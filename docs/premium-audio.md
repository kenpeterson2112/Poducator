# Premium audio — OpenAI voices

**Status:** Built, behind one secret. Set `OPENAI_API_KEY` on the server function and live
lessons speak with OpenAI voices; leave it unset and everything works exactly as before on the
browser's built-in speech. This picks up the plan scoped in
[`background-audio.md`](background-audio.md), first half only — see *Not in this change* below.

## How it works

```
chapter script lands ──▶ tts.prefetch(first 3 lines)       (during the ready gate, or
                                                              while the last chapter plays)
line i starts ──────────▶ prefetch lines i+1, i+2
                          clip(line i) ─▶ POST {action:'speak', text, voice, instructions}
                                          to the server function ─▶ OpenAI /v1/audio/speech
                          ◀── MP3 bytes ── blob URL ── one shared <audio> element ── `ended`
```

- **Server** — `api/session.js` has a `speak` action. It builds the upstream request
  field by field: the voice must be on an allowlist, text is capped at 1,500 characters (one line
  is a sentence or three — the cap keeps the endpoint useless as a free general-purpose TTS), and
  the **model is fixed server-side** (`gpt-4o-mini-tts`, overridable by the `OPENAI_TTS_MODEL`
  secret), so no caller can point it at a pricier one. `speak` has its own rate-limit bucket
  (300/min/IP vs 30 for everything else): a lesson asks for one clip per transcript *line*, and a
  classroom usually shares one IP behind the school's NAT.
- **Client** — `js/tts.js` gets a second engine behind the same three functions
  (`speakChapter`, `speakOne`, `stop`). Nothing in `app.js`'s chapter loop, checkpoints, rewind,
  restart, review or speed controls changed. App wiring is three lines: `usePremiumAudio(credentials)`
  at the start of a live run, `usePremiumAudio(null)` for a replay, and a capture-phase click
  listener that unlocks audio playback inside the first tap (iOS refuses audio no gesture asked for).
- **Voices** — per host in `js/config.js` → `HOSTS[*].premiumVoice`: `marin` for the Teacher,
  `cedar` for the Learner, each with delivery instructions (`gpt-4o-mini-tts` takes direction on
  tone, not just text). Changing a voice or its direction is a config edit.

## The decisions from the plan, as built

- **Caching.** Each clip is cached in memory as a blob URL for the page's life (up to 300 lines,
  least-recently-used evicted). Rewind, restart and chapter review replay audio already paid for.
- **Saved sessions.** Replay stays on browser speech, so demo mode keeps its zero-network-requests
  guarantee and `.poducator` files stay small JSON.
- **Fallback.** A line that can't be fetched within 15 s, or that the browser won't play, is
  spoken by the browser engine instead — that line only. Three failures in a row, or a server
  that answers `tts_unconfigured`, switch premium off for the rest of the page, so an outage
  never costs a timeout per line. *A stalled lesson is the one failure a learner can't work
  around* still holds: every path resolves.
- **Speed.** The listener's speed is `playbackRate` (pitch preserved). Each host's persona rate
  tweak from `voiceHint` applies only to browser speech — the premium voices carry delivery in
  their instructions.

## Cost

`gpt-4o-mini-tts` is billed per text token in and audio token out; OpenAI's own estimate works out
to roughly **$0.015 per minute of audio** — about **$0.15 for a standard 10-minute lesson**, or
**~$9/month for 30 students × 2 lessons**. Re-hearing a line (rewind, review) is free thanks to
the cache; skipping a chapter wastes at most the 2–3 prefetched lines. Check current pricing
before relying on these numbers, and **set a usage limit on the OpenAI key** — like the Anthropic
key, that is what actually bounds spend, since the endpoint has no access gate.

## Not in this change

- **Lock-screen / background playback** — since built on top of this; see *As built* in
  [`background-audio.md`](background-audio.md).
- **Downloadable audio.** Clips live only in memory; a saved lesson is still the transcript.
- **Other providers.** The client sends `{text, voice, instructions}` and gets MP3 back. Trying
  ElevenLabs or Google later means a different upstream call inside `speak` and new voice names
  in `HOSTS` — the client engine doesn't care which vendor made the MP3.
