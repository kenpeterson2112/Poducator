# Poducator

A lesson-shaped podcast that **diagnoses what a student already knows, teaches the gaps, checks
whether the teaching landed, and measures what moved.**

Two AI hosts research a topic from open wiki sources and teach it as a short show. But unlike a
narrated article, the lesson adapts: a 90-second diagnostic decides what gets covered, mid-chapter
comprehension checks decide what gets retaught, and a wrap-up quiz measures growth per learning
objective — feeding a teacher dashboard that never learns a single student's name.

> **Status:** Phase 1. The student loop runs end to end against local storage.
> Supabase schema and the Edge Function ship here but are not yet wired up.

## Lineage

This is the "Student mode" track named in [NowPod's spec §10](https://github.com/kenpeterson2112/NowPod).
NowPod proved chapters can generate incrementally and a listener can steer mid-show. Poducator
takes the same seam and points it at evidence of learning instead of curiosity — its "chime"
becomes a comprehension check.

The TTS engine, the stale-async guard, the structured-output generation pattern, and the
disambiguation checkpoint are all carried over from NowPod rather than rewritten.

## What makes it different from "an AI reading you an article"

**1. Learning objectives are the spine.** A lesson decomposes into 3–5 objectives, and every
diagnostic item, chapter, checkpoint and quiz item tags to one. That's what makes the dashboard
actionable — *"18 of 24 are still shaky on objective 3"* rather than *"class average 62%."*

**2. It measures growth, not score.** The diagnostic and the wrap-up quiz are **parallel forms** —
same objectives, different items, generated in one call so difficulty actually matches. A final
score mostly measures what a student walked in with. The delta measures what the lesson did.

**3. "Not sure yet" is a first-class answer.** Every diagnostic item offers it, and it's tracked
separately from a wrong answer — because a *gap* and a *misconception* need opposite teaching. A
wrong mental model actively interferes with new material; an empty slot doesn't. So the chapter
planner ranks misconceptions **above** things the student has never heard of:

```
MISCONCEPTION  >  UNKNOWN  >  SHAKY  >  SOLID
```

**4. Getting a check wrong changes the lesson.** A missed checkpoint re-queues that objective
immediately with an explicit instruction *not* to repeat the earlier explanation. Once, not
forever — looping a student a third time on the same idea is how a study aid becomes a punishment.

**5. The hosts are a teacher and a learner.** Host B voices the confusion a student has but won't
ask aloud, and sometimes gets it wrong and self-corrects. Hearing your own confusion spoken and
resolved beats being lectured at, and it makes being confused feel normal.

## Privacy: anonymous now, attributable by the teacher

The database has **no column for a student's name.** Not nullable — absent.

Students join with a class code and an opaque pseudonym (`lynx-particle-42`) the teacher assigned
offline. The name↔pseudonym map lives only in the teacher's browser, exportable as CSV. So a
teacher can see exactly who answered what, and the server never can.

All student writes go through the Edge Function, which holds the service-role key and validates
the class code. The student tables have **no anon-role RLS policies at all** — that absence *is*
the access control. Full write-up, including the limitations, in [`docs/privacy.md`](docs/privacy.md).

## The loop

```
[Join]  class code → assigned lesson   |   Explore → free topic
   ↓
[Research]   js/sources/     wiki sources + "which one did you mean?" if ambiguous
   ↓
[Plan]       js/claude.js    objectives + diagnostic + wrap-up items, in ONE call
   ↓
[Diagnose]   js/ui.js        4-6 items, ~90s, blocking — nothing is playing
   ↓
[Gap profile] js/objectives.js   rank objectives by teaching urgency
   ↓
[Teach]      js/tts.js       two voices, karaoke transcript, one objective per chapter
   ↓
[Check]      js/ui.js        non-blocking — Host B's riff IS the answer window
   ↓  wrong/ignored → re-queue that objective, taught a different way
   ↓  (loop)
[Wrap-up]    js/ui.js        the parallel-form items, blocking, with feedback
   ↓
[Result]     per-objective growth
```

Coordinated by the state machine in [`js/app.js`](js/app.js).

### The one real design tension, and how it's resolved

NowPod's rule is that the show never waits on the listener. But a check for understanding needs an
answer — that's the point of it. So:

- Checkpoints **never pause audio.** Host A asks in character; Host B then riffs for ~15 seconds,
  and that riff is the answer window.
- No answer → **Host A answers it aloud** and moves on. No dead air, no "waiting for input" state.
- `no_response` is recorded as its own outcome, distinct from wrong — it usually means the student
  drifted, which is different information than a wrong answer and a teacher should see the
  difference.
- The diagnostic and wrap-up quiz **do** block. Nothing is playing; waiting is correct.

## Project structure

```
Poducator/
├── index.html                    # student PWA shell
├── manifest.webmanifest / sw.js  # installable, works offline mid-lesson
├── css/styles.css
├── js/
│   ├── config.js                 # sources, personas, item counts, grade bands
│   ├── sources/                  # MediaWiki-family adapters + registry
│   ├── claude.js                 # generation: plan call + chapter call
│   ├── assessment.js             # item model, scoring, pre/post delta  (pure)
│   ├── objectives.js             # gap profile, chapter planning        (pure)
│   ├── tts.js                    # browser TTS, ported from NowPod
│   ├── ui.js                     # DOM only
│   ├── store.js                  # IndexedDB + offline outbox
│   └── app.js                    # state machine
├── supabase/
│   ├── migrations/0001_init.sql  # schema + RLS (Phase 2)
│   └── functions/session/        # Claude proxy + student writes (Phase 2)
└── docs/{spec,privacy}.md
```

`assessment.js` and `objectives.js` are pure — no DOM, no fetch, no state — so the pedagogy can be
tested with fixture data instead of by clicking through a lesson.

## Running it

Static and dependency-free, same as NowPod:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Open <http://localhost:8000>, paste a Claude API key, type a topic.

### About the API key

Phase 1 calls the Messages API (`claude-sonnet-5`) directly from the browser with the CORS opt-in
header, and the key lives in `localStorage` — exactly NowPod's known rough edge. **This is fine for
a demo and wrong for students**, which is why `supabase/functions/session` already exists. Phase 2
points `store.js` and `claude.js` at it and the key never leaves the server. The request body is
identical either way; only the URL and headers change.

## Adding sources

The user-supplied wiki source list drops into `SOURCES` in [`js/config.js`](js/config.js). Every
MediaWiki-family site shares one API shape, so adding one is a config entry. Non-MediaWiki sources
need a new adapter implementing the same interface as `js/sources/mediawiki.js`.

## Known rough edges (flag, don't fix)

- Wiki depth is capped; obscure topics produce thin lessons.
- Browser TTS quality varies by OS and browser.
- 4–6 items is a small instrument. The growth delta is a **signal, not a measurement** — the app
  says so on the result screen, and it should keep saying so.
- Reading-level targeting is prompt-based and uncalibrated. It needs real students, not more
  prompt engineering.
- **Claude writes the assessment *and* teaches the content.** That's a genuine conflict of
  interest — the model can teach to its own test. Generating items *before* any chapter helps;
  it doesn't solve it. Teacher review of generated items is on the roadmap for this reason.

## License

[MIT](LICENSE)
