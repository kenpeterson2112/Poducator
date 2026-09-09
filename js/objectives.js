/**
 * objectives.js — the gap profile and chapter planning (spec §3, §4).
 *
 * This is where diagnostic answers become a teaching plan. Pure, like
 * assessment.js: given objectives and responses, produce an ordered chapter
 * plan. No DOM, no fetch, no state.
 *
 * The ordering rule is the pedagogy of the whole app, so it is worth stating
 * plainly:
 *
 *   MISCONCEPTION > UNKNOWN > SHAKY > SOLID
 *
 * A confidently wrong answer outranks not knowing. That ordering is deliberate
 * and it is not obvious — the instinct is to teach the thing the student knows
 * least about first. But a wrong mental model actively interferes with
 * everything built on top of it, while a gap is just an empty slot. Correcting
 * beats filling.
 */

import { OUTCOME, classify } from './assessment.js';
import { CHAPTER_BOUNDS } from './config.js';

/** Per-objective status, ordered by teaching urgency (highest first). */
export const STATUS = Object.freeze({
  MISCONCEPTION: 'misconception',
  UNKNOWN: 'unknown',
  SHAKY: 'shaky',
  SOLID: 'solid',
});

/** Teaching priority per status. Higher is more urgent. */
const PRIORITY = Object.freeze({
  [STATUS.MISCONCEPTION]: 4,
  [STATUS.UNKNOWN]: 3,
  [STATUS.SHAKY]: 2,
  [STATUS.SOLID]: 1,
});

/**
 * How each status should be taught. Handed to the model so the chapter's
 * approach actually matches the diagnosis rather than just its topic.
 */
const STRATEGY = Object.freeze({
  [STATUS.MISCONCEPTION]:
    'The student holds a specific wrong idea here. Surface the plausible-but-wrong version out ' +
    'loud through Host B, then take it apart and replace it. Do not simply state the correct ' +
    'answer over the top of it — an uncorrected wrong model will win.',
  [STATUS.UNKNOWN]:
    'The student has no model here yet, and said so honestly. Build from a concrete, everyday ' +
    'anchor before introducing any terminology.',
  [STATUS.SHAKY]:
    'The student has partial understanding. Firm up the edges and connect it to the objectives ' +
    'they already have solid, rather than re-teaching from zero.',
  [STATUS.SOLID]:
    'The student already has this. Touch it briefly, only where it connects to a weaker ' +
    'objective, and do not belabor it.',
});

/**
 * @typedef {Object} Objective
 * @property {string} id
 * @property {string} text
 */

/**
 * @typedef {Object} Gap
 * @property {string} objectiveId
 * @property {string} status     One of STATUS.
 * @property {number} priority
 * @property {string} strategy   How to teach it.
 */

/**
 * Build the gap profile from diagnostic answers.
 *
 * One item per objective is the common case, so status maps straight from the
 * outcome. With multiple items, any misconception dominates (a wrong model is
 * the urgent thing), then unknowns, then a partial score reads as shaky.
 *
 * An objective with no diagnostic item at all is treated as UNKNOWN rather than
 * skipped — an unassessed objective is not an understood one.
 *
 * @param {Objective[]} objectives
 * @param {import('./assessment.js').Item[]} items
 * @param {import('./assessment.js').Response[]} responses
 * @returns {Gap[]} Ordered most-urgent first.
 */
export function buildGapProfile(objectives, items, responses) {
  const itemsById = new Map(items.map((i) => [i.id, i]));

  /** @type {Map<string, string[]>} objectiveId → outcomes */
  const outcomes = new Map();
  for (const r of responses) {
    const item = itemsById.get(r.itemId);
    if (!item) continue;
    const list = outcomes.get(r.objectiveId) ?? [];
    list.push(classify(item, r.answerIndex));
    outcomes.set(r.objectiveId, list);
  }

  const gaps = objectives.map((objective) => {
    const list = outcomes.get(objective.id) ?? [];
    const status = statusFor(list);
    return {
      objectiveId: objective.id,
      status,
      priority: PRIORITY[status],
      strategy: STRATEGY[status],
    };
  });

  // Most urgent first; ties keep the teacher's authored objective order, which
  // usually encodes a real prerequisite sequence.
  return gaps.sort((a, b) => b.priority - a.priority);
}

/**
 * Collapse one objective's outcomes into a status.
 * @param {string[]} list
 * @returns {string}
 */
function statusFor(list) {
  if (list.length === 0) return STATUS.UNKNOWN;
  if (list.includes(OUTCOME.MISCONCEPTION)) return STATUS.MISCONCEPTION;
  if (list.includes(OUTCOME.SKIPPED) || list.includes(OUTCOME.UNKNOWN)) return STATUS.UNKNOWN;
  return list.every((o) => o === OUTCOME.CORRECT) ? STATUS.SOLID : STATUS.SHAKY;
}

/**
 * @typedef {Object} PlannedChapter
 * @property {string} objectiveId
 * @property {string} objectiveText
 * @property {string} status
 * @property {string} strategy
 */

/**
 * Turn a gap profile into an ordered chapter plan.
 *
 * Objectives the student already has solid are dropped — sitting through four
 * minutes on something you already understand is exactly what this app exists
 * to avoid. But the plan never drops below CHAPTER_BOUNDS.min, so a student who
 * aces the diagnostic still gets a short session (the solid objectives come
 * back in, briefly) rather than an empty one.
 *
 * @param {Objective[]} objectives
 * @param {Gap[]} gaps
 * @returns {PlannedChapter[]}
 */
export function planChapters(objectives, gaps) {
  const textById = new Map(objectives.map((o) => [o.id, o.text]));
  const toChapter = (gap) => ({
    objectiveId: gap.objectiveId,
    objectiveText: textById.get(gap.objectiveId) ?? '',
    status: gap.status,
    strategy: gap.strategy,
  });

  const needsWork = gaps.filter((g) => g.status !== STATUS.SOLID);
  const solid = gaps.filter((g) => g.status === STATUS.SOLID);

  // Backfill from the solid pile if the student knew almost everything.
  const planned = [...needsWork];
  while (planned.length < CHAPTER_BOUNDS.min && solid.length > 0) {
    planned.push(solid.shift());
  }

  return planned.slice(0, CHAPTER_BOUNDS.max).map(toChapter);
}

/**
 * Fold a checkpoint outcome back into the plan mid-session (spec §6).
 *
 * A wrong checkpoint answer means the chapter did not land, so the objective is
 * re-queued *immediately next* with a misconception strategy — the reteach
 * branch. Re-queued at most once per objective: a second failure means this
 * format is not working for this student today, and looping them a third time
 * on the same idea is how a study aid becomes a punishment.
 *
 * @param {PlannedChapter[]} remaining   Chapters not yet played.
 * @param {PlannedChapter} justPlayed
 * @param {string} outcome               A CHECKPOINT_OUTCOME value.
 * @param {Set<string>} alreadyRetaught  Objective ids already re-queued once.
 * @returns {PlannedChapter[]} The new remaining-chapter queue.
 */
export function applyCheckpoint(remaining, justPlayed, outcome, alreadyRetaught) {
  const missed = outcome === 'incorrect' || outcome === 'no_response';
  if (!missed || alreadyRetaught.has(justPlayed.objectiveId)) return remaining;

  alreadyRetaught.add(justPlayed.objectiveId);
  return [
    {
      ...justPlayed,
      status: STATUS.MISCONCEPTION,
      strategy:
        outcome === 'no_response'
          ? 'The student did not answer the check on this objective, which usually means they got ' +
            'lost rather than that they disagreed. Re-approach it from a completely different ' +
            'angle — a concrete worked example or an everyday analogy — and go slower. Do not ' +
            'repeat the earlier explanation in different words.'
          : 'The student got the check on this objective WRONG after it was taught. The first ' +
            'explanation did not land. Teach it a genuinely different way — a different analogy, ' +
            'a worked example, or by starting from the misconception itself. Never repeat the ' +
            'first explanation more slowly.',
      isReteach: true,
    },
    ...remaining,
  ];
}

/** Human-readable label for a status, for the student-facing result screen. */
export function statusLabel(status) {
  return {
    [STATUS.MISCONCEPTION]: 'Worth a second look',
    [STATUS.UNKNOWN]: 'New to you',
    [STATUS.SHAKY]: 'Almost there',
    [STATUS.SOLID]: 'Already solid',
  }[status] ?? status;
}
