/**
 * ontario-sci-7-d.js — Ontario Grade 7 Science, Strand D (spec §3).
 *
 * "Form, Function, and Design of Structures", verbatim from the 2022 Ontario
 * Science and Technology curriculum. These nine expectations ARE the objectives
 * — nothing is inferred at runtime any more. An educator locks 1-3 of them and
 * that selection is the whole lesson.
 *
 * Three fields per expectation are doing work beyond identification:
 *
 *   `sources` — curated article titles, verified by hand, not a search query.
 *     A curriculum expectation is a learning OUTCOME; a wiki article is
 *     reference material, and the mapping between them is lossy. Left to a
 *     search, "symmetry" lands on group theory and D1.1 lands nowhere at all.
 *     Curating the titles also removes the disambiguation round trip, because
 *     there is nothing left to disambiguate.
 *
 *   `brief` — what covering this expectation actually MEANS at Grade 7 in
 *     Ontario. This is the field that makes a chapter hit the curriculum rather
 *     than hit the Wikipedia article. Without it the model teaches whatever the
 *     source emphasizes, which is not the same thing as what was expected.
 *
 *   `anchor` — one concrete, universally available phenomenon to open on.
 *     Deliberately chosen to assume nothing about a student's home, income, or
 *     hobbies (see the fairness note in items.js).
 */

/** Which strand this file covers. Adding another is a new file, not a refactor. */
export const CURRICULUM = Object.freeze({
  id: 'on-sci-7-d',
  label: 'Ontario Grade 7 Science — Strand D',
  subject: 'Science and Technology',
  grade: 7,
  strandTitle: 'Form, Function, and Design of Structures',
  /** Grade 7 sits in the 6-8 band; the educator can still override. */
  defaultGradeBand: 'middle',
});

/**
 * @typedef {Object} Expectation
 * @property {string}   code      e.g. "D2.2" — also the objective id everywhere downstream.
 * @property {string}   strand    "D1" or "D2".
 * @property {string}   text      Curriculum text, verbatim.
 * @property {string}   short     Short label for chips and headers.
 * @property {string[]} sources   Curated article titles for grounding.
 * @property {string}   brief     What covering this means at this grade.
 * @property {string}   anchor    A concrete opening phenomenon.
 */

/** @type {readonly Expectation[]} */
export const EXPECTATIONS = Object.freeze([
  {
    code: 'D1.1',
    strand: 'D1',
    short: 'Factors in design',
    text:
      'evaluate environmental, social, and economic factors that should be considered when ' +
      'designing and building structures to meet specific needs for individuals and communities',
    sources: ['Green building', 'Sustainable design'],
    brief:
      'Students weigh competing factors rather than naming them. The expectation is EVALUATE: ' +
      'given a real design choice, they should be able to argue which factors matter and why, ' +
      'and recognize that environmental, social, and economic considerations trade off against ' +
      'each other rather than sitting in separate boxes. Cost means lifetime cost, not sticker ' +
      'price. Community need is a design input, not an afterthought.',
    anchor:
      'a town deciding how to build a new community centre, library, or school addition',
  },
  {
    code: 'D1.2',
    strand: 'D1',
    short: 'Ergonomic design',
    text:
      'evaluate the impact of the ergonomic design of various tools, objects, and work spaces on ' +
      "a user's health, safety, and ability to work efficiently, and use this information to " +
      'describe changes that could be made in their own spaces and activities',
    sources: ['Human factors and ergonomics', 'Occupational safety and health'],
    brief:
      'The load-bearing idea is that ergonomics fits the TASK to the PERSON, not the person to ' +
      'the task. A student who concludes "I need to be stronger" has missed the expectation; the ' +
      'design is what should change. The curriculum also asks students to apply this to their ' +
      'own spaces, so examples should stay inside a student\'s daily experience — desks, chairs, ' +
      'bags, screens, tools they actually hold.',
    anchor: 'a classroom desk and chair, or the way a student carries their books',
  },
  {
    code: 'D2.1',
    strand: 'D2',
    short: 'Solid, frame, shell',
    text: 'classify structures as solid structures, frame structures, or shell structures',
    sources: ['Thin-shell structure', 'Framing (construction)', 'Structure'],
    brief:
      'Classification depends on HOW THE STRUCTURE CARRIES ITS LOAD, not on what it is made of ' +
      'or how hard it feels. Solid structures rely on their mass; frame structures rely on a ' +
      'skeleton of connected parts; shell structures rely on a thin outer layer that encloses a ' +
      'space. Many real structures combine types — that is worth saying out loud rather than ' +
      'forcing every example into one box.',
    anchor: 'a school building, a bike rack, and a hard hat sitting side by side',
  },
  {
    code: 'D2.2',
    strand: 'D2',
    short: 'Centre of gravity',
    text: "describe ways in which the centre of gravity of a structure affects the structure's stability",
    // NOT "Structural stability" — that article is about dynamical systems in
    // mathematics, the same trap "Symmetry" sets for D2.4.
    sources: ['Center of mass', 'Structural engineering'],
    brief:
      'Two relationships carry the whole expectation: a LOWER centre of gravity makes a structure ' +
      'harder to tip, and a WIDER base does the same. Students commonly believe total weight is ' +
      'what makes something stable, which is why the classic demonstration holds mass constant ' +
      'and moves it. Stability is about where the mass sits, not how much there is.',
    anchor: 'a bookshelf or locker loaded two different ways',
  },
  {
    code: 'D2.3',
    strand: 'D2',
    short: 'Forces on structures',
    text:
      'identify the magnitude, direction, point of application, and plane of application of the ' +
      'forces applied to a structure',
    sources: ['Force', 'Structural load'],
    brief:
      'Four separate properties, and students routinely collapse them into "how hard". Magnitude ' +
      'is how much; direction is which way; point of application is WHERE on the structure it ' +
      'acts; plane of application is the flat surface the force acts within. The point of the ' +
      'expectation is that the same magnitude in a different place produces a different effect — ' +
      'which is why a door opens easily at the handle and barely at the hinge.',
    anchor: 'pushing a classroom door open at different places along its width',
  },
  {
    code: 'D2.4',
    strand: 'D2',
    short: 'Symmetry',
    text:
      'describe the role of symmetry in structures, and identify instances of symmetry in various structures',
    sources: ['Symmetry', 'Structural engineering'],
    brief:
      'Symmetry in structures is FUNCTIONAL, not decorative — that is the misconception to break. ' +
      'A symmetrical structure distributes forces evenly, which makes loads predictable and ' +
      'keeps the centre of gravity over the base. It also makes construction and inspection ' +
      'easier. Symmetry is not a guarantee of strength, and asymmetric structures can be sound ' +
      'when the loads on them are themselves asymmetric.',
    anchor: 'a bridge, a transmission tower, or the roof truss over a gym',
  },
  {
    code: 'D2.5',
    strand: 'D2',
    short: 'Why structures fail',
    text: 'describe factors that can cause a structure to fail',
    sources: ['Structural failure', 'Structural load'],
    brief:
      'Failure has causes and they are identifiable: loads beyond what the structure was designed ' +
      'for, materials that fatigue or corrode over time, poor connections between parts, ' +
      'unstable foundations, and forces applied in directions the design never anticipated. ' +
      'Two misconceptions to break: that failure is random, and that a structure which stood for ' +
      'years must have been defective from the start if it later fails.',
    anchor: 'classroom shelving that held fine for years and then gave way',
  },
  {
    code: 'D2.6',
    strand: 'D2',
    short: 'Choosing materials',
    text:
      'identify the factors that determine the suitability of materials for use in manufacturing ' +
      'a product or constructing a structure',
    sources: ['Material selection', 'Building material'],
    brief:
      'Suitability is a MATCH between material properties and the job, not a ranking of materials ' +
      'from worst to best. The relevant properties depend entirely on use: strength, stiffness, ' +
      'weight, durability, cost, availability, how it behaves in weather, whether it is safe to ' +
      'touch, and whether it can be repaired or recycled. "Strongest is best" is the misconception ' +
      'to break — a slide made of the strongest available material could still be a bad slide.',
    anchor: 'choosing what to make a playground slide or a bike rack out of',
  },
  {
    code: 'D2.7',
    strand: 'D2',
    short: 'Keeping structures safe',
    text:
      'describe methods engineers and other professionals use to assess, improve, and maintain ' +
      'the safety of structures',
    sources: ['Structural engineering', 'Nondestructive testing', 'Factor of safety'],
    brief:
      'Engineers do not wait for failure. They build in a factor of safety so a structure carries ' +
      'more than it will ever be asked to, they test models and materials before building, they ' +
      'inspect on a schedule looking for small changes like cracks and corrosion, and they ' +
      'monitor structures in service. The idea to land is that small problems found early are ' +
      'cheap and safe to fix, which is why inspection happens when nothing appears to be wrong.',
    anchor: 'the regular inspection of a highway overpass or a school roof',
  },
]);

/** Look up one expectation by code. */
export function expectationByCode(code) {
  return EXPECTATIONS.find((e) => e.code === code) ?? null;
}

/** Expectations grouped by strand, for the educator picker. */
export function byStrand() {
  const groups = new Map();
  for (const e of EXPECTATIONS) {
    const list = groups.get(e.strand) ?? [];
    list.push(e);
    groups.set(e.strand, list);
  }
  return [...groups.entries()].map(([strand, expectations]) => ({
    strand,
    title: strand === 'D1' ? 'Relating Science and Technology to Our Changing World' : 'Exploring and Understanding Concepts',
    expectations,
  }));
}
