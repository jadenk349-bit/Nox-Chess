-- ============================================================
--  NOX CHESS — the system profiles: twenty-one names at the top of the ladder
--  Run this once in your Supabase project: SQL Editor → New query → Run.
--  It expects supabase-setup.sql and supabase-social.sql to have been run
--  first — everything here hangs off public.profiles and the two social tables.
--
--  Running it again is harmless and is the intended way to put anything back:
--  every statement either does nothing the second time or re-asserts exactly
--  the same twenty-one rows. It creates nothing twice, and it touches no row
--  that is not one of its own.
--
--  What these are, and what they are not. They are profiles: a row each in
--  public.profiles with a fixed id, a fixed name and a fixed rating, so that
--  the leaderboard, the Social search and a friend request all find them the
--  way they find anybody — through the same table and the same queries, with
--  nothing special-cased in the page. They are NOT the ranked fallback bot,
--  which is a name and a rating that live for one game in server/server.py
--  and never touch this database; that opponent is a seat with no account,
--  and these are accounts with no seat. Nobody can sign in as one, nothing
--  can queue one, and the server refuses a token for one on sight — see
--  "the system profiles" in server/server.py.
--
--  Why they need rows in auth.users. profiles.id is a foreign key to
--  auth.users (on delete cascade), and the signup trigger is how a profile
--  row normally comes to exist. That relationship is the right one and is
--  kept: each system profile gets an auth.users row of its own, with a fixed
--  id, an address on a reserved domain that can never receive mail, no
--  password and a ban that never lifts — so the foreign key holds, the
--  cascade still works, and there is still no door to sign in through.
-- ============================================================


-- ------------------------------------------------------------
--  1. The flag
--
--     One boolean on profiles, false for every real account, and the only
--     thing in the database that tells a system profile from a person. The
--     browser may read it (the table-level SELECT grant in supabase-setup.sql
--     covers every column, this one included) and cannot write it (the UPDATE
--     grant there is per column and does not name it). The page does not
--     select it — nothing on the leaderboard or the Social page shows account
--     metadata, and a flag nobody displays is a flag nobody has to hide.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists is_bot boolean not null default false;


-- ------------------------------------------------------------
--  2. Their numbers do not move
--
--     No ranked game can involve one (nothing can sign in as one), so nothing
--     that rates a game will ever reach these rows. This trigger is for the
--     other ways a rating changes: a bulk `update profiles set rating = …`
--     like the one supabase-migrate-tiers.sql mentions, a recalculation, a
--     hand edit. On a system profile the name, the rating and the flag keep
--     their old values, quietly, so a statement written for everybody still
--     runs for everybody and simply leaves these twenty-one where they are.
--
--     The one exception is this file re-asserting them, which sets a
--     transaction-local flag the trigger honours. It is local to the
--     transaction, so nothing outside this script can leave it switched on.
-- ------------------------------------------------------------
create or replace function public.keep_system_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_bot
     and coalesce(current_setting('nox.seeding_system_profiles', true), '') <> 'on'
  then
    new.display_name := old.display_name;
    new.rating       := old.rating;
    new.is_bot       := old.is_bot;
  end if;
  return new;
end;
$$;

drop trigger if exists system_profiles_keep_their_place on public.profiles;
create trigger system_profiles_keep_their_place
  before update on public.profiles
  for each row execute function public.keep_system_profile();


-- ------------------------------------------------------------
--  3. They make no friends and ask for none
--
--     A friend request TO one is allowed on purpose: the Social page behaves
--     exactly as it does for anybody, the request is sent, and it sits there
--     unanswered — there is nobody to answer it. What can never happen is a
--     friendship row with a system profile in it, by any door: not by
--     accept_friend_request(), not by a hand insert, not by a future policy.
--     And a request FROM one can never be made, which closes the other
--     direction. Both are triggers rather than policies because a policy
--     binds only the browser's roles, and a guarantee about a table is worth
--     making at the table.
-- ------------------------------------------------------------
create or replace function public.refuse_system_profile_friendship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.profiles p
     where p.id in (new.user_low, new.user_high) and p.is_bot
  ) then
    raise exception 'system profiles do not make friends'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists system_profiles_make_no_friends on public.friendships;
create trigger system_profiles_make_no_friends
  before insert or update on public.friendships
  for each row execute function public.refuse_system_profile_friendship();

create or replace function public.refuse_system_profile_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.sender and p.is_bot) then
    raise exception 'system profiles do not send friend requests'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists system_profiles_ask_nobody on public.friend_requests;
create trigger system_profiles_ask_nobody
  before insert or update on public.friend_requests
  for each row execute function public.refuse_system_profile_request();


-- ------------------------------------------------------------
--  4. The twenty-one
--
--     Ids are fixed rather than generated, which is the whole of the
--     duplicate protection: the same name always has the same id, so running
--     this twice finds its own rows and updates them instead of making more.
--     (They are UUIDv5 of the name under one namespace; nothing reads them as
--     anything but ids.)
--
--     The auth.users row is inserted only when missing and never touched
--     again. The profile is upserted: the signup trigger will already have
--     made a placeholder for a new user, and on a second run the row is
--     simply re-asserted — same name, same rating, still flagged.
-- ------------------------------------------------------------
do $$
declare
  who record;
begin
  -- Local to this transaction: the guard in §2 stands down for these writes
  -- and for nothing else.
  perform set_config('nox.seeding_system_profiles', 'on', true);

  for who in
    select * from (values
      ('a0319957-cef8-50b8-b118-20bd1a8f4f3b'::uuid, 'Arvenko',         2854),
      ('3774ae12-1c12-524b-8e8a-2ee4a79c704c'::uuid, 'LeoFromPrague',   2832),
      ('3ae0709b-3bda-57c7-b519-4e0f94686728'::uuid, 'novaendgame',     2814),
      ('b017bb23-a227-5642-bf80-34c313881b50'::uuid, 'Kasper21',        2809),
      ('b6f90315-bf25-5ec5-ab03-1c32c6269390'::uuid, 'tomasik_',        2801),
      ('6e9f0cc9-a219-52a2-9f9c-08d05579dff9'::uuid, 'MarekZed',        2793),
      ('2988c553-d378-57b0-add1-eea6ada3f6a4'::uuid, 'Noah_Vortex',     2788),
      ('52fcb2ba-b20c-56c5-95e9-ffb896e9e815'::uuid, 'Cedro',           2765),
      ('d55c1490-7412-5e25-9c12-cd23c40001d8'::uuid, 'ivanorbit',       2754),
      ('36908b7d-478f-5c8b-b70d-4d6c6c5cc01d'::uuid, 'Velmor',          2742),
      ('7e360f76-a02f-5b9b-995a-b602e73a688a'::uuid, 'chessnori',       2733),
      ('dae3c7db-af85-5ac1-8f8b-f136eda8010a'::uuid, 'Luca_Mirnov',     2711),
      ('1a545816-6924-5615-8779-29a53c9a8a75'::uuid, 'CedricChessLab',  2705),
      ('37058b10-fbb8-5d39-9ba9-70252e2b665b'::uuid, 'Artem_Koslov',    2694),
      ('216b65f3-58f3-517d-917f-e0e5c1cf5ebc'::uuid, 'NemoPlays',       2655),
      ('4e80d001-68dc-54c2-89ff-4757bf42d079'::uuid, 'Milo_Anders',     2623),
      ('97f5bd52-8973-5ec5-8afe-e7142a3d0009'::uuid, 'Kasper_Nova',     2611),
      ('fe01ded9-ea13-52c1-a38a-e54307c2c778'::uuid, 'tacticalmango',   2596),
      ('21f8d325-76e9-514c-8bf6-9b8101e2a9a6'::uuid, 'justleon',        2569),
      ('f40dfc82-869a-5780-9410-b7ea01021b1b'::uuid, 'Nash_B',          2493),
      ('45ac1539-c5aa-515d-ad09-3ed4a8f7708e'::uuid, 'fiftyfourthmove', 2478)
    ) as t(id, name, rating)
  loop
    -- An account with every way in closed:
    --   · the address is on .invalid, a domain reserved never to resolve, so
    --     no magic link or reset mail can ever arrive anywhere
    --   · no password hash, so there is nothing a password could match
    --   · banned until the year 3000, which GoTrue refuses to issue a token
    --     across — belt and braces over the two above
    --   · app_metadata carries the flag, and app_metadata is the half of the
    --     metadata a user cannot write, so if a token for one of these ever
    --     did exist it would say what it is and the server would refuse it
    -- The four token columns are '' rather than left null: GoTrue reads them
    -- into plain strings and a null there breaks listing users in the
    -- dashboard, which is a known sharp edge of seeding this table by hand.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      banned_until
    ) values (
      '00000000-0000-0000-0000-000000000000', who.id, 'authenticated', 'authenticated',
      lower(who.name) || '@system.noxchess.invalid', null, now(),
      jsonb_build_object('provider', 'system', 'providers', jsonb_build_array('system'), 'is_bot', true),
      jsonb_build_object('game_name', who.name),
      now(), now(),
      '', '', '', '',
      '3000-01-01 00:00:00+00'
    )
    on conflict (id) do nothing;

    insert into public.profiles (id, display_name, rating, is_bot)
    values (who.id, who.name, who.rating, true)
    on conflict (id) do update
      set display_name = excluded.display_name,
          rating       = excluded.rating,
          is_bot       = true;
  end loop;
end $$;


-- ------------------------------------------------------------
--  Check it worked. Paste these into a new query and run them on their own.
--
--    -- twenty-one rows, Arvenko first at 2854, fiftyfourthmove last at 2478
--    select display_name, rating, tier
--      from public.profiles where is_bot order by rating desc;
--
--    -- they cannot sign in: no password, banned, and flagged in app_metadata
--    select email, encrypted_password is null as no_password, banned_until,
--           raw_app_meta_data ->> 'is_bot' as flagged
--      from auth.users where raw_app_meta_data ->> 'is_bot' = 'true';
--
--    -- the guard: this changes nothing, and reports 2854 afterwards
--    update public.profiles set rating = 100
--     where display_name = 'Arvenko';
--    select rating from public.profiles where display_name = 'Arvenko';
--
--    -- the browser still cannot write the flag (expect false)
--    select has_column_privilege('authenticated', 'public.profiles', 'is_bot', 'update');
-- ------------------------------------------------------------
