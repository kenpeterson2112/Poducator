/**
 * sessionfile.js — the `.poducator` session file (P1).
 *
 * One format serving two jobs that turn out to be the same job:
 *
 *   1. SAVING a podcast to the device — export what a learner just did, so it
 *      can be kept, reread, or handed in.
 *   2. DEMO MODE — hand-author a podcast in a Claude conversation, save it as a
 *      file, and play it in the app with ZERO API calls.
 *
 * A saved session and a hand-authored one are the same shape, so they use the
 * same reader. That is the whole reason this file exists rather than an ad-hoc
 * JSON dump on the result screen.
 *
 * Pure: no DOM, no fetch, no IndexedDB. `download()` is the one browser-facing
 * helper and it is kept trivial so the rest stays testable with fixtures.
 *
 * Privacy (spec §7): a session carries no name and no student identifier, so
 * neither does this file. `assertNoIdentity()` enforces that on the way OUT —
 * a file is the one artifact a learner might email, so it is worth checking
 * rather than assuming.
 */

export const FORMAT = 'poducator.session';
export const VERSION = 1;

/** Fields a chapter must have to be playable. */
const CHAPTER_REQUIRED = ['lines'];

/**
 * Keys that must never appear in an exported file. Not a guess at every
 * possible leak — a tripwire for the specific mistake of someone later adding
 * a name field to the session record and not noticing it now travels.
 */
const FORBIDDEN_KEYS = [
  'name', 'studentName', 'firstName', 'lastName', 'fullName',
  'email', 'studentEmail', 'studentId', 'userId',
];

/**
 * @typedef {Object} SessionFile
 * @property {string} format
 * @property {number} version
 * @property {string} exportedAt
 * @property {Object} session
 */

/** Walk an object tree looking for forbidden keys. Returns the paths found. */
function findIdentityKeys(value, path = '', found = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findIdentityKeys(v, `${path}[${i}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.includes(k) && v != null && v !== '') {
        found.push(path ? `${path}.${k}` : k);
      }
      findIdentityKeys(v, path ? `${path}.${k}` : k, found);
    }
  }
  return found;
}

/**
 * Throw if a session carries anything that identifies a person.
 * Exported so a test can assert the tripwire actually trips.
 * @param {Object} session
 */
export function assertNoIdentity(session) {
  const found = findIdentityKeys(session);
  if (found.length > 0) {
    throw new Error(
      `Refusing to export: session carries identifying field(s) ${found.join(', ')}. ` +
        'See spec §7 — Poducator stores no student identity.'
    );
  }
}

/**
 * Build the file object for a session record.
 * @param {import('./store.js').SessionRecord} session
 * @returns {SessionFile}
 */
export function toFile(session) {
  assertNoIdentity(session);
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    session: {
      id: session.id,
      mode: session.mode,
      topic: session.topic,
      gradeBand: session.gradeBand,
      curriculumId: session.curriculumId ?? null,
      expectations: session.expectations ?? [],
      objectives: session.objectives ?? [],
      // Items travel with the file. A hand-authored demo has no item bank to
      // look them up in, and a saved session should reread the same questions
      // it actually asked even if the bank changes later.
      diagnosticItems: session.diagnosticItems ?? [],
      finalItems: session.finalItems ?? [],
      chapters: session.chapters ?? [],
      responses: session.responses ?? [],
      refs: session.refs ?? [],
      startedAt: session.startedAt,
      completedAt: session.completedAt ?? null,
      inProgress: Boolean(session.inProgress),
    },
  };
}

/** Pretty JSON — these files get hand-edited, so readability earns its bytes. */
export function serialize(session) {
  return JSON.stringify(toFile(session), null, 2);
}

/**
 * Parse and validate a `.poducator` file.
 *
 * Errors are written for someone who just picked the wrong file, not for a
 * stack trace — a broken player with no explanation is the failure mode this
 * is guarding against.
 *
 * @param {string} text
 * @returns {Object} the session
 */
export function parseFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON — is it a .poducator file?");
  }

  if (!data || typeof data !== 'object') {
    throw new Error("That file doesn't look like a Poducator session.");
  }
  if (data.format !== FORMAT) {
    throw new Error(
      `That file isn't a Poducator session (its format is "${data.format ?? 'missing'}").`
    );
  }
  if (data.version > VERSION) {
    throw new Error(
      `That file was made by a newer version of Poducator (v${data.version}; this app reads v${VERSION}).`
    );
  }

  const session = data.session;
  if (!session || typeof session !== 'object') {
    throw new Error('That file is missing its session data.');
  }

  const chapters = Array.isArray(session.chapters) ? session.chapters : [];
  if (chapters.length === 0) {
    throw new Error('That session has no chapters to play.');
  }

  chapters.forEach((ch, i) => {
    for (const key of CHAPTER_REQUIRED) {
      if (!Array.isArray(ch?.[key]) || ch[key].length === 0) {
        throw new Error(`Chapter ${i + 1} has no dialogue lines.`);
      }
    }
    const bad = ch.lines.findIndex(
      (l) => !l || (l.speaker !== 'A' && l.speaker !== 'B') || typeof l.text !== 'string'
    );
    if (bad !== -1) {
      throw new Error(
        `Chapter ${i + 1}, line ${bad + 1} is malformed — each line needs speaker "A" or "B" and text.`
      );
    }
  });

  return normalize(session);
}

/**
 * Fill in what a hand-authored file is allowed to leave out.
 *
 * Demo files are written by a person (or by Claude in a chat), so requiring
 * every field would make them tedious to produce — which would defeat the
 * point of demo mode. Only what is needed to PLAY is mandatory; the rest gets
 * a sane default here.
 */
function normalize(session) {
  return {
    id: session.id ?? `imported-${Date.now()}`,
    mode: session.mode === 'explore' ? 'explore' : 'assigned',
    topic: session.topic ?? 'Imported lesson',
    gradeBand: session.gradeBand ?? 'middle',
    curriculumId: session.curriculumId ?? null,
    expectations: session.expectations ?? [],
    objectives: session.objectives ?? [],
    diagnosticItems: session.diagnosticItems ?? [],
    finalItems: session.finalItems ?? [],
    chapters: session.chapters.map((ch, i) => ({
      objectiveId: ch.objectiveId ?? `IMPORTED-${i + 1}`,
      objectiveShort: ch.objectiveShort ?? ch.objectiveText ?? '',
      objectiveText: ch.objectiveText ?? ch.objectiveShort ?? '',
      status: ch.status ?? 'unknown',
      isReteach: Boolean(ch.isReteach),
      lines: ch.lines,
      checkpoint: ch.checkpoint ?? null,
      summary: ch.summary ?? '',
      outcome: ch.outcome ?? null,
    })),
    responses: Array.isArray(session.responses) ? session.responses : [],
    refs: Array.isArray(session.refs) ? session.refs : [],
    startedAt: session.startedAt ?? new Date().toISOString(),
    completedAt: session.completedAt ?? null,
    inProgress: Boolean(session.inProgress),
  };
}

/**
 * A filename a person can recognise in a Downloads folder six weeks later.
 * @param {Object} session
 */
export function filenameFor(session) {
  const slug = String(session.topic ?? 'lesson')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'lesson';
  const date = (session.startedAt ?? new Date().toISOString()).slice(0, 10);
  return `${date}-${slug}.poducator`;
}

/**
 * Trigger a download of the session as a file. The one impure function here.
 * @param {Object} session
 */
export function download(session) {
  const blob = new Blob([serialize(session)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFor(session);
  document.body.append(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download
  // in some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
