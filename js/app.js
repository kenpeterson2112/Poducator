/**
 * app.js — orchestrator / state machine (spec §4).
 *
 * The loop, now that the lesson is curriculum-driven:
 *
 *   [educator picks 1-3 expectations] → shareable link
 *   [learner opens link] → diagnose → [teach → check → adapt]* → quiz → result
 *
 * Two structural changes from Phase 1 worth knowing before reading:
 *
 * 1. THE PLANNING CALL IS GONE. Objectives are curriculum expectations the
 *    educator locked in; assessment items are pre-built and human-reviewed in
 *    js/curriculum/items.js. The diagnostic can therefore start the instant the
 *    learner presses go, with no network round trip in front of it.
 *
 * 2. SOURCE FETCHING OVERLAPS THE DIAGNOSTIC. The three diagnostic questions
 *    need no network at all, so the wiki fetches for every selected expectation
 *    run underneath them. By the time the learner answers question three the
 *    grounding material is usually already in hand and the first chapter call
 *    can fire immediately.
 *
 * Carried over from NowPod and still load-bearing:
 *
 * - The runId stale-async guard (isCurrentRun). More async phases than NowPod
 *   had means more ways to strand a promise that then writes into a dead run.
 * - Overlapping generation with playback: the next chapter starts generating
 *   the moment the checkpoint resolves, while the current chapter's audio tail
 *   is still playing. The checkpoint OUTCOME feeds that generation, which is
 *   why it is resolved during the riff rather than at the end.
 */

import {
  API_KEY_STORAGE_KEY,
  PASSPHRASE_STORAGE_KEY,
  PROXY_URL,
  usingProxy,
  CHECKPOINT_LINES,
  CHECKPOINT_OUTCOME,
} from './config.js';
import * as sources from './sources/index.js';
import * as claude from './claude.js';
import * as assessment from './assessment.js';
import * as objectivesLib from './objectives.js';
import * as curriculum from './curriculum/index.js';
import { CURRICULUM, byStrand } from './curriculum/ontario-sci-7-d.js';
import * as tts from './tts.js';
import * as store from './store.js';
import * as ui from './ui.js';

/** @type {Object|null} */
let state = null;
let runCounter = 0;

/** The lesson an educator locked in, read from the URL. */
let lesson = null;

/** Lets an open checkpoint be resolved from outside the play loop. */
let checkpointResolve = null;

function main() {
  ui.init();
  ui.bindHandlers({
    onStart,
    onSkip,
    onRestart,
    onSelectionChange: refreshLessonLink,
    onPreviewLesson,
  });
  ui.setCredentialMode(usingProxy());
  ui.setPassphrase(localStorage.getItem(PASSPHRASE_STORAGE_KEY) ?? '');
  ui.setApiKey(localStorage.getItem(API_KEY_STORAGE_KEY) ?? '');
  tts.initVoices();
  store.flush(); // drain anything stranded by a previous session's bad wifi
  reportPending();

  window.addEventListener('hashchange', route);
  route();
}

/**
 * One decision, taken from the URL: a hash carrying a valid expectation
 * selection puts the app in learner mode with that lesson locked; anything else
 * shows the educator's picker. This is what "locked in for the learner" means
 * with no accounts and no server — a learner opening the link gets an interface
 * with no control that changes what is taught.
 */
function route() {
  onRestart({ silent: true });
  lesson = curriculum.parseLessonConfig(location.hash);

  if (lesson) {
    ui.renderLockedLesson(curriculum.toObjectives(lesson.codes), {
      curriculumLabel: CURRICULUM.label,
      strandTitle: CURRICULUM.strandTitle,
    });
    ui.showView('start');
  } else {
    ui.renderEducatorPicker(byStrand(), CURRICULUM);
    refreshLessonLink();
    ui.showView('educator');
  }
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
/* Educator mode                                                       */
/* ------------------------------------------------------------------ */

/** Live-update the shareable link as the educator checks expectations. */
function refreshLessonLink() {
  const selection = ui.readEducatorSelection();
  const valid = curriculum.isValidSelection(selection.codes);
  ui.setLessonLink(
    valid ? new URL(curriculum.encodeLessonConfig(selection), location.href).href : '',
    selection.codes.length
  );
}

/** "Preview as a learner" — the educator's own selection, locked the same way. */
function onPreviewLesson() {
  const selection = ui.readEducatorSelection();
  if (!curriculum.isValidSelection(selection.codes)) return;
  location.hash = curriculum.encodeLessonConfig(selection);
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function onStart() {
  if (!lesson) return;
  // One credentials object, built once, threaded through every generation
  // call. claude.js:callClaude already branches on proxyUrl, so which mode is
  // active stays a single decision made here rather than at each call site.
  let credentials;
  if (usingProxy()) {
    const { passphrase } = ui.readStart();
    if (!passphrase) {
      ui.setStatus('Enter the class passphrase to start.', true);
      return;
    }
    localStorage.setItem(PASSPHRASE_STORAGE_KEY, passphrase);
    credentials = { proxyUrl: PROXY_URL, passphrase };
  } else {
    const { apiKey } = ui.readStart();
    if (!apiKey) {
      ui.setStatus('Paste a Claude API key to build the lesson.', true);
      return;
    }
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    credentials = { apiKey };
  }

  const objectives = curriculum.toObjectives(lesson.codes);
  const { diagnostic, final } = curriculum.sampleItems(lesson.codes);

  state = {
    runId: ++runCounter,
    lessonTitle: curriculum.lessonTitle(lesson),
    gradeBand: lesson.gradeBand,
    credentials,
    objectives,
    diagnosticItems: diagnostic,
    finalItems: final,
    sourcesByCode: new Map(),
    responses: [],
    gaps: [],
    chapterQueue: [],
    playedChapters: [],
    retaught: new Set(),
    priorSummary: '',
    lastCheckpoint: null,
    session: store.newSession({
      mode: 'assigned',
      topic: curriculum.lessonTitle(lesson),
      gradeBand: lesson.gradeBand,
      curriculumId: CURRICULUM.id,
      expectations: lesson.codes,
      objectives,
    }),
  };

  try {
    // Sources fetch underneath the diagnostic rather than in front of it. The
    // three questions need no network, so this costs the learner nothing.
    const gathering = gatherSources(state);

    if (!(await runDiagnostic())) return;
    if (!(await gathering)) return;
    if (!(await teach())) return;
    await runFinalQuiz();
    await finish();
  } catch (err) {
    if (!isCurrentRun(state)) return;
    tts.stop();
    ui.hideCheckpoint();
    // Don't keep a passphrase the server rejected — otherwise it prefills the
    // field on every reload and the learner retries the same wrong value.
    if (err?.code === 'bad_passphrase') localStorage.removeItem(PASSPHRASE_STORAGE_KEY);
    ui.showView('start');
    ui.setStatus(err?.message ?? 'Something went wrong — try again.', true);
  }
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/**
 * Pull grounding material for every selected expectation, in parallel.
 *
 * Fails soft all the way down: an expectation whose articles are missing still
 * gets a chapter, because the curriculum `brief` carries enough for the model
 * to teach from. Losing the wiki text costs depth, not the lesson.
 */
async function gatherSources(run) {
  const { byCode, refs } = await sources.buildLessonSources(run.objectives, {
    gradeBand: run.gradeBand,
  });
  if (!isCurrentRun(run)) return false;

  run.sourcesByCode = byCode;
  ui.renderReferences(refs);
  run.session.refs = refs;
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
      heading: 'Before we start — what do you already think?',
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
    throw new Error('Could not build a lesson plan from that selection.');
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Teach                                                               */
/* ------------------------------------------------------------------ */

function chapterInput(chapter, index, total) {
  const run = state;
  const source = run.sourcesByCode.get(chapter.objectiveId);
  return {
    lessonTitle: run.lessonTitle,
    // Only this expectation's material — not the whole lesson's. A focused
    // prompt teaches the expectation rather than the topic around it.
    source: source?.text ?? '',
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
 * re-queues its expectation immediately next with a different strategy
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

  ui.setChapterHeader(run.lessonTitle, 'Preparing the first chapter…', '');
  let pending = claude.chapter(
    chapterInput(run.chapterQueue[0], 0, plannedTotal),
    run.credentials
  );

  while (isCurrentRun(run) && run.chapterQueue.length > 0) {
    const planned = run.chapterQueue.shift();
    const generated = await pending;
    if (!isCurrentRun(run)) return false;

    const isLast = run.chapterQueue.length === 0;
    ui.setChapterHeader(
      run.lessonTitle,
      `Chapter ${index + 1} of about ${Math.max(plannedTotal, index + 1)}`,
      planned.isReteach ? `Another look at: ${planned.objectiveShort}` : planned.objectiveShort,
      planned.objectiveId
    );
    ui.renderChapterLines(generated.lines);

    const outcome = await playChapter(generated, planned);
    if (!isCurrentRun(run)) return false;

    run.priorSummary = [run.priorSummary, generated.summary].filter(Boolean).join(' ');
    run.lastCheckpoint = { objectiveText: planned.objectiveText, outcome };
    run.playedChapters.push({
      objectiveId: planned.objectiveId,
      status: planned.status,
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
        run.lessonTitle,
        `Chapter ${index} done — preparing the next…`,
        run.chapterQueue[0].objectiveShort,
        run.chapterQueue[0].objectiveId
      );
      pending = claude.chapter(
        chapterInput(run.chapterQueue[0], index, Math.max(plannedTotal, index + 1)),
        run.credentials
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
 * the answer window. If the learner answers, playback continues uninterrupted.
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
  // the boundary too — a stalled lesson is the one failure a learner cannot
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
    // appears, and a learner who just finished a lesson deserves to know.
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

/**
 * Restart → invalidate the run so stale async work can't write into it.
 * `silent` is used by the router, which is about to pick its own view.
 */
function onRestart(opts = {}) {
  runCounter += 1;
  state = null;
  checkpointResolve = null;
  tts.stop();
  ui.hideCheckpoint();
  ui.setStatus('');
  if (opts.silent !== true) ui.showView(lesson ? 'start' : 'educator');
  reportPending();
}

main();
