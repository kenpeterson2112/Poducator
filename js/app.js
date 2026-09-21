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
  LENGTHS,
  DEFAULT_LENGTH,
  CHAPTER_BOUNDS,
  estimateMinutes,
  scaleDepth,
  API_KEY_STORAGE_KEY,
  PASSPHRASE_STORAGE_KEY,
  PROXY_URL,
  usingProxy,
  CHECKPOINT_LINES,
  CHECKPOINT_OUTCOME,
  SMART_PREV_LINE_THRESHOLD,
  LINE_SEEK_COUNT,
  SPEED_PRESETS,
  SPEED_STORAGE_KEY,
} from './config.js';
import * as sources from './sources/index.js';
import * as claude from './claude.js';
import * as assessment from './assessment.js';
import * as objectivesLib from './objectives.js';
import * as curriculum from './curriculum/index.js';
import { CURRICULUM, byStrand } from './curriculum/ontario-sci-7-d.js';
import * as tts from './tts.js';
import * as store from './store.js';
import * as sessionfile from './sessionfile.js';
import * as ui from './ui.js';

/** @type {Object|null} */
let state = null;
let runCounter = 0;

/** The lesson an educator locked in, read from the URL. */
let lesson = null;

/** Lets an open checkpoint be resolved from outside the play loop. */
let checkpointResolve = null;

/**
 * The listener's chosen playback speed — a device preference (config.js
 * SPEED_STORAGE_KEY), never part of a session record. Applied as a multiplier
 * on top of each host's own fixed rate (tts.js speakLine).
 */
let rateMultiplier = 1;
function getRateMultiplier() {
  return rateMultiplier;
}

/** A sentinel `playChapter()` returns instead of a CHECKPOINT_OUTCOME when the
 * chapter was torn down for a restart, not genuinely finished. Never persisted
 * — teach()'s retry loop consumes it and calls playChapter() again. */
const CHAPTER_RESTART = Symbol('chapter-restart');

function main() {
  ui.init();
  ui.bindHandlers({
    onStart,
    onSkip,
    onRestart,
    onPrevious,
    onRewindLines,
    onForwardLines,
    onSetSpeed,
    onJumpToChapter,
    onSelectionChange: refreshLessonLink,
    onPreviewLesson,
    onStudentStart,
    onShare,
    onExportSession,
    onImportFile,
    onPlaySaved,
    onDeleteSession,
    onOpenLibrary: openLibrary,
  });
  ui.setCredentialMode(usingProxy());
  ui.setStudentCredentialMode(usingProxy(), localStorage.getItem(PASSPHRASE_STORAGE_KEY) ?? '');
  ui.setPassphrase(localStorage.getItem(PASSPHRASE_STORAGE_KEY) ?? '');
  ui.setApiKey(localStorage.getItem(API_KEY_STORAGE_KEY) ?? '');
  try {
    const stored = Number(localStorage.getItem(SPEED_STORAGE_KEY));
    if (SPEED_PRESETS.includes(stored)) rateMultiplier = stored;
  } catch {
    /* private browsing, or no storage at all — the 1x default already set */
  }
  ui.setActiveSpeedPill(rateMultiplier);
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

  if (location.hash === '#saved') {
    lesson = null;
    showLibrary();
    return;
  }

  lesson = curriculum.parseLessonConfig(location.hash);

  // Student mode is now the front door. A teacher who bookmarked the bare URL
  // lands here instead of the picker — the "Teaching a class?" link on the
  // student screen is the way back, and existing #e=… lesson links are
  // untouched.
  if (!lesson && location.hash !== '#teach') {
    ui.cancelSourceConfirm();
    ui.setStudentStatus('');
    ui.showView('student');
    return;
  }

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
    // Player-control state (Previous, rewind/forward, chapter dots, review
    // mode) — see playChapter()/onJumpToChapter(). Harmless before the first
    // chapter starts; a control clicked during the diagnostic just no-ops.
    currentChapterIndex: 0,
    currentLineIndex: 0,
    currentLines: null,
    currentCheckpointAt: 0,
    pendingSeek: null,
    restartRequested: false,
    reviewing: null,
    suspendUntil: null,
    exitReview: null,
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
      // Items travel with the session so a saved file rereads the questions it
      // actually asked, and a replay can ask them without the item bank.
      diagnosticItems: diagnostic,
      finalItems: final,
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

async function runDiagnostic(opts = {}) {
  const run = state;
  ui.setStatus('');

  // Student mode makes the opener optional, so an empty set is a normal path,
  // not an error. With no answers the gap profile treats every objective as
  // UNKNOWN, which leaves the chapter order as the model's prerequisite order.
  if (run.diagnosticItems.length === 0) {
    run.gaps = objectivesLib.buildGapProfile(run.objectives, [], []);
    run.chapterQueue = objectivesLib.planChapters(run.objectives, run.gaps);
    if (run.chapterQueue.length === 0) {
      throw new Error('Could not build a lesson plan from that topic.');
    }
    applyLengthScale(run);
    store.saveProgress(run.session);
    return true;
  }

  ui.showView('assess');

  for (const [i, item] of run.diagnosticItems.entries()) {
    const askedAt = Date.now();
    // No feedback during the diagnostic: showing the answer here would teach
    // the very thing being measured and contaminate the baseline (spec §9).
    const answer = await ui.askItem(item, {
      heading: opts.heading ?? 'Before we start — what do you already think?',
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

  applyLengthScale(run);

  // First save point. Everything before this — three answered questions — used
  // to vanish if the learner closed the tab during chapter one.
  run.session.responses = run.responses;
  store.saveProgress(run.session);
  return true;
}

/**
 * Apply the student's chosen length to the planned chapters.
 *
 * Scales rather than replaces objectives.depthFor(), which already sizes each
 * chapter by how well the opener says the learner knows it (CHAPTER_DEPTH). A
 * flat "make everything longer" would erase that — a misconception chapter is
 * long for a reason, and should stay longer than a solid one at every length.
 * Curriculum mode has no length control, so this is a no-op there.
 */
function applyLengthScale(run) {
  const scale = run.length?.depthScale;
  if (!scale || scale === 1) return;
  run.chapterQueue = run.chapterQueue.map((c) => ({ ...c, depth: scaleDepth(c.depth, scale) }));
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

    // Mirrored onto `run` so player-control handlers (Previous, chapter dots)
    // can see "which chapter is live" without a closure into this loop.
    run.currentChapterIndex = index;
    ui.renderChapterDots(index);

    // A restart tears the attempt down and hands back CHAPTER_RESTART rather
    // than a real outcome (see playChapter) — retry on the SAME already-
    // generated chapter until one attempt actually finishes. No network call.
    let outcome = await playChapter(generated, planned);
    while (outcome === CHAPTER_RESTART && isCurrentRun(run)) {
      outcome = await playChapter(generated, planned);
    }
    if (!isCurrentRun(run)) return false;

    run.priorSummary = [run.priorSummary, generated.summary].filter(Boolean).join(' ');
    run.lastCheckpoint = { objectiveText: planned.objectiveText, outcome };
    run.playedChapters.push({
      objectiveId: planned.objectiveId,
      objectiveShort: planned.objectiveShort,
      objectiveText: planned.objectiveText,
      status: planned.status,
      isReteach: Boolean(planned.isReteach),
      lines: generated.lines,
      // The checkpoint is kept, not just its outcome: replaying a session has
      // to be able to ask the question again, and a hand-authored demo file
      // needs somewhere to put one.
      checkpoint: generated.checkpoint,
      summary: generated.summary,
      outcome,
    });

    // Save after every chapter, so an interrupted lesson keeps what it played.
    run.session.responses = run.responses;
    run.session.chapters = run.playedChapters;
    store.saveProgress(run.session);

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
 * Player controls (rewind, forward-a-few-lines, a live speed change, restart,
 * chapter review) all interrupt the same way: stop whatever is speaking and
 * let this function decide what happens next. None of them invent a second
 * interruption pathway — see the inner loop below.
 *
 * @returns {Promise<string|symbol>} A CHECKPOINT_OUTCOME value, or
 *   CHAPTER_RESTART if the attempt was torn down for a restart (the caller —
 *   teach() or replay() — retries on the same already-generated chapter).
 */
async function playChapter(generated, planned) {
  const run = state;
  const { lines, checkpoint } = generated;

  // Host A asks at this line; the remaining lines are the riff / answer window.
  const checkpointAt = Math.max(0, lines.length - CHECKPOINT_LINES);
  // Set once the panel first opens, so a rewind that crosses back over this
  // line doesn't reopen it — rewinding is for re-hearing dialogue, not
  // re-taking the quiz. Only a genuine restart (below) resets this.
  let checkpointShown = false;
  let answer = assessment.NO_ANSWER;
  let askedAt = 0;

  run.currentLines = lines;
  run.currentCheckpointAt = checkpointAt;
  run.currentLineIndex = 0;
  run.restartRequested = false;
  run.skipRequested = false;
  run.pendingSeek = null;

  const answered = new Promise((resolve) => {
    checkpointResolve = resolve;
  });

  // Owns every tts.speakChapter() call for this chapter — a plain finish, a
  // rewind/forward/speed-change (pendingSeek: restart at a new index in this
  // SAME chapter), and a pause for chapter review (suspendUntil: hold here
  // without ending, so reviewing an earlier chapter never counts as this one
  // finishing). `playback`, and therefore `finished` below, only settle once
  // this loop truly ends — so the "audio ended, nobody answered" fallback
  // further down can never fire on a mid-chapter interruption, only on a
  // genuine finish.
  const playback = (async () => {
    let index = 0;
    while (true) {
      run.pendingSeek = null;
      await tts.speakChapter(
        lines,
        (i) => {
          if (!isCurrentRun(run)) return;
          run.currentLineIndex = i;
          ui.highlightLine(i);
          if (checkpoint && i === checkpointAt && !checkpointShown) {
            checkpointShown = true;
            askedAt = Date.now();
            ui.showCheckpoint(checkpoint).then((picked) => checkpointResolve?.(picked));
          }
        },
        { startIndex: index, rateMultiplier: getRateMultiplier() }
      );

      // restartCurrentChapter()/onSkip() already woke `answered` directly —
      // this loop's only job on either signal is to stop, not decide anything.
      if (run.restartRequested || run.skipRequested) break;

      if (run.suspendUntil) {
        // Paused for chapter review. Re-check after every wake: switching
        // straight from reviewing one earlier chapter to another replaces
        // suspendUntil before this resolves, so this keeps waiting instead of
        // resuming the live chapter in between — and a restart/skip that
        // arrives while paused (e.g. hitting Skip mid-review) must break here
        // too, or the live chapter would silently resume speaking instead of
        // ending, leaving `finished` — and teach()'s wait on it — stuck behind
        // audio nobody asked to hear anymore.
        index = run.currentLineIndex;
        while (run.suspendUntil) {
          await run.suspendUntil;
          if (run.restartRequested || run.skipRequested) break;
        }
        if (run.restartRequested || run.skipRequested) break;
        continue;
      }

      if (run.pendingSeek && isCurrentRun(run)) {
        index = run.pendingSeek.index;
        continue;
      }
      break;
    }
  })();

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
    if (run.restartRequested) {
      run.restartRequested = false;
      return CHAPTER_RESTART;
    }
    return CHECKPOINT_OUTCOME.NO_RESPONSE;
  }

  // When the audio genuinely ends with nothing picked, the checkpoint
  // resolves as unanswered — the window was the riff, and the riff is over.
  finished.then(() => {
    ui.cancelCheckpoint();
    checkpointResolve?.(assessment.NO_ANSWER);
  });

  answer = await answered;
  if (!isCurrentRun(run)) return CHECKPOINT_OUTCOME.NO_RESPONSE;

  if (run.restartRequested) {
    // Woken by restartCurrentChapter(), not a real answer or a real finish —
    // let the torn-down attempt actually wind down before handing back the
    // sentinel, so two attempts can never be in flight at once.
    run.restartRequested = false;
    await finished;
    checkpointResolve = null;
    return CHAPTER_RESTART;
  }

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
    await tts.speakOne(line, { rateMultiplier: getRateMultiplier() });
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

  ui.setResultMode('curriculum');
  ui.renderResult(growth, run.objectives, run.gaps);
  ui.showView('result');

  run.session.responses = run.responses;
  run.session.chapters = run.playedChapters;
  run.session.completedAt = new Date().toISOString();
  run.session.inProgress = false;
  await store.enqueue(run.session);
  ui.setResultSession(run.session);
  reportPending();
}

/* ------------------------------------------------------------------ */
/* Student mode (P2)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Share the app itself — the landing page has nothing else worth sharing yet,
 * and a decorative icon that does nothing is worse than no icon.
 *
 * Deliberately shares the app root, not location.href: a lesson hash would
 * hand a classmate someone else's locked lesson rather than the app.
 */
async function onShare() {
  const url = new URL('.', location.href).href;
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Poducator', text: 'A lesson you can talk back to.', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    ui.setStudentStatus('Link copied.');
  } catch {
    // A cancelled share sheet lands here too, which is not an error worth
    // reporting — the learner simply changed their mind.
  }
}

/**
 * Build the credentials object for a student run, or throw with a message fit
 * to show the learner. Same shape curriculum mode builds in onStart —
 * claude.js:callClaude branches on proxyUrl, so which mode is live stays one
 * decision rather than one per call site.
 */
function readCredentials() {
  if (usingProxy()) {
    const { passphrase } = ui.readStudent();
    const value = passphrase || localStorage.getItem(PASSPHRASE_STORAGE_KEY) || '';
    if (!value) throw new Error('Enter the class passphrase to start.');
    localStorage.setItem(PASSPHRASE_STORAGE_KEY, value);
    return { proxyUrl: PROXY_URL, passphrase: value };
  }
  const apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  if (!apiKey) throw new Error('No API key saved — open a curriculum lesson once to set one.');
  return { apiKey };
}

/**
 * Student mode start: topic → sources → objectives → optional opener → teach.
 *
 * The one structural difference from curriculum mode is what happens at the
 * end: this path does NOT score. The opening questions steer the lesson (they
 * feed the same gap profile) and are never reported back, because with an
 * optional opener there is often no baseline, and with model-authored items
 * there would be no independent test to measure against. See spec §7b.
 */
async function onStudentStart() {
  const { topic, length, gradeBand, wantDiagnostic } = ui.readStudent();
  if (!topic) return;

  let credentials;
  try {
    credentials = readCredentials();
  } catch (err) {
    return ui.setStudentStatus(err.message, true);
  }

  ui.cancelSourceConfirm();
  const plan = LENGTHS[length] ?? LENGTHS[DEFAULT_LENGTH];

  state = {
    runId: ++runCounter,
    lessonTitle: topic,
    gradeBand,
    credentials,
    isStudent: true,
    length: plan,
    objectives: [],
    diagnosticItems: [],
    finalItems: [], // student mode never runs a wrap-up quiz
    sourcesByCode: new Map(),
    responses: [],
    gaps: [],
    chapterQueue: [],
    playedChapters: [],
    // Player-control state (Previous, rewind/forward, chapter dots, review
    // mode) — see playChapter()/onJumpToChapter(). Harmless before the first
    // chapter starts; a control clicked during the diagnostic just no-ops.
    currentChapterIndex: 0,
    currentLineIndex: 0,
    currentLines: null,
    currentCheckpointAt: 0,
    pendingSeek: null,
    restartRequested: false,
    reviewing: null,
    suspendUntil: null,
    exitReview: null,
    retaught: new Set(),
    priorSummary: '',
    lastCheckpoint: null,
    session: store.newSession({
      mode: 'explore',
      topic,
      gradeBand,
      curriculumId: null,
      expectations: [],
    }),
  };
  const run = state;

  try {
    ui.setStudentStatus(`Looking up "${topic}"…`);
    const { candidates, needsConfirmation } = await sources.research(topic, { gradeBand });
    if (!isCurrentRun(run)) return;

    let chosen = candidates[0];
    if (needsConfirmation) {
      ui.setStudentStatus('');
      chosen = await ui.showSourceConfirm(topic, candidates);
      if (!isCurrentRun(run)) return;
      if (!chosen) return ui.setStudentStatus('No problem — reword it and try again.');
    }

    ui.setStudentStatus(`Reading up on "${chosen.title}"…`);
    const source = await sources.build(chosen);
    if (!isCurrentRun(run)) return;

    run.lessonTitle = chosen.title;
    run.session.topic = chosen.title;
    run.session.refs = source.refs;
    ui.renderReferences(source.refs);

    ui.setStudentStatus('Working out what to cover…');
    const planned = await claude.plan(
      {
        topic: chosen.title,
        source: source.text,
        gradeBand,
        objectiveTarget: Math.min(plan.objectives, CHAPTER_BOUNDS.max),
        wantDiagnostic,
      },
      run.credentials
    );
    if (!isCurrentRun(run)) return;

    run.objectives = planned.objectives;
    run.diagnosticItems = wantDiagnostic ? planned.diagnostic : [];
    run.session.objectives = planned.objectives;
    run.session.diagnosticItems = run.diagnosticItems;

    // Every objective shares the one source blob — unlike curriculum mode,
    // there are no per-expectation curated articles to split by.
    for (const objective of planned.objectives) run.sourcesByCode.set(objective.id, source);

    ui.setStudentStatus('');
    if (!(await runDiagnostic({ heading: 'First — what do you already think?' }))) return;
    if (!(await teach())) return;
    await finishStudent();
  } catch (err) {
    if (!isCurrentRun(run)) return;
    tts.stop();
    ui.hideCheckpoint();
    if (err?.code === 'bad_passphrase') localStorage.removeItem(PASSPHRASE_STORAGE_KEY);
    ui.showView('student');
    ui.setStudentStatus(err?.message ?? 'Something went wrong — try again.', true);
  }
}

/**
 * Student-mode wrap-up. No score, by design — see spec §7b and the note on
 * onStudentStart above.
 */
async function finishStudent() {
  const run = state;
  if (!isCurrentRun(run)) return;

  ui.setResultMode('student');
  ui.renderStudentWrapUp(run.objectives, run.playedChapters);
  ui.showView('result');

  run.session.responses = run.responses;
  run.session.chapters = run.playedChapters;
  run.session.completedAt = new Date().toISOString();
  run.session.inProgress = false;
  // An honest label rather than a promise: the estimate is recomputed from the
  // dialogue that actually got written, not the one requested up front.
  run.session.estimatedMinutes = estimateMinutes(run.playedChapters.flatMap((c) => c.lines));
  await store.enqueue(run.session);
  ui.setResultSession(run.session);
  reportPending();
}

/* ------------------------------------------------------------------ */
/* Saved lessons: library, import, replay                              */
/* ------------------------------------------------------------------ */

/**
 * Open the library.
 *
 * Routes through the hash so the view is linkable and the back button works —
 * but setting location.hash to the value it already holds fires no hashchange,
 * so route() would never run. That is not hypothetical: it is the main demo
 * loop (open library → import a file → click back to the library), where the
 * hash is already '#saved' the whole time and the button appeared dead.
 */
function openLibrary() {
  if (location.hash === '#saved') {
    onRestart({ silent: true }); // stop any replay still playing
    showLibrary();
  } else {
    location.hash = '#saved';
  }
}

/** Render the library from whatever is on this device. */
async function showLibrary() {
  const sessions = await store.listSessions();
  ui.renderLibrary(sessions);
  ui.showView('library');
}

/** Export the session behind the result screen (or a library row) as a file. */
function onExportSession(session) {
  try {
    sessionfile.download(session);
  } catch (err) {
    // assertNoIdentity throws here if a future change ever puts a name in a
    // session. Surfacing it loudly is the point — see sessionfile.js.
    ui.setLibraryStatus(err?.message ?? 'Could not export that session.', true);
  }
}

/** Delete a saved session from the device. */
async function onDeleteSession(id) {
  await store.deleteSession(id);
  showLibrary();
}

/**
 * Import a `.poducator` file and play it. This is demo mode: a hand-authored
 * podcast plays through the real player with ZERO API calls, so iterating on
 * the experience costs nothing.
 * @param {File} file
 */
async function onImportFile(file) {
  try {
    const session = sessionfile.parseFile(await file.text());
    // Imported sessions are saved like any other, so a demo file opened once
    // stays in the library rather than needing the file again.
    await store.saveSession({ ...session, inProgress: false });
    replay(session);
  } catch (err) {
    ui.setLibraryStatus(err?.message ?? 'Could not read that file.', true);
  }
}

/** Play a saved session from the library. */
async function onPlaySaved(id) {
  const session = await store.getSession(id);
  if (!session) return ui.setLibraryStatus('That session is no longer on this device.', true);
  replay(session);
}

/**
 * Replay a stored or imported session.
 *
 * Deliberately NOT the adaptive loop in teach(): a replay plays what happened,
 * in the order it happened, rather than re-deciding it. The checkpoints are
 * still live — you can answer them — because demoing the experience means
 * demoing that interaction, but answering cannot change which chapter comes
 * next, since the next chapter is already written.
 *
 * Makes no API calls. That is the whole point.
 * @param {Object} session
 */
async function replay(session) {
  const objectives = session.objectives ?? [];

  state = {
    runId: ++runCounter,
    lessonTitle: session.topic || 'Saved lesson',
    gradeBand: session.gradeBand,
    objectives,
    diagnosticItems: session.diagnosticItems ?? [],
    finalItems: session.finalItems ?? [],
    sourcesByCode: new Map(),
    responses: [],
    gaps: [],
    chapterQueue: [],
    playedChapters: [],
    // Player-control state (Previous, rewind/forward, chapter dots, review
    // mode) — see playChapter()/onJumpToChapter(). Harmless before the first
    // chapter starts; a control clicked during the diagnostic just no-ops.
    currentChapterIndex: 0,
    currentLineIndex: 0,
    currentLines: null,
    currentCheckpointAt: 0,
    pendingSeek: null,
    restartRequested: false,
    reviewing: null,
    suspendUntil: null,
    exitReview: null,
    retaught: new Set(),
    priorSummary: '',
    lastCheckpoint: null,
    credentials: null, // nothing here may call the API
    session: null, // a replay does not overwrite the record it came from
    isReplay: true,
  };
  const run = state;

  ui.renderReferences(session.refs ?? []);
  ui.clearTranscript();
  ui.showView('player');

  const chapters = session.chapters ?? [];
  for (const [index, chapter] of chapters.entries()) {
    if (!isCurrentRun(run)) return;

    ui.setChapterHeader(
      run.lessonTitle,
      `Chapter ${index + 1} of ${chapters.length}`,
      chapter.isReteach ? `Another look at: ${chapter.objectiveShort}` : chapter.objectiveShort,
      chapter.objectiveId
    );
    ui.renderChapterLines(chapter.lines);
    run.currentChapterIndex = index;
    ui.renderChapterDots(index);

    // playChapter() is shared with teach() and can hand back CHAPTER_RESTART
    // for the same reason there — replaying the same already-known chapter,
    // no network call. Replay's chapters are all known upfront (unlike an
    // adaptive run), but chapter dots still only go back, not forward — kept
    // uniform with teach() rather than building a second affordance just for
    // this one flow.
    let outcome = await playChapter(chapter, {
      objectiveId: chapter.objectiveId,
      objectiveShort: chapter.objectiveShort,
      objectiveText: chapter.objectiveText,
      status: chapter.status,
    });
    while (outcome === CHAPTER_RESTART && isCurrentRun(run)) {
      outcome = await playChapter(chapter, {
        objectiveId: chapter.objectiveId,
        objectiveShort: chapter.objectiveShort,
        objectiveText: chapter.objectiveText,
        status: chapter.status,
      });
    }
    if (!isCurrentRun(run)) return;

    run.playedChapters.push({ ...chapter, outcome });
  }

  // A replay runs the wrap-up quiz when the file carries one, so the demo ends
  // where a real lesson ends.
  if (run.finalItems.length > 0) {
    await runFinalQuiz();
    if (!isCurrentRun(run)) return;
  }

  const growth = assessment.growth(
    // A replay has no fresh diagnostic, so the baseline is whatever the saved
    // session recorded. Imported demo files often have none, and renderResult
    // says so rather than inventing one.
    (session.responses ?? []).filter((r) => r.phase === 'diagnostic'),
    run.responses.filter((r) => r.phase === 'final')
  );
  ui.renderResult(growth, objectives, run.gaps);
  ui.setResultSession(session);
  ui.showView('result');
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

/** Skip → stop audio; an open checkpoint resolves as unanswered. */
function onSkip() {
  const run = state;
  if (run) run.skipRequested = true; // tells a paused (reviewing) loop to end, not resume
  // Skip must act on the live chapter, never on whatever review is on screen
  // — leave it first so the transcript and state agree with what gets skipped.
  if (run?.reviewing) run.exitReview?.();
  tts.stop();
  ui.cancelCheckpoint();
  checkpointResolve?.(assessment.NO_ANSWER);
}

/**
 * Restart the CURRENT chapter — not the whole lesson (that's onRestart below).
 * Reuses onSkip's exact wake-up idiom (stop, then resolve the pending
 * checkpoint) rather than inventing a second interruption signal;
 * `run.restartRequested` is what tells playChapter() this wake-up means
 * "tear down and hand back CHAPTER_RESTART," not "unanswered, chapter over."
 */
function restartCurrentChapter() {
  const run = state;
  if (!run) return;
  run.restartRequested = true;
  // Leaving a review releases its pause gate; the live loop wakes, sees
  // restartRequested already set, and breaks immediately without resuming.
  if (run.reviewing) run.exitReview?.();
  tts.stop();
  ui.cancelCheckpoint();
  checkpointResolve?.(assessment.NO_ANSWER);
}

/**
 * Previous — the podcast convention: early in a chapter, go back to the real
 * previous chapter (as a review, see onJumpToChapter — it never re-scores);
 * a few lines in, restart the current one instead. At chapter 0 there is no
 * previous chapter, so it always restarts regardless of line position, which
 * keeps the button always enabled rather than needing to gray out mid-chapter.
 */
function onPrevious() {
  const run = state;
  if (!run) return;
  if (run.reviewing) return run.exitReview?.();
  if (run.currentChapterIndex > 0 && run.currentLineIndex < SMART_PREV_LINE_THRESHOLD) {
    return onJumpToChapter(run.currentChapterIndex - 1);
  }
  restartCurrentChapter();
}

/** Back/ahead a few lines within the current chapter — a seek, not a skip:
 * playChapter()'s loop restarts at the new index without touching the
 * checkpoint at all. No-ops during chapter review (there's nothing live to
 * seek in) or before any chapter has started. */
function onRewindLines() {
  const run = state;
  if (!run || !run.currentLines || run.reviewing) return;
  const target = Math.max(0, run.currentLineIndex - LINE_SEEK_COUNT);
  run.pendingSeek = { index: target };
  tts.stop();
}

/** Forward is clamped at the checkpoint line while it hasn't been shown yet —
 * a listener should never leap over a question they haven't seen, unlike the
 * whole-chapter Skip button, which already treats it as forfeited. Once
 * shown, forward moves freely to the chapter's end. */
function onForwardLines() {
  const run = state;
  if (!run || !run.currentLines || run.reviewing) return;
  const lastIndex = run.currentLines.length - 1;
  let target = run.currentLineIndex + LINE_SEEK_COUNT;
  if (run.currentLineIndex < run.currentCheckpointAt) {
    target = Math.min(target, run.currentCheckpointAt);
  }
  run.pendingSeek = { index: Math.min(target, lastIndex) };
  tts.stop();
}

/**
 * Speed pill → update the device preference, then — if a chapter is live —
 * restart just the current line at the new rate. A zero-distance seek through
 * the exact same mechanism as rewind/forward, since an utterance's rate can't
 * change once speech.speak() has been called on it.
 */
function onSetSpeed(rate) {
  if (!SPEED_PRESETS.includes(rate)) return;
  rateMultiplier = rate;
  try {
    localStorage.setItem(SPEED_STORAGE_KEY, String(rate));
  } catch {
    /* private browsing, or no storage at all — the choice still applies this session */
  }
  ui.setActiveSpeedPill(rate);

  const run = state;
  if (!run || !run.currentLines || run.reviewing) return;
  run.pendingSeek = { index: run.currentLineIndex };
  tts.stop();
}

/**
 * Chapter dots. Tapping the current chapter restarts it — unless a review is
 * already open, in which case it means "return to what I was doing," so it
 * resumes the paused live chapter exactly where it was rather than restarting
 * it (a deliberate deviation from restarting-on-return: a listener leaving a
 * review didn't ask to lose progress on the live chapter, only to stop
 * looking at an old one). Tapping an earlier, already-played chapter enters
 * REVIEW: the live chapter is paused (not ended — see playChapter()'s
 * suspendUntil gate) while the reviewed chapter's own already-generated lines
 * play from a throwaway tts.speakChapter() call whose result is never pushed
 * to run.responses and never fed to applyCheckpoint, same principle as
 * replay()'s "answering doesn't change what's next." Nothing beyond the
 * current chapter is ever a target — that content doesn't exist yet in an
 * adaptive run (see the plan's hard constraint), and dots for it are never
 * rendered in the first place.
 */
function onJumpToChapter(i) {
  const run = state;
  if (!run) return;

  if (run.reviewing) {
    if (i === run.currentChapterIndex) return run.exitReview?.();
    if (i === run.reviewing.index) return; // already reviewing this one
    if (i > run.currentChapterIndex) return;
    run.exitReview?.(); // leave the old review cleanly before starting the new one
  }

  if (i === run.currentChapterIndex) return restartCurrentChapter();
  if (i > run.currentChapterIndex || i < 0) return;

  const chapter = run.playedChapters[i];
  if (!chapter?.lines) return;

  let release;
  run.suspendUntil = new Promise((resolve) => {
    release = resolve;
  });
  run.reviewing = { index: i };
  tts.stop(); // pauses the live chapter — its loop sees suspendUntil, not a real end

  // Appended below the live transcript, not swapped in over it — the running
  // transcript for chapters already played is real content, not scratch
  // space, and review is a temporary detour, not a replacement view.
  ui.showChapterReview(i, chapter.objectiveShort, chapter.lines);

  const exitReview = () => {
    if (run.reviewing?.index !== i) return; // superseded already
    tts.stop();
    ui.clearChapterReview();
    run.reviewing = null;
    run.exitReview = null;
    run.suspendUntil = null;
    release();
  };
  run.exitReview = exitReview;

  tts
    .speakChapter(
      chapter.lines,
      (li) => {
        if (run.reviewing?.index !== i) return;
        ui.highlightReviewLine(li);
      },
      { rateMultiplier: getRateMultiplier() }
    )
    .then(() => {
      if (run.reviewing?.index === i) exitReview(); // reached the end naturally
    });
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
