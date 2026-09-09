/**
 * tts.js — browser text-to-speech via the Web Speech API.
 *
 * Ported near-verbatim from NowPod's js/tts.js. The robustness here was earned
 * the hard way and is worth keeping intact:
 *
 * - Some environments report zero voices or fail synthesis outright. Those
 *   lines degrade to a duration-estimate pacing timer, so the karaoke
 *   transcript still advances at reading speed and the lesson still completes
 *   in silence rather than hanging forever.
 * - stop() settles any pending line immediately, so skipping or restarting
 *   never waits out a pacing timer.
 *
 * The one addition over NowPod: speakOne(), used for the spoken checkpoint
 * answer Host A gives when the student doesn't respond (spec §6). That line
 * isn't part of the generated chapter script, so it needs its own entry point.
 */

import { HOSTS } from './config.js';

/** Resolved voice assignment: one SpeechSynthesisVoice (or null) per host id. */
const voiceMap = { A: null, B: null };

/** Cancellation token for whatever is currently being spoken. */
let activeSession = null;

/** Wait for getVoices() to populate — it's async in most browsers. */
function loadVoices() {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    if (!synth) return resolve([]);

    const existing = synth.getVoices();
    if (existing.length > 0) return resolve(existing);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(synth.getVoices());
    };
    synth.addEventListener('voiceschanged', settle, { once: true });
    setTimeout(settle, 1500); // some environments never fire voiceschanged
  });
}

/**
 * Load available voices and assign one per host. Best-effort: with one voice
 * (or none) the hosts still differ via the pitch/rate hints in config.js.
 */
export async function initVoices() {
  const voices = await loadVoices();
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
  const pool = english.length > 0 ? english : voices;

  voiceMap.A = pool[0] ?? null;
  voiceMap.B = pool.find((v) => v.name !== voiceMap.A?.name) ?? voiceMap.A;
}

/** True when at least one distinct voice pair was found (for a UI hint). */
export function hasDistinctVoices() {
  return Boolean(voiceMap.A && voiceMap.B && voiceMap.A.name !== voiceMap.B.name);
}

/**
 * Speak one dialogue line in its host's voice. Always resolves — on `end`, on
 * cancellation, or on the pacing timer.
 * @param {{speaker: 'A'|'B', text: string}} line
 * @param {{session?: {cancelled: boolean, cancelHooks: Set<Function>}}} [opts]
 * @returns {Promise<void>}
 */
export function speakLine(line, opts = {}) {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const session = opts.session;
    const hint = HOSTS[line.speaker]?.voiceHint ?? {};

    // ~75ms per character approximates speech rate; generous floor and ceiling.
    const fallbackMs = Math.min(30000, 1500 + line.text.length * 75);

    let settled = false;
    let timer = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session?.cancelHooks.delete(settle);
      resolve();
    };
    session?.cancelHooks.add(settle); // stop() settles us immediately

    if (session?.cancelled) return settle();
    if (!synth) {
      timer = setTimeout(settle, fallbackMs); // silent read-along pacing
      return;
    }

    const u = new SpeechSynthesisUtterance(line.text);
    if (voiceMap[line.speaker]) u.voice = voiceMap[line.speaker];
    u.pitch = hint.pitch ?? 1.0;
    u.rate = hint.rate ?? 1.0;
    u.onend = settle;
    u.onerror = (e) => {
      // 'canceled'/'interrupted' come from stop() — settle right away. Anything
      // else (e.g. 'synthesis-failed' on voiceless setups) falls through to the
      // pacing timer so the transcript still reads along.
      if (e.error === 'canceled' || e.error === 'interrupted') settle();
    };
    timer = setTimeout(settle, fallbackMs);

    // speak() can throw outright — a detached utterance type, a synthesis
    // engine that is missing or wedged, some embedded webviews. Left
    // unhandled this rejects the promise, which strands the chapter loop
    // waiting on audio that will never finish and hangs the whole lesson
    // with no way out. Falling through to the pacing timer instead means the
    // worst case is a silent read-along, which is the documented degradation.
    try {
      synth.speak(u);
    } catch {
      /* pacing timer already armed above */
    }
  });
}

/**
 * Speak an ordered list of lines.
 * @param {Array<{speaker: 'A'|'B', text: string}>} lines
 * @param {(index: number) => void} [onLineStart] Fires as each line begins.
 * @returns {Promise<void>} Resolves when finished or stopped.
 */
export async function speakChapter(lines, onLineStart) {
  const session = { cancelled: false, cancelHooks: new Set() };
  activeSession = session;

  for (let i = 0; i < lines.length; i++) {
    if (session.cancelled) break;
    onLineStart?.(i);
    await speakLine(lines[i], { session });
  }
}

/**
 * Speak a single ad-hoc line outside a chapter — used for the spoken
 * checkpoint answer when the student doesn't respond (spec §6).
 * @param {{speaker: 'A'|'B', text: string}} line
 * @returns {Promise<void>}
 */
export async function speakOne(line) {
  const session = { cancelled: false, cancelHooks: new Set() };
  activeSession = session;
  await speakLine(line, { session });
}

/** Stop all speech immediately (skip / restart). */
export function stop() {
  if (activeSession) {
    activeSession.cancelled = true;
    for (const hook of [...activeSession.cancelHooks]) hook();
  }
  window.speechSynthesis?.cancel();
}
