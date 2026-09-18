/**
 * check-bank.mjs — validate a curriculum item bank before shipping it.
 *
 *   node tools/check-bank.mjs
 *
 * Dependency-free, like the rest of the project. Run it after editing
 * js/curriculum/items.js or adding a new curriculum.
 *
 * The rules it enforces are the ones in spec §9 that a human reviewer reliably
 * misses. Two are worth calling out because they are invisible when you read an
 * item on its own:
 *
 *   PAIRS MUST MATCH ON COGNITIVE DEMAND. A pre/post pair has to share its
 *   Growing Success category, its practice, and its crosscutting concept. If the
 *   post item sits at a lower demand than the pre item, the growth delta
 *   measures a change in the instrument rather than a change in the learner —
 *   and the number still looks perfectly plausible.
 *
 *   ORDER IS THINKING, APPLICATION, KNOWLEDGE. The sampler takes the first N
 *   items, so a bank authored in a different order would quietly hand a
 *   three-expectation lesson three recall questions instead of three
 *   thinking-level ones.
 */

import { BANK, MISCONCEPTIONS, CATEGORY } from '../js/curriculum/items.js';
import { EXPECTATIONS } from '../js/curriculum/ontario-sci-7-d.js';
import { ASSESSMENT } from '../js/config.js';
import { checkParallelForms } from '../js/assessment.js';

const problems = [];
const fail = (m) => problems.push(m);

const codes = EXPECTATIONS.map((e) => e.code);
const DEMAND_KEYS = ['category', 'practice', 'crosscutting'];
const WANTED_ORDER = [CATEGORY.THINKING, CATEGORY.APPLICATION, CATEGORY.KNOWLEDGE];

/* Curriculum <-> bank coverage. An expectation with no bank entry cannot be
   selected, so this catches a half-added curriculum before a teacher does. */
for (const code of codes) {
  if (!BANK[code]) fail(`${code}: in the curriculum but missing from the bank`);
  const e = EXPECTATIONS.find((x) => x.code === code);
  if (!e.brief?.trim()) fail(`${code}: no brief — chapters will drift to whatever the source says`);
  if (!e.sources?.length) fail(`${code}: no curated source titles`);
}
for (const code of Object.keys(BANK)) {
  if (!codes.includes(code)) fail(`${code}: in the bank but not in the curriculum`);
}

const usedSlugs = new Set();
let itemCount = 0;

for (const [code, entry] of Object.entries(BANK)) {
  for (const phase of ['diagnostic', 'final']) {
    const items = entry[phase] ?? [];
    // Enough items to fill the whole budget when this expectation is selected
    // alone — that is the case that needs the most.
    if (items.length < ASSESSMENT.maxItems) {
      fail(`${code}.${phase}: ${items.length} items, need at least ${ASSESSMENT.maxItems}`);
    }

    items.forEach((item, i) => {
      const at = `${code}.${phase}[${i}]`;
      itemCount += 1;

      if (!item.prompt?.trim()) fail(`${at}: empty prompt`);
      if (!item.explanation?.trim()) fail(`${at}: empty explanation`);
      if (item.choices.length !== ASSESSMENT.choicesPerItem) {
        fail(`${at}: ${item.choices.length} choices, expected ${ASSESSMENT.choicesPerItem}`);
      }
      if (new Set(item.choices.map((c) => c.text)).size !== item.choices.length) {
        fail(`${at}: two choices read the same`);
      }
      for (const key of DEMAND_KEYS) {
        if (!item[key]) fail(`${at}: missing ${key}`);
      }

      const correct = item.choices.filter((c) => c.misconception === null);
      if (correct.length !== 1) {
        fail(`${at}: ${correct.length} choices carry no misconception, expected exactly 1`);
      }
      if (!Number.isInteger(item.correctIndex) ||
          item.correctIndex < 0 || item.correctIndex >= item.choices.length) {
        fail(`${at}: correctIndex out of range`);
      } else if (item.choices[item.correctIndex].misconception !== null) {
        fail(`${at}: correctIndex points at a distractor`);
      }

      for (const choice of item.choices) {
        if (!choice.text?.trim()) fail(`${at}: empty choice text`);
        if (!choice.misconception) continue;
        usedSlugs.add(choice.misconception);
        if (!MISCONCEPTIONS[choice.misconception]) {
          fail(`${at}: "${choice.misconception}" is not in the misconception library`);
        }
      }
    });
  }

  // Pre/post pairs.
  const pairs = Math.min(entry.diagnostic?.length ?? 0, entry.final?.length ?? 0);
  for (let i = 0; i < pairs; i += 1) {
    const pre = entry.diagnostic[i];
    const post = entry.final[i];
    for (const key of DEMAND_KEYS) {
      if (pre[key] !== post[key]) {
        fail(`${code} pair ${i}: ${key} differs — "${pre[key]}" vs "${post[key]}". ` +
             `A mismatched pair makes the growth delta measure the instrument, not the learner.`);
      }
    }
  }

  const { duplicates } = checkParallelForms(entry.diagnostic ?? [], entry.final ?? []);
  for (const dup of duplicates) {
    fail(`${code}: a wrap-up item reuses a pre-pod prompt — "${dup.prompt.slice(0, 60)}…"`);
  }

  const order = (entry.diagnostic ?? []).slice(0, 3).map((i) => i.category);
  if (order.join() !== WANTED_ORDER.join()) {
    fail(`${code}: item order is [${order}], expected [${WANTED_ORDER}] — ` +
         `the sampler takes the first N, so this changes what a short lesson asks.`);
  }
}

for (const slug of Object.keys(MISCONCEPTIONS)) {
  if (!usedSlugs.has(slug)) fail(`unused misconception in the library: "${slug}"`);
}

console.log(
  `${codes.length} expectations · ${itemCount} items · ${usedSlugs.size} distinct misconceptions`
);

if (problems.length === 0) {
  console.log('Bank OK.');
  process.exit(0);
}
console.error(`\n${problems.length} problem(s):`);
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
