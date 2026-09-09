/**
 * ui.js — all DOM rendering for the student app.
 *
 * Deliberately dumb, like NowPod's ui.js: it renders what app.js hands it and
 * reports intent back through promises and callbacks. No fetching, no TTS, no
 * run state.
 *
 * Two question surfaces, and the difference between them IS the design
 * (spec §6):
 *
 *   askItem()       BLOCKS. Used for the diagnostic and the wrap-up quiz.
 *                   Nothing is playing; waiting is correct.
 *   showCheckpoint() DOES NOT BLOCK. Used mid-chapter. Appears while Host B's
 *                   riff is still playing and resolves either on an answer or
 *                   when the audio moves on. The show never waits.
 *
 * Both are built on the same settle-once promise pattern carried over from
 * NowPod's showChime/showSourceConfirm.
 */

import { UNSURE, UNSURE_LABEL, NO_ANSWER } from './assessment.js';
import { statusLabel } from './objectives.js';

const els = {};

/** <li> elements of the chapter currently playing (highlight targets). */
let currentChapterEls = [];

/** Cleanup handles for the open panels, if any. */
let openCheckpoint = null;
let openConfirm = null;

export function init() {
  const byId = (id) => document.getElementById(id);
  // One assessment stage serves both the diagnostic and the wrap-up quiz —
  // they are parallel forms of the same instrument (spec §9), so presenting
  // them on the same surface is honest as well as less markup.
  els.views = {
    start: byId('start-view'),
    assess: byId('assess-view'),
    player: byId('player-view'),
    result: byId('result-view'),
  };
  els.startForm = byId('start-form');
  els.topicInput = byId('topic-input');
  els.gradeSelect = byId('grade-select');
  els.apiKeyInput = byId('api-key-input');
  els.startStatus = byId('start-status');

  els.confirmPanel = byId('confirm-panel');
  els.confirmPrompt = byId('confirm-prompt');
  els.confirmOptions = byId('confirm-options');
  els.confirmNoneBtn = byId('confirm-none-btn');

  els.quizStage = byId('quiz-stage');
  els.quizHeading = byId('quiz-heading');
  els.quizProgress = byId('quiz-progress');
  els.quizPrompt = byId('quiz-prompt');
  els.quizChoices = byId('quiz-choices');
  els.quizFeedback = byId('quiz-feedback');

  els.topicTitle = byId('topic-title');
  els.chapterProgress = byId('chapter-progress');
  els.objectiveNow = byId('objective-now');
  els.transcript = byId('transcript');
  els.skipBtn = byId('skip-btn');

  els.checkpointPanel = byId('checkpoint-panel');
  els.checkpointPrompt = byId('checkpoint-prompt');
  els.checkpointChoices = byId('checkpoint-choices');
  els.checkpointNote = byId('checkpoint-note');

  els.resultSummary = byId('result-summary');
  els.resultObjectives = byId('result-objectives');
  els.restartBtn = byId('restart-btn');
  els.referenceLists = Array.from(document.querySelectorAll('[data-slot="references"]'));
  els.offlineNote = byId('offline-note');
}

/** Show exactly one view. */
export function showView(name) {
  for (const [key, el] of Object.entries(els.views)) {
    if (!el) continue;
    el.hidden = key !== name;
    el.classList.toggle('view--active', key === name);
  }
}

export function readStart() {
  return {
    topic: els.topicInput.value.trim(),
    gradeBand: els.gradeSelect.value,
    apiKey: els.apiKeyInput.value.trim(),
  };
}

export function setApiKey(value) {
  if (value) els.apiKeyInput.value = value;
}

export function setStatus(message, isError = false) {
  els.startStatus.textContent = message;
  els.startStatus.classList.toggle('status--error', isError);
}

export function setOfflineNote(text) {
  els.offlineNote.textContent = text ?? '';
  els.offlineNote.hidden = !text;
}

/* ------------------------------------------------------------------ */
/* Source confirmation (ported from NowPod)                            */
/* ------------------------------------------------------------------ */

/**
 * "Which one did you mean?" — shown only when the topic is ambiguous, before
 * any generation compute is spent. Getting the wrong article is worse in a
 * classroom than in a curiosity app, so this checkpoint stays.
 * @returns {Promise<Object|null>} The picked candidate, or null to refine.
 */
export function showSourceConfirm(topic, candidates) {
  cancelSourceConfirm();

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      hideSourceConfirm();
      resolve(value);
    };

    els.confirmPrompt.textContent = `A few things match "${topic}" — which did you mean?`;
    els.confirmOptions.replaceChildren(
      ...candidates.map((candidate) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn candidate';

        const title = document.createElement('span');
        title.className = 'candidate__title';
        title.textContent = candidate.title;

        const desc = document.createElement('span');
        desc.className = 'candidate__desc';
        desc.textContent =
          candidate.description || candidate.summary.slice(0, 140) || 'No description available';

        btn.append(title, desc);
        btn.addEventListener('click', () => settle(candidate));
        li.append(btn);
        return li;
      })
    );

    const onNone = () => settle(null);
    els.confirmNoneBtn.addEventListener('click', onNone);

    openConfirm = {
      cancel: () => settle(null),
      cleanup: () => els.confirmNoneBtn.removeEventListener('click', onNone),
    };
    els.confirmPanel.hidden = false;
  });
}

export function hideSourceConfirm() {
  if (openConfirm) {
    openConfirm.cleanup();
    openConfirm = null;
  }
  els.confirmPanel.hidden = true;
  els.confirmOptions.replaceChildren();
}

export function cancelSourceConfirm() {
  openConfirm?.cancel();
}

/* ------------------------------------------------------------------ */
/* Blocking assessment (diagnostic + wrap-up quiz)                     */
/* ------------------------------------------------------------------ */

/**
 * Ask one assessment item and wait for an answer.
 *
 * The "Not sure yet" choice is always appended and is never framed as failure —
 * it is the single most informative answer a student can give, because it
 * separates a gap from a misconception (see assessment.js). A student who feels
 * penalized for it will guess instead, and the diagnostic loses its point.
 *
 * @param {import('./assessment.js').Item} item
 * @param {{heading: string, index: number, total: number, showFeedback?: boolean}} meta
 * @returns {Promise<number>} Chosen index, or UNSURE.
 */
export function askItem(item, meta) {
  return new Promise((resolve) => {
    els.quizHeading.textContent = meta.heading;
    els.quizProgress.textContent = `${meta.index + 1} of ${meta.total}`;
    els.quizPrompt.textContent = item.prompt;
    els.quizFeedback.hidden = true;
    els.quizFeedback.textContent = '';

    let settled = false;

    const choiceButtons = item.choices.map((choice, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn choice';
      btn.textContent = choice;
      btn.addEventListener('click', () => pick(i, btn));
      li.append(btn);
      return li;
    });

    const unsureLi = document.createElement('li');
    const unsureBtn = document.createElement('button');
    unsureBtn.type = 'button';
    unsureBtn.className = 'btn choice choice--unsure';
    unsureBtn.textContent = UNSURE_LABEL;
    unsureBtn.addEventListener('click', () => pick(UNSURE, unsureBtn));
    unsureLi.append(unsureBtn);

    els.quizChoices.replaceChildren(...choiceButtons, unsureLi);

    function pick(index, btn) {
      if (settled) return;
      settled = true;

      // Lock the choices so a student can't re-answer after seeing feedback.
      for (const el of els.quizChoices.querySelectorAll('button')) el.disabled = true;
      btn.classList.add('choice--picked');

      if (!meta.showFeedback) return resolve(index);

      // Feedback only on the wrap-up quiz. During the diagnostic it would
      // teach the answer, contaminating the very baseline being measured.
      const correct = index === item.correctIndex;
      els.quizChoices
        .querySelectorAll('button')
        [item.correctIndex]?.classList.add('choice--correct');
      els.quizFeedback.textContent = correct
        ? `Yes — ${item.explanation}`
        : `Not quite. ${item.explanation}`;
      els.quizFeedback.className = `feedback ${correct ? 'feedback--ok' : 'feedback--no'}`;
      els.quizFeedback.hidden = false;

      setTimeout(() => resolve(index), correct ? 1400 : 2600);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Player: transcript + checkpoint                                     */
/* ------------------------------------------------------------------ */

export function setChapterHeader(topic, progress, objectiveText) {
  els.topicTitle.textContent = topic;
  els.chapterProgress.textContent = progress;
  els.objectiveNow.textContent = objectiveText ?? '';
}

export function clearTranscript() {
  els.transcript.replaceChildren();
  currentChapterEls = [];
}

function buildLineEl(line) {
  const li = document.createElement('li');
  li.className = `line line--host-${line.speaker.toLowerCase()}`;
  const speaker = document.createElement('span');
  speaker.className = 'line__speaker';
  speaker.textContent = line.speaker === 'A' ? 'Teacher' : 'Learner';
  const text = document.createElement('span');
  text.className = 'line__text';
  text.textContent = line.text;
  li.append(speaker, text);
  return li;
}

export function renderChapterLines(lines) {
  currentChapterEls = lines.map(buildLineEl);
  els.transcript.append(...currentChapterEls);
}

/** Append a single spoken line (e.g. Host A revealing an unanswered check). */
export function appendLine(line) {
  const el = buildLineEl(line);
  els.transcript.append(el);
  currentChapterEls.push(el);
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function highlightLine(lineIndex) {
  currentChapterEls.forEach((el, i) => el.classList.toggle('line--active', i === lineIndex));
  currentChapterEls[lineIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * Show the checkpoint panel alongside still-playing audio (spec §6).
 *
 * Never a modal, never pauses. It appears when Host A asks the question and
 * stays up through Host B's riff — that riff is the answer window. If the
 * student doesn't answer, app.js resolves this with NO_ANSWER when the audio
 * moves on, and Host A answers aloud instead.
 *
 * @param {Object} checkpoint
 * @returns {Promise<number>} Chosen index, or NO_ANSWER.
 */
export function showCheckpoint(checkpoint) {
  cancelCheckpoint();

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      hideCheckpoint();
      resolve(value);
    };

    els.checkpointPrompt.textContent = checkpoint.prompt;
    els.checkpointChoices.replaceChildren(
      ...checkpoint.choices.map((choice, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn choice';
        btn.textContent = choice;
        btn.addEventListener('click', () => settle(i));
        li.append(btn);
        return li;
      })
    );
    els.checkpointNote.textContent = "…or just keep listening — they'll get to it.";

    openCheckpoint = {
      cancel: () => settle(NO_ANSWER),
      cleanup: () => els.checkpointPanel.classList.remove('checkpoint--pulse'),
    };

    els.checkpointPanel.hidden = false;
    // Visibility signal (NowPod §11): replay the pulse on each appearance.
    els.checkpointPanel.classList.remove('checkpoint--pulse');
    void els.checkpointPanel.offsetWidth; // reflow so the animation restarts
    els.checkpointPanel.classList.add('checkpoint--pulse');
  });
}

export function hideCheckpoint() {
  if (openCheckpoint) {
    openCheckpoint.cleanup();
    openCheckpoint = null;
  }
  els.checkpointPanel.hidden = true;
  els.checkpointChoices.replaceChildren();
}

/** Resolve an open checkpoint as unanswered (audio moved on, or skip). */
export function cancelCheckpoint() {
  openCheckpoint?.cancel();
}

/** Briefly acknowledge a checkpoint answer without interrupting playback. */
export function flashCheckpointResult(correct, explanation) {
  els.checkpointNote.textContent = correct ? `Yes — ${explanation}` : `Not quite. ${explanation}`;
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

/**
 * Render the student-facing result: per-objective growth, framed as movement
 * rather than as a grade (spec §9).
 * @param {Array<{objectiveId: string, before: number, after: number, delta: number}>} growth
 * @param {Array<{id: string, text: string}>} objectives
 * @param {Array<{objectiveId: string, status: string}>} gaps
 */
export function renderResult(growth, objectives, gaps) {
  const textById = new Map(objectives.map((o) => [o.id, o.text]));
  const statusById = new Map(gaps.map((g) => [g.objectiveId, g.status]));

  const improved = growth.filter((g) => g.delta > 0).length;
  const held = growth.filter((g) => g.delta === 0 && g.after === 100).length;

  els.resultSummary.textContent =
    improved > 0
      ? `You moved forward on ${improved} of ${growth.length} objectives.`
      : held > 0
        ? 'You already had most of this — nice.'
        : 'This one was tough. That is useful information, not a verdict.';

  els.resultObjectives.replaceChildren(
    ...growth.map((g) => {
      const li = document.createElement('li');
      li.className = 'objective-result';

      const head = document.createElement('p');
      head.className = 'objective-result__text';
      head.textContent = textById.get(g.objectiveId) ?? g.objectiveId;

      // Three segments rather than two overlaid bars, so the GAIN is the thing
      // the eye lands on: what the student already had is muted, what they
      // picked up is in accent, and a drop is called out rather than hidden.
      const bar = document.createElement('div');
      bar.className = 'growth';

      const held = document.createElement('span');
      held.className = 'growth__held';
      held.style.width = `${Math.min(g.before, g.after)}%`;

      const change = document.createElement('span');
      change.className = g.delta >= 0 ? 'growth__gain' : 'growth__loss';
      change.style.width = `${Math.abs(g.delta)}%`;

      bar.append(held, change);

      const label = document.createElement('p');
      label.className = 'objective-result__label';
      const start = statusById.get(g.objectiveId);
      const movement =
        g.delta > 0 ? `up ${g.delta} points` : g.delta < 0 ? `down ${Math.abs(g.delta)}` : 'no change';
      label.textContent = `Started: ${statusLabel(start)} · ${g.before}% → ${g.after}% (${movement})`;

      li.append(head, bar, label);
      return li;
    })
  );
}

export function renderReferences(refs) {
  for (const list of els.referenceLists) {
    list.replaceChildren(
      ...refs.map((ref) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = ref.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = ref.title;
        const src = document.createElement('span');
        src.className = 'references__source';
        src.textContent = ` — ${ref.label}`;
        li.append(a, src);
        return li;
      })
    );
  }
}

export function bindHandlers(handlers) {
  els.startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handlers.onStart();
  });
  els.skipBtn.addEventListener('click', handlers.onSkip);
  els.restartBtn.addEventListener('click', handlers.onRestart);
}
