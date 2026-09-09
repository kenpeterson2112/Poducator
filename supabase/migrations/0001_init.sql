-- Poducator — initial schema (spec §7).
--
-- The privacy model is enforced here, in the schema and in RLS, rather than in
-- application code that a future change could quietly bypass.
--
-- The single most important property of this file: there is NO COLUMN ANYWHERE
-- for a student's name, email, or external identifier. Not nullable, not
-- optional — absent. A student is a pseudonym the teacher assigned offline, and
-- the mapping back to a real person lives only in the teacher's browser. If a
-- future migration adds such a column, it has broken the model deliberately,
-- not by accident.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Lessons
-- ---------------------------------------------------------------------------

create table if not exists lessons (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  subject       text,
  grade_band    text not null default 'high',
  -- Short, human-typable, case-insensitively unique. Students type this.
  class_code    text not null unique,
  -- [{ id, label, host }] — which sources this lesson draws on.
  sources       jsonb not null default '[]'::jsonb,
  -- [{ id, text }] — the teacher's authored objectives (spec §3).
  objectives    jsonb not null default '[]'::jsonb,
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists lessons_teacher_idx on lessons (teacher_id);
create index if not exists lessons_class_code_idx on lessons (lower(class_code));

-- ---------------------------------------------------------------------------
-- Roster
-- ---------------------------------------------------------------------------

-- Deliberately just (lesson, pseudonym). The teacher generates these, prints
-- them, and keeps the name mapping on their own device.
create table if not exists roster_entries (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references lessons (id) on delete cascade,
  pseudonym   text not null,
  created_at  timestamptz not null default now(),
  unique (lesson_id, pseudonym)
);

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

create table if not exists sessions (
  id              uuid primary key,
  lesson_id       uuid references lessons (id) on delete cascade,
  pseudonym       text,
  mode            text not null default 'explore'
                  check (mode in ('assigned', 'explore')),
  topic           text not null default '',
  objectives      jsonb not null default '[]'::jsonb,
  refs            jsonb not null default '[]'::jsonb,
  -- What the student actually heard, for a teacher checking what was taught.
  chapters        jsonb not null default '[]'::jsonb,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists sessions_lesson_idx on sessions (lesson_id);
create index if not exists sessions_pseudonym_idx on sessions (lesson_id, pseudonym);

-- ---------------------------------------------------------------------------
-- Responses — the table every dashboard query joins through
-- ---------------------------------------------------------------------------

create table if not exists responses (
  id            bigserial primary key,
  session_id    uuid not null references sessions (id) on delete cascade,
  phase         text not null check (phase in ('diagnostic', 'checkpoint', 'final')),
  objective_id  text not null,
  item_id       text not null,
  -- -1 = "not sure yet", -2 = never answered. Both are signal, not absence:
  -- see js/assessment.js for why they are tracked apart from a wrong answer.
  answer_index  integer,
  correct       boolean not null default false,
  latency_ms    integer,
  asked_at      timestamptz not null default now()
);

create index if not exists responses_session_idx on responses (session_id);
create index if not exists responses_objective_idx on responses (objective_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- Teachers read only their own lessons' data. Students get NO policies at all,
-- which means the anon role can neither read nor write these tables directly —
-- every student write arrives through the Edge Function using the service role,
-- which bypasses RLS and validates the class code itself. That is why there is
-- no student-facing insert policy below: its absence is the design.

alter table lessons        enable row level security;
alter table roster_entries enable row level security;
alter table sessions       enable row level security;
alter table responses      enable row level security;

drop policy if exists lessons_owner on lessons;
create policy lessons_owner on lessons
  for all
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

drop policy if exists roster_owner on roster_entries;
create policy roster_owner on roster_entries
  for all
  using (exists (
    select 1 from lessons l where l.id = roster_entries.lesson_id and l.teacher_id = auth.uid()
  ))
  with check (exists (
    select 1 from lessons l where l.id = roster_entries.lesson_id and l.teacher_id = auth.uid()
  ));

drop policy if exists sessions_owner_read on sessions;
create policy sessions_owner_read on sessions
  for select
  using (exists (
    select 1 from lessons l where l.id = sessions.lesson_id and l.teacher_id = auth.uid()
  ));

drop policy if exists responses_owner_read on responses;
create policy responses_owner_read on responses
  for select
  using (exists (
    select 1
    from sessions s
    join lessons l on l.id = s.lesson_id
    where s.id = responses.session_id and l.teacher_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Dashboard view: per-objective mastery, pre/post (spec §9)
-- ---------------------------------------------------------------------------
--
-- security_invoker so the view runs under the querying teacher's RLS rather
-- than the view owner's — without it, this view would hand any authenticated
-- user every class's results.

create or replace view objective_mastery
with (security_invoker = true) as
select
  s.lesson_id,
  r.objective_id,
  s.pseudonym,
  count(*) filter (where r.phase = 'diagnostic')                          as pre_items,
  count(*) filter (where r.phase = 'diagnostic' and r.correct)            as pre_correct,
  count(*) filter (where r.phase = 'final')                               as post_items,
  count(*) filter (where r.phase = 'final' and r.correct)                 as post_correct,
  count(*) filter (where r.phase = 'checkpoint' and r.answer_index = -2)  as checks_ignored,
  count(*) filter (where r.phase = 'checkpoint' and not r.correct
                     and r.answer_index >= 0)                             as checks_missed
from responses r
join sessions s on s.id = r.session_id
group by s.lesson_id, r.objective_id, s.pseudonym;
