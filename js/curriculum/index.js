/**
 * curriculum/index.js — lesson configuration and item sampling.
 *
 * Three jobs:
 *
 *   1. Turn an educator's expectation selection into a shareable lesson link,
 *      and read one back. This is how a lesson gets "locked in for the learner"
 *      with no accounts and no server (spec §7's constraint in Phase 1).
 *   2. Sample the pre-built bank into a diagnostic and a matched wrap-up set.
 *   3. Hand back objectives in the shape the rest of the app already speaks.
 *
 * ON "LOCKED": the lesson lives in the URL hash, so a student who opens the
 * link gets an interface with no way to change what is being taught. A student
 * who edits the hash by hand can change it. That is a real limit and it is the
 * right one for this phase — the requirement is pedagogical (the learner does
 * not choose the scope), not adversarial. The same config object moves to the
 * `lessons` table behind a class code in Phase 2, and only the transport
 * changes.
 */

import { EXPECTATIONS, expectationByCode, CURRICULUM } from './ontario-sci-7-d.js';
import { BANK } from './items.js';
import { ASSESSMENT, EXPECTATION_SELECTION, GRADE_BANDS, DEFAULT_GRADE_BAND } from '../config.js';

/**
 * @typedef {Object} LessonConfig
 * @property {string[]} codes      Selected expectation codes, curriculum order.
 * @property {string}   gradeBand  Reading-level band.
 */

/* ------------------------------------------------------------------ */
/* Lesson config <-> URL hash                                          */
/* ------------------------------------------------------------------ */

/**
 * Encode a lesson into a hash fragment.
 *
 * Deliberately readable rather than base64: an educator can eyeball a link and
 * see which expectations it carries, and so can anyone debugging one.
 * @param {LessonConfig} config
 * @returns {string} e.g. "#e=D2.2,D2.5&g=middle"
 */
export function encodeLessonConfig(config) {
  const params = new URLSearchParams();
  params.set('e', config.codes.join(','));
  params.set('g', config.gradeBand);
  return `#${params.toString()}`;
}

/**
 * Read a lesson config out of a hash fragment.
 *
 * Validates hard, because this string arrives from outside the app: unknown
 * codes are dropped, order is normalized to curriculum order (a lesson should
 * teach prerequisites first regardless of the order they were clicked), the
 * selection is capped, and an unknown grade band falls back to the default.
 *
 * @param {string} hash
 * @returns {LessonConfig|null} null when there is no usable lesson in the hash.
 */
export function parseLessonConfig(hash) {
  if (!hash || hash.length < 2) return null;

  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const raw = (params.get('e') ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  if (raw.length === 0) return null;

  const known = new Set(EXPECTATIONS.map((e) => e.code));
  const selected = new Set(raw.filter((c) => known.has(c) && BANK[c]));
  if (selected.size === 0) return null;

  // Curriculum order, not click order — the numbering encodes a teaching
  // sequence and a lesson should respect it.
  const codes = EXPECTATIONS.filter((e) => selected.has(e.code))
    .map((e) => e.code)
    .slice(0, EXPECTATION_SELECTION.max);

  const g = params.get('g');
  const gradeBand = g && GRADE_BANDS[g] ? g : CURRICULUM.defaultGradeBand ?? DEFAULT_GRADE_BAND;

  return { codes, gradeBand };
}

/** True when a selection is a legal lesson. */
export function isValidSelection(codes) {
  return (
    Array.isArray(codes) &&
    codes.length >= EXPECTATION_SELECTION.min &&
    codes.length <= EXPECTATION_SELECTION.max &&
    codes.every((c) => Boolean(BANK[c]))
  );
}

/* ------------------------------------------------------------------ */
/* Objectives                                                          */
/* ------------------------------------------------------------------ */

/**
 * The selected expectations as objectives, in the shape objectives.js,
 * assessment.js and the database already use. The expectation code IS the
 * objective id, so a response row reads `D2.2` rather than `OBJ-3` and a
 * teacher can match it to the curriculum document without a lookup table.
 * @param {string[]} codes
 * @returns {Array<{id: string, text: string, short: string, brief: string, anchor: string}>}
 */
export function toObjectives(codes) {
  return codes.map((code) => {
    const e = expectationByCode(code);
    return {
      id: e.code,
      text: e.text,
      short: e.short,
      brief: e.brief,
      anchor: e.anchor,
      sources: e.sources,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Item sampling                                                       */
/* ------------------------------------------------------------------ */

/**
 * How many items each expectation contributes, given the total budget.
 *
 * The budget is fixed at ASSESSMENT.maxItems regardless of how many
 * expectations were selected, spread as evenly as possible, with any remainder
 * going to the earliest expectations. Earliest, because curriculum numbering
 * usually encodes a prerequisite order and the earlier idea is the one more
 * worth measuring twice.
 *
 *   1 expectation  -> [3]
 *   2 expectations -> [2, 1]
 *   3 expectations -> [1, 1, 1]
 *
 * Holding the total at 3 rather than scaling it down is what keeps a
 * single-expectation lesson from resting its entire growth measurement on one
 * binary item.
 *
 * @param {number} count  How many expectations were selected.
 * @returns {number[]}    Items per expectation, in order.
 */
export function itemSplit(count) {
  const budget = ASSESSMENT.maxItems;
  const base = Math.floor(budget / count);
  const remainder = budget % count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Flatten one bank entry into the Item shape the app runs on.
 *
 * `choices` becomes plain strings so ui.js and assessment.js need no changes,
 * and the misconception slugs ride alongside in a parallel array. They are
 * teacher-facing only: nothing renders them to a student.
 */
function toItem(raw, code, phase, index) {
  return {
    id: `${phase}-${code}-${index + 1}`,
    objectiveId: code,
    prompt: raw.prompt,
    choices: raw.choices.map((c) => c.text),
    misconceptions: raw.choices.map((c) => c.misconception),
    correctIndex: raw.correctIndex,
    explanation: raw.explanation,
    category: raw.category,
    practice: raw.practice,
    crosscutting: raw.crosscutting,
  };
}

/**
 * Build the diagnostic and wrap-up sets for a lesson.
 *
 * Both sets are drawn from the same index positions in the bank, which is what
 * makes them parallel forms: bank pairs are authored to share category,
 * practice and crosscutting concept and differ only in phenomenon. Taking
 * position i from both sides preserves that pairing at any selection size — and
 * because each expectation's items run [thinking, application, knowledge], a
 * three-expectation lesson asks a thinking-level question about each rather
 * than three recall questions.
 *
 * @param {string[]} codes
 * @returns {{diagnostic: Array, final: Array}}
 */
export function sampleItems(codes) {
  const split = itemSplit(codes.length);
  const diagnostic = [];
  const final = [];

  codes.forEach((code, ci) => {
    const entry = BANK[code];
    const take = Math.min(split[ci], entry.diagnostic.length, entry.final.length);
    for (let i = 0; i < take; i += 1) {
      diagnostic.push(toItem(entry.diagnostic[i], code, 'diagnostic', diagnostic.length));
      final.push(toItem(entry.final[i], code, 'final', final.length));
    }
  });

  return { diagnostic, final };
}

/**
 * A one-line description of the lesson, for headers and the session record.
 * @param {LessonConfig} config
 */
export function lessonTitle(config) {
  const parts = config.codes.map((c) => expectationByCode(c)?.short ?? c);
  return parts.join(' · ');
}
