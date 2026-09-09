/**
 * app.js — orchestrator / state machine (spec §4).
 *
 * The loop:
 *   research → plan → diagnose → [teach → check → adapt]* → quiz → result
 *
 * Two things carried over from NowPod that matter more here than they did there:
 *
 * 1. The runId stale-async guard (isCurrentRun). Poducator has more async
 *    phases than NowPod did, so a student who restarts mid-generation has more
 *    ways to strand a promise that then writes into a dead session.
 *
 * 2. Overlapping generation with playback. The next chapter starts generating
 *    the moment the checkpoint resolves, while the current chapter's audio tail
 *    is still playing — so the lesson never stalls on a render. The difference
 *    is that here the checkpoint OUTCOME feeds that generation, which is
 *    exactly why it is resolved during the riff rather than at the end.
 */

import { API_KEY_STORAGE_KEY, CHECKPOINT_LINES, CHECKPOINT_OUTCOME } from './config.js';
import * as sources from './sources/index.js';
import * as claude from './claude.js';
import * as assessment from './assessment.js';
import * as objectivesLib from './objectives.js';
import * as tts from './tts.js';
import * as store from './store.js';
import * as ui from './ui.js';

/** @type {Object|null} */
let state = null;
let runCounter = 0;

/** Lets an open checkpoint be resolved from outside the play loop. */
let checkpointResolve = null;

function main() {
  ui.init();
  ui.bindHandlers({ onStart, onSkip, onRestart });
  ui.setApiKey(localStorage.getItem(API_KEY_STORAGE_KEY) ?? '');
  ui.showView('start');
  tts.initVoices();
  store.flush(); // drain anything stranded by a previous session's bad wifi
  reportPending();
}

/** True while this run is still the active one. */
function isCurrentRun(run) {
  return run !== null && run === state && run.runId === runCounter;
}

async function reportPending() {
  const n = await store.pendingCount();
  ui.setOfflineNote(n > 0 ? `${n} result${n === 1 ? '' : 's'} waiting to sync.` : '');
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function onStart() {
  const { topic, gradeBand, apiKey } = ui.readStart();
  if (!topic) return;
  if (!apiKey) {
    ui.setStatus('Paste a Claude API key to build the lesson.', true);
    return;
  }
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  ui.cancelSourceConfirm();

  state = {
    runId: ++runCounter,
    topic,
    gradeBand,
    apiKey,
    source: null,
    objectives: [],
    diagnosticItems: [],
    finalItems: [],
    responses: [],
    gaps: [],
    chapterQueue: [],
    playedChapters: [],
    retaught: new Set(),
    priorSummary: '',
    lastCheckpoint: null,
    session: store.newSession({ topic, gradeBand, mode: 'explore' }),
  };

  try {
    if (!(await research())) return;
    if (!(await planLesson())) return;
    if (!(await runDiagnostic())) return;
    if (!(await teach())) return;
    await runFinalQuiz();
    await finish();
  } catch (err) {
    if (!isCurrentRun(state)) return;
    tts.stop();
    ui.hideCheckpoint();
    ui.showView('start');
    ui.setStatus(err?.message ?? 'Something went wrong — try again.', true);
  }
}

/* ------------------------------------------------------------------ */
/* Research                                                            */
/* ------------------------------------------------------------------ */

async function research() {
  const run = state;
  ui.setStatus(`Looking up "${run.topic}"…`);

  const { candidates, needsConfirmation } = await sources.research(run.topic, {
    gradeBand: run.gradeBand,
  });
  if (!isCurrentRun(run)) return false;

  let chosen = candidates[0];
  if (needsConfirmation) {
    ui.setStatus('');
    chosen = await ui.showSourceConfirm(run.topic, candidates);
    if (!isCurrentRun(run)) return false;
    if (!chosen) {
      ui.setStatus('No problem — reword your topic and start again.');
      return false;
    }
  }

  ui.setStatus(`Reading up on "${chosen.title}"…`);
  run.source = await sources.build(chosen);
  if (!isCurrentRun(run)) return false;

  // Reference list (spec §12): the articles actually used, not a generic note.
  ui.renderReferences(run.source.refs);
  run.session.refs = run.source.refs;
  run.session.topic = run.source.title;
  return true;
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

async function planLesson() {
  const run = state;
  ui.setStatus('Working out what this lesson should cover…');

  const result = await claude.plan(
    {
      topic: run.source.title,
      source: run.source.text,
      gradeBand: run.gradeBand,
      // Assigned mode passes the teacher's objectives here; explore mode
      // leaves it undefined and the model infers them.
      objectives: run.assignedObjectives,
    },
    { apiKey: run.apiKey }
  );
  if (!isCurrentRun(run)) return false;

  run.objectives = result.objectives;
  run.diagnosticItems = result.diagnostic;

  // Guard the parallel-form property (spec §9). A wrap-up item that reuses a
  // diagnostic prompt turns the growth delta into a memory test, so drop it —
  // but only if enough items survive to still measure anything.
  const { duplicates } = assessment.checkParallelForms(result.diagnostic, result.final);
  if (duplicates.length > 0) {
    const deduped = result.final.filter((i) => !duplicates.includes(i));
    run.finalItems = deduped.length >= 2 ? deduped : result.final;
    console.warn(
      `${duplicates.length} wrap-up item(s) duplicated the diagnostic.`,
      deduped.length >= 2 ? 'Dropped.' : 'Kept — too few items would remain.'
    );
  } else {
    run.finalItems = result.final;
  }

  run.session.objectives = run.objectives;
  return true;
}

/* ------------------------------------------------------------------ */
/* Diagnostic                                                          */
/* ------------------------------------------------------------------ */

async function runDiagnostic() {
  const run = state;
  ui.setStatus('');
  ui.showView('assess');

  for (const [i, item] of run.diagnosticItems.entries()) {
    const askedAt = Date.now();
    // No feedback during the diagnostic: showing the answer here would teach
    // the very thing being measured and contaminate the baseline (spec §9).
    const answer = await ui.askItem(item, {
      heading: 'Before we start — what do you already know?',
      index: i,
      total: run.diagnosticItems.length,
      showFeedback: false,
    });
    if (!isCurrentRun(run)) return false;

    run.responses.push(
      assessment.recordResponse(item, answer, {
        phase: 'diagnostic',
        latencyMs: Date.now() - askedAt,
      })
    );
  }

  run.gaps = objectivesLib.buildGapProfile(
    run.objectives,
    run.diagnosticItems,
    run.responses.filter((r) => r.phase === 'diagnostic')
  );
  run.chapterQueue = objectivesLib.planChapters(run.objectives, run.gaps);

  if (run.chapterQueue.length === 0) {
    throw new Error('Could not build a lesson plan from that topic — try another.');
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Teach                                                               */
/* ------------------------------------------------------------------ */

function chapterInput(chapter, index, total) {
  const run = state;
  return {
    topic: run.source.title,
    source: run.source.text,
    gradeBand: run.gradeBand,
    chapter,
    priorSummary: run.priorSummary,
    chapterIndex: index,
    chapterTotal: total,
    lastCheckpoint: run.lastCheckpoint,
  };
}

/**
 * The teaching loop. The chapter queue is mutable: a missed checkpoint
 * re-queues its objective immediately next with a different strategy
 * (objectives.applyCheckpoint), so the plan adapts as it runs.
 */
async function teach() {
  const run = state;
  ui.clearTranscript();
  ui.showView('player');

  // Total is a moving target once reteach chapters can be inserted, so this is
  // the planned length — the header says "of about N" rather than lying.
  const plannedTotal = run.chapterQueue.length;
  let index = 0;

  ui.setChapterHeader(run.source.title, 'Preparing the first chapter…', '');
  let pending = claude.chapter(chapterInput(run.chapterQueue[0], 0, plannedTotal), {
    apiKey: run.apiKey,
  });

  while (isCurrentRun(run) && run.chapterQueue.length > 0) {
    const planned = run.chapterQueue.shift();
    const generated = await pending;
    if (!isCurrentRun(run)) return false;

    const isLast = run.chapterQueue.length === 0;
    ui.setChapterHeader(
      run.source.title,
      `Chapter ${index + 1} of about ${Math.max(plannedTotal, index + 1)}`,
      planned.isReteach ? `Another look at: ${planned.objectiveText}` : planned.objectiveText
    );
    ui.renderChapterLines(generated.lines);

    const outcome = await playChapter(generated, planned);
    if (!isCurrentRun(run)) return false;

    run.priorSummary = [run.priorSummary, generated.summary].filter(Boolean).join(' ');
    run.lastCheckpoint = { objectiveText: planned.objectiveText, outcome };
    run.playedChapters.push({
      objectiveId: planned.objectiveId,
      isReteach: Boolean(planned.isReteach),
      lines: generated.lines,
      summary: generated.summary,
      outcome,
    });

    // Adapt the remaining plan to how the check went (spec §6).
    run.chapterQueue = objectivesLib.applyCheckpoint(
      run.chapterQueue,
      planned,
      outcome,
      run.retaught
    );

    index += 1;
    if (run.chapterQueue.length > 0) {
      ui.setChapterHeader(
        run.source.title,
        `Chapter ${index} done — preparing the next…`,
        run.chapterQueue[0].objectiveText
      );
      pending = claude.chapter(
        chapterInput(run.chapterQueue[0], index, Math.max(plannedTotal, index + 1)),
        { apiKey: run.apiKey }
      );
    } else if (!isLast) {
      break;
    }
  }

  return isCurrentRun(run);
}

/**
 * Play one chapter and collect its checkpoint outcome.
 *
 * The checkpoint panel opens as Host A asks the question, and Host B's riff is
 * the answer window. If the student answers, playback continues uninterrupted.
 * If they don't, Host A speaks the answer aloud afterwards (spec §6) — the show
 * never goes silent waiting, and never pretends the question wasn't asked.
 *
 * @returns {Promise<string>} A CHECKPOINT_OUTCOME value.
 */
async function playChapter(generated, planned) {
  const run = state;
  const { lines, checkpoint } = generated;

  // Host A asks at this line; the remaining lines are the riff / answer window.
  const checkpointAt = Math.max(0, lines.length - CHECKPOINT_LINES);
  let answer = assessment.NO_ANSWER;
  let askedAt = 0;

  const answered = new Promise((resolve) => {
    checkpointResolve = resolve;
  });

  const playback = tts.speakChapter(lines, (i) => {
    if (!isCurrentRun(run)) return;
    ui.highlightLine(i);
    if (checkpoint && i === checkpointAt) {
      askedAt = Date.now();
      ui.showCheckpoint(checkpoint).then((picked) => checkpointResolve?.(picked));
    }
  });

  // Playback must never reject the loop. tts.speakLine degrades to a pacing
  // timer rather than throwing, but a rejection here would strand the
  // checkpoint promise forever and hang the lesson, so it is neutralized at
  // the boundary too — a stalled lesson is the one failure a student cannot
  // work around.
  const finished = playback.catch((err) => {
    console.warn('Playback failed; continuing without audio.', err);
  });

  if (!checkpoint) {
    await finished;
    checkpointResolve = null;
    return CHECKPOINT_OUTCOME.NO_RESPONSE;
  }

  // When the audio ends with nothing picked, the checkpoint resolves as
  // unanswered — the window was the riff, and the riff is over.
  finished.then(() => {
    ui.cancelCheckpoint();
    checkpointResolve?.(assessment.NO_ANSWER);
  });

  answer = await answered;
  if (!isCurrentRun(run)) return CHECKPOINT_OUTCOME.NO_RESPONSE;

  const outcome =
    answer === assessment.NO_ANSWER
      ? CHECKPOINT_OUTCOME.NO_RESPONSE
      : answer === checkpoint.correctIndex
        ? CHECKPOINT_OUTCOME.CORRECT
        : CHECKPOINT_OUTCOME.INCORRECT;

  run.responses.push(
    assessment.recordResponse(checkpoint, answer, {
      phase: 'checkpoint',
      latencyMs: askedAt ? Date.now() - askedAt : 0,
    })
  );

  if (outcome !== CHECKPOINT_OUTCOME.NO_RESPONSE) {
    ui.flashCheckpointResult(
      outcome === CHECKPOINT_OUTCOME.CORRECT,
      checkpoint.explanation
    );
  }

  await finished;
  checkpointResolve = null;
  if (!isCurrentRun(run)) return outcome;

  // Nobody answered — Host A reveals it out loud rather than letting the
  // question evaporate. This is what keeps an ignored check from feeling like
  // the show forgot it asked.
  if (outcome === CHECKPOINT_OUTCOME.NO_RESPONSE && checkpoint.spokenAnswer) {
    const line = { speaker: 'A', text: checkpoint.spokenAnswer };
    ui.appendLine(line);
    await tts.speakOne(line);
  }

  return outcome;
}

/* ------------------------------------------------------------------ */
/* Wrap-up quiz                                                        */
/* ------------------------------------------------------------------ */

async function runFinalQuiz() {
  const run = state;
  tts.stop();
  ui.hideCheckpoint();

  if (run.finalItems.length === 0) return;
  ui.showView('assess');

  for (const [i, item] of run.finalItems.entries()) {
    const askedAt = Date.now();
    // Feedback IS shown here — the measurement is already taken by the time it
    // appears, and a student who just finished a lesson deserves to know.
    const answer = await ui.askItem(item, {
      heading: 'Last thing — show what you picked up',
      index: i,
      total: run.finalItems.length,
      showFeedback: true,
    });
    if (!isCurrentRun(run)) return;

    run.responses.push(
      assessment.recordResponse(item, answer, {
        phase: 'final',
        latencyMs: Date.now() - askedAt,
      })
    );
  }
}

/* ------------------------------------------------------------------ */
/* Finish                                                              */
/* ------------------------------------------------------------------ */

async function finish() {
  const run = state;
  if (!isCurrentRun(run)) return;

  const growth = assessment.growth(
    run.responses.filter((r) => r.phase === 'diagnostic'),
    run.responses.filter((r) => r.phase === 'final')
  );

  ui.renderResult(growth, run.objectives, run.gaps);
  ui.showView('result');

  run.session.responses = run.responses;
  run.session.chapters = run.playedChapters;
  run.session.completedAt = new Date().toISOString();
  await store.enqueue(run.session);
  reportPending();
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

/** Skip → stop audio; an open checkpoint resolves as unanswered. */
function onSkip() {
  tts.stop();
  ui.cancelCheckpoint();
  checkpointResolve?.(assessment.NO_ANSWER);
}

/** Restart → invalidate the run so stale async work can't write into it. */
function onRestart() {
  runCounter += 1;
  state = null;
  checkpointResolve = null;
  tts.stop();
  ui.hideCheckpoint();
  ui.hideSourceConfirm();
  ui.setStatus('');
  ui.showView('start');
  reportPending();
}

main();
