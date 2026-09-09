/**
 * claude.js — all generation (spec §8).
 *
 * Two call types, and deliberately only two:
 *
 *   1. plan()    — once per session. Produces the objectives (explore mode),
 *                  the diagnostic items, AND the wrap-up items, together.
 *   2. chapter() — once per chapter. Dialogue + checkpoint, aimed at one
 *                  objective, informed by the gap profile and the last
 *                  checkpoint outcome.
 *
 * Why both item sets come from ONE call: they have to be parallel forms —
 * same objectives, different items, matched difficulty. Generated in separate
 * calls the difficulty drifts, and a drifting instrument makes the pre/post
 * delta meaningless (spec §9). One call, one context, one calibration.
 *
 * Structure follows NowPod's js/claude.js: a pure buildPrompt/parseResponse
 * pair either side of the fetch, so prompts can be inspected and responses
 * parsed without a network call. Structured outputs (`output_config.format`)
 * guarantee the JSON parses.
 */

import {
  CLAUDE,
  CHAPTER_SHAPE,
  HOSTS,
  OBJECTIVE_RANGE,
  ASSESSMENT,
  GRADE_BANDS,
  DEFAULT_GRADE_BAND,
} from './config.js';
import { UNSURE_LABEL } from './assessment.js';

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    objectiveId: { type: 'string' },
    prompt: { type: 'string' },
    choices: { type: 'array', items: { type: 'string' } },
    correctIndex: { type: 'integer' },
    explanation: { type: 'string' },
  },
  required: ['objectiveId', 'prompt', 'choices', 'correctIndex', 'explanation'],
  additionalProperties: false,
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    objectives: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
    diagnostic: { type: 'array', items: ITEM_SCHEMA },
    final: { type: 'array', items: ITEM_SCHEMA },
  },
  required: ['objectives', 'diagnostic', 'final'],
  additionalProperties: false,
};

const CHAPTER_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          speaker: { type: 'string', enum: ['A', 'B'] },
          text: { type: 'string' },
        },
        required: ['speaker', 'text'],
        additionalProperties: false,
      },
    },
    checkpoint: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        choices: { type: 'array', items: { type: 'string' } },
        correctIndex: { type: 'integer' },
        explanation: { type: 'string' },
        spokenAnswer: { type: 'string' },
      },
      required: ['prompt', 'choices', 'correctIndex', 'explanation', 'spokenAnswer'],
      additionalProperties: false,
    },
    summary: { type: 'string' },
  },
  required: ['lines', 'checkpoint', 'summary'],
  additionalProperties: false,
};

/* ------------------------------------------------------------------ */
/* Prompt building (pure)                                              */
/* ------------------------------------------------------------------ */

function readingGuidance(gradeBand) {
  const band = GRADE_BANDS[gradeBand] ?? GRADE_BANDS[DEFAULT_GRADE_BAND];
  return `Audience: ${band.label}. ${band.guidance}`;
}

/**
 * Build the planning prompt.
 * @param {{topic: string, source: string, gradeBand: string,
 *          objectives?: Array<{id: string, text: string}>}} input
 *   `objectives` is supplied in assigned mode (the teacher wrote them) and
 *   omitted in explore mode (the model infers them).
 */
export function buildPlanPrompt(input) {
  const { topic, source, gradeBand, objectives } = input;
  const authored = Array.isArray(objectives) && objectives.length > 0;

  const system = [
    'You design short, focused lessons that are delivered as a two-host audio podcast.',
    'You are writing the ASSESSMENT for one lesson, before any teaching happens.',
    readingGuidance(gradeBand),
    '',
    'Rules:',
    authored
      ? '- The learning objectives are FIXED and given to you. Return them back unchanged, with their ids intact. Do not add, remove, reword, or reorder them.'
      : `- Derive ${OBJECTIVE_RANGE.min}-${OBJECTIVE_RANGE.max} learning objectives from the source material. ` +
        'Each must be a single, specific, checkable thing a student could demonstrate — "Explain why ' +
        'X causes Y", not "Understand X". Order them so prerequisites come first. Give them ids ' +
        'OBJ-1, OBJ-2, and so on.',
    '',
    `- Write ${ASSESSMENT.diagnosticItems.min}-${ASSESSMENT.diagnosticItems.max} DIAGNOSTIC items and the same number of FINAL items.`,
    '- Every objective must be covered by at least one diagnostic item and at least one final item.',
    '- The two sets are PARALLEL FORMS: they assess the same objectives at the same difficulty, ' +
      'but no final item may reuse, paraphrase, or merely reorder a diagnostic item. A student who ' +
      'memorized the diagnostic must gain no advantage on the final.',
    `- Each item has exactly ${ASSESSMENT.choicesPerItem} choices. Do NOT include a "not sure" choice — the app adds one ("${UNSURE_LABEL}") automatically.`,
    '- Wrong choices must be PLAUSIBLE — each should encode a real misconception a student actually ' +
      'holds, not filler. The wrong answers are the diagnostic signal; throwaway distractors waste the item.',
    '- "correctIndex" is the 0-based index of the correct choice. Vary its position across items.',
    '- "explanation" is one or two sentences on why the right answer is right, written to be read by ' +
      'a student who just got it wrong. No blame, no "obviously".',
    '- Items must be answerable from the source material alone.',
  ].join('\n');

  const userParts = [
    `Lesson topic: ${topic}`,
    '',
    '<source_material>',
    source,
    '</source_material>',
  ];

  if (authored) {
    userParts.push(
      '',
      'Fixed learning objectives (return these unchanged):',
      ...objectives.map((o) => `${o.id}: ${o.text}`)
    );
  }

  userParts.push('', 'Produce the objectives and both item sets now.');

  return { system, messages: [{ role: 'user', content: userParts.join('\n') }] };
}

/**
 * Build the chapter prompt.
 * @param {{topic: string, source: string, gradeBand: string,
 *          chapter: import('./objectives.js').PlannedChapter,
 *          priorSummary: string, chapterIndex: number, chapterTotal: number,
 *          lastCheckpoint?: {objectiveText: string, outcome: string}|null}} input
 */
export function buildChapterPrompt(input) {
  const {
    topic, source, gradeBand, chapter,
    priorSummary, chapterIndex, chapterTotal, lastCheckpoint,
  } = input;
  const isLast = chapterIndex === chapterTotal - 1;

  const system = [
    'You write dialogue for a two-host educational podcast called Poducator.',
    `Host A is "${HOSTS.A.name}": ${HOSTS.A.role}`,
    `Host B is "${HOSTS.B.name}": ${HOSTS.B.role}`,
    readingGuidance(gradeBand),
    '',
    'Rules:',
    `- Write ${CHAPTER_SHAPE.minExchanges}-${CHAPTER_SHAPE.maxExchanges} short spoken exchanges, alternating hosts.`,
    '- This chapter teaches ONE objective. Stay on it. Do not survey the whole topic.',
    '- Ground every factual claim in the source material. If the source is thin on something, say ' +
      'less rather than inventing more.',
    '- Lines are spoken aloud by text-to-speech: conversational, no stage directions, no markdown, ' +
      'no URLs, no bullet points, no "Host A:" prefixes.',
    '- Host B must actually be a learner, not a sidekick who says "wow". Have Host B ask the ' +
      'question a confused student would ask, or try an explanation and get part of it wrong so ' +
      'Host A can correct it kindly.',
    '',
    '- The FINAL 3 exchanges are the CHECKPOINT, written fully in character:',
    '  - Host A asks ONE comprehension question about this chapter\'s objective, out loud, as a ' +
      'real question a host would ask — never "please select an option below".',
    '  - Then Host B riffs for 2-4 sentences: thinking out loud, narrowing it down, saying which ' +
      'part they found hardest. This riff is the answer window — it must never sound like the show ' +
      'is waiting on the listener, and it must not give the answer away.',
    `- The "checkpoint" object mirrors that spoken question for the UI: "prompt" is the question, ` +
      `"choices" is exactly ${ASSESSMENT.choicesPerItem} short options with plausible wrong answers, ` +
      '"correctIndex" is 0-based, "explanation" is a short why.',
    '- "spokenAnswer" is what Host A says aloud if the listener never answers: it reveals and ' +
      'explains the answer conversationally, in Host A\'s voice, and moves the show along. Two or ' +
      'three sentences. It must read naturally after Host B\'s riff.',
    ...(isLast
      ? ['- This is the FINAL chapter: after the checkpoint, wrap the lesson up warmly in a line or two.']
      : []),
    '- "summary" is one sentence on what this chapter taught, used as memory for the next chapter.',
  ].join('\n');

  const userParts = [
    `Lesson topic: ${topic}`,
    `Chapter ${chapterIndex + 1} of ${chapterTotal}.`,
    '',
    `THIS CHAPTER TEACHES: ${chapter.objectiveText}`,
    '',
    `The diagnostic showed where this student stands on it. How to approach it: ${chapter.strategy}`,
    '',
    '<source_material>',
    source,
    '</source_material>',
  ];

  if (chapter.isReteach) {
    userParts.push(
      '',
      'IMPORTANT: this objective was already taught once in this session and the student still ' +
        'missed the check. Do not repeat the earlier explanation in different words — the student ' +
        'has already heard that framing and it did not work. Change the approach entirely.'
    );
  }

  if (priorSummary) {
    userParts.push('', `Earlier in this lesson: ${priorSummary}`);
  }

  if (lastCheckpoint) {
    const note = {
      correct: `The student answered the last check correctly (on: ${lastCheckpoint.objectiveText}). Host A can acknowledge that briefly and build on it.`,
      incorrect: `The student answered the last check incorrectly (on: ${lastCheckpoint.objectiveText}). Do not shame it or dwell on it; carry the corrected idea forward as you teach this chapter.`,
      no_response: `The student did not answer the last check (on: ${lastCheckpoint.objectiveText}). Assume they may have drifted — open this chapter with a concrete hook rather than an abstract statement.`,
    }[lastCheckpoint.outcome];
    if (note) userParts.push('', note);
  }

  userParts.push('', 'Write the chapter now.');

  return { system, messages: [{ role: 'user', content: userParts.join('\n') }] };
}

/* ------------------------------------------------------------------ */
/* Response parsing (pure)                                             */
/* ------------------------------------------------------------------ */

/** Parse JSON, tolerating an accidental code fence. */
function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const stripped = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    return JSON.parse(stripped);
  }
}

/**
 * Coerce one raw item into a validated Item, or null if unusable.
 * Ids are assigned here rather than asked of the model — client-generated ids
 * are guaranteed unique, and the model has no reason to be good at it.
 */
function toItem(raw, index, phase, validObjectiveIds) {
  const choices = (raw?.choices ?? []).filter((c) => typeof c === 'string' && c.trim());
  if (choices.length < 2) return null;
  if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) return null;
  if (!validObjectiveIds.has(raw.objectiveId)) return null;

  const correctIndex = Number.isInteger(raw.correctIndex) ? raw.correctIndex : 0;
  if (correctIndex < 0 || correctIndex >= choices.length) return null;

  return {
    id: `${phase}-${index + 1}`,
    objectiveId: raw.objectiveId,
    prompt: raw.prompt.trim(),
    choices,
    correctIndex,
    explanation: typeof raw.explanation === 'string' ? raw.explanation : '',
  };
}

/**
 * Parse the planning response.
 * @param {string} raw
 * @param {Array<{id: string, text: string}>} [authoredObjectives]
 * @returns {{objectives: Array<{id: string, text: string}>,
 *            diagnostic: import('./assessment.js').Item[],
 *            final: import('./assessment.js').Item[]}}
 */
export function parsePlanResponse(raw, authoredObjectives) {
  const data = parseJson(raw);

  // In assigned mode the teacher's objectives are authoritative; the model was
  // told to echo them, but trusting that echo would let a paraphrase silently
  // replace what the teacher wrote.
  const objectives =
    Array.isArray(authoredObjectives) && authoredObjectives.length > 0
      ? authoredObjectives
      : (data.objectives ?? [])
          .filter((o) => typeof o?.id === 'string' && typeof o?.text === 'string' && o.text.trim())
          .map((o) => ({ id: o.id, text: o.text.trim() }));

  if (objectives.length === 0) {
    throw new Error('Lesson planning returned no learning objectives.');
  }

  const validIds = new Set(objectives.map((o) => o.id));
  const diagnostic = (data.diagnostic ?? [])
    .map((raw, i) => toItem(raw, i, 'diagnostic', validIds))
    .filter(Boolean);
  const final = (data.final ?? [])
    .map((raw, i) => toItem(raw, i, 'final', validIds))
    .filter(Boolean);

  if (diagnostic.length === 0) {
    throw new Error('Lesson planning returned no usable diagnostic questions.');
  }

  return { objectives, diagnostic, final };
}

/**
 * Parse a chapter response.
 * @param {string} raw
 * @param {string} objectiveId  Tag the checkpoint to the chapter's objective.
 */
export function parseChapterResponse(raw, objectiveId) {
  const data = parseJson(raw);

  const lines = (data.lines ?? []).filter(
    (l) => (l.speaker === 'A' || l.speaker === 'B') && typeof l.text === 'string' && l.text.trim()
  );
  if (lines.length === 0) {
    throw new Error('Chapter generation returned no usable dialogue.');
  }

  const cp = data.checkpoint ?? {};
  const choices = (cp.choices ?? []).filter((c) => typeof c === 'string' && c.trim());
  const correctIndex =
    Number.isInteger(cp.correctIndex) && cp.correctIndex >= 0 && cp.correctIndex < choices.length
      ? cp.correctIndex
      : 0;

  // A chapter with an unusable checkpoint still plays — losing the dialogue
  // because the quiz object came back malformed would be the wrong trade.
  const checkpoint =
    choices.length >= 2 && typeof cp.prompt === 'string' && cp.prompt.trim()
      ? {
          id: `checkpoint-${objectiveId}`,
          objectiveId,
          prompt: cp.prompt.trim(),
          choices,
          correctIndex,
          explanation: typeof cp.explanation === 'string' ? cp.explanation : '',
          spokenAnswer: typeof cp.spokenAnswer === 'string' ? cp.spokenAnswer : '',
        }
      : null;

  return {
    lines,
    checkpoint,
    summary: typeof data.summary === 'string' ? data.summary : lines[0].text,
  };
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

/**
 * Call the Messages API and return the text block.
 *
 * Phase 1 talks to the API directly from the browser with a pasted key, as
 * NowPod does. Phase 2 swaps `opts.proxyUrl` in and the key never reaches the
 * client (spec §7) — the request body is identical either way, which is the
 * whole point of routing both through here.
 *
 * @param {{system: string, messages: Array}} prompt
 * @param {Object} schema
 * @param {{apiKey?: string, proxyUrl?: string, signal?: AbortSignal}} opts
 * @returns {Promise<string>}
 */
async function callClaude(prompt, schema, opts) {
  const body = JSON.stringify({
    model: CLAUDE.model,
    max_tokens: CLAUDE.maxTokens,
    system: prompt.system,
    messages: prompt.messages,
    // Schema-constrained generation doesn't need extended thinking, and
    // latency is what the listener actually experiences.
    thinking: { type: 'disabled' },
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema },
    },
  });

  const headers = { 'content-type': 'application/json' };
  let url;

  if (opts.proxyUrl) {
    url = opts.proxyUrl;
    if (opts.classCode) headers['x-poducator-class'] = opts.classCode;
  } else {
    if (!opts.apiKey) {
      throw new Error('Missing Claude API key — paste one on the start screen.');
    }
    url = CLAUDE.endpoint;
    headers['x-api-key'] = opts.apiKey;
    headers['anthropic-version'] = CLAUDE.apiVersion;
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  const res = await fetch(url, { method: 'POST', headers, body, signal: opts.signal });

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const err = await res.json();
      detail = err?.error?.message ?? detail;
    } catch {
      /* keep the status code */
    }
    throw new Error(`Generation failed: ${detail}`);
  }

  const data = await res.json();
  const text = (data.content ?? []).find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new Error(`Generation returned no content (stop_reason: ${data.stop_reason}).`);
  }
  return text;
}

/**
 * Plan a lesson: objectives (explore mode) plus both parallel item sets.
 * @returns {Promise<{objectives: Array, diagnostic: Array, final: Array}>}
 */
export async function plan(input, opts) {
  const text = await callClaude(buildPlanPrompt(input), PLAN_SCHEMA, opts);
  return parsePlanResponse(text, input.objectives);
}

/**
 * Generate one chapter.
 * @returns {Promise<{lines: Array, checkpoint: Object|null, summary: string}>}
 */
export async function chapter(input, opts) {
  const text = await callClaude(buildChapterPrompt(input), CHAPTER_SCHEMA, opts);
  return parseChapterResponse(text, input.chapter.objectiveId);
}
