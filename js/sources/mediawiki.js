/**
 * sources/mediawiki.js — adapter for the MediaWiki family (spec §8).
 *
 * Wikipedia, Simple English Wikipedia, Wikibooks, Wikiversity and Wikinews all
 * run the same software, expose the same `api.php` shape, and are CORS-friendly
 * via `origin=*` with no auth. One adapter covers all of them; a source is just
 * a hostname.
 *
 * Generalized from NowPod's js/wikipedia.js — including `titlesCollide`, the
 * ambiguity heuristic that decides whether to ask "which one did you mean?"
 * before spending generation compute. Getting the wrong article is worse in a
 * classroom than it is in a curiosity app, so that checkpoint stays.
 */

import { CANDIDATE_COUNT, SOURCE_CHAR_LIMIT } from '../config.js';

/**
 * @typedef {Object} Candidate
 * @property {string} title        Article title.
 * @property {string} description  One-liner for the confirm UI (may be '').
 * @property {string} summary      Article summary (reused for generation).
 * @property {string} url          Canonical article URL.
 * @property {string} sourceId     Which registry source this came from.
 * @property {string} sourceLabel  Human-readable source name, for references.
 */

/** Endpoint builders for any MediaWiki host. */
const api = {
  search: (host, topic, limit) =>
    `https://${host}/w/api.php?action=query&list=search&srlimit=${limit}` +
    `&srsearch=${encodeURIComponent(topic)}&format=json&origin=*`,
  summary: (host, title) =>
    `https://${host}/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
  extract: (host, title) =>
    `https://${host}/w/api.php?action=query&prop=extracts&explaintext` +
    `&titles=${encodeURIComponent(title)}&format=json&origin=*`,
  articleUrl: (host, title) =>
    `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
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
 * Pull the summary card for an article.
 * @param {{id: string, label: string, host: string}} source
 * @param {string} title
 */
export async function fetchSummary(source, title) {
  const data = await getJson(api.summary(source.host, title));
  return {
    summary: data?.extract ?? '',
    description: data?.description ?? '',
    url: data?.content_urls?.desktop?.page ?? api.articleUrl(source.host, title),
    isDisambiguation: data?.type === 'disambiguation',
  };
}

/**
 * Pull the fuller plain-text article body, capped.
 * @param {{id: string, label: string, host: string}} source
 * @param {string} title
 * @param {number} [limit]
 * @returns {Promise<string>}
 */
export async function fetchExtract(source, title, limit = SOURCE_CHAR_LIMIT) {
  const data = await getJson(api.extract(source.host, title));
  const page = Object.values(data?.query?.pages ?? {})[0];
  return (page?.extract ?? '').slice(0, limit);
}

/**
 * Ambiguity heuristic, carried over from NowPod. Prompt only when there is real
 * disambiguation risk: a runner-up whose title *contains* the topic ("Mercury
 * (planet)" and "Mercury (element)" for "mercury") is a same-name variant that
 * search ranking alone can't disambiguate. A merely-related runner-up
 * ("Espresso" for "espresso machine") is not a risk, so a clear top match
 * proceeds without friction.
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
 * Fail-soft: a source that is down or has no match returns [] rather than
 * throwing, so one bad source never blocks a lesson.
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

  // Summaries in parallel; a candidate whose summary fetch fails is dropped.
  const cards = await Promise.all(
    titles.map((title) =>
      fetchSummary(source, title)
        .then((card) => ({ title, ...card }))
        .catch(() => null)
    )
  );
  const usable = cards.filter(Boolean);

  // A disambiguation page in the results is a loud signal the topic is
  // ambiguous. The page itself is not a narratable source, so it is excluded
  // from the options but still forces a confirmation.
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
