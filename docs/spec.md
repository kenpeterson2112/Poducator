# Poducator — Build Spec

**Status:** Phase 1 implemented, then narrowed to a curriculum-driven loop
**Curriculum:** Ontario Grade 7 Science and Technology, Strand D — Form, Function, and Design of Structures
**Lineage:** This is the "Student mode" follow-on named in [NowPod's spec §10](https://github.com/kenpeterson2112/NowPod/blob/main/docs/spec.md) — built as its own repo, not folded into NowPod.

---

## 0. What changed, and why

The first build let a learner type any topic and had Claude infer the learning
objectives. That worked, and it was wrong for a classroom. Three changes:

1. **Objectives are curriculum expectations, chosen by an educator.** Not
   inferred, not typed by the learner. An educator picks 1–3 expectations from
   the strand and those are locked in for the learner.
2. **The pre-pod quiz is 3 questions.** Down from 4–6.
3. **The assessment items are pre-built, not generated.** 54 hand-authored items
   live in `js/curriculum/items.js`.

Explore mode is removed. It can come back later as a separate path; carrying it
alongside meant two live code paths and a diluted product.

The third change is the one with consequences beyond its cost saving. It
resolves §11's conflict of interest — Claude no longer authors the test it then
teaches to — and it deletes the one blocking API call that stood between a
learner pressing start and seeing a question. **A lesson now makes one API call
per chapter and nothing else.**

## 1. What this proves

NowPod proved you can generate a podcast chapter-by-chapter and let a listener steer it mid-show
without breaking the illusion of a live broadcast. That's a *curiosity* product.

Poducator proves a different thing: that the same seam can carry **evidence of learning**.

1. **A podcast can diagnose before it teaches.** A short quiz up front changes what
   gets generated — a learner who already understands centre of gravity shouldn't
   sit through four minutes on centre of gravity.
2. **A podcast can check whether it worked, mid-flight, and change course.** NowPod's chime
   becomes a comprehension check. Wrong answer → the next chapter reteaches that idea a
   different way.
3. **A listening session can produce teacher-actionable data** without the app ever storing a
   student's name. Not just scores — *which misconceptions the class actually
   holds* (§9a).
4. **A generated lesson can be genuinely accountable to a curriculum.** Not
   "about structures", but "covers D2.2 and D2.5, chosen by the teacher, measured
   against those codes."

## 2. Non-goals for this build

- No real ElevenLabs integration — browser TTS stands in (same reasoning as NowPod §6)
- No document ingestion (PDFs, slides, syllabi). NowPod §10 correctly flagged this as the hard
  part; it's a separate research spike. Wiki-style sources only for now.
- No grading, no gradebook export, no LMS/SIS integration
- No student accounts — pseudonyms only (see §7)
- No adaptive difficulty across *sessions* — each session is self-contained
- **One strand only.** Ontario Grade 7 Science, Strand D. Other strands and
  subjects are a data file each, not a redesign — but they are not in this build.
- **No free-topic mode.** Explore mode is removed (§0). Everything is tied to a
  curriculum expectation an educator selected.
- **No in-app item editing.** The bank is human-readable and meant to be edited,
  but by hand in the source file.

## 3. The spine: curriculum expectations

Everything hangs off expectations, and the expectation code IS the objective id
everywhere downstream — in the item bank, in the chapter plan, in the `responses`
table. A teacher reading a dashboard row sees `D2.2`, not `OBJ-3`, and can match
it to the curriculum document with no lookup table in between.

```
Lesson: D2.2 + D2.5           (chosen by the educator, locked for the learner)
├── D2.2  describe ways in which the centre of gravity of a structure
│         affects the structure's stability
└── D2.5  describe factors that can cause a structure to fail
```

- Pre-pod items → tagged to an expectation
- Chapters → one per expectation, ordered weakest-first
- Checkpoints → check the expectation the chapter just taught
- Wrap-up items → parallel forms of the pre-pod items

**Why 1–3 and not more.** A podcast that covers nine expectations covers none of
them, and a three-item diagnostic cannot say anything useful about more than
three. The cap is the product.

Each expectation in `js/curriculum/ontario-sci-7-d.js` carries three fields
beyond its curriculum text, and each is load-bearing:

| Field | Why it exists |
|---|---|
| `sources` | Curated, hand-picked article titles. A curriculum expectation is a learning *outcome*; a wiki article is reference material, and the mapping is lossy. Left to a search, "symmetry" lands on group theory and D1.1 lands nowhere. |
| `brief` | What covering this expectation *means* at Grade 7 in Ontario. This is what stops a chapter from teaching whatever the source article emphasizes instead of what was expected. |
| `anchor` | A concrete opening phenomenon, chosen to assume nothing about a learner's home, income, or hobbies. |

Curating the titles also removed the "which one did you mean?" step entirely —
there is nothing left to disambiguate. A stale title degrades to a search rather
than to no source.

## 4. User flow

```
EDUCATOR
[Pick 1–3 expectations] + reading level
   ↓
[Shareable link]  #e=D2.2,D2.5&g=middle   → hand to learners

LEARNER (opens the link)
[Locked lesson]  sees what it covers; no control changes it
   ↓
[Pre-pod quiz]  3 items from the pre-built bank — NO API CALL, renders instantly
   ↓            (wiki source fetching runs underneath these three questions)
   ↓            → gap profile: per-expectation {misconception, unknown, shaky, solid}
[Chapter plan]  every selected expectation gets a chapter, ordered weakest-first;
                chapter LENGTH scales inversely with how well they already know it
   ↓
[Chapter N]  two hosts, grounded in that expectation's source + brief
   ↓
[Checkpoint]  in-narrative comprehension question (the chime, repurposed — §6)
   ↓   correct  → brief confirm, move on
   ↓   wrong    → next chapter reteaches that expectation a DIFFERENT way, at full length
   ↓   silent   → Host A answers aloud, logged as no_response
   ↓   (loop until chapter plan exhausted)
[Wrap-up quiz]  the parallel-form items from the same bank
   ↓
[Result]  per-expectation growth shown to the learner
   ↓
[Teacher dashboard]  class × expectation mastery, pre/post delta,
                     AND which misconceptions the class actually holds (§9a)
```

**"Locked in" with no accounts.** The lesson lives in the URL hash, so a learner
who opens the link gets an interface with no control that changes what is
taught. A learner who edits the hash by hand can change it — that limit is real
and it is the right one for this phase. The requirement is pedagogical (the
learner does not choose the scope), not adversarial. The same config object
moves behind a class code in Phase 2 and only the transport changes.

**Every selected expectation gets a chapter.** This is the one place the app
deliberately overrides its own diagnostic. An educator locked these in on
purpose, and a single multiple-choice item is not strong enough evidence to
overturn that — a learner can get one item right by guessing, but they cannot
un-choose what their teacher assigned. What the diagnostic controls instead is
**order and length**: an expectation the learner arrived solid on gets a short
confirm-and-extend (5–7 exchanges) rather than a full treatment (9–12). Miss the
checkpoint and the reteach comes back at full length, because the brief version
is what just failed.

## 5. The two hosts

Deliberately different from NowPod's Explainer/Enthusiast pairing, which is wrong for teaching:

- **Host A — "the Teacher":** explains clearly at the target reading level. Checks for
  understanding. Never condescending, never says "as you probably already know" (which teaches a
  struggling student to stay quiet).
- **Host B — "the Learner":** voices the confusion the student probably has but won't ask aloud.
  Gets things partly wrong and self-corrects. Models productive struggle.

Host B is the load-bearing one. A student hearing their own confusion spoken and then resolved
learns more than a student being lectured at — and it makes being confused feel normal rather
than disqualifying.

## 6. Checkpoints: resolving the "never pause" tension

NowPod's hard rule is that the show never waits on the listener. But a check for understanding
genuinely needs an answer — that's the entire point. The resolution keeps NowPod's insight intact:

- **Checkpoints never pause the audio.** Host A asks the question in character. Host B then riffs
  for ~15 seconds — the same buffer trick as NowPod §11 — and *that riff is the answer window*.
- Answer inside the window → the next chapter branches on it.
- No answer → **Host A answers it aloud**, conversationally, and the show moves on. No dead air,
  no "waiting for input" state.
- `no_response` is recorded as its own outcome, distinct from wrong. It usually means the student
  disengaged or got lost — which is different information than a wrong answer, and a teacher
  should see the difference.

**The diagnostic and wrap-up quiz DO block.** They're bracketing assessments, not interludes, and
no audio is playing during either.

## 7. Privacy model

The requirement is "anonymized for now, but teachers need to see who answered what." Those sound
contradictory. They aren't — they just require the mapping to live somewhere other than the server.

- **Students never authenticate and never type a name.** The teacher generates a roster of opaque
  pseudonyms (`lynx-particle-42`). A student joins with `class code + pseudonym`.
- **The database has no name column.** Not "we don't populate it" — it does not exist. There is
  nothing to leak, subpoena, or accidentally log.
- **The name↔pseudonym map lives only in the teacher's browser** (IndexedDB), exportable as CSV so
  it survives a lost laptop.
- **All student writes go through the Edge Function**, which holds the service-role key and
  validates the class code. Student tables are deny-all to the anon key — no direct client write
  path exists to abuse.
- **Teachers authenticate** via Supabase Auth. RLS restricts them to lessons where
  `teacher_id = auth.uid()`.

Net: anonymous by construction, de-anonymizable only by the teacher holding the roster.

See [`privacy.md`](privacy.md) for the version to hand a school.

## 8. Data flow / API calls

**Research — wiki-style sources.** All MediaWiki-family sites share one API shape, are
CORS-friendly via `origin=*`, and need no auth:

| Source | Why it's in the list |
|---|---|
| Wikipedia | Breadth; the default |
| Simple English Wikipedia | Lower reading level — the right default for younger grade bands |
| Wikibooks | Actual textbook-shaped content |
| Wikiversity | Explicitly instructional, often already has learning objectives |
| Wikinews | Current-events hooks |

Adding sources is a config entry in `js/sources/index.js`, not a refactor. Non-MediaWiki sources
need a new adapter implementing the same interface.

Sourcing is **per expectation**, not one blended blob per lesson. Each chapter
call gets only the material for the expectation it teaches, which makes the
prompt more focused and cheaper at the same time.

**Generation (Claude, `/v1/messages`, `claude-sonnet-5`, structured outputs).**
One call type:

1. **Chapter call** (once per chapter) → dialogue lines + checkpoint, grounded in
   that expectation's source and `brief`, aimed at the chapter's expectation,
   informed by the gap profile and the last checkpoint outcome.

That is the whole API surface. The planning call is gone — objectives are the
educator's selection and both item sets are pre-built. A three-expectation
lesson makes three calls where it used to make four, and a one-expectation
lesson makes one where it used to make two. The bigger win is that **none of
them block the start of the lesson**: the pre-pod quiz needs no network, so the
source fetches run underneath it and the first chapter call fires the moment the
learner answers question three.

**Voice:** Web Speech API, two voices, karaoke transcript. Ported from NowPod.

## 9. Measurement: why pre/post and not just a score

The pre-pod quiz and the wrap-up quiz cover **the same expectations with
different items**. That gives a per-expectation growth delta rather than a final
percentage.

This matters because a final score mostly measures what a student walked in with. A student who
arrives at 10% and leaves at 60% learned a great deal. A student who arrives at 80% and leaves at
85% learned very little — and looks better on a raw score. Only the delta distinguishes them, and
the delta is the thing a teacher actually wants to know about their teaching.

**The item budget is fixed at 3 and spread, not scaled down.** One expectation
selected means three items on it; two means 2+1; three means 1+1+1. Holding the
total at three is what keeps a single-expectation lesson from resting its entire
growth measurement on one binary item.

### How items are built

Every item in the bank follows five rules, drawn from NRC assessment standards,
NGSS three-dimensional task design, and Ontario's Growing Success:

1. **Phenomenon first.** Each stem opens on a concrete situation, not a
   definition.
2. **Every choice is claim + reason.** A two-tier item (claim, then reasoning) is
   the standard way to catch a learner who is right for the wrong reason — but a
   second tier would cost a question we don't have. Folding the because-clause
   into each choice buys most of that diagnostic power for free.
3. **Every distractor is a named misconception** (see §9a).
4. **Pairs match on cognitive demand.** A pre/post pair shares its Growing
   Success category, its practice, and its crosscutting concept, and differs only
   in phenomenon. Matching *difficulty* alone is not enough: if the post item
   sits at a lower demand, the delta measures a change in the instrument rather
   than a change in the learner.
5. **Fairness by context review.** No stem assumes a house, a car, a bike, a
   backyard, travel, or any hobby. Reading load is kept low on purpose — a wordy
   stem assesses reading, not science.

Each expectation's three items run **thinking → application → knowledge**, and
the sampler takes the first N. So a three-expectation lesson asks one
thinking-level question about each — the most informative single question —
rather than three recall items.

### What this instrument cannot do

Stated plainly, because a growth bar reading "+33%" invites more confidence than
three items can carry:

- **It is a placement signal, not a measurement.** Three items is thinner than
  the 4–6 this spec originally hedged about. Directional evidence for a teacher
  who also knows the learner; never something to grade on.
- **Growing Success asks for triangulation** across observations, conversations,
  and products. This is one leg: products.
- **It cannot assess Communication.** That needs constructed response or talk.
  Knowledge & Understanding, Thinking, and Application are reachable through
  multiple choice; the fourth category is not.
- **Neither quiz is assessment *of* learning.** The pre-pod quiz is assessment
  *for* learning by construction. So is the wrap-up quiz — it tells a teacher
  what to reteach. Nothing here is an achievement score.
- **No per-learner item variation in this build.** Two students sitting together
  see identical questions. Adding rotation later is growing the JSON, not
  changing code.

## 9a. Misconceptions: the actual teacher-facing payoff

Every distractor in the bank carries a slug naming what a learner picking it
believes — `symmetry-is-decorative`, `total-mass-determines-stability`,
`blame-the-user`. 100 distinct misconceptions across 162 distractors. The slug
rides through `responses.misconception` to the dashboard.

This is the difference between a report a teacher can act on and one they
cannot:

> "62% on D2.4" is a number.
> "Eleven students think symmetry is decorative" is tomorrow's lesson opener.

Two views ship for it: `misconception_tally` (what the class holds, by
expectation) and `misconception_persistence` (which misconceptions *survived*
the lesson — held at the pre-pod quiz and still held at the wrap-up). The second
is a signal about the teaching, not just about the learner.

**These are teacher-facing only.** The learner sees the explanation; they never
see the label. Telling a 12-year-old they hold the "symmetry-is-decorative"
misconception is a different act from telling their teacher, and not a helpful
one.

`NULL` in that column means three things that must not be collapsed: the answer
was correct, the learner said "not sure yet" (a gap, not a belief), or they never
answered. Recording a misconception for any of those would put an idea in a
teacher's report that the learner never expressed.

## 10. Definition of done

- [ ] Educator can pick 1–3 expectations and get a working shareable link
- [ ] Learner opening that link sees the expectations and no way to change them
- [ ] Pre-pod quiz is exactly 3 items and renders with no API call in front of it
- [ ] Chapter order visibly reflects the gap profile (weakest expectation first)
- [ ] An expectation the learner already had gets a visibly shorter chapter
- [ ] No selected expectation is ever dropped, even on a perfect diagnostic
- [ ] Audio plays with two distinct voices and a karaoke transcript
- [ ] Checkpoint appears mid-chapter without pausing audio
- [ ] Answering a checkpoint wrong visibly changes the next chapter's approach
- [ ] Ignoring a checkpoint lets the host answer aloud and continue — no stall
- [ ] Wrap-up quiz uses different items on the same expectations, at matched demand
- [ ] Result screen shows per-expectation growth
- [ ] A wrong answer records *which* misconception, not just that it was wrong
- [ ] Whole loop runs without a hard error on any selection of 1–3 expectations
- [ ] Installable as a PWA; the pre-pod quiz works offline (the bank is shell, not content)

## 11. Known rough edges to flag, not fix

- **The curated article titles are unverified against live Wikipedia.** They were
  chosen by hand and one known trap (`Structural stability`, which is a
  mathematics article) was already caught and swapped. A stale title now degrades
  to a search rather than to no source, but the list deserves one live pass.
- Wiki source depth is capped; the D1 expectations (evaluating social and
  economic factors) map onto reference articles worse than the D2 ones do. The
  `brief` field is carrying more weight there.
- Browser TTS quality varies by OS/browser. Same as NowPod §8.
- 3 items is a small instrument — see §9's caveat, which got stronger, not weaker.
- The pre-pod quiz now runs closer to **2 minutes than 90 seconds**. Claim-and-reason
  choices with a phenomenon stem take longer to read. Three good items beat six
  thin ones, but the 90-second figure elsewhere in this document was written for a
  shallower instrument.
- Reading-level targeting is prompt-based and uncalibrated. It needs real student testing, not
  more prompt engineering.
- ~~Claude authors the assessment items *and* teaches the content.~~ **Resolved**
  by the pre-built bank — the model no longer authors the test it teaches to. The
  in-chapter *checkpoints* are still model-authored, but they don't feed the
  growth delta.

## 12. Disclaimer & references

Carried over from NowPod §12, with more teeth because the audience is students:

- Persistent footer: "Poducator uses AI and can make mistakes. It is a study aid, not a
  substitute for your teacher or your textbook. Check the reference list before citing anything."
- Reference list auto-populated per session from the actual articles fetched — real titles and
  URLs, not a generic "we use Wikipedia" note.

## 13. Roadmap

**Next, in rough order of value:**

- **Teacher dashboard.** The data model and the two misconception views exist;
  nothing renders them yet. This is where the whole design pays off and it is the
  most valuable missing piece.
- **More strands.** Adding one is a new file in `js/curriculum/` plus its item
  bank — 6 items per expectation, following the rules in §9. Not a refactor.
- **Per-learner item rotation.** Two students sitting together currently see the
  same three questions. Growing each expectation's pool past 3+3 fixes it with no
  code change.
- **Class codes.** Replaces the URL hash with the `lessons` table that already
  exists, so a lesson is issued rather than linked.

**Later:**

- **Document ingestion** — the hard problem NowPod §10 identified. Syllabi, lecture slides,
  multi-column PDFs. Own research spike.
- **Cross-session adaptivity** — expectations a learner failed last week resurface this week.
- **Educator item editing** — the bank is human-readable and human-editable by
  design, but there is no UI for it. §13's original "teacher review of generated
  items" is now half-solved: the items are reviewable, just not in-app.
- **Accessibility pass** — transcript-only mode, adjustable playback rate, dyslexia-friendly type.
- **ElevenLabs-quality TTS** — an infra swap, not an architecture change (NowPod §6).
