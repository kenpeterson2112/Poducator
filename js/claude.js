/**
 * claude.js — all generation (spec §8).
 *
 * ONE call type now, and that is the headline change:
 *
 *   chapter() — once per chapter. Dialogue + checkpoint, aimed at one
 *               curriculum expectation, informed by the gap profile and the
 *               last checkpoint outcome.
 *
 * The planning call is gone. Objectives are curriculum expectations an educator
 * locked in, and the assessment items are pre-built and human-reviewed in
 * js/curriculum/items.js. Two things came out of that beyond the saved call:
 *
 *   1. Spec §11's conflict of interest is resolved. The model no longer authors
 *      the test it then teaches to.
 *   2. The one blocking round trip before a learner saw anything is gone, so
 *      the first question renders immediately.
 *
 * Structure still follows NowPod's js/claude.js: a pure buildPrompt/parse pair
 * either side of the fetch, so prompts can be inspected and responses parsed
 * without a network call. Structured outputs (`output_config.format`) guarantee
 * the JSON parses.
 */

import { CLAUDE, CHAPTER_SHAPE, HOSTS, ASSESSMENT, GRADE_BANDS, DEFAULT_GRADE_BAND } from './config.js';

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

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
 * Build the chapter prompt.
 *
 * Three curriculum fields do work here that a topic string cannot. `brief` says
 * what covering this expectation MEANS at this grade, which is what stops the
 * model from teaching whatever the source article happens to emphasize —
 * Wikipedia's "Symmetry" is about group theory, and a chapter grounded only in
 * it would miss the expectation entirely. `anchor` gives a concrete opening
 * phenomenon. `depth` sets the length from how well the learner already knows
 * it: the better they scored, the shorter the chapter.
 *
 * @param {{lessonTitle: string, source: string, gradeBand: string,
 *          chapter: import('./objectives.js').PlannedChapter,
 *          priorSummary: string, chapterIndex: number, chapterTotal: number,
 *          lastCheckpoint?: {objectiveText: string, outcome: string}|null}} input
 */
export function buildChapterPrompt(input) {
  const {
    lessonTitle, source, gradeBand, chapter,
    priorSummary, chapterIndex, chapterTotal, lastCheckpoint,
  } = input;
  const isLast = chapterIndex === chapterTotal - 1;
  const depth = chapter.depth ?? CHAPTER_SHAPE;

  const system = [
    'You write dialogue for a two-host educational podcast called Poducator.',
    `Host A is "${HOSTS.A.name}": ${HOSTS.A.role}`,
    `Host B is "${HOSTS.B.name}": ${HOSTS.B.role}`,
    readingGuidance(gradeBand),
    '',
    'This lesson is tied to a specific curriculum expectation that a teacher selected. Covering ' +
      'that expectation is the job — not covering the topic in general, and not covering whatever ' +
      'the source material happens to emphasize.',
    '',
    'Rules:',
    `- Write ${depth.minExchanges}-${depth.maxExchanges} short spoken exchanges, alternating hosts.`,
    '- This chapter teaches ONE expectation. Stay on it. Do not survey the whole topic.',
    '- Ground every factual claim in the source material. If the source is thin on something, say ' +
      'less rather than inventing more.',
    '- Lines are spoken aloud by text-to-speech: conversational, no stage directions, no markdown, ' +
      'no URLs, no bullet points, no "Host A:" prefixes.',
    '- Host B must actually be a learner, not a sidekick who says "wow". Have Host B ask the ' +
      'question a confused student would ask, or try an explanation and get part of it wrong so ' +
      'Host A can correct it kindly.',
    '',
    '- The FINAL 3 exchanges are the CHECKPOINT, written fully in character:',
    '  - Host A asks ONE comprehension question about this chapter\'s expectation, out loud, as a ' +
      'real question a host would ask — never "please select an option below".',
    '  - Then Host B riffs for 2-4 sentences: thinking out loud, narrowing it down, saying which ' +
      'part they found hardest. This riff is the answer window — it must never sound like the show ' +
      'is waiting on the listener, and it must not give the answer away.',
    `- The "checkpoint" object mirrors that spoken question for the UI: "prompt" is the question, ` +
      `"choices" is exactly ${ASSESSMENT.choicesPerItem} short options, "correctIndex" is 0-based, ` +
      '"explanation" is a short why.',
    '- Each wrong checkpoint choice must encode a mistake a student actually makes about THIS ' +
      'expectation. A throwaway option wastes the check — the wrong answer is the useful signal.',
    '- "spokenAnswer" is what Host A says aloud if the listener never answers: it reveals and ' +
      'explains the answer conversationally, in Host A\'s voice, and moves the show along. Two or ' +
      'three sentences. It must read naturally after Host B\'s riff.',
    ...(isLast
      ? ['- This is the FINAL chapter: after the checkpoint, wrap the lesson up warmly in a line or two.']
      : []),
    '- "summary" is one sentence on what this chapter taught, used as memory for the next chapter.',
  ].join('\n');

  const userParts = [
    `Lesson: ${lessonTitle}`,
    `Chapter ${chapterIndex + 1} of ${chapterTotal}.`,
    '',
    'THIS CHAPTER TEACHES THIS CURRICULUM EXPECTATION:',
    chapter.objectiveText,
    '',
    `What covering it means at this grade level: ${chapter.brief}`,
  ];

  if (chapter.anchor) {
    userParts.push(
      '',
      `A concrete situation you may open on, if it helps: ${chapter.anchor}. Use it or find a ` +
        'better one — do not force it.'
    );
  }

  userParts.push(
    '',
    `The learner answered questions on this expectation before the lesson started. How to ` +
      `approach it: ${chapter.strategy}`,
    '',
    '<source_material>',
    source,
    '</source_material>'
  );

  if (chapter.isReteach) {
    userParts.push(
      '',
      'IMPORTANT: this expectation was already taught once in this session and the learner still ' +
        'missed the check. Do not repeat the earlier explanation in different words — they have ' +
        'already heard that framing and it did not work. Change the approach entirely.'
    );
  }

  if (priorSummary) {
    userParts.push('', `Earlier in this lesson: ${priorSummary}`);
  }

  if (lastCheckpoint) {
    const note = {
      correct: `The learner answered the last check correctly (on: ${lastCheckpoint.objectiveText}). Host A can acknowledge that briefly and build on it.`,
      incorrect: `The learner answered the last check incorrectly (on: ${lastCheckpoint.objectiveText}). Do not shame it or dwell on it; carry the corrected idea forward as you teach this chapter.`,
      no_response: `The learner did not answer the last check (on: ${lastCheckpoint.objectiveText}). Assume they may have drifted — open this chapter with a concrete hook rather than an abstract statement.`,
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
 * Parse a chapter response.
 * @param {string} raw
 * @param {string} objectiveId  Tag the checkpoint to the chapter's expectation.
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
 * @param {{apiKey?: string, proxyUrl?: string, passphrase?: string,
 *           classCode?: string, signal?: AbortSignal}} opts
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
    // The passphrase is checked by the function, never here. A client-side
    // check would be theatre — see the note in supabase/functions/session.
    headers['x-poducator-pass'] = opts.passphrase ?? '';
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
    let code = null;
    try {
      const err = await res.json();
      detail = err?.error?.message ?? detail;
      code = err?.error?.code ?? null;
    } catch {
      /* keep the status code */
    }
    // A wrong passphrase is a user mistake, not a system failure, and the
    // start screen should say so plainly rather than surfacing "500".
    if (code === 'bad_passphrase') {
      const wrong = new Error('That passphrase is not right — check with your teacher.');
      wrong.code = 'bad_passphrase';
      throw wrong;
    }
    if (code === 'rate_limited') {
      const busy = new Error('Too many requests right now — wait a minute and try again.');
      busy.code = 'rate_limited';
      throw busy;
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
 * Generate one chapter.
 * @returns {Promise<{lines: Array, checkpoint: Object|null, summary: string}>}
 */
export async function chapter(input, opts) {
  const text = await callClaude(buildChapterPrompt(input), CHAPTER_SCHEMA, opts);
  return parseChapterResponse(text, input.chapter.objectiveId);
}
