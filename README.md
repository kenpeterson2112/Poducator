# Poducator

A curriculum-tied podcast that **diagnoses what a learner already thinks, teaches the gaps, checks
whether the teaching landed, and measures what moved.**

An educator picks 1–3 curriculum expectations. Two AI hosts teach exactly those, as a short show.
The lesson adapts: a three-question quiz up front decides what gets covered and how long each part
runs, mid-chapter comprehension checks decide what gets retaught, and a wrap-up quiz measures
growth per expectation — feeding a teacher dashboard that never learns a single student's name, but
does report **which misconceptions the class actually holds.**

> **Status:** The learner loop runs end to end against local storage, tied to
> Ontario Grade 7 Science, Strand D. Supabase schema and the Edge Function ship
> here but are not yet wired up. No teacher dashboard yet.

## Lineage

This is the "Student mode" track named in [NowPod's spec §10](https://github.com/kenpeterson2112/NowPod).
NowPod proved chapters can generate incrementally and a listener can steer mid-show. Poducator
takes the same seam and points it at evidence of learning instead of curiosity — its "chime"
becomes a comprehension check.

The TTS engine, the stale-async guard, and the structured-output generation pattern are carried
over from NowPod rather than rewritten. NowPod's disambiguation checkpoint is *gone* — curriculum
expectations carry curated source titles, so there is nothing left to disambiguate.

## What makes it different from "an AI reading you an article"

**1. Curriculum expectations are the spine.** An educator picks 1–3 and they are locked in for the
learner. The expectation code *is* the objective id everywhere — in the item bank, the chapter plan,
the database — so a dashboard row reads `D2.2`, not `OBJ-3`, and matches the curriculum document
with no lookup table in between.

**2. Wrong answers say *what the learner believes*, not just that they were wrong.** Every distractor
in the bank is authored to encode a specific mistake students actually make, and that slug is
recorded. 100 distinct misconceptions across 162 distractors. This is the whole point of the
design:

> *"62% on D2.4"* is a number.
> *"Eleven students think symmetry is decorative"* is tomorrow's lesson opener.

Teacher-facing only — the learner sees the explanation, never the label.

**3. It measures growth, not score.** The pre-pod quiz and the wrap-up quiz are **parallel forms** —
same expectations, different items, authored as pairs matched on cognitive demand, not just
difficulty. A final score mostly measures what a learner walked in with. The delta measures what the
lesson did.

**4. "Not sure yet" is a first-class answer.** Every item offers it, and it's tracked
separately from a wrong answer — because a *gap* and a *misconception* need opposite teaching. A
wrong mental model actively interferes with new material; an empty slot doesn't. So the chapter
planner ranks misconceptions **above** things the student has never heard of:

```
MISCONCEPTION  >  UNKNOWN  >  SHAKY  >  SOLID
```

**5. Knowing it already makes the chapter shorter, not absent.** Every selected expectation gets a
chapter — an educator chose them on purpose, and one multiple-choice item is not strong enough
evidence to overturn that. What the diagnostic controls is **order and length**: arrive solid and you
get a 5–7 exchange confirm-and-extend instead of a 9–12 exchange full treatment.

**6. Getting a check wrong changes the lesson.** A missed checkpoint re-queues that expectation
immediately, at full length, with an explicit instruction *not* to repeat the earlier explanation.
Once, not forever — looping a learner a third time on the same idea is how a study aid becomes a
punishment.

**7. The hosts are a teacher and a learner.** Host B voices the confusion a student has but won't
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
EDUCATOR
[Pick 1-3]   js/curriculum/  expectations from the strand + reading level
   ↓
[Link]                       #e=D2.2,D2.5&g=middle  → hand to learners

LEARNER
[Locked]     js/ui.js        sees what it covers; no control changes it
   ↓
[Diagnose]   js/ui.js        3 items from the pre-built bank — NO API CALL
   ↓                         (wiki fetches run underneath these three questions)
[Gap profile] js/objectives.js   rank expectations by teaching urgency
   ↓
[Teach]      js/tts.js       two voices, karaoke transcript, one expectation per
   ↓                         chapter, length scaled to how well they knew it
[Check]      js/ui.js        non-blocking — Host B's riff IS the answer window
   ↓  wrong/ignored → re-queue that expectation at full length, taught differently
   ↓  (loop)
[Wrap-up]    js/ui.js        the parallel-form items, blocking, with feedback
   ↓
[Result]     per-expectation growth
```

**One API call per chapter, and nothing else.** The planning call is gone — objectives are the
educator's selection and both item sets are pre-built, so nothing blocks the start of the lesson.

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
- Both quizzes **do** block. Nothing is playing; waiting is correct.

## Project structure

```
Poducator/
├── index.html                    # PWA shell: educator picker + learner loop
├── manifest.webmanifest / sw.js  # installable; the item bank is cached shell
├── css/styles.css
├── js/
│   ├── curriculum/
│   │   ├── ontario-sci-7-d.js    # the 9 expectations + curated sources + briefs
│   │   ├── items.js              # 54 hand-authored items + misconception library
│   │   └── index.js              # lesson link encode/decode, item sampling
│   ├── config.js                 # sources, personas, item counts, chapter depth
│   ├── sources/                  # MediaWiki-family adapters + registry
│   ├── claude.js                 # generation: chapter call (the only one)
│   ├── assessment.js             # item model, scoring, pre/post delta  (pure)
│   ├── objectives.js             # gap profile, chapter planning        (pure)
│   ├── tts.js                    # browser TTS, ported from NowPod
│   ├── ui.js                     # DOM only
│   ├── store.js                  # IndexedDB + offline outbox
│   └── app.js                    # state machine
├── supabase/
│   ├── migrations/               # schema + RLS + misconception views (Phase 2)
│   └── functions/session/        # Claude proxy + student writes (Phase 2)
└── docs/{spec,privacy}.md
```

`assessment.js`, `objectives.js` and `curriculum/index.js` are pure — no DOM, no fetch, no state —
so the pedagogy can be tested with fixture data instead of by clicking through a lesson.

## Running it

Static and dependency-free, same as NowPod:

```bash
python3 -m http.server 8000
# or: npx serve .
```

Open <http://localhost:8000>. You land on the educator picker: choose 1–3 expectations, then
**Open as a learner** (or copy the link). Paste a Claude API key on the learner screen.

### The class passphrase, and where the API key lives

Learners type a **class passphrase** (e.g. `ETEC523`). They never see an API key, never make an
account, and no key is ever sent to their browser.

The key lives in one place: the `ANTHROPIC_API_KEY` secret on the deployed Edge Function. It is
not in this repo, and it must never be — **the repository is public**, so a committed key is a
published key, git history keeps it published after any later removal, and GitHub and Anthropic
both scan public repos and revoke what they find.

**The passphrase is checked on the server, not in the browser.** That distinction is the whole
design. A browser-side check would be decorative: anything the client compares, a learner can read
in DevTools in about ten seconds, along with whatever it was guarding.

Worth being precise about what this does and does not buy:

- It **does** keep the API key secret. That part is complete — the key never leaves the server.
- It **does not** authenticate anyone. A shared passphrase gets shared. The real bound on a leaked
  passphrase is a **spend limit on the Anthropic key**, set in the Anthropic console. The function
  also rate-limits per IP, but Edge instances are ephemeral, so treat that as a speed bump rather
  than a quota.

Rotate the passphrase per term by changing the `POD_PASSPHRASE` secret — no redeploy needed.

### Deploying

1. **Create a Supabase project** (free tier is enough).
2. **Set the secrets** — Dashboard → Edge Functions → Secrets, or
   `supabase secrets set ANTHROPIC_API_KEY=... POD_PASSPHRASE=ETEC523`. See
   [`.env.example`](.env.example) for what's needed. Never commit values.
3. **Deploy the function:** `supabase functions deploy session --no-verify-jwt`, or let the GitHub
   integration do it — [`supabase/config.toml`](supabase/config.toml) already sets
   `verify_jwt = false` for that path. Either way this flag is required: learners hold no JWT, so
   with verification on, every request is rejected by the platform before the passphrase is read.
4. **Set a spend limit** on the Anthropic key. This is the control that actually bounds abuse.
5. **Put the function URL** into `PROXY_URL` in [`js/config.js`](js/config.js) — a function URL is
   public by design and correct to commit.
6. **Enable GitHub Pages** (Settings → Pages → `main` / root). All asset paths are relative, so it
   works under `/Poducator/` unchanged.

## Saved lessons and demo mode

Every lesson is saved to the device as it runs — **after the opening quiz and after each chapter**,
not only at the end. A learner who closes the tab at chapter two keeps what they did, and the
library labels it *unfinished*. **Saved lessons** in the header lists everything on the device.

Nothing in the library has been sent anywhere. It is IndexedDB on that device.

### The `.poducator` file

A session exports to a single JSON file (`js/sessionfile.js`) carrying the lesson metadata,
objectives, full chapter transcripts, checkpoints, assessment items, responses and results. Export
from the result screen or any library row.

Because saving and demoing want the same thing, **a saved session and a hand-authored one are the
same format**. That is what makes the next part work.

### Demo mode — iterate without paying per run

Open a `.poducator` file from the library and it plays through the real player with **zero API
calls**. No key, no passphrase, works with the network off entirely.

So to iterate on the experience without spending anything:

1. Ask Claude, in a normal conversation, to write a podcast in the `.poducator` format — hand it
   [`demo/sample-lesson.poducator`](demo/sample-lesson.poducator) as the shape to copy.
2. Save the reply as a `.poducator` file.
3. Open it under **Saved lessons → Open a lesson file**.

Checkpoints stay live during a replay, so the interaction demos properly. What a replay will *not*
do is re-plan: it plays the chapters in the file, in order, because they are already written. If
you want to demo the reteach branch, put a reteach chapter in the file.

A hand-authored file needs very little — a topic and one chapter with dialogue lines. Everything
else is optional and gets filled in on load, so these are quick to write by hand.

**What a saved podcast is not: audio.** Browser TTS synthesizes speech live and never produces a
file. A saved lesson is the transcript, and replaying re-runs TTS over it — which costs nothing.
Downloadable audio arrives with the ElevenLabs swap, not before.

### Running it locally

Leave `PROXY_URL` empty and the app falls back to asking for a pasted API key, exactly as before —
the passphrase field hides itself and the dev key field appears. That fallback exists so you can
develop without deploying anything; learners never encounter it.

## Adding a strand or a subject

A curriculum is one file in `js/curriculum/` plus its item bank. For each expectation you need:
curriculum text, curated source titles, a `brief` saying what covering it means at that grade, an
`anchor` phenomenon, and **six items** — three pre, three post, authored as pairs.

Item authoring rules live in [`js/curriculum/items.js`](js/curriculum/items.js) and in spec §9. The
short version: phenomenon-first stems, every choice is claim + reason, every distractor is a named
misconception, pairs match on cognitive demand, and no stem assumes a house, a car, a bike, or a
hobby.

Then check it:

```bash
node tools/check-bank.mjs
```

That enforces the rules a human reviewer reliably misses — chiefly that pre/post pairs match on
cognitive demand (a mismatched pair makes the growth delta measure the instrument rather than the
learner, and the number still looks plausible) and that each expectation's items are ordered
thinking → application → knowledge, since the sampler takes the first N.

## Adding sources

The wiki source registry lives in `SOURCES` in [`js/config.js`](js/config.js). Every
MediaWiki-family site shares one API shape, so adding one is a config entry. Non-MediaWiki sources
need a new adapter implementing the same interface as `js/sources/mediawiki.js`.

## Known rough edges (flag, don't fix)

- **The curated article titles haven't had a live pass.** One known trap was caught and swapped
  (`Structural stability` is a *mathematics* article). A title that stops resolving now degrades to
  a search rather than to nothing, but the list deserves verification.
- Wiki depth is capped, and the D1 expectations — evaluating social and economic factors — map onto
  reference articles worse than the D2 ones do. The `brief` field carries more weight there.
- Browser TTS quality varies by OS and browser.
- **3 items is a small instrument**, thinner than the 4–6 this started with. The growth delta is a
  **signal, not a measurement** — the app says so on the result screen and should keep saying so.
  Growing Success wants triangulation across observations, conversations and products; this is one
  leg. It can't assess Communication at all.
- The pre-pod quiz now runs closer to **2 minutes than 90 seconds** — claim-and-reason choices take
  longer to read. Three good items beat six thin ones, but the number moved.
- Two learners sitting together see identical questions. Rotation means growing the JSON, not
  changing code.
- Reading-level targeting is prompt-based and uncalibrated. It needs real students, not more
  prompt engineering.
- ~~Claude writes the assessment *and* teaches the content.~~ **Resolved** — the bank is
  pre-authored and human-reviewable, so the model no longer teaches to its own test. In-chapter
  *checkpoints* are still model-authored, but they don't feed the growth delta.

## License

[MIT](LICENSE)
