-- ============================================================
--  Nox Chess — practice: progress tracking
--
--  Run once by hand in the Supabase SQL editor, after
--  supabase-setup.sql. Safe to re-run: everything here is
--  create-if-not-exists or drop-then-create.
--
--  One row per player per mode: the level, the best level
--  reached, and the stats that track how they got there. Only
--  the owner may read or write their own row. The browser
--  writes updates as the player advances and finishes drills;
--  the server leaves it alone.
--
--  WHAT THIS TOUCHES
--
--    creates   public.practice_progress, its policy, one
--              function and one trigger that guard it
--
--  WHAT THIS NEVER TOUCHES
--
--    auth.users and everything else in the auth schema. It is
--    named once, as the target of a foreign key, which is a
--    read-only relationship: deleting a user would delete that
--    user's practice progress, never the other way round. The same
--    line public.profiles already has.
--
--    profiles and every rating column.
--
--    No existing row, column or table is dropped, renamed,
--    emptied or rewritten. There is no delete, truncate, drop
--    table or drop column anywhere in this file.
--
--    Existing RLS policies are left alone. The only policies
--    dropped here are ones this file creates, on the table
--    this file creates.
--
--  Safe to run twice: every statement is create-if-not-exists
--  or drop-then-create of an object this file owns. Wrapped in
--  a transaction, so a failure anywhere leaves the database
--  exactly as it was.
--
--  Requires supabase-setup.sql to have been run first.
--
--  Note: The policy is "for all to authenticated" while the
--  grant excludes DELETE, so a delete is refused by the grant,
--  not the policy — this is on purpose, matching puzzle_progress.
-- ============================================================

begin;
create table if not exists public.practice_progress (
  user_id    uuid        not null references auth.users on delete cascade,
  mode       text        not null check (mode ~ '^[a-z]{3,16}$'),
  level      integer     not null default 1 check (level between 1 and 20),
  best       integer     not null default 1 check (best between 1 and 20),
  asked      integer     not null default 0 check (asked >= 0),
  correct    integer     not null default 0 check (correct >= 0 and correct <= asked),
  sessions   integer     not null default 0 check (sessions >= 0),
  stats      jsonb       not null default '{}'::jsonb check (pg_column_size(stats) < 16384),
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);
alter table public.practice_progress enable row level security;
drop policy if exists "practice: own rows" on public.practice_progress;
create policy "practice: own rows" on public.practice_progress
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
revoke all on public.practice_progress from anon;
grant select, insert, update on public.practice_progress to authenticated;
create or replace function public.practice_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.user_id := auth.uid(); return new; end $$;
drop trigger if exists practice_touch on public.practice_progress;
create trigger practice_touch before insert or update on public.practice_progress
  for each row execute function public.practice_touch();
commit;
