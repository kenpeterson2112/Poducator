/**
 * assessment.js — the item model, scoring, and the pre/post delta (spec §9).
 *
 * Deliberately pure: no DOM, no fetch, no state. Everything here is a function
 * of its arguments, so the measurement logic can be exercised directly with
 * fixture data rather than by clicking through a lesson.
 *
 * The one design decision worth knowing before reading: every diagnostic item
 * carries an explicit "Not sure yet" choice. That is not politeness — it
 * separates two states that a plain right/wrong score conflates:
 *
 *   - a student who picked a WRONG answer holds a misconception, and a wrong
 *     mental model actively interferes with new material;
 *   - a student who picked "not sure" simply has a gap, which is a clean slate.
 *
 * Those need different teaching, so they are tracked as different outcomes
 * (see objectives.js, which turns them into different chapter strategies).
 */

/** Sentinel answer index meaning "the student chose 'Not sure yet'". */
export const UNSURE = -1;

/** Sentinel answer index meaning "the student never answered". */
export const NO_ANSWER = -2;

/** The label rendered for the unsure choice, and handed to the model. */
export const UNSURE_LABEL = 'Not sure yet';

/**
 * @typedef {Object} Item
 * @property {string}   id
 * @property {string}   objectiveId
 * @property {string}   prompt
 * @property {string[]} choices        Distractors + the correct answer.
 * @property {number}   correctIndex   Index into `choices`.
 * @property {string}   explanation    Short "why" — shown after answering.
 * @property {Array<string|null>} [misconceptions]
 *   Parallel to `choices`: the misconception each wrong choice encodes, null on
 *   the correct one. Present on curriculum-bank items, absent on generated
 *   checkpoints. Teacher-facing only — never rendered to a student.
 */

/**
 * @typedef {Object} Response
 * @property {string} itemId
 * @property {string} objectiveId
 * @property {'diagnostic'|'checkpoint'|'final'} phase
 * @property {number} answerIndex   Choice index, or UNSURE / NO_ANSWER.
 * @property {boolean} correct
 * @property {string|null} misconception  Slug of what a wrong answer reveals.
 * @property {number} latencyMs
 * @property {string} askedAt       ISO timestamp.
 */

/** Outcome of a single answered item. */
export const OUTCOME = Object.freeze({
  CORRECT: 'correct',
  MISCONCEPTION: 'misconception', // confidently wrong
  UNKNOWN: 'unknown',             // said "not sure"
  SKIPPED: 'skipped',             // never answered
});

/**
 * Classify a single answer.
 * @param {Item} item
 * @param {number} answerIndex
 * @returns {string} One of OUTCOME.
 */
export function classify(item, answerIndex) {
  if (answerIndex === NO_ANSWER) return OUTCOME.SKIPPED;
  if (answerIndex === UNSURE) return OUTCOME.UNKNOWN;
  return answerIndex === item.correctIndex ? OUTCOME.CORRECT : OUTCOME.MISCONCEPTION;
}

/**
 * Build a Response record from an item and the student's answer.
 * @param {Item} item
 * @param {number} answerIndex
 * @param {{phase: string, latencyMs?: number, askedAt?: string}} meta
 * @returns {Response}
 */
export function recordResponse(item, answerIndex, meta) {
  return {
    itemId: item.id,
    objectiveId: item.objectiveId,
    phase: meta.phase,
    answerIndex,
    correct: answerIndex === item.correctIndex,
    // What the wrong answer reveals, not just that it was wrong. The sentinel
    // indices are negative and miss the array, which is correct: "not sure" and
    // "no answer" are gaps, not misconceptions, and conflating them would put
    // beliefs in a teacher's report that the student never expressed.
    misconception: item.misconceptions?.[answerIndex] ?? null,
    latencyMs: meta.latencyMs ?? 0,
    askedAt: meta.askedAt ?? new Date().toISOString(),
  };
}

/**
 * Count which misconceptions actually showed up, most common first.
 *
 * This is the teacher-facing payoff of the pre-built bank. "62% on D2.4" is not
 * something a teacher can teach to tomorrow; "most of the class thinks symmetry
 * is decorative" is a lesson opener. Aggregating across a class happens in the
 * dashboard — this is the per-session version of the same query.
 *
 * @param {Response[]} responses
 * @returns {Array<{misconception: string, objectiveId: string, count: number}>}
 */
export function misconceptionTally(responses) {
  const counts = new Map();
  for (const r of responses) {
    if (!r.misconception) continue;
    const key = `${r.objectiveId}::${r.misconception}`;
    const entry = counts.get(key) ?? {
      misconception: r.misconception,
      objectiveId: r.objectiveId,
      count: 0,
    };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * Score a set of responses per objective.
 * @param {Response[]} responses
 * @returns {Record<string, {correct: number, total: number, pct: number}>}
 */
export function scoreByObjective(responses) {
  /** @type {Record<string, {correct: number, total: number, pct: number}>} */
  const out = {};
  for (const r of responses) {
    const bucket = (out[r.objectiveId] ??= { correct: 0, total: 0, pct: 0 });
    bucket.total += 1;
    if (r.correct) bucket.correct += 1;
  }
  for (const bucket of Object.values(out)) {
    bucket.pct = bucket.total === 0 ? 0 : Math.round((bucket.correct / bucket.total) * 100);
  }
  return out;
}

/**
 * Overall score across a phase.
 * @param {Response[]} responses
 * @returns {{correct: number, total: number, pct: number}}
 */
export function scoreOverall(responses) {
  const correct = responses.filter((r) => r.correct).length;
  const total = responses.length;
  return { correct, total, pct: total === 0 ? 0 : Math.round((correct / total) * 100) };
}

/**
 * The headline measurement (spec §9): per-objective growth from diagnostic to
 * wrap-up quiz. Objectives present in either phase appear in the result, so an
 * objective that was only assessed once still shows up rather than vanishing.
 *
 * @param {Response[]} pre   Diagnostic responses.
 * @param {Response[]} post  Final-quiz responses.
 * @returns {Array<{objectiveId: string, before: number, after: number, delta: number, assessedBoth: boolean}>}
 */
export function growth(pre, post) {
  const beforeScores = scoreByObjective(pre);
  const afterScores = scoreByObjective(post);
  const ids = [...new Set([...Object.keys(beforeScores), ...Object.keys(afterScores)])];

  return ids.map((objectiveId) => {
    const b = beforeScores[objectiveId];
    const a = afterScores[objectiveId];
    return {
      objectiveId,
      before: b?.pct ?? 0,
      after: a?.pct ?? 0,
      delta: (a?.pct ?? 0) - (b?.pct ?? 0),
      assessedBoth: Boolean(b && a),
    };
  });
}

/**
 * Flag a wrap-up item that reuses a pre-pod item's prompt, which would turn the
 * growth delta into a memory test (spec §9).
 *
 * This used to run at runtime, when the model wrote both item sets in one call
 * and could quietly paraphrase itself. The pre-built bank makes the property
 * structural instead — pairs are authored as pairs — so nothing calls this in
 * the lesson loop any more. It is kept as an AUTHORING CHECK: run it over a new
 * curriculum's bank before shipping it, alongside the demand-matching assertions
 * described in items.js. Compares normalized prompt text rather than ids,
 * because the failure it catches is two items that read the same, not two items
 * that are labelled the same.
 *
 * @param {Item[]} diagnostic
 * @param {Item[]} final
 * @returns {{items: Item[], duplicates: Item[]}}
 */
export function checkParallelForms(diagnostic, final) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const seen = new Set(diagnostic.map((i) => norm(i.prompt)));
  const duplicates = final.filter((i) => seen.has(norm(i.prompt)));
  return { items: final, duplicates };
}
