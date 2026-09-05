-- ============================================================
--  NOX CHESS — migration: a rating for each of the other three visions
--
--  Run once, by hand, in the Supabase SQL editor — SQL Editor → New query →
--  paste → Run — after supabase-setup.sql, supabase-social.sql and
--  supabase-system-profiles.sql. Running it again is harmless: every statement
--  either does nothing the second time or re-asserts exactly what it made the
--  first time, and no rating that has started to move is ever put back.
--
--  WHAT THIS ADDS
--
--    · three columns on public.profiles, one per vision that had no rating of
--      its own until now:
--
--          complete_blindfold_rating    Complete Blindfold   (G.mode 'total')
--          board_only_rating            Board Only           (G.mode 'blind')
--          fog_of_war_rating            Fog of War           (G.mode 'fog')
--
--      `rating` is untouched and stays what it has always been: the Sighted
--      ladder. The three are shaped exactly like it — integer, not null,
--      default 100, everybody starts at the foot and climbs — and are
--      server-owned exactly like it: the browser may read them and never
--      write them (section 2).
--
--    · the sixty places on the three ladders the home page used to carry as
--      a fixture in blind-chess.html, copied out here name for name and
--      number for number, so the ladders a player sees the day after this
--      runs are the ladders they saw the day before, and only then begin to
--      move. Forty of those sixty places belong to twenty of the system
--      profiles that already exist; the other twenty places belong to
--      twenty names that had no account at all. Those twenty are created
--      here as system profiles, on the same terms as the twenty-one in
--      supabase-system-profiles.sql (section 3), and every one of them is
--      announced with a NOTICE as it is made, so nothing about this file's
--      guesswork is quiet. A seeded name that is neither an existing profile
--      nor one of the twenty this file may create is reported and skipped,
--      never invented.
--
--    · public.rated_games and public.record_rated_game(): the one door
--      through which any of the four ratings moves as the result of a game.
--      It moves the column of the vision that was played and no other, by a
--      flat four points to the winner and four from the loser, nothing on a
--      draw, and it moves them once per game id whatever asks twice
--      (section 5). Only the server's secret key may call it.
--
--  WHAT THIS NEVER TOUCHES
--
--    No existing row, column or table is dropped, renamed, emptied or
--    rewritten. There is no delete, truncate, drop table or drop column
--    anywhere in this file. Nobody's `rating` changes. No human account is
--    written at all: the seed writes only rows flagged is_bot, and creates
--    only the twenty names listed in section 3 under ids fixed in this file.
--    auth.users is inserted into for those twenty and nothing else, exactly
--    as supabase-system-profiles.sql already does for its twenty-one.
--
--  Wrapped in a transaction, so a failure anywhere leaves the database
--  exactly as it was.
-- ============================================================

begin;


-- ------------------------------------------------------------
--  1. The three columns
--
--     `integer not null default 100`, character for character the shape of
--     `rating` in supabase-setup.sql. A default rather than NULL because that
--     is the arrangement the Sighted ladder already has: a new account stands
--     at the foot of every ladder from its first day, and there is no such
--     thing as a player who is "unrated" in one vision and rated in another.
--     The page turns each of the four into a badge through the one TIERS
--     ladder, so a number is what it needs from every column.
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists complete_blindfold_rating integer not null default 100;
alter table public.profiles
  add column if not exists board_only_rating integer not null default 100;
alter table public.profiles
  add column if not exists fog_of_war_rating integer not null default 100;


-- ------------------------------------------------------------
--  2. THE IMPORTANT BIT: none of the four is the player's to set
--
--     supabase-setup.sql revoked blanket UPDATE on profiles and granted back
--     exactly two columns, and supabase-migrate-puzzles.sql restated the
--     same three lines when it added puzzle_rating. This restates them again
--     for the same reason: a column added later stays closed to the browser
--     only because the blanket UPDATE was already revoked, and on a project
--     where it was not, section 1 would have just made three ratings
--     writable by every signed-in browser. These three lines are
--     character-for-character the three at the bottom of supabase-setup.sql,
--     so on a database where that file was run and profiles has not been
--     re-granted since, they change nothing at all.
--
--     THE ONE SIDE EFFECT is the one the puzzles file warns about: if you
--     have granted `authenticated` UPDATE on any other profiles column since
--     running the setup file, this revoke drops that grant and you will want
--     to add it back.
-- ------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant  update (display_name, avatar_url) on public.profiles to authenticated;
grant  select on public.profiles to authenticated, anon;


-- ------------------------------------------------------------
--  3. Twenty more system profiles
--
--     The three fixture ladders name forty different players. Twenty of them
--     are system profiles already (supabase-system-profiles.sql); these are
--     the other twenty, which had no account of any kind. They are made on
--     exactly the terms that file makes its twenty-one — read the comment
--     above its section 4 for why each of these columns is what it is:
--
--       · a fixed id, so running this file twice finds its own rows and
--         makes nothing twice. UUIDv5 of the lower-cased name under the URL
--         namespace, as https://system.noxchess.invalid/profile/<name>;
--         nothing reads them as anything but ids.
--       · an address on .invalid, no password, a ban until the year 3000,
--         and is_bot in app_metadata — an account nobody can sign in as.
--       · the auth row inserted only when missing and never touched again;
--         the profile upserted, so the signup trigger's placeholder row is
--         overwritten with the name and the flag.
--
--     They start on the Sighted ladder at the default of 100, which is where
--     any new account starts and well below its top twenty; nothing here
--     invents a Sighted rating for anybody.
--
--     supabase-system-profiles.sql installs a trigger that keeps a system
--     profile's name, rating and flag from changing unless
--     nox.seeding_system_profiles is on for the transaction. It is switched
--     on here, transaction-locally, for the same reason that file switches
--     it on: this is the file that is allowed to say what these rows are.
-- ------------------------------------------------------------
do $$
declare
  who record;
begin
  perform set_config('nox.seeding_system_profiles', 'on', true);

  for who in
    select * from (values
      ('fbd46dc0-e308-5960-8cd1-8fa28839f359'::uuid, 'RivenCross'),
      ('88ea15dc-fd59-5a4d-b160-a0cf0f61d705'::uuid, 'ElianVoss'),
      ('fa2cb9b2-74f2-5127-9b5d-af189d98b190'::uuid, 'OrionVale'),
      ('64b83ed4-41e8-5fcb-8da5-9667d5804c1d'::uuid, 'MaxenRook'),
      ('93c7ee13-19cd-5de3-b4b5-097f8d6a68ff'::uuid, 'SorenKnight'),
      ('22d43453-efcd-5330-90a6-89208b245194'::uuid, 'nova_ember'),
      ('301b55ed-653a-5e10-85d5-168713daa657'::uuid, 'FelixArden'),
      ('6b265a1d-9023-5f73-900e-c7f22d2a7bcb'::uuid, 'rookzero'),
      ('7cd3b8ac-8df8-513a-bde0-af62692c5fb4'::uuid, 'LevinCore'),
      ('4532e550-195b-537b-aaee-26775357c27a'::uuid, 'ViktorEndgame'),
      ('722a7517-7c0d-57b2-a230-29c1805d4a9e'::uuid, 'Leonid64'),
      ('bda8ff1e-88f7-5b53-98f1-bea1d32734de'::uuid, 'DorianVale'),
      ('fc17f42d-3ffe-5c9d-ba87-e78051c762e0'::uuid, 'KaiVektor'),
      ('089144a5-0699-51c7-a22b-08b80e286056'::uuid, 'RookHarbor'),
      ('861327fe-caf8-5e78-a733-647819c2bbd5'::uuid, 'MilanCore'),
      ('83873e59-8c6e-5460-9f11-0908c228d903'::uuid, 'TheoDrift'),
      ('4f0a5486-f2be-5d45-aa30-7d24554f1aa2'::uuid, 'NovaRook'),
      ('29e3b758-cd7d-5dda-8a4e-f290ca50643b'::uuid, 'Varek_17'),
      ('102a5583-ca35-55b6-aba8-1f6db276e6ac'::uuid, 'LennoxFile'),
      ('9dadb47d-2831-59a9-b075-9b5aad7e36c3'::uuid, 'ArloKnight')
    ) as t(id, name)
  loop
    -- A name somebody already holds — a human who signed up under it since
    -- this file was written, or a system profile — is theirs. The seed in
    -- section 4 will find that row by name; this one is not made.
    if exists (select 1 from public.profiles p where lower(p.display_name) = lower(who.name)) then
      raise notice 'system profile %: a profile of that name already exists, so none is created', who.name;
      continue;
    end if;

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

    insert into public.profiles (id, display_name, is_bot)
    values (who.id, who.name, true)
    on conflict (id) do update
      set display_name = excluded.display_name,
          is_bot       = true;

    raise notice 'system profile %: created as % (no profile of that name existed)', who.name, who.id;
  end loop;
end $$;


-- ------------------------------------------------------------
--  4. The sixty places, seeded once
--
--     The fixture, verbatim: the three ladders as blind-chess.html carried
--     them, in the order it carried them. The one edit is that the Fog of
--     War table listed Kasper21 twice, at 2673 and at 2501; the page kept
--     the higher standing when it drew the ladder, and so does this file.
--
--     Every place is matched to a profile BY NAME, case-insensitively, which
--     is the sense in which supabase-migrate-usernames.sql says two names are
--     the same name. A place whose name matches no profile — which after
--     section 3 can only mean a name this file was never given an id for —
--     is reported and skipped, never made up.
--
--     A place is written ONCE. public.rating_seeds records each
--     (vision, profile) this file has seeded, and a row already recorded is
--     left exactly where it stands: a ladder that has started to move is
--     never put back to the fixture by somebody running this file again.
--     That is a table rather than a "still at the default" test because a
--     rating that has moved can in principle come back to 100, and a rule
--     that is exact costs three lines.
--
--     Only rows flagged is_bot are written, so a human who happens to share
--     a fixture name is reported and left alone.
-- ------------------------------------------------------------
create table if not exists public.rating_seeds (
  mode        text not null check (mode in ('total', 'blind', 'fog')),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  seeded_at   timestamptz not null default now(),
  primary key (mode, profile_id)
);
alter table public.rating_seeds enable row level security;
-- no policies and no grants: only the SQL editor and the service role, which
-- bypass row-level security, ever read or write this

do $$
declare
  place record;
  who record;
  col text;
  seeded integer := 0;
  kept integer := 0;
  skipped integer := 0;
begin
  for place in
    select * from (values
      -- Complete Blindfold
      ('total', 'NemoPlays', 2501), ('total', 'Velmor', 2474), ('total', 'Kasper21', 2455),
      ('total', 'fiftyfourthmove', 2430), ('total', 'CedricChessLab', 2407), ('total', 'Noah_Vortex', 2386),
      ('total', 'tacticalmango', 2344), ('total', 'LeoFromPrague', 2268), ('total', 'Milo_Anders', 2253),
      ('total', 'Cedro', 2247), ('total', 'novaendgame', 2242), ('total', 'Nash_B', 2239),
      ('total', 'Luca_Mirnov', 2199), ('total', 'Arvenko', 2185), ('total', 'chessnori', 2180),
      ('total', 'tomasik_', 2175), ('total', 'Artem_Koslov', 2172), ('total', 'ivanorbit', 2144),
      ('total', 'justleon', 2143), ('total', 'MarekZed', 2140),
      -- Fog of War
      ('fog', 'Kasper21', 2673), ('fog', 'RivenCross', 2648), ('fog', 'tacticalmango', 2622),
      ('fog', 'ElianVoss', 2597), ('fog', 'Luca_Mirnov', 2574), ('fog', 'OrionVale', 2549),
      ('fog', 'Velmor', 2523), ('fog', 'MaxenRook', 2498), ('fog', 'justleon', 2471),
      ('fog', 'SorenKnight', 2446), ('fog', 'Cedro', 2421), ('fog', 'nova_ember', 2397),
      ('fog', 'Artem_Koslov', 2372), ('fog', 'FelixArden', 2348), ('fog', 'NemoPlays', 2324),
      ('fog', 'rookzero', 2299), ('fog', 'MarekZed', 2277), ('fog', 'LevinCore', 2254),
      ('fog', 'ViktorEndgame', 2847), ('fog', 'Leonid64', 2826),
      -- Board Only
      ('blind', 'Velmor', 2762), ('blind', 'DorianVale', 2744), ('blind', 'FelixArden', 2725),
      ('blind', 'KaiVektor', 2706), ('blind', 'RookHarbor', 2687), ('blind', 'Cedro', 2669),
      ('blind', 'MilanCore', 2650), ('blind', 'Kasper21', 2631), ('blind', 'TheoDrift', 2612),
      ('blind', 'chessnori', 2594), ('blind', 'ElianVoss', 2575), ('blind', 'NovaRook', 2556),
      ('blind', 'NemoPlays', 2537), ('blind', 'SorenKnight', 2519), ('blind', 'Varek_17', 2500),
      ('blind', 'MarekZed', 2481), ('blind', 'LennoxFile', 2462), ('blind', 'tacticalmango', 2444),
      ('blind', 'ArloKnight', 2423), ('blind', 'RivenCross', 2402)
    ) as t(mode, name, elo)
  loop
    select id, display_name, is_bot into who
      from public.profiles
     where lower(display_name) = lower(place.name)
     limit 1;

    if not found then
      raise notice 'NOT FOUND: % has no profile, so its % place (%) is skipped', place.name, place.mode, place.elo;
      skipped := skipped + 1;
      continue;
    end if;
    if not who.is_bot then
      raise notice 'NOT A SYSTEM PROFILE: % is a real account and is left alone (% place %)', who.display_name, place.mode, place.elo;
      skipped := skipped + 1;
      continue;
    end if;

    insert into public.rating_seeds (mode, profile_id)
    values (place.mode, who.id)
    on conflict (mode, profile_id) do nothing;
    if not found then
      kept := kept + 1;               -- seeded on an earlier run; wherever it stands now, it stays
      continue;
    end if;

    col := case place.mode
             when 'total' then 'complete_blindfold_rating'
             when 'blind' then 'board_only_rating'
             when 'fog'   then 'fog_of_war_rating'
           end;
    execute format('update public.profiles set %I = $1 where id = $2', col)
      using place.elo, who.id;
    seeded := seeded + 1;
  end loop;

  raise notice 'vision ladders: % places seeded, % already seeded and left alone, % skipped (see the notices above)',
    seeded, kept, skipped;
  if skipped > 0 then
    raise notice 'A skipped place means a fixture name with no system profile; nothing was invented for it.';
  end if;
end $$;


-- ------------------------------------------------------------
--  5. record_rated_game: the one door through which a rating moves
--
--     A rated game between two accounts, priced here rather than by the
--     caller. The server hands over the game's id, the vision it was played
--     in, both seats and the result; this decides which column that vision
--     is, moves that column and no other, and records the game.
--
--     The rule is flat and the same in all four visions: four points to the
--     winner, four from the loser, nothing on a draw. `p_points` is a
--     parameter rather than a constant so the rule can be tuned without a
--     second function, and it defaults to the rule.
--
--     ONCE. public.rated_games is keyed by the game's id, and the two rating
--     writes and the row that records them are one transaction: a second
--     call for the same id — the same server finishing a game twice, or two
--     server processes that each thought they owned it — finds the row and
--     answers with what was recorded, applied = false, having moved nothing.
--     Two such calls racing each other are settled by the primary key: the
--     loser's rating writes are rolled back with its failed insert and it,
--     too, answers applied = false. The winner cannot be paid twice.
--
--     Both profile rows are locked before they are read, lowest id first so
--     two games finishing at once for the same players cannot deadlock, and
--     the numbers written are read under that lock rather than trusted from
--     the caller — the rating a game started from is whatever the row said
--     when the game was settled.
--
--     supabase-system-profiles.sql keeps a system profile's `rating` from
--     changing unless nox.seeding_system_profiles is on for the transaction.
--     That guard exists for bulk edits and hand edits, and this is neither:
--     it is the rated game those rows were made to play, so the guard is
--     stood down for the length of this call. (That trigger only exists if
--     that file was run; switching a setting on is harmless without it.)
--     The other three columns are not guarded and need no such thing.
--
--     security definer, and executable by service_role alone: the browser
--     cannot reach it, which is what keeps every rating the server's.
-- ------------------------------------------------------------
create table if not exists public.rated_games (
  id            text primary key,
  mode          text not null check (mode in ('sighted', 'total', 'blind', 'fog')),
  white_id      uuid not null references public.profiles(id) on delete cascade,
  black_id      uuid not null references public.profiles(id) on delete cascade,
  result        text not null check (result in ('1-0', '0-1', '1/2-1/2')),
  white_before  integer not null,
  black_before  integer not null,
  white_after   integer not null,
  black_after   integer not null,
  recorded_at   timestamptz not null default now()
);
create index if not exists rated_games_by_player_white on public.rated_games (white_id, recorded_at desc);
create index if not exists rated_games_by_player_black on public.rated_games (black_id, recorded_at desc);
alter table public.rated_games enable row level security;
-- no policies and no grants: nothing in the browser reads a game record yet,
-- and the day something does, a select policy is the whole of what it needs

create or replace function public.record_rated_game(
  p_game    text,
  p_mode    text,
  p_white   uuid,
  p_black   uuid,
  p_result  text,
  p_points  integer default 4
)
returns table (
  applied        boolean,
  rating_column  text,
  white_before   integer,
  black_before   integer,
  white_after    integer,
  black_after    integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  col       text;
  seat      record;
  done      public.rated_games%rowtype;
  w_before  integer;
  b_before  integer;
  w_delta   integer := 0;
  b_delta   integer := 0;
begin
  if p_game is null or p_game = '' then
    raise exception 'a rated game needs an id';
  end if;
  if p_white is null or p_black is null or p_white = p_black then
    raise exception 'a rated game needs two different players';
  end if;

  col := case p_mode
           when 'sighted' then 'rating'
           when 'total'   then 'complete_blindfold_rating'
           when 'blind'   then 'board_only_rating'
           when 'fog'     then 'fog_of_war_rating'
         end;
  if col is null then
    raise exception 'unknown vision %', p_mode;
  end if;

  if p_result = '1-0' then
    w_delta :=  p_points; b_delta := -p_points;
  elsif p_result = '0-1' then
    w_delta := -p_points; b_delta :=  p_points;
  elsif p_result <> '1/2-1/2' then
    raise exception 'unknown result %', p_result;
  end if;

  -- Already settled: say what was recorded, and move nothing.
  select * into done from public.rated_games g where g.id = p_game;
  if found then
    return query select false, col, done.white_before, done.black_before,
                        done.white_after, done.black_after;
    return;
  end if;

  -- Both rows, locked in id order, and the column read under the lock.
  for seat in execute format(
    'select id, %I as held from public.profiles where id in ($1, $2) order by id for update', col
  ) using p_white, p_black
  loop
    if seat.id = p_white then w_before := seat.held; end if;
    if seat.id = p_black then b_before := seat.held; end if;
  end loop;
  if w_before is null or b_before is null then
    raise exception 'no profile row for one of the players (% / %)', p_white, p_black;
  end if;

  begin
    perform set_config('nox.seeding_system_profiles', 'on', true);
    execute format('update public.profiles set %I = $1 where id = $2', col)
      using w_before + w_delta, p_white;
    execute format('update public.profiles set %I = $1 where id = $2', col)
      using b_before + b_delta, p_black;
    insert into public.rated_games (
      id, mode, white_id, black_id, result,
      white_before, black_before, white_after, black_after
    ) values (
      p_game, p_mode, p_white, p_black, p_result,
      w_before, b_before, w_before + w_delta, b_before + b_delta
    );
  exception when unique_violation then
    -- Somebody recorded this very game between our first look and our
    -- insert. The two updates above are undone with this block; answer with
    -- what they recorded.
    select * into done from public.rated_games g where g.id = p_game;
    return query select false, col, done.white_before, done.black_before,
                        done.white_after, done.black_after;
    return;
  end;

  return query select true, col, w_before, b_before,
                      w_before + w_delta, b_before + b_delta;
end;
$$;

revoke all on function public.record_rated_game(text, text, uuid, uuid, text, integer) from public;
revoke all on function public.record_rated_game(text, text, uuid, uuid, text, integer) from anon, authenticated;
grant  execute on function public.record_rated_game(text, text, uuid, uuid, text, integer) to service_role;


commit;


-- ------------------------------------------------------------
--  Check it worked. Paste these into a new query and run them on their own;
--  none of them writes anything.
--
--    -- twenty on each ladder, all of them system profiles, highest first
--    select display_name, complete_blindfold_rating
--      from public.profiles order by complete_blindfold_rating desc, display_name limit 20;
--    select display_name, board_only_rating
--      from public.profiles order by board_only_rating desc, display_name limit 20;
--    select display_name, fog_of_war_rating
--      from public.profiles order by fog_of_war_rating desc, display_name limit 20;
--
--    -- sixty seeded places, and the Sighted ladder exactly as it was
--    select mode, count(*) from public.rating_seeds group by mode;
--    select display_name, rating from public.profiles order by rating desc limit 21;
--
--    -- the browser cannot write any of the four. Expect four rows of false.
--    select column_name,
--           has_column_privilege('authenticated', 'public.profiles', column_name, 'update')
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'profiles'
--       and column_name in ('rating', 'complete_blindfold_rating',
--                           'board_only_rating', 'fog_of_war_rating');
--
--    -- and cannot record a game (expect false, false; true for the server)
--    select has_function_privilege('anon',
--             'public.record_rated_game(text, text, uuid, uuid, text, integer)', 'execute'),
--           has_function_privilege('authenticated',
--             'public.record_rated_game(text, text, uuid, uuid, text, integer)', 'execute'),
--           has_function_privilege('service_role',
--             'public.record_rated_game(text, text, uuid, uuid, text, integer)', 'execute');
--
--    -- the rule, end to end, on two system profiles, undone afterwards:
--    -- fog moves by four each way, the other three columns do not move,
--    -- and the second call answers applied = false having moved nothing
--    begin;
--      select * from public.record_rated_game('probe-1', 'fog',
--        (select id from public.profiles where display_name = 'Kasper21'),
--        (select id from public.profiles where display_name = 'Velmor'), '1-0');
--      select * from public.record_rated_game('probe-1', 'fog',
--        (select id from public.profiles where display_name = 'Kasper21'),
--        (select id from public.profiles where display_name = 'Velmor'), '1-0');
--      select display_name, rating, complete_blindfold_rating, board_only_rating, fog_of_war_rating
--        from public.profiles where display_name in ('Kasper21', 'Velmor');
--    rollback;
-- ------------------------------------------------------------
