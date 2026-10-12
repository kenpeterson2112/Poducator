/**
 * tts.js — the hosts' voices.
 *
 * Two engines behind one surface (speakChapter / speakOne / stop):
 *
 *   premium   real voices from OpenAI's speech endpoint, one MP3 per line,
 *             fetched through the Edge Function and played in an <audio>
 *             element. Live proxy lessons only — see usePremiumAudio().
 *   browser   the Web Speech API. Everything else, and the fallback for any
 *             single line the premium engine can't deliver in time.
 *
 * Every caller in app.js (the chapter loop, checkpoints, rewind, restart,
 * review, speed) is built on that surface, not on either engine, so swapping
 * engines changes nothing above this file. docs/premium-audio.md has the why.
 *
 * The browser engine is ported near-verbatim from NowPod's js/tts.js. The
 * robustness here was earned the hard way and is worth keeping intact:
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

import { HOSTS, PREMIUM_AUDIO } from './config.js';

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

/* ------------------------------------------------------------------ */
/* Premium engine                                                      */
/* ------------------------------------------------------------------ */

/** Where `speak` requests go while premium audio is live; null when it isn't. */
let premium = null;

/**
 * Set once premium audio has proven unavailable — the server says it isn't
 * configured, or it failed PREMIUM_AUDIO.maxFailures lines in a row. Sticky
 * for the page's life: a learner should not sit through a timeout per line
 * to rediscover the same outage, and the browser voices are a fine lesson.
 */
let premiumDisabled = false;
let premiumFailures = 0;

/**
 * Clip cache: line → Promise of a blob URL. Holding the promise (not the URL)
 * means a line being prefetched and the same line being played share one
 * request. Map order doubles as recency for eviction.
 * @type {Map<string, Promise<string>>}
 */
const clipCache = new Map();

/** One element for every line. Reusing it matters on iOS, where an element
 * that has played once inside a user gesture may keep playing afterwards. */
let audioEl = null;
let audioUnlocked = false;

/** 10ms of silence, played once inside the first user gesture. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

function audioElement() {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'auto';
  }
  return audioEl;
}

/**
 * Turn premium audio on or off for the run about to start.
 *
 * Takes the same credentials object app.js already threads through every
 * Claude call, so "is this a proxy run" stays one decision: a proxy URL means
 * premium voices; a pasted key (local dev, no server to hold an OpenAI key)
 * or null (saved-lesson replay, which must make no network calls) means the
 * browser's own speech.
 * @param {{proxyUrl?: string, classCode?: string}|null} credentials
 */
export function usePremiumAudio(credentials) {
  premium =
    credentials?.proxyUrl && !premiumDisabled
      ? { url: credentials.proxyUrl, classCode: credentials.classCode ?? null }
      : null;
}

/**
 * Call from inside a user gesture. Browsers — iOS above all — refuse to start
 * audio that no tap asked for, and the first line of a lesson plays after an
 * await on network work, outside any gesture. Playing a silent clip on the
 * shared element while the tap is still live is what lets every later line
 * play on its own. Idempotent and cheap; safe to call on every click.
 */
export function unlockAudio() {
  if (audioUnlocked) return;
  const audio = audioElement();
  if (!audio.paused) {
    audioUnlocked = true; // already playing a real line, so already allowed
    return;
  }
  audio.src = SILENT_WAV;
  audio.play()?.then(
    () => {
      audioUnlocked = true;
    },
    () => {
      /* not a qualifying gesture — the next click tries again */
    }
  );
}

function clipKey(line) {
  return `${line.speaker}\u0000${line.text}`;
}

/**
 * Fetch one line's audio. Rejects on a timeout or any non-audio answer; the
 * error's `code` carries the server's, so `tts_unconfigured` is recognizable.
 */
async function fetchClip(line, target) {
  const voice = HOSTS[line.speaker]?.premiumVoice ?? HOSTS.A.premiumVoice;
  const headers = { 'content-type': 'application/json' };
  if (target.classCode) headers['x-poducator-class'] = target.classCode;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREMIUM_AUDIO.fetchTimeoutMs);
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'speak',
        text: line.text,
        voice: voice.voice,
        instructions: voice.instructions,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let code = null;
      try {
        code = (await res.json())?.error?.code ?? null;
      } catch {
        /* not JSON — the status is all there is */
      }
      const err = new Error(`Speech request failed (${res.status}).`);
      err.code = code;
      throw err;
    }
    // The timeout still covers reading the body: a stream that stalls halfway
    // is as useless to a listener as one that never started.
    return URL.createObjectURL(await res.blob());
  } finally {
    clearTimeout(timer);
  }
}

/** A line's clip, from cache or a fresh request. Failed requests are dropped
 * from the cache, so the next attempt at that line asks again. */
function clip(line) {
  const key = clipKey(line);
  const cached = clipCache.get(key);
  if (cached) {
    clipCache.delete(key); // re-insert as most recent
    clipCache.set(key, cached);
    return cached;
  }

  const pending = fetchClip(line, premium);
  pending.catch((err) => {
    if (clipCache.get(key) === pending) clipCache.delete(key);
    // Unconfigured is not a blip — no point asking again for anything.
    if (err?.code === 'tts_unconfigured') disablePremium('not configured on the server');
  });
  clipCache.set(key, pending);

  while (clipCache.size > PREMIUM_AUDIO.cacheLines) {
    const [oldKey, oldClip] = clipCache.entries().next().value;
    clipCache.delete(oldKey);
    oldClip.then((url) => URL.revokeObjectURL(url), () => {});
  }
  return pending;
}

function disablePremium(reason) {
  if (premiumDisabled) return;
  premiumDisabled = true;
  premium = null;
  console.info(`Premium audio off (${reason}); using browser speech.`);
}

/**
 * Start fetching clips before they're needed. Only the first few lines —
 * enough that playback, not the network, sets the pace, without paying for a
 * whole chapter a learner may skip. A no-op unless premium audio is live.
 * @param {Array<{speaker: 'A'|'B', text: string}>} lines
 */
export function prefetch(lines) {
  if (!premium) return;
  for (const line of lines.slice(0, PREMIUM_AUDIO.prefetchAhead + 1)) {
    if (line?.text) clip(line).catch(() => {}); // a failed prefetch is retried when played
  }
}

const CANCELLED = Symbol('cancelled');

/** Race a promise against the session being stopped, so stop() never waits
 * out a network request before the chapter loop can move on. */
function unlessCancelled(session, promise) {
  if (!session) return promise;
  return new Promise((resolve, reject) => {
    const hook = () => resolve(CANCELLED);
    if (session.cancelled) return hook();
    session.cancelHooks.add(hook);
    promise.then(resolve, reject).finally(() => session.cancelHooks.delete(hook));
  });
}

/**
 * Play one fetched clip. Resolves true when it played to the end or was
 * stopped, false when the browser couldn't play it (caller falls back).
 */
function playClip(url, opts) {
  return new Promise((resolve) => {
    const session = opts.session;
    const audio = audioElement();
    let settled = false;
    let timer = null;

    const settle = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session?.cancelHooks.delete(onCancel);
      audio.onended = audio.onerror = audio.onloadedmetadata = null;
      if (!ok) audio.pause(); // the fallback voice must not talk over a half-played clip
      resolve(ok);
    };
    const onCancel = () => {
      audio.pause();
      settle(true);
    };
    session?.cancelHooks.add(onCancel);
    if (session?.cancelled) return onCancel();

    audio.onended = () => settle(true);
    audio.onerror = () => settle(false);
    // Watchdog, in the spirit of the browser engine's pacing timer: if
    // `ended` never arrives, the lesson still moves on. Generous, because a
    // late `ended` is harmless and an early cut-off is not.
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      const ms = Number.isFinite(audio.duration)
        ? (audio.duration / audio.playbackRate) * 1000 + 4000
        : 60000; // some MP3s report no duration up front; still bounded
      timer = setTimeout(() => settle(true), ms);
    };
    timer = setTimeout(() => settle(false), 8000); // never even loaded

    audio.src = url;
    // Loading a new src resets playbackRate to defaultPlaybackRate, so set
    // both. Only the listener's speed applies: each host's delivery is in its
    // premiumVoice instructions, not a rate tweak. Pitch is preserved.
    const rate = opts.rateMultiplier ?? 1;
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    audio.play()?.catch((err) => {
      // AbortError is our own pause() from stop(), already settled above.
      // Anything else — usually NotAllowedError, no gesture yet — falls back.
      if (err?.name !== 'AbortError') settle(false);
    });
  });
}

/** Speak a line with a premium voice, falling back to the browser engine for
 * this line alone if the clip can't be fetched or played. Never rejects. */
async function speakPremium(line, opts) {
  const session = opts.session;
  try {
    const url = await unlessCancelled(session, clip(line));
    if (url === CANCELLED) return;
    if (await playClip(url, opts)) {
      premiumFailures = 0;
      return;
    }
    // Counted like a failed fetch: a browser that won't play these clips
    // should stop being sent them.
    throw new Error('The browser could not play the clip.');
  } catch (err) {
    console.warn('Premium audio failed for one line; using browser speech.', err);
    if (err?.code !== 'tts_unconfigured' && ++premiumFailures >= PREMIUM_AUDIO.maxFailures) {
      disablePremium(`${premiumFailures} failures in a row`);
    }
  }
  if (!session?.cancelled) await speakBrowser(line, opts);
}

/* ------------------------------------------------------------------ */
/* Browser engine                                                      */
/* ------------------------------------------------------------------ */

/**
 * Speak one dialogue line in its host's voice. Always resolves — on `end`, on
 * cancellation, or on the pacing timer.
 * @param {{speaker: 'A'|'B', text: string}} line
 * @param {{session?: {cancelled: boolean, cancelHooks: Set<Function>}, rateMultiplier?: number}} [opts]
 * @returns {Promise<void>}
 */
export function speakLine(line, opts = {}) {
  return premium ? speakPremium(line, opts) : speakBrowser(line, opts);
}

/** The Web Speech API path — see the header for why it's shaped this way. */
function speakBrowser(line, opts = {}) {
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
    // The host's own rate is a fixed persona quirk (config.js HOSTS); the
    // multiplier on top is the listener's chosen speed, a device preference
    // that has nothing to do with which host is talking.
    u.rate = (hint.rate ?? 1.0) * (opts.rateMultiplier ?? 1);
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
 * Speak an ordered list of lines, starting partway through if asked.
 *
 * `startIndex` and `rateMultiplier` exist for one reason: player controls
 * (rewind, forward-a-few-lines, restart-this-chapter, a live speed change)
 * all work by stopping this loop and calling it again at a new index — the
 * same cancellation session mechanism every interruption already used, not a
 * second pathway. app.js owns deciding *where* to resume; this just resumes.
 * @param {Array<{speaker: 'A'|'B', text: string}>} lines
 * @param {(index: number) => void} [onLineStart] Fires as each line begins.
 * @param {{startIndex?: number, rateMultiplier?: number}} [opts]
 * @returns {Promise<void>} Resolves when finished or stopped.
 */
export async function speakChapter(lines, onLineStart, opts = {}) {
  const session = { cancelled: false, cancelHooks: new Set() };
  activeSession = session;
  const { startIndex = 0, rateMultiplier = 1 } = opts;

  for (let i = startIndex; i < lines.length; i++) {
    if (session.cancelled) break;
    prefetch(lines.slice(i + 1)); // the next few download while this one plays
    onLineStart?.(i);
    await speakLine(lines[i], { session, rateMultiplier });
  }
}

/**
 * Speak a single ad-hoc line outside a chapter — used for the spoken
 * checkpoint answer when the student doesn't respond (spec §6).
 * @param {{speaker: 'A'|'B', text: string}} line
 * @param {{rateMultiplier?: number}} [opts]
 * @returns {Promise<void>}
 */
export async function speakOne(line, opts = {}) {
  const session = { cancelled: false, cancelHooks: new Set() };
  activeSession = session;
  await speakLine(line, { session, rateMultiplier: opts.rateMultiplier ?? 1 });
}

/** Stop all speech immediately (skip / restart). */
export function stop() {
  if (activeSession) {
    activeSession.cancelled = true;
    for (const hook of [...activeSession.cancelHooks]) hook();
  }
  audioEl?.pause();
  window.speechSynthesis?.cancel();
}
