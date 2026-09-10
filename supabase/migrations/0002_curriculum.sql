-- Poducator — curriculum expectations and misconception capture.
--
-- Two changes, and the second is the one that matters.
--
-- 1. Lessons and sessions now carry the curriculum they were built from and the
--    expectation codes an educator locked in. `objectives` already held
--    [{id, text}] and still does — the id is now the expectation code ("D2.2")
--    rather than a generated "OBJ-3", so a response row joins to the curriculum
--    document with no lookup table in between.
--
-- 2. `responses.misconception` records WHAT A WRONG ANSWER REVEALED, not just
--    that it was wrong. Every distractor in the pre-built bank
--    (js/curriculum/items.js) is authored to encode a specific mistake students
--    actually make, and this column carries that slug through to the dashboard.
--
--    This is the difference between a report a teacher can act on and one they
--    cannot. "62% on D2.4" is a number. "Eleven students think symmetry is
--    decorative" is tomorrow's lesson opener.
--
-- The privacy model in 0001_init.sql is unchanged and this migration does not
-- weaken it. A misconception slug describes an idea, not a person: it is
-- attached to a response, the response to a pseudonymous session, and there is
-- still no column anywhere for a name.

-- ---------------------------------------------------------------------------
-- Lessons and sessions: which expectations
-- ---------------------------------------------------------------------------

alter table lessons
  add column if not exists curriculum_id text,
  -- ["D2.2", "D2.5"] — the codes the educator selected, in curriculum order.
  add column if not exists expectations jsonb not null default '[]'::jsonb;

alter table sessions
  add column if not exists curriculum_id text,
  add column if not exists expectations jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Responses: what the wrong answer revealed
-- ---------------------------------------------------------------------------

-- Nullable by design, and null means three different things that must not be
-- collapsed: the answer was correct, the learner said "not sure yet" (a gap,
-- not a belief), or the learner never answered. Recording a misconception for
-- any of those would put an idea in a teacher's report that the student never
-- expressed.
alter table responses
  add column if not exists misconception text;

create index if not exists responses_misconception_idx
  on responses (misconception)
  where misconception is not null;

-- ---------------------------------------------------------------------------
-- Dashboard view: what the class actually believes
-- ---------------------------------------------------------------------------
--
-- security_invoker so the view runs under the querying teacher's RLS rather
-- than the view owner's — without it, this view would hand any authenticated
-- user every class's results.
--
-- Ordered by learner count rather than raw responses: a misconception eight
-- students hold once is a class-wide reteach, while one student holding it
-- three times is a conversation with that student.

create or replace view misconception_tally
with (security_invoker = true) as
select
  s.lesson_id,
  r.objective_id,
  r.misconception,
  r.phase,
  count(*)                        as times_chosen,
  count(distinct s.pseudonym)     as learners
from responses r
join sessions s on s.id = r.session_id
where r.misconception is not null
group by s.lesson_id, r.objective_id, r.misconception, r.phase;

-- A misconception that survives the lesson is the interesting one: the learner
-- still held it at the wrap-up quiz, after the podcast taught against it. That
-- is a signal about the teaching, not just about the learner.

create or replace view misconception_persistence
with (security_invoker = true) as
select
  s.lesson_id,
  r.objective_id,
  r.misconception,
  count(distinct s.pseudonym) filter (where r.phase = 'diagnostic') as held_before,
  count(distinct s.pseudonym) filter (where r.phase = 'final')      as held_after
from responses r
join sessions s on s.id = r.session_id
where r.misconception is not null
group by s.lesson_id, r.objective_id, r.misconception;
