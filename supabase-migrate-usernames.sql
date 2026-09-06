-- ============================================================
--  NOX CHESS — migration: one username per account
--
--  Run once, by hand, in the Supabase SQL editor, after supabase-setup.sql.
--  Running it twice is harmless.
--
--  A username is what the other player reads across the board, and two
--  accounts that both read "Alex" are two boards lying to somebody. The rule
--  is enforced in three places, and this file is the durable one:
--
--    · here — a unique index on profiles.display_name, case-insensitively,
--      so the database refuses a second "alex" whoever asks and however they
--      ask (the username screen, the REST API, a hand-written client).
--    · the username screen — asks username_available() before saving, and
--      reads the unique-violation error as "that name is taken" if it loses
--      the race anyway.
--    · the game server — keeps a registry of every name in use on it, guests
--      included, and reads the name an account plays under from THIS column
--      rather than from the token, because the token's metadata is something
--      the account can write for itself. See claim_name() in server/server.py.
--
--  Case-insensitive on purpose: "Alex" and "alex" are the same name to
--  anybody reading a board bar, and the point of the rule is the reader.
-- ============================================================

begin;

-- ------------------------------------------------------------
--  1. Existing duplicates, if any, before the index can be built
--
--     The name stays with whoever has had it longest. Everybody else on it
--     goes back to the placeholder their row was created with — the same
--     'player_' + eight characters of their id that handle_new_user() seeds,
--     which is unique by construction. They will be asked to choose again the
--     next time the page sees an account with no username of its own.
--     Nothing is deleted.
-- ------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (partition by lower(display_name) order by created_at, id) as nth
    from public.profiles
)
update public.profiles p
   set display_name = 'player_' || substr(p.id::text, 1, 8)
  from ranked
 where ranked.id = p.id
   and ranked.nth > 1;

-- ------------------------------------------------------------
--  2. The rule itself
-- ------------------------------------------------------------
create unique index if not exists profiles_display_name_unique
  on public.profiles (lower(display_name));

-- ------------------------------------------------------------
--  3. "Is this name free?" — asked by the username screen as you type
--
--     Profiles are readable by everyone already, so this gives nothing away;
--     it exists because the honest query is `lower(display_name) = lower($1)`,
--     and the browser's query builder has no way to say that except ilike,
--     where _ and % are wildcards and _ is a character usernames allow.
--     Your own name is always available to you: choosing again the name you
--     already have is not a collision, and a browser that saved the profile
--     row but not the token would otherwise be told its own name is taken.
--     security definer so it reads the row regardless of who asks; the search
--     path is pinned for the same reason it is on handle_new_user().
-- ------------------------------------------------------------
create or replace function public.username_available(wanted text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
      from public.profiles
     where lower(display_name) = lower(btrim(wanted))
       and id is distinct from auth.uid()
  );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

commit;

-- ------------------------------------------------------------
--  Check it worked:
--     select username_available('SomeNameNobodyHas');   -- true
--     select display_name, count(*) from public.profiles
--       group by lower(display_name), display_name having count(*) > 1;  -- no rows
-- ------------------------------------------------------------
