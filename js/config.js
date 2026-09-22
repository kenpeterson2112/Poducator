/**
 * config.js — shared constants for Poducator.
 *
 * Centralizes what the spec pins down: source registry, objective/item counts,
 * the two host personas, and generation settings. No logic here.
 */

/**
 * How many curriculum expectations one lesson may cover (spec §3).
 *
 * The educator picks these and the learner cannot change them. The cap is the
 * point: a podcast that covers nine expectations covers none of them, and a
 * three-item diagnostic cannot say anything useful about more than three.
 */
export const EXPECTATION_SELECTION = Object.freeze({ min: 1, max: 3 });

/**
 * Assessment shape (spec §9).
 *
 * Three items, always — not "up to three". The budget stays fixed however many
 * expectations were selected and gets spread across them (see
 * curriculum/index.js `itemSplit`), so a one-expectation lesson asks three
 * questions about that expectation rather than resting its whole growth
 * measurement on a single binary item.
 *
 * Richer items cost time: a claim-and-reason choice set with a phenomenon stem
 * runs nearer 30-40 seconds than 15, so the pre-pod quiz lands around two
 * minutes rather than the 90 seconds the spec originally assumed for shallower
 * recall items. Three good items beat six thin ones.
 */
export const ASSESSMENT = Object.freeze({
  maxItems: 3,
  choicesPerItem: 4,
});

/**
 * Chapter length, by how the learner scored on that expectation.
 *
 * The rule is that the more solid the understanding, the briefer the content.
 * A learner who already has an idea should not sit through a full treatment of
 * it — but because the educator explicitly locked this expectation into the
 * lesson, it is never dropped entirely either (see objectives.planChapters).
 *
 * The last CHECKPOINT_LINES exchanges of every chapter are the checkpoint, so
 * the floor here has to leave room to actually teach something first.
 */
export const CHAPTER_DEPTH = Object.freeze({
  misconception: { minExchanges: 9, maxExchanges: 12 },
  unknown: { minExchanges: 8, maxExchanges: 11 },
  shaky: { minExchanges: 6, maxExchanges: 9 },
  solid: { minExchanges: 5, maxExchanges: 7 },
});

/** Fallback shape when a status has no entry above. */
export const CHAPTER_SHAPE = Object.freeze({
  minExchanges: 6,
  maxExchanges: 10,
});

/**
 * How many chapters a session runs. One per selected expectation, plus room for
 * the reteach branch (spec §6) to insert one more per expectation when a
 * checkpoint is missed — so a three-expectation lesson can reach six chapters.
 */
export const CHAPTER_BOUNDS = Object.freeze({ min: 1, max: 8 });

/** How many candidate articles the "which did you mean?" step offers. */
export const CANDIDATE_COUNT = 3;

/**
 * Podcast length, student mode only (P2).
 *
 * Minutes is what a learner actually thinks in ("I have the bus ride"), so that
 * is what the UI offers. Two things it maps to, and the split matters:
 *
 *   objectives  — how much GROUND the lesson covers. Extra minutes buy more
 *                 ideas, not more words about one idea.
 *   depthScale  — a gentle multiplier on js/objectives.js:depthFor(), which
 *                 already sizes each chapter by how well the diagnostic says
 *                 the learner knows it (CHAPTER_DEPTH above). Scaling rather
 *                 than replacing keeps that: a misconception chapter stays
 *                 longer than a solid one at every length.
 *
 * `estMinutesPerExchange` is only for the up-front "about N minutes" label.
 * Once chapters exist the estimate is recomputed from their real text — see
 * estimateMinutes() below — because a promised 10 that runs 13 is worse than
 * an honest approximation.
 */
export const LENGTHS = Object.freeze({
  short: { label: 'About 5 minutes', minutes: 5, objectives: 3, depthScale: 0.8 },
  standard: { label: 'About 10 minutes', minutes: 10, objectives: 5, depthScale: 1.0 },
  deep: { label: 'About 20 minutes', minutes: 20, objectives: 7, depthScale: 1.3 },
});

export const DEFAULT_LENGTH = 'standard';

/**
 * Words per minute for turning text into a time estimate. Browser TTS runs
 * near a normal speaking pace at rate 1.0; this is deliberately a round number
 * because the label says "about".
 */
export const SPEECH_WPM = 150;

/**
 * Estimate how long some dialogue takes to speak.
 * @param {Array<{text: string}>} lines
 * @returns {number} minutes, rounded to the nearest whole minute (min 1)
 */
export function estimateMinutes(lines) {
  const words = lines.reduce((n, l) => n + String(l?.text ?? '').split(/\s+/).filter(Boolean).length, 0);
  return Math.max(1, Math.round(words / SPEECH_WPM));
}

/**
 * Scale a chapter depth by the chosen length.
 * @param {{minExchanges: number, maxExchanges: number}} depth
 * @param {number} scale
 */
export function scaleDepth(depth, scale) {
  const clamp = (n) => Math.max(3, Math.min(16, Math.round(n * scale)));
  return { minExchanges: clamp(depth.minExchanges), maxExchanges: clamp(depth.maxExchanges) };
}

/** How many questions the optional student-mode opener asks (spec: 2-3 tops). */
export const STUDENT_DIAGNOSTIC_ITEMS = Object.freeze({ min: 2, max: 3 });

/** How many questions the closing check-in asks — same shape as the opener,
 * a practice moment for the learner rather than a measurement, so it never
 * needs to be longer than the opener was. */
export const STUDENT_FINAL_ITEMS = Object.freeze({ min: 2, max: 3 });

/**
 * How many closing exchanges form the checkpoint window (spec §6): Host A's
 * question plus Host B's riff. The riff IS the answer window.
 */
export const CHECKPOINT_LINES = 3;

/**
 * How many lines "Previous" tolerates before it stops meaning "go back a
 * chapter" and starts meaning "restart this one" — the same podcast-app
 * convention as a track-back button. Reuses CHECKPOINT_LINES' "3" as this
 * codebase's unit for a short window: the shortest chapter (a `solid`-status
 * one, ~10 lines per CHAPTER_DEPTH) still has plenty of room past it.
 */
export const SMART_PREV_LINE_THRESHOLD = 3;

/** How many lines "back a few" / "ahead a few" move within a chapter. */
export const LINE_SEEK_COUNT = 3;

/** Preset playback-speed multipliers, applied on top of each host's own rate. */
export const SPEED_PRESETS = Object.freeze([0.75, 1, 1.25, 1.5]);

/** localStorage key for the listener's chosen playback speed (a device
 * preference, never part of a session record — see store.js). */
export const SPEED_STORAGE_KEY = 'poducator_speed';

/**
 * Cap on source text fed to a generation call. This is now a PER-EXPECTATION
 * budget rather than a whole-lesson one: each chapter is grounded only in the
 * material for the expectation it teaches, so the same number buys a more
 * focused prompt than it used to.
 */
export const SOURCE_CHAR_LIMIT = 9000;

/**
 * Source registry (spec §8). Every entry is a MediaWiki-family site: one API
 * shape, CORS-friendly via origin=*, no auth. The user's own source list drops
 * in here — adding a site is a config entry, not a refactor.
 *
 * `readingLevel` steers which sources a grade band prefers; `instructional`
 * marks sites whose content is already lesson-shaped.
 */
export const SOURCES = Object.freeze([
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    host: 'en.wikipedia.org',
    readingLevel: 'general',
    instructional: false,
    default: true,
  },
  {
    id: 'simple',
    label: 'Simple English Wikipedia',
    host: 'simple.wikipedia.org',
    readingLevel: 'simple',
    instructional: false,
    default: true,
  },
  {
    id: 'wikibooks',
    label: 'Wikibooks',
    host: 'en.wikibooks.org',
    readingLevel: 'general',
    instructional: true,
    default: true,
  },
  {
    id: 'wikiversity',
    label: 'Wikiversity',
    host: 'en.wikiversity.org',
    readingLevel: 'general',
    instructional: true,
    default: true,
  },
  {
    id: 'wikinews',
    label: 'Wikinews',
    host: 'en.wikinews.org',
    readingLevel: 'general',
    instructional: false,
    default: false,
  },
]);

/**
 * Grade bands → reading-level guidance handed to the model, and which source
 * reading level to prefer. Prompt-based and uncalibrated (spec §11).
 */
export const GRADE_BANDS = Object.freeze({
  'elementary': {
    label: 'Elementary (3-5)',
    prefer: 'simple',
    guidance: 'Short sentences. Everyday words. Explain any term longer than three syllables the first time it appears.',
  },
  'middle': {
    label: 'Middle school (6-8)',
    prefer: 'simple',
    guidance: 'Plain, direct sentences. Introduce subject vocabulary, but define each term the first time.',
  },
  'high': {
    label: 'High school (9-12)',
    prefer: 'general',
    guidance: 'Normal conversational register. Subject vocabulary is fine; define only genuinely technical terms.',
  },
  'college': {
    label: 'College / adult',
    prefer: 'general',
    guidance: 'Assume comfort with technical vocabulary. Do not over-explain foundational ideas.',
  },
});

export const DEFAULT_GRADE_BAND = 'high';

/**
 * Claude Messages API. Phase 1 calls the API directly from the browser with the
 * CORS opt-in header and a pasted key, exactly as NowPod does, so the loop is
 * demoable with no infrastructure. Phase 2 points `proxyEndpoint` at the Edge
 * Function in supabase/functions/session and students never touch a key
 * (spec §7) — `mode` is the only thing that changes.
 */
export const CLAUDE = Object.freeze({
  endpoint: 'https://api.anthropic.com/v1/messages',
  proxyEndpoint: '/functions/v1/session',
  // Sonnet: grounded, schema-constrained generation doesn't need Opus-level
  // reasoning, and per-chapter latency is what the listener actually feels.
  model: 'claude-sonnet-5',
  apiVersion: '2023-06-01',
  maxTokens: 4096,
});

/** localStorage key for the Phase 1 paste-your-own-key dev flow. */
export const API_KEY_STORAGE_KEY = 'poducator_api_key';

/**
 * Deployed Edge Function URL, e.g.
 *   https://<project-ref>.supabase.co/functions/v1/session
 *
 * NOT a secret — a function URL is meant to be public, and committing it is
 * correct. The secrets (the Anthropic key and the class passphrase) live in
 * that function's environment and never appear in this repo.
 *
 * Empty string = local development mode: the app falls back to asking for a
 * pasted API key, exactly as it did before the gate existed. Blank it locally
 * if you want that fallback back; leave it set for anything learners touch.
 */
export const PROXY_URL = 'https://dmvikgkwyybswabyrgni.supabase.co/functions/v1/session';

/** localStorage key for the class passphrase, so a learner types it once. */
export const PASSPHRASE_STORAGE_KEY = 'poducator_passphrase';

/**
 * Which credential mode is active. UI and orchestrator both read this so they
 * cannot disagree about which field the learner is being asked for.
 */
export function usingProxy() {
  return PROXY_URL.trim().length > 0;
}

/**
 * The two hosts (spec §5). Host B is the load-bearing one: a learner-companion
 * who voices the confusion the student won't ask aloud. `voiceHint` is used by
 * tts.js when picking/tuning a Web Speech voice.
 */
export const HOSTS = Object.freeze({
  A: {
    id: 'A',
    name: 'the Teacher',
    role:
      'Explains clearly and checks for understanding. Warm, never condescending. ' +
      'Never says "as you already know" or "obviously" — that teaches a struggling student to stay quiet.',
    voiceHint: { pitch: 1.0, rate: 1.0 },
  },
  B: {
    id: 'B',
    name: 'the Learner',
    role:
      'Voices the confusion a student probably has but would not ask aloud. ' +
      'Sometimes gets it partly wrong and self-corrects. Models productive struggle, so being confused feels normal.',
    voiceHint: { pitch: 1.15, rate: 1.03 },
  },
});

/** Outcome of a single checkpoint (spec §6). `no_response` is its own signal. */
export const CHECKPOINT_OUTCOME = Object.freeze({
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  NO_RESPONSE: 'no_response',
});
