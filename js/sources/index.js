/**
 * sources/index.js — the source registry and research step (spec §8).
 *
 * Two phases, same shape as NowPod's research:
 *
 *   1. research(topic, opts)  — search the enabled sources, gather candidates,
 *      and decide whether the match is ambiguous enough to confirm with the
 *      student BEFORE any generation compute is spent.
 *   2. build(candidate, opts) — turn the confirmed candidate into the grounded
 *      source material a lesson is generated from, pulling supporting material
 *      from instructional sources (Wikibooks/Wikiversity) when they have it.
 *
 * Why more than one source, unlike NowPod: an encyclopedia article is written
 * to inform, not to teach. Wikibooks and Wikiversity content is already
 * lesson-shaped, and Simple English carries the same facts at a lower reading
 * level. Blending them produces better objectives than any one alone.
 */

import { SOURCES, GRADE_BANDS, SOURCE_CHAR_LIMIT } from '../config.js';
import * as mediawiki from './mediawiki.js';

/**
 * @typedef {Object} SourceRef
 * @property {string} title
 * @property {string} url
 * @property {string} label   Source name, for the reference list (spec §12).
 */

/**
 * @typedef {Object} LessonSource
 * @property {string} title       Resolved primary article title.
 * @property {string} text        Blended, capped source material for generation.
 * @property {SourceRef[]} refs   Every article actually used — the reference list.
 */

/** Sources enabled by default, in registry order. */
export function defaultSources() {
  return SOURCES.filter((s) => s.default);
}

/** Look up a source by id. */
export function sourceById(id) {
  return SOURCES.find((s) => s.id === id) ?? null;
}

/**
 * Pick the primary search source for a grade band: younger bands start at
 * Simple English, which carries the same facts in shorter sentences.
 * Falls back to Wikipedia when Simple has no article on the topic.
 * @param {string} gradeBand
 */
function primaryFor(gradeBand) {
  const prefer = GRADE_BANDS[gradeBand]?.prefer ?? 'general';
  const wanted = prefer === 'simple' ? 'simple' : 'wikipedia';
  return sourceById(wanted) ?? sourceById('wikipedia');
}

/**
 * Phase 1: find candidate articles for a topic and flag ambiguity.
 *
 * Searches the preferred source first and falls back to Wikipedia when it comes
 * up empty — Simple English has far fewer articles, and a thin result there
 * should not read to the student as "no such topic".
 *
 * @param {string} topic
 * @param {{gradeBand?: string}} [opts]
 * @returns {Promise<{candidates: import('./mediawiki.js').Candidate[], needsConfirmation: boolean}>}
 */
export async function research(topic, opts = {}) {
  const primary = primaryFor(opts.gradeBand);
  let { candidates, sawDisambiguation } = await mediawiki.findCandidates(primary, topic);

  if (candidates.length === 0 && primary.id !== 'wikipedia') {
    ({ candidates, sawDisambiguation } = await mediawiki.findCandidates(
      sourceById('wikipedia'),
      topic
    ));
  }

  if (candidates.length === 0) {
    throw new Error(
      `Couldn't find anything on "${topic}" in the reference sources — try rewording it.`
    );
  }

  return {
    candidates,
    needsConfirmation: sawDisambiguation || mediawiki.titlesCollide(topic, candidates),
  };
}

/**
 * Look for instructional coverage of a confirmed topic. Fail-soft by design:
 * most topics have no Wikibooks or Wikiversity page, and that is fine — it is
 * a bonus, never a blocker.
 * @param {string} title
 * @returns {Promise<Array<{label: string, title: string, url: string, text: string}>>}
 */
async function findInstructional(title) {
  const instructional = SOURCES.filter((s) => s.instructional && s.default);

  const results = await Promise.all(
    instructional.map(async (source) => {
      try {
        const [first] = await mediawiki.searchTitles(source, title, 1);
        if (!first) return null;
        const text = await mediawiki.fetchExtract(source, first, 2500);
        if (!text || text.length < 200) return null; // stubs aren't worth the tokens
        return {
          label: source.label,
          title: first,
          url: `https://${source.host}/wiki/${encodeURIComponent(first.replace(/ /g, '_'))}`,
          text,
        };
      } catch {
        return null;
      }
    })
  );

  return results.filter(Boolean);
}

/**
 * Phase 2: build the grounded source material for a confirmed candidate.
 * @param {import('./mediawiki.js').Candidate} candidate
 * @returns {Promise<LessonSource>}
 */
export async function build(candidate) {
  const source = sourceById(candidate.sourceId) ?? sourceById('wikipedia');

  // Main body and instructional supplements fetch in parallel; both fail-soft.
  const [body, instructional] = await Promise.all([
    mediawiki.fetchExtract(source, candidate.title).catch(() => ''),
    findInstructional(candidate.title),
  ]);

  const parts = [
    `Reference article (${candidate.sourceLabel} — "${candidate.title}"):`,
    body || candidate.summary,
  ];

  for (const entry of instructional) {
    parts.push(
      `\nInstructional material (${entry.label} — "${entry.title}"):\n${entry.text}`
    );
  }

  const refs = [
    { title: candidate.title, url: candidate.url, label: candidate.sourceLabel },
    ...instructional.map((e) => ({ title: e.title, url: e.url, label: e.label })),
  ];

  return {
    title: candidate.title,
    text: parts.join('\n').slice(0, SOURCE_CHAR_LIMIT),
    refs,
  };
}
