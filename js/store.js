/**
 * store.js — persistence behind an adapter (spec §7).
 *
 * Two adapters, one interface:
 *
 *   - local     IndexedDB only. Phase 1 default. The whole student loop runs
 *               with no credentials and no backend, which keeps the thing
 *               demoable and keeps the pedagogy reviewable on its own.
 *   - supabase  Writes through the Edge Function, which holds the service-role
 *               key. Phase 2.
 *
 * Everything goes through an OUTBOX regardless of adapter. Schools have bad
 * wifi, so a save that fails mid-lesson has to be a non-event: the record lands
 * in IndexedDB, the student sees nothing, and it flushes on reconnect. This is
 * not decorative — a student who loses their session because the wifi dropped
 * during fifth period will not use the app again.
 *
 * Note what is NOT here: any field for a student's name. There is no column to
 * populate and no parameter to pass one. That is the privacy model enforced in
 * code rather than in policy.
 */

const DB_NAME = 'poducator';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_OUTBOX = 'outbox';

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

let config = { adapter: 'local', functionUrl: null, anonKey: null };

/**
 * Point the store at a backend. Called once at boot; with no arguments the
 * store stays local-only, which is Phase 1's default.
 * @param {{adapter?: 'local'|'supabase', functionUrl?: string, anonKey?: string}} [next]
 */
export function configure(next = {}) {
  config = { ...config, ...next };
}

export function isRemote() {
  return config.adapter === 'supabase' && Boolean(config.functionUrl);
}

/* ------------------------------------------------------------------ */
/* Session records                                                     */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} SessionRecord
 * @property {string} id
 * @property {string|null} lessonId
 * @property {string|null} classCode
 * @property {string|null} pseudonym   Opaque. Never a name (spec §7).
 * @property {'assigned'|'explore'} mode
 * @property {string} topic
 * @property {string} gradeBand
 * @property {Array} objectives
 * @property {Array} responses
 * @property {Array} chapters
 * @property {Array} refs
 * @property {string} startedAt
 * @property {string|null} completedAt
 */

/**
 * Create a new local session record.
 * @param {Partial<SessionRecord>} init
 * @returns {SessionRecord}
 */
export function newSession(init) {
  return {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    lessonId: null,
    classCode: null,
    pseudonym: null,
    mode: 'explore',
    topic: '',
    gradeBand: 'high',
    objectives: [],
    responses: [],
    chapters: [],
    refs: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    ...init,
  };
}

/**
 * Persist a session locally. Always succeeds if IndexedDB is available, and
 * degrades to a no-op rather than throwing if it isn't — losing the analytics
 * record is bad, but taking the lesson down with it is worse.
 * @param {SessionRecord} session
 */
export async function saveSession(session) {
  try {
    const db = await openDb();
    await promisify(tx(db, STORE_SESSIONS, 'readwrite').put(session));
  } catch (err) {
    console.warn('Local session save failed; continuing.', err);
  }
}

/** Read every locally stored session, newest first. */
export async function listSessions() {
  try {
    const db = await openDb();
    const all = await promisify(tx(db, STORE_SESSIONS, 'readonly').getAll());
    return all.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Outbox                                                              */
/* ------------------------------------------------------------------ */

/**
 * Queue a completed session for upload, then try to flush immediately.
 * The caller never awaits a network round trip and never sees a failure.
 * @param {SessionRecord} session
 */
export async function enqueue(session) {
  await saveSession(session);
  if (!isRemote()) return;

  try {
    const db = await openDb();
    await promisify(
      tx(db, STORE_OUTBOX, 'readwrite').add({
        sessionId: session.id,
        payload: toRemotePayload(session),
        queuedAt: new Date().toISOString(),
      })
    );
  } catch (err) {
    console.warn('Outbox enqueue failed.', err);
    return;
  }
  flush();
}

/**
 * Shape a session for the Edge Function. This is the only place a record
 * crosses the network, so it is the right place to be explicit about what does
 * NOT go: no free-text the student typed, and no name field (there isn't one).
 * @param {SessionRecord} session
 */
function toRemotePayload(session) {
  return {
    sessionId: session.id,
    lessonId: session.lessonId,
    classCode: session.classCode,
    pseudonym: session.pseudonym,
    mode: session.mode,
    topic: session.topic,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    objectives: session.objectives,
    responses: session.responses.map((r) => ({
      itemId: r.itemId,
      objectiveId: r.objectiveId,
      phase: r.phase,
      answerIndex: r.answerIndex,
      correct: r.correct,
      latencyMs: r.latencyMs,
      askedAt: r.askedAt,
    })),
    chapters: session.chapters,
    refs: session.refs,
  };
}

/** Drain the outbox. Safe to call at any time; a failure leaves the queue intact. */
export async function flush() {
  if (!isRemote() || !navigator.onLine) return;

  let pending;
  try {
    const db = await openDb();
    pending = await promisify(tx(db, STORE_OUTBOX, 'readonly').getAll());
  } catch {
    return;
  }

  for (const entry of pending) {
    try {
      const res = await fetch(config.functionUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.anonKey ? { apikey: config.anonKey } : {}),
        },
        body: JSON.stringify({ action: 'record_session', ...entry.payload }),
      });
      if (!res.ok) continue; // leave it queued; try again next flush

      const db = await openDb();
      await promisify(tx(db, STORE_OUTBOX, 'readwrite').delete(entry.id));
    } catch {
      return; // network is down again — stop, keep the rest queued
    }
  }
}

/** How many records are still waiting to upload (for a quiet UI indicator). */
export async function pendingCount() {
  try {
    const db = await openDb();
    return await promisify(tx(db, STORE_OUTBOX, 'readonly').count());
  } catch {
    return 0;
  }
}

// Opportunistic flush whenever connectivity returns.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flush());
}
