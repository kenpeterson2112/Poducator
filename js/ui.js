/**
 * ui.js — all DOM rendering.
 *
 * Deliberately dumb, like NowPod's ui.js: it renders what app.js hands it and
 * reports intent back through promises and callbacks. No fetching, no TTS, no
 * run state.
 *
 * Two question surfaces, and the difference between them IS the design
 * (spec §6):
 *
 *   askItem()        BLOCKS. Used for the pre-pod quiz and the wrap-up quiz.
 *                    Nothing is playing; waiting is correct.
 *   showCheckpoint() DOES NOT BLOCK. Used mid-chapter. Appears while Host B's
 *                    riff is still playing and resolves either on an answer or
 *                    when the audio moves on. The show never waits.
 *
 * One thing this file deliberately never renders: a misconception label. The
 * bank tags every wrong choice with what a learner picking it believes, and
 * that is genuinely useful — to a teacher deciding what to reteach. Telling a
 * 12-year-old they hold the "symmetry-is-decorative" misconception is a
 * different act, and not a helpful one. The learner gets the explanation; the
 * label goes in the session record.
 */

import { UNSURE, UNSURE_LABEL, NO_ANSWER } from './assessment.js';
import { statusLabel } from './objectives.js';
import { EXPECTATION_SELECTION } from './config.js';

const els = {};

/** <li> elements of the chapter currently playing (highlight targets). */
let currentChapterEls = [];

/** Cleanup handle for the open checkpoint, if any. */
let openCheckpoint = null;

/** Called when the educator changes their expectation selection. */
let onSelectionChange = () => {};

export function init() {
  const byId = (id) => document.getElementById(id);
  els.views = {
    educator: byId('educator-view'),
    library: byId('library-view'),
    start: byId('start-view'),
    assess: byId('assess-view'),
    player: byId('player-view'),
    result: byId('result-view'),
  };

  els.educatorCurriculum = byId('educator-curriculum');
  els.expectationGroups = byId('expectation-groups');
  els.gradeSelect = byId('grade-select');
  els.lessonLink = byId('lesson-link');
  els.lessonLinkStatus = byId('lesson-link-status');
  els.copyLinkBtn = byId('copy-link-btn');
  els.previewBtn = byId('preview-btn');

  els.lessonCurriculum = byId('lesson-curriculum');
  els.lockedExpectations = byId('locked-expectations');
  els.startForm = byId('start-form');
  els.passphraseField = byId('passphrase-field');
  els.passphraseInput = byId('passphrase-input');
  els.devKeyField = byId('devkey-field');
  els.apiKeyInput = byId('api-key-input');
  els.startStatus = byId('start-status');

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

  els.libraryBtn = byId('library-btn');
  els.libraryList = byId('library-list');
  els.libraryEmpty = byId('library-empty');
  els.libraryStatus = byId('library-status');
  els.importInput = byId('import-input');
  els.exportBtn = byId('export-btn');
}

/** Show exactly one view. */
export function showView(name) {
  for (const [key, el] of Object.entries(els.views)) {
    if (!el) continue;
    el.hidden = key !== name;
    el.classList.toggle('view--active', key === name);
  }
}

/**
 * Show whichever credential field this build actually uses, and mark it
 * required. Driven by config.usingProxy() so the UI and the orchestrator can
 * never disagree about what the learner is being asked for.
 */
export function setCredentialMode(proxied) {
  els.passphraseField.hidden = !proxied;
  els.devKeyField.hidden = proxied;
  els.passphraseInput.required = proxied;
  els.apiKeyInput.required = !proxied;
}

export function setPassphrase(value) {
  if (value) els.passphraseInput.value = value;
}

export function setApiKey(value) {
  if (value) els.apiKeyInput.value = value;
}

export function readStart() {
  return {
    passphrase: els.passphraseInput.value.trim(),
    apiKey: els.apiKeyInput.value.trim(),
  };
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
/* Educator: expectation picker                                        */
/* ------------------------------------------------------------------ */

/**
 * Render the strand's expectations as a capped multi-select.
 *
 * The cap is enforced by disabling unchecked boxes once the maximum is reached
 * rather than by rejecting a fourth click with a message. An educator should be
 * able to see that three is the limit without having to bump into it.
 *
 * @param {Array<{strand: string, title: string, expectations: Array}>} groups
 * @param {{label: string, strandTitle: string}} curriculum
 */
export function renderEducatorPicker(groups, curriculum) {
  els.educatorCurriculum.textContent = `${curriculum.label} — ${curriculum.strandTitle}`;

  els.expectationGroups.replaceChildren(
    ...groups.map((group) => {
      const section = document.createElement('section');
      section.className = 'expectation-group';

      const heading = document.createElement('h3');
      heading.className = 'expectation-group__heading';
      heading.textContent = `${group.strand}. ${group.title}`;
      section.append(heading);

      const list = document.createElement('ul');
      list.className = 'expectation-group__list';

      for (const expectation of group.expectations) {
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'expectation';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'expectation__check';
        input.value = expectation.code;
        input.addEventListener('change', () => {
          enforceSelectionCap();
          onSelectionChange();
        });

        const code = document.createElement('span');
        code.className = 'expectation__code';
        code.textContent = expectation.code;

        const text = document.createElement('span');
        text.className = 'expectation__text';
        text.textContent = expectation.text;

        label.append(input, code, text);
        li.append(label);
        list.append(li);
      }

      section.append(list);
      return section;
    })
  );
}

/** Every checkbox in the picker. */
function checkboxes() {
  return Array.from(els.expectationGroups.querySelectorAll('.expectation__check'));
}

/** Grey out the unchecked boxes once the cap is reached. */
function enforceSelectionCap() {
  const boxes = checkboxes();
  const atCap = boxes.filter((b) => b.checked).length >= EXPECTATION_SELECTION.max;
  for (const box of boxes) {
    box.disabled = atCap && !box.checked;
    box.closest('.expectation')?.classList.toggle('expectation--disabled', box.disabled);
  }
}

/** @returns {{codes: string[], gradeBand: string}} */
export function readEducatorSelection() {
  return {
    codes: checkboxes().filter((b) => b.checked).map((b) => b.value),
    gradeBand: els.gradeSelect.value,
  };
}

/**
 * Show (or hide) the shareable lesson link.
 * @param {string} url    Empty string when the selection isn't valid yet.
 * @param {number} count  How many expectations are currently selected.
 */
export function setLessonLink(url, count) {
  const ready = Boolean(url);
  els.lessonLink.hidden = !ready;
  els.copyLinkBtn.hidden = !ready;
  els.previewBtn.hidden = !ready;

  if (ready) {
    els.lessonLink.value = url;
    els.lessonLinkStatus.textContent =
      `${count} expectation${count === 1 ? '' : 's'} selected. ` +
      `The pre-pod quiz asks 3 questions across ${count === 1 ? 'it' : 'them'}.`;
  } else {
    els.lessonLinkStatus.textContent = 'Pick at least one expectation.';
  }
}

/* ------------------------------------------------------------------ */
/* Learner: the locked lesson                                          */
/* ------------------------------------------------------------------ */

/**
 * Show the learner what the lesson covers, read-only.
 *
 * There is deliberately no control here that changes the scope. The educator
 * chose it; the learner's job is to listen to it.
 *
 * @param {Array<{id: string, text: string, short: string}>} objectives
 * @param {{curriculumLabel: string, strandTitle: string}} meta
 */
export function renderLockedLesson(objectives, meta) {
  els.lessonCurriculum.textContent = `${meta.curriculumLabel} — ${meta.strandTitle}`;

  els.lockedExpectations.replaceChildren(
    ...objectives.map((objective) => {
      const li = document.createElement('li');
      li.className = 'locked-expectation';

      const code = document.createElement('span');
      code.className = 'locked-expectation__code';
      code.textContent = objective.id;

      const text = document.createElement('span');
      text.className = 'locked-expectation__text';
      text.textContent = objective.text;

      li.append(code, text);
      return li;
    })
  );
}

/* ------------------------------------------------------------------ */
/* Blocking assessment (pre-pod quiz + wrap-up quiz)                   */
/* ------------------------------------------------------------------ */

/**
 * Ask one assessment item and wait for an answer.
 *
 * The "Not sure yet" choice is always appended and is never framed as failure —
 * it is the single most informative answer a learner can give, because it
 * separates a gap from a misconception (see assessment.js). A learner who feels
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

      // Lock the choices so a learner can't re-answer after seeing feedback.
      for (const el of els.quizChoices.querySelectorAll('button')) el.disabled = true;
      btn.classList.add('choice--picked');

      if (!meta.showFeedback) return resolve(index);

      // Feedback only on the wrap-up quiz. During the pre-pod quiz it would
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

      // Longer on a miss: the explanation is the teaching, and these items
      // carry a reason clause that takes a beat to read.
      setTimeout(() => resolve(index), correct ? 1600 : 3200);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Player: transcript + checkpoint                                     */
/* ------------------------------------------------------------------ */

export function setChapterHeader(lessonTitle, progress, objectiveText, code) {
  els.topicTitle.textContent = lessonTitle;
  els.chapterProgress.textContent = progress;
  els.objectiveNow.textContent = code ? `${code} · ${objectiveText}` : (objectiveText ?? '');
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
  scrollTo(el);
}

export function highlightLine(lineIndex) {
  currentChapterEls.forEach((el, i) => el.classList.toggle('line--active', i === lineIndex));
  scrollTo(currentChapterEls[lineIndex]);
}

/**
 * Follow the karaoke transcript.
 *
 * Optional-called because this runs inside the TTS boundary callback, and a
 * throw there propagates out through speakChapter and takes down audio for the
 * whole chapter. Losing the auto-scroll is a cosmetic degradation; losing the
 * lesson's audio because a platform lacks scrollIntoView is not a trade worth
 * making.
 */
function scrollTo(el) {
  el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
}

/**
 * Show the checkpoint panel alongside still-playing audio (spec §6).
 *
 * Never a modal, never pauses. It appears when Host A asks the question and
 * stays up through Host B's riff — that riff is the answer window. If the
 * learner doesn't answer, app.js resolves this with NO_ANSWER when the audio
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
 * Render the learner-facing result: per-expectation growth, framed as movement
 * rather than as a grade (spec §9).
 *
 * @param {Array<{objectiveId: string, before: number, after: number, delta: number}>} growth
 * @param {Array<{id: string, text: string, short: string}>} objectives
 * @param {Array<{objectiveId: string, status: string}>} gaps
 */
export function renderResult(growth, objectives, gaps) {
  const byId = new Map(objectives.map((o) => [o.id, o]));
  const statusById = new Map(gaps.map((g) => [g.objectiveId, g.status]));

  const improved = growth.filter((g) => g.delta > 0).length;
  const held = growth.filter((g) => g.delta === 0 && g.after === 100).length;

  els.resultSummary.textContent =
    improved > 0
      ? `You moved forward on ${improved} of ${growth.length} expectation${growth.length === 1 ? '' : 's'}.`
      : held > 0
        ? 'You already had most of this — nice.'
        : 'This one was tough. That is useful information, not a verdict.';

  els.resultObjectives.replaceChildren(
    ...growth.map((g) => {
      const objective = byId.get(g.objectiveId);
      const li = document.createElement('li');
      li.className = 'objective-result';

      const head = document.createElement('p');
      head.className = 'objective-result__text';
      const code = document.createElement('span');
      code.className = 'objective-result__code';
      code.textContent = g.objectiveId;
      head.append(code, document.createTextNode(objective?.text ?? g.objectiveId));

      // Three segments rather than two overlaid bars, so the GAIN is the thing
      // the eye lands on: what the learner already had is muted, what they
      // picked up is in accent, and a drop is called out rather than hidden.
      const bar = document.createElement('div');
      bar.className = 'growth';

      const heldSeg = document.createElement('span');
      heldSeg.className = 'growth__held';
      heldSeg.style.width = `${Math.min(g.before, g.after)}%`;

      const change = document.createElement('span');
      change.className = g.delta >= 0 ? 'growth__gain' : 'growth__loss';
      change.style.width = `${Math.abs(g.delta)}%`;

      bar.append(heldSeg, change);

      const label = document.createElement('p');
      label.className = 'objective-result__label';
      const start = statusById.get(g.objectiveId);
      const movement =
        g.delta > 0 ? `up ${g.delta} points` : g.delta < 0 ? `down ${Math.abs(g.delta)}` : 'no change';
      // An imported or skipped-diagnostic session has no starting status. Say
      // so rather than rendering "Started: undefined" — a missing baseline is
      // a real state, not a glitch.
      label.textContent = start
        ? `Started: ${statusLabel(start)} · ${g.before}% → ${g.after}% (${movement})`
        : `${g.before}% → ${g.after}% (${movement})`;

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

/* ------------------------------------------------------------------ */
/* Saved lessons                                                       */
/* ------------------------------------------------------------------ */

/** The session the result screen is currently showing, for the export button. */
let resultSession = null;

/** Tell the UI which session an export button would write out. */
export function setResultSession(session) {
  resultSession = session;
  els.exportBtn.hidden = !session;
}

export function setLibraryStatus(message, isError = false) {
  els.libraryStatus.textContent = message;
  els.libraryStatus.classList.toggle('status--error', isError);
}

/** Human date for a library row. */
function whenLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Render the saved-lessons list.
 *
 * In-progress sessions are shown rather than hidden, and labelled as such: a
 * learner who was interrupted at chapter two should be able to see that their
 * work survived. Hiding them would make the recovery invisible, which defeats
 * the reason for saving progress at all.
 * @param {Array} sessions
 */
export function renderLibrary(sessions) {
  setLibraryStatus('');
  els.libraryEmpty.hidden = sessions.length > 0;

  els.libraryList.replaceChildren(
    ...sessions.map((session) => {
      const li = document.createElement('li');
      li.className = 'library-item';

      const head = document.createElement('div');
      head.className = 'library-item__head';

      const title = document.createElement('span');
      title.className = 'library-item__title';
      title.textContent = session.topic || 'Untitled lesson';
      head.append(title);

      if (session.inProgress) {
        const badge = document.createElement('span');
        badge.className = 'library-item__badge';
        badge.textContent = 'unfinished';
        head.append(badge);
      }

      const meta = document.createElement('p');
      meta.className = 'library-item__meta';
      const parts = [whenLabel(session.startedAt)];
      const chapters = session.chapters?.length ?? 0;
      if (chapters) parts.push(`${chapters} chapter${chapters === 1 ? '' : 's'}`);
      if (session.expectations?.length) parts.push(session.expectations.join(', '));
      meta.textContent = parts.filter(Boolean).join(' · ');

      const actions = document.createElement('div');
      actions.className = 'library-item__actions';

      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'btn';
      play.textContent = chapters ? 'Play' : 'No chapters yet';
      play.disabled = chapters === 0;
      play.addEventListener('click', () => libraryHandlers.onPlaySaved?.(session.id));

      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn';
      save.textContent = 'Download';
      save.addEventListener('click', () => libraryHandlers.onExportSession?.(session));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--quiet';
      del.textContent = 'Delete';
      del.addEventListener('click', () => {
        // Deleting is the one irreversible thing in the library, and these
        // files exist precisely because someone wanted to keep them.
        if (confirm(`Delete "${session.topic || 'this lesson'}" from this device?`)) {
          libraryHandlers.onDeleteSession?.(session.id);
        }
      });

      actions.append(play, save, del);
      li.append(head, meta, actions);
      return li;
    })
  );
}

/** Handlers the library rows call into; filled by bindHandlers. */
let libraryHandlers = {};

export function bindHandlers(handlers) {
  onSelectionChange = handlers.onSelectionChange ?? (() => {});

  els.startForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handlers.onStart();
  });
  els.gradeSelect.addEventListener('change', () => onSelectionChange());
  els.previewBtn.addEventListener('click', handlers.onPreviewLesson);
  els.copyLinkBtn.addEventListener('click', copyLessonLink);
  libraryHandlers = handlers;

  els.libraryBtn.addEventListener('click', () => handlers.onOpenLibrary?.());
  els.exportBtn.addEventListener('click', () => {
    if (resultSession) handlers.onExportSession?.(resultSession);
  });
  els.exportBtn.hidden = true;
  els.importInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    // Clear the input so re-picking the same file fires change again — a demo
    // loop means opening the same file repeatedly while editing it.
    e.target.value = '';
    if (file) handlers.onImportFile?.(file);
  });

  els.skipBtn.addEventListener('click', handlers.onSkip);
  els.restartBtn.addEventListener('click', () => handlers.onRestart());
}

/**
 * Copy the lesson link. The clipboard API needs a secure context and can be
 * denied, so the select-and-execCommand path stays as a fallback — an educator
 * on a school-managed browser should still be able to get the link out.
 */
async function copyLessonLink() {
  const url = els.lessonLink.value;
  if (!url) return;

  try {
    await navigator.clipboard.writeText(url);
    flashCopied('Link copied.');
  } catch {
    els.lessonLink.select();
    const ok = document.execCommand?.('copy');
    flashCopied(ok ? 'Link copied.' : 'Press Ctrl/Cmd+C to copy.');
  }
}

function flashCopied(message) {
  const previous = els.lessonLinkStatus.textContent;
  els.lessonLinkStatus.textContent = message;
  setTimeout(() => {
    els.lessonLinkStatus.textContent = previous;
  }, 2000);
}
