/**
 * api/session — the server seam (spec §7, §8), as a Vercel Function.
 *
 * It does exactly two things, and deliberately nothing else:
 *
 *   generate  proxies a Claude call so the API key never reaches a
 *             learner's browser
 *   speak     proxies one OpenAI text-to-speech call — one transcript
 *             line in, MP3 bytes out (docs/premium-audio.md)
 *
 * There is no access gate: anyone with the URL can call it. Neither API key
 * ever leaves this function; what bounds spend is the per-IP rate limits below
 * plus a spend limit on each key in its provider's console.
 *
 * There is no database. Sessions are stored in the learner's browser only.
 *
 * Environment variables (Vercel → Project → Settings → Environment Variables):
 *   ANTHROPIC_API_KEY   required
 *   OPENAI_API_KEY      optional: premium voices
 *   OPENAI_TTS_MODEL    optional: overrides the speech model
 *
 * Without OPENAI_API_KEY, `speak` answers 501 and the client falls back to the
 * browser's built-in speech for the rest of the page's life — so premium audio
 * is switched on and off entirely by whether that variable exists.
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';

const CORS = {
  'access-control-allow-origin': '*',
  // x-poducator-class is still accepted so an older client's preflight passes;
  // with no database there is nothing to validate it against, so it is ignored.
  'access-control-allow-headers': 'content-type, x-poducator-class',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

/**
 * Best-effort per-IP rate limit.
 *
 * Deliberately modest about what it is: function instances are ephemeral and
 * there may be several, so this Map is not a quota — it is a speed bump against
 * one script hammering the endpoint.
 *
 * Two buckets, because the two kinds of call arrive at very different rates.
 * A lesson makes one Claude call per chapter, but one `speak` call per
 * transcript LINE — twenty-odd per chapter, a few seconds apart, with the next
 * couple prefetched. And a classroom usually shares one public IP behind the
 * school's NAT, so `speak` needs headroom for a room of learners, not one.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = { default: 30, speak: 300 };
const hits = new Map();

function rateLimited(req, bucket) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  entry.count += 1;
  if (entry.count > MAX_PER_WINDOW[bucket]) {
    return json(
      { error: { code: 'rate_limited', message: 'Too many requests — wait a minute.' } },
      429
    );
  }
  return null;
}

/**
 * Proxy one Claude call. The client sends the full Messages API body; this
 * adds the key and nothing else, so the request shape stays identical to the
 * direct-from-browser call (see js/claude.js:callClaude).
 */
async function generate(body) {
  if (!ANTHROPIC_KEY) return json({ error: { message: 'Server API key not configured.' } }, 500);

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

/**
 * Text-to-speech model. Overridable by environment variable so a newer
 * snapshot can be tried without a code change; the CLIENT never chooses it, so
 * nobody holding the URL can point this at a pricier model.
 */
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';

/** The voices the speech endpoint offers. Anything else is rejected rather
 * than forwarded, so a bad value fails here with a clear message. */
const TTS_VOICES = new Set([
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx',
  'sage', 'shimmer', 'verse', 'marin', 'cedar',
]);

/** One transcript line is a sentence or three; the API's own ceiling is 4096.
 * A tighter cap keeps this endpoint useless as a general-purpose free TTS. */
const MAX_SPEAK_CHARS = 1500;
const MAX_INSTRUCTION_CHARS = 600;

/**
 * Speak one transcript line through OpenAI's speech endpoint.
 *
 * Unlike `generate`, this does NOT pass the client's body through: it builds
 * the upstream request field by field from validated values. The model is
 * fixed here.
 */
async function speak(body) {
  if (!OPENAI_KEY) {
    // A distinct code the client recognizes as "premium audio isn't set up
    // here" — it stops asking for the rest of the session instead of paying a
    // failed round trip on every line.
    return json(
      { error: { code: 'tts_unconfigured', message: 'Premium audio is not configured.' } },
      501
    );
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > MAX_SPEAK_CHARS) {
    return json({ error: { message: `Text must be 1-${MAX_SPEAK_CHARS} characters.` } }, 400);
  }
  const voice = typeof body.voice === 'string' ? body.voice : '';
  if (!TTS_VOICES.has(voice)) {
    return json({ error: { message: 'Unknown voice.' } }, 400);
  }
  const instructions =
    typeof body.instructions === 'string'
      ? body.instructions.slice(0, MAX_INSTRUCTION_CHARS)
      : undefined;

  const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: text,
      voice,
      instructions,
      // MP3 is the one format every browser's <audio> plays, iOS included.
      response_format: 'mp3',
    }),
  });

  if (!upstream.ok) {
    let message = `Speech failed (${upstream.status}).`;
    try {
      message = (await upstream.json())?.error?.message ?? message;
    } catch {
      /* keep the status-code message */
    }
    return json({ error: { code: 'tts_failed', message } }, upstream.status);
  }

  // Streamed straight through: the first bytes reach the browser while the
  // rest are still being synthesized.
  return new Response(upstream.body, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg', ...CORS },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return rateLimited(req, 'default') ?? json({ error: { message: 'Invalid JSON body.' } }, 400);
  }

  // Rate-limit BEFORE dispatching. The action picks the bucket, so this runs
  // just after the (cheap) parse rather than before it.
  const limited = rateLimited(req, body.action === 'speak' ? 'speak' : 'default');
  if (limited) return limited;

  if (body.action === 'speak') return speak(body);
  if (body.action === 'record_session') {
    return json({ error: { message: 'Session recording is not available on this server.' } }, 501);
  }

  // Anything else is a Messages API passthrough.
  const { action: _ignored, ...messagesBody } = body;
  return generate(messagesBody);
}
