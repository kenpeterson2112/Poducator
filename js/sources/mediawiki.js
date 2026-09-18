/**
 * sources/mediawiki.js — adapter for the MediaWiki family (spec §8).
 *
 * Wikipedia, Simple English Wikipedia, Wikibooks, Wikiversity and Wikinews all
 * run the same software, expose the same `api.php` shape, and are CORS-friendly
 * via `origin=*` with no auth. One adapter covers all of them; a source is just
 * a hostname.
 *
 * Two shapes of lookup live here, because the app now has two modes:
 *
 *   - Curriculum mode hands over curated, hand-verified article titles, so
 *     there is nothing to disambiguate: `searchTitles` + `fetchExtract`.
 *   - Student mode starts from whatever a learner typed, so it needs candidate
 *     search and the `titlesCollide` ambiguity check below — restored from the
 *     original explore mode, because "mercury" is three different lessons and
 *     picking the wrong one is worse for a learner with no teacher to correct it.
 */

import { SOURCE_CHAR_LIMIT, CANDIDATE_COUNT } from '../config.js';

/** Endpoint builders for any MediaWiki host. */
const api = {
  search: (host, topic, limit) =>
    `https://${host}/w/api.php?action=query&list=search&srlimit=${limit}` +
    `&srsearch=${encodeURIComponent(topic)}&format=json&origin=*`,
  summary: (host, title) =>
    `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  extract: (host, title) =>
    `https://${host}/w/api.php?action=query&prop=extracts&explaintext&redirects=1` +
    `&titles=${encodeURIComponent(title)}&format=json&origin=*`,
};

/** Fetch JSON with a readable error on non-2xx. */
async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Source request failed (${res.status})`);
  return res.json();
}

/**
 * Search one source for candidate titles.
 * @param {{id: string, label: string, host: string}} source
 * @param {string} topic
 * @param {number} [limit]
 * @returns {Promise<string[]>} Titles, best match first.
 */
export async function searchTitles(source, topic, limit = 5) {
  const data = await getJson(api.search(source.host, topic, limit));
  return (data?.query?.search ?? []).map((hit) => hit.title);
}

/**
 * Pull the plain-text article body, capped.
 *
 * `redirects=1` matters for curated titles: several of the ones the curriculum
 * file names are redirects to the canonical article, and without it the API
 * returns an empty page rather than following them.
 *
 * @param {{id: string, label: string, host: string}} source
 * @param {string} title
 * @param {number} [limit]
 * @returns {Promise<string>} Empty string when the page is missing.
 */
export async function fetchExtract(source, title, limit = SOURCE_CHAR_LIMIT) {
  const data = await getJson(api.extract(source.host, title));
  const page = Object.values(data?.query?.pages ?? {})[0];
  // A missing page comes back with a negative pageid and no extract.
  return (page?.extract ?? '').slice(0, limit);
}

/**
 * @typedef {Object} Candidate
 * @property {string} title        Article title.
 * @property {string} description  One-liner for the confirm UI (may be '').
 * @property {string} summary      Article summary (reused for grounding).
 * @property {string} url          Canonical article URL.
 * @property {string} sourceId
 * @property {string} sourceLabel
 */

/**
 * Pull the summary card for an article: extract, one-line description, URL, and
 * whether the page is a disambiguation page.
 * @param {{id: string, label: string, host: string}} source
 * @param {string} title
 */
export async function fetchSummary(source, title) {
  const data = await getJson(api.summary(source.host, title));
  return {
    summary: data?.extract ?? '',
    description: data?.description ?? '',
    url:
      data?.content_urls?.desktop?.page ??
      `https://${source.host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    isDisambiguation: data?.type === 'disambiguation',
  };
}

/**
 * Ambiguity heuristic — prompt only when there is real disambiguation risk.
 *
 * A runner-up whose title *contains* the topic ("Mercury (planet)" and
 * "Mercury (element)" for "mercury") is a same-name variant that search ranking
 * alone cannot separate. A merely-related runner-up ("Espresso" for "espresso
 * machine") is not a risk, so a clear top match proceeds with no friction —
 * asking every time would train learners to click past the question.
 * @param {string} topic
 * @param {Candidate[]} candidates
 * @returns {boolean}
 */
export function titlesCollide(topic, candidates) {
  if (candidates.length <= 1) return false;
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const t = norm(topic);
  return candidates.slice(1).some((c) => norm(c.title).includes(t));
}

/**
 * Find candidate articles in one source, with summaries attached.
 *
 * Fail-soft: a source that is down or has no match returns an empty list rather
 * than throwing, so one bad source never blocks a lesson.
 * @param {{id: string, label: string, host: string}} source
 * @param {string} topic
 * @returns {Promise<{candidates: Candidate[], sawDisambiguation: boolean}>}
 */
export async function findCandidates(source, topic) {
  let titles;
  try {
    titles = await searchTitles(source, topic);
  } catch {
    return { candidates: [], sawDisambiguation: false };
  }
  if (titles.length === 0) return { candidates: [], sawDisambiguation: false };

  const cards = await Promise.all(
    titles.map((title) =>
      fetchSummary(source, title)
        .then((card) => ({ title, ...card }))
        .catch(() => null)
    )
  );
  const usable = cards.filter(Boolean);

  // A disambiguation page in the results is a loud signal the topic is
  // ambiguous. The page itself is not narratable, so it forces the question
  // without appearing as one of the answers.
  const sawDisambiguation = usable.some((c) => c.isDisambiguation);

  const candidates = usable
    .filter((c) => !c.isDisambiguation && c.summary)
    .slice(0, CANDIDATE_COUNT)
    .map(({ title, description, summary, url }) => ({
      title,
      description,
      summary,
      url,
      sourceId: source.id,
      sourceLabel: source.label,
    }));

  return { candidates, sawDisambiguation };
}
