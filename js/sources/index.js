/**
 * sources/index.js — grounding material for one curriculum expectation (spec §8).
 *
 * What changed when the app became curriculum-driven: there is no search step
 * and no "which one did you mean?" any more. Each expectation carries curated,
 * hand-verified article titles in js/curriculum/ontario-sci-7-d.js, so the
 * ambiguity that made the confirmation step necessary does not arise. Left to a
 * search, "symmetry" lands on group theory.
 *
 * Sourcing is now PER EXPECTATION rather than one blended blob for the whole
 * lesson. Each chapter call gets only the material for the expectation it is
 * teaching, which makes the prompt more focused and cheaper at the same time.
 *
 * Everything here fails soft. A missing article, a down source, a stub page —
 * none of them should take a lesson down, because the curriculum `brief` on
 * each expectation carries enough for the model to teach from even when the
 * wiki fetch returns nothing at all.
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
 * @property {string} title       The expectation's short label.
 * @property {string} text        Grounding material, capped.
 * @property {SourceRef[]} refs   Every article actually used.
 */

/** Look up a source by id. */
export function sourceById(id) {
  return SOURCES.find((s) => s.id === id) ?? null;
}

/**
 * Reading-level preference decides which wiki to try first. Younger bands start
 * at Simple English, which carries the same facts in shorter sentences, and
 * fall back to Wikipedia — Simple has far fewer articles, and a curated title
 * often only exists on the main site.
 * @param {string} gradeBand
 * @returns {Array<{id: string, label: string, host: string}>} In try order.
 */
function hostsFor(gradeBand) {
  const prefer = GRADE_BANDS[gradeBand]?.prefer ?? 'general';
  const wikipedia = sourceById('wikipedia');
  if (prefer !== 'simple') return [wikipedia];
  return [sourceById('simple'), wikipedia].filter(Boolean);
}

function entryFor(source, title, text) {
  return {
    label: source.label,
    title,
    url: `https://${source.host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    text,
  };
}

/**
 * Fetch one curated title, trying each host in order.
 *
 * The curated title is a strong hint, not a hard dependency. Wikipedia renames
 * and merges articles, and a title that was right when the curriculum file was
 * written can quietly stop resolving — so when no host has it, this falls back
 * to searching for it. That turns a stale title into a slightly worse source
 * rather than into no source at all, which matters because these titles were
 * chosen precisely to avoid what a bare search returns.
 *
 * @returns {Promise<{label: string, title: string, url: string, text: string}|null>}
 */
async function fetchTitle(hosts, title, charBudget) {
  for (const source of hosts) {
    try {
      const text = await mediawiki.fetchExtract(source, title, charBudget);
      // Stubs and redirect shells aren't worth the tokens, and their presence
      // would crowd out a fuller article from the next host in the list.
      if (!text || text.length < 300) continue;
      return entryFor(source, title, text);
    } catch {
      /* try the next host */
    }
  }

  // Exact lookup failed everywhere — search for it on the last (broadest) host.
  const fallback = hosts[hosts.length - 1];
  try {
    const [found] = await mediawiki.searchTitles(fallback, title, 1);
    if (!found) return null;
    const text = await mediawiki.fetchExtract(fallback, found, charBudget);
    return text && text.length >= 300 ? entryFor(fallback, found, text) : null;
  } catch {
    return null;
  }
}

/**
 * Look for instructional coverage — Wikibooks and Wikiversity content is
 * already lesson-shaped in a way an encyclopedia article is not. Fail-soft by
 * design: most topics have no page there, and that is fine. It is a bonus,
 * never a blocker.
 * @returns {Promise<Array<{label: string, title: string, url: string, text: string}>>}
 */
async function findInstructional(query, charBudget) {
  const instructional = SOURCES.filter((s) => s.instructional && s.default);

  const results = await Promise.all(
    instructional.map(async (source) => {
      try {
        const [first] = await mediawiki.searchTitles(source, query, 1);
        if (!first) return null;
        const text = await mediawiki.fetchExtract(source, first, charBudget);
        if (!text || text.length < 300) return null;
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
 * Build the grounding material for one curriculum expectation.
 *
 * The `brief` is prepended rather than left to the chapter prompt alone,
 * because it is the thing that tells the model what "covering D2.4" means when
 * the article underneath is about symmetry in mathematics. Source text supports
 * it; it does not replace it.
 *
 * @param {{code: string, short: string, text: string, brief: string, sources: string[]}} expectation
 * @param {{gradeBand?: string}} [opts]
 * @returns {Promise<LessonSource>}
 */
export async function buildForExpectation(expectation, opts = {}) {
  const hosts = hostsFor(opts.gradeBand);
  const titles = expectation.sources ?? [];

  // Split the budget across the curated titles, leaving room for whatever the
  // instructional sources turn up.
  const perTitle = Math.floor(SOURCE_CHAR_LIMIT / Math.max(titles.length + 1, 2));

  const [articles, instructional] = await Promise.all([
    Promise.all(titles.map((t) => fetchTitle(hosts, t, perTitle))),
    findInstructional(expectation.short, perTitle),
  ]);

  const used = [...articles.filter(Boolean), ...instructional];

  const parts = used.map(
    (entry) => `Reference material (${entry.label} — "${entry.title}"):\n${entry.text}`
  );

  return {
    title: expectation.short,
    text: parts.join('\n\n').slice(0, SOURCE_CHAR_LIMIT),
    refs: used.map((e) => ({ title: e.title, url: e.url, label: e.label })),
  };
}

/**
 * Gather sources for every expectation in a lesson, in parallel.
 *
 * Returns a map keyed by expectation code plus the deduplicated reference list
 * for the whole lesson (spec §12 — real titles and URLs, not a generic note).
 *
 * @param {Array<{code: string}>} expectations
 * @param {{gradeBand?: string}} [opts]
 * @returns {Promise<{byCode: Map<string, LessonSource>, refs: SourceRef[]}>}
 */
export async function buildLessonSources(expectations, opts = {}) {
  const built = await Promise.all(
    expectations.map((e) => buildForExpectation(e, opts).catch(() => null))
  );

  const byCode = new Map();
  const seen = new Set();
  const refs = [];

  expectations.forEach((expectation, i) => {
    const source = built[i] ?? { title: expectation.short, text: '', refs: [] };
    byCode.set(expectation.code, source);
    for (const ref of source.refs) {
      if (seen.has(ref.url)) continue;
      seen.add(ref.url);
      refs.push(ref);
    }
  });

  return { byCode, refs };
}
