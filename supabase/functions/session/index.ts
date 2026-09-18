/**
 * supabase/functions/session — the server seam (spec §7, §8).
 *
 * Phase 2 wires this up. It ships now, unwired, because its shape constrains
 * the client design and reviewing it alongside the schema is the point.
 *
 * It does exactly two things, and deliberately nothing else:
 *
 *   generate        proxies a Claude call so the API key never reaches a
 *                   student's browser
 *   record_session  writes a completed session and its responses
 *
 * It holds the service-role key, so it is the ONLY path through which student
 * data reaches the database (the student tables have no anon-role policies at
 * all — see 0001_init.sql). That concentration is intentional: one audited
 * choke point beats permissions scattered across a client.
 *
 * Deploy:
 *   supabase functions deploy session --no-verify-jwt
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *
 * --no-verify-jwt is required because students are never authenticated. The
 * class code is the only credential, which is why validateClass() below is
 * load-bearing rather than a formality.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, apikey, x-poducator-class',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

/**
 * Resolve a class code to a lesson. Returns null when the code is unknown,
 * which the caller must treat as a hard stop — an unvalidated code would let
 * anyone write arbitrary rows into any teacher's dashboard.
 */
async function validateClass(classCode: string | null) {
  if (!classCode) return null;
  const { data } = await admin
    .from('lessons')
    .select('id, archived')
    .ilike('class_code', classCode)
    .maybeSingle();
  return data && !data.archived ? data : null;
}

/**
 * Proxy one Claude call. The client sends the full Messages API body; this
 * adds the key and nothing else, so the request shape stays identical to the
 * Phase 1 direct-from-browser call (see js/claude.js:callClaude).
 */
async function generate(req: Request, body: Record<string, unknown>) {
  if (!ANTHROPIC_KEY) return json({ error: { message: 'Server API key not configured.' } }, 500);

  // Phase 1 lessons travel in a URL and carry no class code. Once a lesson is
  // issued through a class code, that code must be valid before a call is
  // proxied on it.
  const classCode = req.headers.get('x-poducator-class');
  if (classCode && !(await validateClass(classCode))) {
    return json({ error: { message: 'Unknown class code.' } }, 403);
  }

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
 * Record a completed session.
 *
 * Note what is dropped on the way in: anything not on this list. The payload is
 * rebuilt field by field rather than spread, so a future client that starts
 * sending something extra — a name, a device id, free text — cannot quietly
 * persist it. Allowlisting is the whole reason this is written the long way.
 */
async function recordSession(payload: Record<string, any>) {
  const lesson = payload.classCode ? await validateClass(payload.classCode) : null;
  if (payload.classCode && !lesson) {
    return json({ error: { message: 'Unknown class code.' } }, 403);
  }

  const { error: sessionError } = await admin.from('sessions').upsert({
    id: payload.sessionId,
    lesson_id: lesson?.id ?? null,
    pseudonym: payload.pseudonym ?? null,
    mode: payload.mode === 'assigned' ? 'assigned' : 'explore',
    topic: String(payload.topic ?? '').slice(0, 500),
    curriculum_id: payload.curriculumId ? String(payload.curriculumId).slice(0, 100) : null,
    expectations: Array.isArray(payload.expectations)
      ? payload.expectations.slice(0, 8).map((c: unknown) => String(c).slice(0, 20))
      : [],
    objectives: payload.objectives ?? [],
    refs: payload.refs ?? [],
    chapters: payload.chapters ?? [],
    started_at: payload.startedAt ?? new Date().toISOString(),
    completed_at: payload.completedAt ?? null,
  });
  if (sessionError) return json({ error: { message: sessionError.message } }, 400);

  const responses = (payload.responses ?? []).map((r: Record<string, any>) => ({
    session_id: payload.sessionId,
    phase: r.phase,
    objective_id: String(r.objectiveId ?? ''),
    item_id: String(r.itemId ?? ''),
    answer_index: Number.isInteger(r.answerIndex) ? r.answerIndex : null,
    correct: Boolean(r.correct),
    // A slug from the item bank, describing an idea rather than a person.
    // Capped like every other free-ish string that crosses this boundary.
    misconception: r.misconception ? String(r.misconception).slice(0, 80) : null,
    latency_ms: Number.isFinite(r.latencyMs) ? Math.round(r.latencyMs) : null,
    asked_at: r.askedAt ?? new Date().toISOString(),
  }));

  if (responses.length > 0) {
    // Replace rather than append: the outbox retries, and a retried upload must
    // not double-count a student's answers in the dashboard.
    await admin.from('responses').delete().eq('session_id', payload.sessionId);
    const { error } = await admin.from('responses').insert(responses);
    if (error) return json({ error: { message: error.message } }, 400);
  }

  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: { message: 'POST only.' } }, 405);

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json({ error: { message: 'Invalid JSON body.' } }, 400);
  }

  if (body.action === 'record_session') return recordSession(body);

  // Anything else is a Messages API passthrough.
  const { action: _ignored, ...messagesBody } = body;
  return generate(req, messagesBody);
});
