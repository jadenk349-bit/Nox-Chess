-- ============================================================
--  Nox Chess — puzzles: progress and rating
--
--  Run once by hand in the Supabase SQL editor, after
--  supabase-setup.sql. Safe to re-run: everything here is
--  create-if-not-exists or drop-then-create.
--
--  Two different kinds of state, deliberately owned by two
--  different parties:
--
--    puzzle_progress   which puzzles you have finished. Personal
--                      state, like your display name, so the
--                      browser writes it directly under RLS.
--                      Nobody is cheated by a player who marks
--                      their own Opening 12 complete.
--
--    puzzle_rating     what your solving is worth. A number
--                      players compare, so the browser may read
--                      it and never write it — exactly the
--                      arrangement `rating` and `tier` already
--                      have at the bottom of supabase-setup.sql.
--
--  WHAT THIS TOUCHES
--
--    creates   public.puzzle_progress, its index, its policies,
--              and the function/trigger that guard it
--    adds      profiles.puzzle_rating (a new column, default 1200)
--    re-states the profiles UPDATE grant — see section 5
--
--  WHAT THIS NEVER TOUCHES
--
--    auth.users and everything else in the auth schema. It is
--    named once, as the target of a foreign key, which is a
--    read-only relationship: deleting a user would delete that
--    user's puzzle progress, never the other way round. The same
--    line public.profiles already has.
--
--    No existing row, column or table is dropped, renamed,
--    emptied or rewritten. There is no delete, truncate, drop
--    table or drop column anywhere in this file. Existing
--    profiles keep every value they have; the new column simply
--    starts at 1200 for everybody.
--
--    Existing RLS policies on profiles are left alone. The only
--    policies dropped here are ones this file creates, on the
--    table this file creates.
--
--  Safe to run twice: every statement is create-if-not-exists,
--  add-column-if-not-exists, or drop-then-create of an object
--  this file owns. Wrapped in a transaction, so a failure
--  anywhere leaves the database exactly as it was.
--
--  Requires supabase-setup.sql to have been run first — this
--  adds a column to the table that one creates.
-- ============================================================

begin;



-- ------------------------------------------------------------
--  1. The rating, on the profile that already exists
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists puzzle_rating integer not null default 1200;


-- ------------------------------------------------------------
--  2. Progress, one row per puzzle attempted
--
--     puzzle_id is the generated id ("op-3f2a1b9c"), not the
--     number: regenerating the set renumbers the ladders, and a
--     player who has finished thirty-five Opening puzzles should
--     lose their place in the numbering, not the thirty-five.
--
--     solved separates a real solve from a revealed one. Both
--     open the next rung; only the first is a solve.
-- ------------------------------------------------------------
create table if not exists public.puzzle_progress (
  user_id    uuid not null references auth.users on delete cascade,
  track      text not null check (track in ('opening', 'middlegame', 'endgame')),
  puzzle_id  text not null,
  solved     boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, puzzle_id)
);

create index if not exists puzzle_progress_by_user
  on public.puzzle_progress (user_id, track);


-- ------------------------------------------------------------
--  3. Row-level security
--
--     Your progress is yours: you may read and write your own
--     rows and nobody else's. Unlike profiles, these rows are
--     not public — there is nothing to gain from reading a
--     stranger's list of finished puzzles.
-- ------------------------------------------------------------
alter table public.puzzle_progress enable row level security;

drop policy if exists "read your own puzzle progress" on public.puzzle_progress;
create policy "read your own puzzle progress"
  on public.puzzle_progress for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "record your own puzzle progress" on public.puzzle_progress;
create policy "record your own puzzle progress"
  on public.puzzle_progress for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update your own puzzle progress" on public.puzzle_progress;
create policy "update your own puzzle progress"
  on public.puzzle_progress for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.puzzle_progress to authenticated;


-- ------------------------------------------------------------
--  4. A solve is never undone by a replay
--
--     The player may finish a puzzle again by revealing it, and
--     the client upserts that row. Without this, a second visit
--     would write solved = false over a genuine solve. Enforced
--     here rather than in the browser, because the browser is
--     the thing being guarded against.
-- ------------------------------------------------------------
create or replace function public.keep_puzzle_solved()
returns trigger
language plpgsql
as $$
begin
  if old.solved and not new.solved then
    new.solved := true;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists puzzle_progress_keep_solved on public.puzzle_progress;
create trigger puzzle_progress_keep_solved
  before update on public.puzzle_progress
  for each row execute function public.keep_puzzle_solved();


-- ------------------------------------------------------------
--  5. THE IMPORTANT BIT: the rating is not the player's to set
--
--     supabase-setup.sql revoked blanket UPDATE on profiles and
--     granted back exactly two columns. puzzle_rating must stay
--     outside that grant, so re-stating it here is the whole
--     point of this section: if the grant below ever grows a
--     third column, a player can rate themselves 3000.
--
--     These three lines are character-for-character the three at
--     the bottom of supabase-setup.sql, so on a database where
--     that file was run and profiles has not been re-granted
--     since, they change nothing at all.
--
--     They are not decoration. Column grants are not inherited by
--     a column added later only because the blanket UPDATE was
--     already revoked; on a project where it was not, section 1
--     would have just made puzzle_rating writable by every
--     signed-in browser, and this is what closes that.
--
--     THE ONE SIDE EFFECT: if you have granted `authenticated`
--     UPDATE on any *other* profiles column since running the
--     setup file, this revoke drops that grant and you will want
--     to add it back. To see what you have before running:
--
--       select column_name, privilege_type
--       from information_schema.column_privileges
--       where table_schema = 'public'
--         and table_name = 'profiles'
--         and grantee = 'authenticated';
-- ------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant  update (display_name, avatar_url) on public.profiles to authenticated;
grant  select on public.profiles to authenticated, anon;


commit;


-- ------------------------------------------------------------
--  Check it worked:
--     select id, display_name, rating, puzzle_rating from public.profiles;
--     select track, count(*) from public.puzzle_progress group by track;
--  and, to prove the rating is closed to the browser, from a
--  signed-in session:
--     update profiles set puzzle_rating = 3000 where id = auth.uid();
--  which must fail with "permission denied for column puzzle_rating".
-- ------------------------------------------------------------
