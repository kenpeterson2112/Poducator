/**
 * sources/mediawiki.js — adapter for the MediaWiki family (spec §8).
 *
 * Wikipedia, Simple English Wikipedia, Wikibooks, Wikiversity and Wikinews all
 * run the same software, expose the same `api.php` shape, and are CORS-friendly
 * via `origin=*` with no auth. One adapter covers all of them; a source is just
 * a hostname.
 *
 * This shrank when the app became curriculum-driven. NowPod's candidate search
 * and its `titlesCollide` ambiguity heuristic are gone along with explore mode:
 * expectations carry curated, hand-verified article titles, so there is nothing
 * left to disambiguate. What remains is title search (still needed to find
 * instructional coverage on Wikibooks and Wikiversity) and extract fetching.
 */

import { SOURCE_CHAR_LIMIT } from '../config.js';

/** Endpoint builders for any MediaWiki host. */
const api = {
  search: (host, topic, limit) =>
    `https://${host}/w/api.php?action=query&list=search&srlimit=${limit}` +
    `&srsearch=${encodeURIComponent(topic)}&format=json&origin=*`,
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
