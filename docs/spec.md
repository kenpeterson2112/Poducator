# Poducator — Build Spec

**Status:** Phase 1 implemented (student loop, local persistence)
**Lineage:** This is the "Student mode" follow-on named in [NowPod's spec §10](https://github.com/kenpeterson2112/NowPod/blob/main/docs/spec.md) — built as its own repo, not folded into NowPod.

---

## 1. What this proves

NowPod proved you can generate a podcast chapter-by-chapter and let a listener steer it mid-show
without breaking the illusion of a live broadcast. That's a *curiosity* product.

Poducator proves a different thing: that the same seam can carry **evidence of learning**.

1. **A podcast can diagnose before it teaches.** A 90-second quiz up front changes what gets
   generated — a student who already understands photosynthesis inputs shouldn't sit through
   four minutes on photosynthesis inputs.
2. **A podcast can check whether it worked, mid-flight, and change course.** NowPod's chime
   becomes a comprehension check. Wrong answer → the next chapter reteaches that idea a
   different way.
3. **A listening session can produce teacher-actionable data** without the app ever storing a
   student's name.

## 2. Non-goals for this build

- No real ElevenLabs integration — browser TTS stands in (same reasoning as NowPod §6)
- No document ingestion (PDFs, slides, syllabi). NowPod §10 correctly flagged this as the hard
  part; it's a separate research spike. Wiki-style sources only for now.
- No grading, no gradebook export, no LMS/SIS integration
- No student accounts — pseudonyms only (see §7)
- No adaptive difficulty across *sessions* — each session is self-contained

## 3. The spine: learning objectives

Everything hangs off objectives. A lesson decomposes into **3–5 learning objectives**, and every
generated artifact tags to exactly one:

```
Lesson: "Photosynthesis"
├── OBJ-1  Identify the inputs and outputs of photosynthesis
├── OBJ-2  Explain the role of chlorophyll in capturing light energy
├── OBJ-3  Distinguish the light-dependent from the light-independent reactions
└── OBJ-4  Relate photosynthesis to cellular respiration
```

- Diagnostic items → tagged to an objective
- Chapters → target one or two objectives
- Checkpoints → check the objective the chapter just taught
- Wrap-up items → tagged to an objective

This is what turns a pile of answers into something a teacher can act on. "62% average" tells a
teacher nothing they can teach to tomorrow. "18 of 24 still shaky on OBJ-3" tells them exactly
what to reteach.

**Where objectives come from:**
- *Assigned mode:* the teacher writes them when authoring the lesson.
- *Explore mode:* Claude infers 3–5 from the source material.

## 4. User flow

```
[Join]  class code → assigned lesson   |   Explore → free topic
   ↓
[Research]  source adapters → grounded material (+ disambiguation confirm, from NowPod)
   ↓
[Plan]  one Claude call produces: objectives (if explore), diagnostic items,
        AND the parallel-form wrap-up items — matched difficulty by construction
   ↓
[Diagnostic]  4–6 fast items, ~90 seconds
   ↓          → gap profile: per-objective {correct, confident, unknown}
[Chapter plan]  rank objectives weakest-first; weak objectives get earlier
                chapters and more airtime
   ↓
[Chapter N]  two hosts, grounded in source, aimed at this chapter's objective
   ↓
[Checkpoint]  in-narrative comprehension question (the chime, repurposed — §6)
   ↓   correct  → brief confirm, move on or go deeper
   ↓   wrong    → next chapter reteaches that objective a DIFFERENT way
   ↓   silent   → Host A answers aloud, logged as no_response
   ↓   (loop until chapter plan exhausted)
[Wrap-up quiz]  the parallel-form items held back from the planning call
   ↓
[Result]  per-objective growth shown to the student
   ↓
[Teacher dashboard]  class × objective mastery, pre/post delta, item analysis
```

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

**Generation (Claude, `/v1/messages`, `claude-sonnet-5`, structured outputs).** Three call types:

1. **Plan call** (once per session) → objectives (explore mode only), diagnostic items, and
   wrap-up items. Generating both item sets in one call is what makes them genuinely parallel
   forms — same objectives, different items, matched difficulty. Split across two calls and the
   difficulty drifts, which corrupts the growth delta.
2. **Chapter call** (once per chapter) → dialogue lines + checkpoint, grounded in source, aimed at
   the chapter's objective, informed by the gap profile and the last checkpoint outcome.
3. No third call — the wrap-up items already exist from the plan call.

**Voice:** Web Speech API, two voices, karaoke transcript. Ported from NowPod.

## 9. Measurement: why pre/post and not just a score

The diagnostic and the wrap-up quiz cover **the same objectives with different items**. That gives
a per-objective growth delta rather than a final percentage.

This matters because a final score mostly measures what a student walked in with. A student who
arrives at 10% and leaves at 60% learned a great deal. A student who arrives at 80% and leaves at
85% learned very little — and looks better on a raw score. Only the delta distinguishes them, and
the delta is the thing a teacher actually wants to know about their teaching.

Caveat worth stating plainly: with 4–6 items this is a *signal*, not a measurement. It's directional
evidence for a teacher who also knows the student — not something to grade on.

## 10. Definition of done — Phase 1

- [ ] Student can join in explore mode, pick a topic, and get objectives inferred from real sources
- [ ] Diagnostic runs in under ~90 seconds and produces a per-objective gap profile
- [ ] Chapter order visibly reflects the gap profile (weakest objective first)
- [ ] Audio plays with two distinct voices and a karaoke transcript
- [ ] Checkpoint appears mid-chapter without pausing audio
- [ ] Answering a checkpoint wrong visibly changes the next chapter's approach
- [ ] Ignoring a checkpoint lets the host answer aloud and continue — no stall
- [ ] Wrap-up quiz uses different items on the same objectives as the diagnostic
- [ ] Result screen shows per-objective growth
- [ ] Whole loop runs without a hard error on a normal topic
- [ ] Installable as a PWA; a loaded session survives going offline

## 11. Known rough edges to flag, not fix

- Wiki source depth is capped; obscure topics produce thin lessons. Same as NowPod §8.
- Browser TTS quality varies by OS/browser. Same as NowPod §8.
- 4–6 items is a small instrument — see §9's caveat.
- Reading-level targeting is prompt-based and uncalibrated. It needs real student testing, not
  more prompt engineering.
- Claude authors the assessment items *and* teaches the content. That's a real conflict of
  interest — the model can inadvertently teach to its own test. Mitigated slightly by generating
  items *before* chapters, but not solved.

## 12. Disclaimer & references

Carried over from NowPod §12, with more teeth because the audience is students:

- Persistent footer: "Poducator uses AI and can make mistakes. It is a study aid, not a
  substitute for your teacher or your textbook. Check the reference list before citing anything."
- Reference list auto-populated per session from the actual articles fetched — real titles and
  URLs, not a generic "we use Wikipedia" note.

## 13. Roadmap (not in Phase 1)

- **Document ingestion** — the hard problem NowPod §10 identified. Syllabi, lecture slides,
  multi-column PDFs. Own research spike.
- **Cross-session adaptivity** — objectives a student failed last week resurface this week.
- **Teacher review of generated items** — approve/edit the diagnostic before students see it.
  Probably necessary before any real classroom use, given §11's conflict-of-interest note.
- **Accessibility pass** — transcript-only mode, adjustable playback rate, dyslexia-friendly type.
- **ElevenLabs-quality TTS** — an infra swap, not an architecture change (NowPod §6).
