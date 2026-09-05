-- ============================================================
--  NOX CHESS — migration: the 24/7 ranked AI league
--
--  Run once, by hand, in the Supabase SQL editor, after supabase-setup.sql
--  and supabase-migrate-usernames.sql. Running it twice is harmless.
--
--  The server (server/league.py) keeps the highest-rated AI accounts playing
--  each other around the clock, one ladder per vision, and this file is
--  everything the database has to know for that:
--
--    · three more rating columns on profiles — one per vision that had no
--      rating of its own until now. `rating` stays the Sighted ladder, exactly
--      as it was; complete_blindfold_rating, board_only_rating and fog_of_war_rating are Complete
--      Blindfold, Board Only and Fog of War. They are server-owned like
--      `rating`: the browser may read them and never write them.
--    · the twenty players on each of the three page-fixture ladders, seeded
--      as bot accounts. Twenty of the names are bot profiles already; the
--      other twenty had no account at all and are created here, so that one
--      name means one player across every ladder and across the server.
--      From then on the league reads the top twenty of each ladder out of
--      these columns and never a list of its own.
--    · league_games — every AI game, live or finished, and the record that
--      lets a restarted server carry on rather than start over.
--    · league_seats — one row per (vision, player) while they are playing,
--      which is what makes "never in two games at once" a rule the database
--      enforces rather than one the server hopes to keep.
--    · league_start / league_finish / league_abandon — the three writes that
--      have to be all-or-nothing. league_finish is the one that moves
--      ratings, and it moves them exactly once per game whatever asks twice.
-- ============================================================

begin;

-- ------------------------------------------------------------
--  1. Ratings per vision, and the bot flag
--
--     Nullable on purpose: NULL is "unrated in this vision", which is what
--     every human account and most bots are. A ladder query filters on the
--     column being present, so nobody unrated turns up at 0.
--     is_bot exists on the live project already (the sighted bots carry it);
--     `if not exists` makes this file safe for a project that never had it.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists is_bot boolean not null default false;
alter table public.profiles add column if not exists complete_blindfold_rating integer;
alter table public.profiles add column if not exists board_only_rating integer;
alter table public.profiles add column if not exists fog_of_war_rating   integer;

-- The same rule supabase-setup.sql applies to `rating`: the browser writes
-- display_name and avatar_url and nothing else. The column grant is restated
-- rather than trusted, because `add column` widens nothing but a fresh grant
-- somewhere else might have.
revoke update on public.profiles from authenticated;
grant  update (display_name, avatar_url) on public.profiles to authenticated;
grant  select on public.profiles to authenticated, anon;

-- ------------------------------------------------------------
--  2. The players. The three ladders the page used to carry as a fixture,
--     copied out exactly — same names, same numbers — so the ladders a player
--     sees the day after this runs are the ladders they saw the day before,
--     and only then start to move.
--
--     A name already in profiles gets the column set on its row. A name with
--     no profile gets an account: a row in auth.users, so the profile's
--     foreign key holds, and then the profile itself. The id is a hash of the
--     name, so running this twice cannot make two of anybody. The auth row is
--     inserted with an empty password hash and a reserved-domain email, which
--     is an account nobody can sign in to — a bot is a name and a rating, not
--     a login. The insert is wrapped so that a project whose auth schema
--     refuses it (a column renamed in a later GoTrue) reports which name it
--     could not create and carries on with the rest.
-- ------------------------------------------------------------
do $$
declare
  seed record;
  bot_id uuid;
  existing uuid;
begin
  for seed in
    select * from (values
      -- Complete Blindfold
      ('total', 'NemoPlays', 2501), ('total', 'Velmor', 2474), ('total', 'Kasper21', 2455),
      ('total', 'fiftyfourthmove', 2430), ('total', 'CedricChessLab', 2407), ('total', 'Noah_Vortex', 2386),
      ('total', 'tacticalmango', 2344), ('total', 'LeoFromPrague', 2268), ('total', 'Milo_Anders', 2253),
      ('total', 'Cedro', 2247), ('total', 'novaendgame', 2242), ('total', 'Nash_B', 2239),
      ('total', 'Luca_Mirnov', 2199), ('total', 'Arvenko', 2185), ('total', 'chessnori', 2180),
      ('total', 'tomasik_', 2175), ('total', 'Artem_Koslov', 2172), ('total', 'ivanorbit', 2144),
      ('total', 'justleon', 2143), ('total', 'MarekZed', 2140),
      -- Fog of War (the fixture listed Kasper21 twice; the higher standing is the one kept)
      ('fog', 'ViktorEndgame', 2847), ('fog', 'Leonid64', 2826), ('fog', 'Kasper21', 2673),
      ('fog', 'RivenCross', 2648), ('fog', 'tacticalmango', 2622), ('fog', 'ElianVoss', 2597),
      ('fog', 'Luca_Mirnov', 2574), ('fog', 'OrionVale', 2549), ('fog', 'Velmor', 2523),
      ('fog', 'MaxenRook', 2498), ('fog', 'justleon', 2471), ('fog', 'SorenKnight', 2446),
      ('fog', 'Cedro', 2421), ('fog', 'nova_ember', 2397), ('fog', 'Artem_Koslov', 2372),
      ('fog', 'FelixArden', 2348), ('fog', 'NemoPlays', 2324), ('fog', 'rookzero', 2299),
      ('fog', 'MarekZed', 2277), ('fog', 'LevinCore', 2254),
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
    select id into existing from public.profiles where lower(display_name) = lower(seed.name) limit 1;
    if existing is null then
      bot_id := md5('nox-bot:' || lower(seed.name))::uuid;
      begin
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, recovery_token, email_change, email_change_token_new
        ) values (
          '00000000-0000-0000-0000-000000000000', bot_id, 'authenticated', 'authenticated',
          lower(seed.name) || '@bots.noxchess.invalid', '', now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
          '', '', '', ''
        ) on conflict (id) do nothing;
      exception when others then
        raise notice 'could not create an auth row for bot %: % — inserting the profile on its own', seed.name, sqlerrm;
      end;
      -- handle_new_user() may already have made the placeholder row; either
      -- way this leaves one row wearing the seeded name.
      insert into public.profiles (id, display_name, is_bot, rating)
      values (bot_id, seed.name, true, 100)
      on conflict (id) do update set display_name = excluded.display_name, is_bot = true;
      existing := bot_id;
    end if;

    -- Only where the column is still empty: a ladder that has started moving
    -- must not be reset to the fixture by somebody running this file again.
    if seed.mode = 'total' then
      update public.profiles set complete_blindfold_rating = seed.elo, is_bot = true
       where id = existing and complete_blindfold_rating is null;
    elsif seed.mode = 'blind' then
      update public.profiles set board_only_rating = seed.elo, is_bot = true
       where id = existing and board_only_rating is null;
    elsif seed.mode = 'fog' then
      update public.profiles set fog_of_war_rating = seed.elo, is_bot = true
       where id = existing and fog_of_war_rating is null;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
--  3. The games
--
--     One row per game from the moment it is arranged. `moves` is the whole
--     game in UCI and `fen` the position it has reached, so a server that
--     starts up over a live row has everything it needs to sit back down at
--     the board; `sans` is the same moves as written, which is what the
--     Complete Blindfold card shows and what the PGN is built from.
--
--     The clocks are stored as what each side had left when the last move was
--     played, with the moment it was played beside them: the side to move is
--     charged from then, so nothing has to write a row every second.
--
--     `owner` and `lease_until` are how two server processes — a deploy
--     overlapping the instance it replaces — avoid both driving one game.
--     A move is written only by the owner and only at the ply it expects,
--     so the second process to try loses cleanly rather than doubling a move.
-- ------------------------------------------------------------
create table if not exists public.league_games (
  id                uuid primary key default gen_random_uuid(),
  mode              text not null check (mode in ('sighted', 'total', 'blind', 'fog')),
  white_id          uuid not null references public.profiles(id),
  black_id          uuid not null references public.profiles(id),
  white_name        text not null,
  black_name        text not null,
  white_elo_before  integer not null,
  black_elo_before  integer not null,
  white_elo_after   integer,
  black_elo_after   integer,
  status            text not null default 'live' check (status in ('live', 'finished', 'abandoned')),
  result            text check (result in ('1-0', '0-1', '1/2-1/2')),
  winner_id         uuid references public.profiles(id),
  termination       text,
  moves             text not null default '',
  sans              text not null default '',
  fen               text not null,
  ply               integer not null default 0,
  white_ms          integer not null,
  black_ms          integer not null,
  last_move_at      timestamptz not null default now(),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  pgn               text,
  owner             text,
  lease_until       timestamptz
);

create index if not exists league_games_mode_status on public.league_games (mode, status);
create index if not exists league_games_finished on public.league_games (mode, finished_at desc)
  where status = 'finished';

-- Live games are public: they are what the home page shows, and a finished
-- one is a record anybody may read. Nothing but the service role writes.
alter table public.league_games enable row level security;
drop policy if exists "league games are readable by everyone" on public.league_games;
create policy "league games are readable by everyone"
  on public.league_games for select
  to authenticated, anon
  using (true);
grant select on public.league_games to anon, authenticated;

-- ------------------------------------------------------------
--  4. Who is at a board right now
--
--     The primary key is the rule: a player has one seat per vision, whichever
--     colour they hold. Two games in one vision cannot both seat them, because
--     the second insert is a duplicate key. Rows live exactly as long as the
--     game does — league_finish and league_abandon delete them.
-- ------------------------------------------------------------
create table if not exists public.league_seats (
  mode        text not null,
  player_id   uuid not null references public.profiles(id),
  game_id     uuid not null references public.league_games(id) on delete cascade,
  primary key (mode, player_id)
);
alter table public.league_seats enable row level security;
-- no policies: only the service role, which bypasses them, reads or writes this

-- ------------------------------------------------------------
--  5. league_start: a game and both seats, or nothing
--
--     Returns the new game's id. A player already seated in this vision makes
--     the seat insert fail, the transaction roll back, and the caller hear an
--     error — which is the answer "no", and a better one than a game that
--     seats somebody twice.
-- ------------------------------------------------------------
create or replace function public.league_start(
  p_mode text, p_white uuid, p_black uuid, p_white_name text, p_black_name text,
  p_white_elo integer, p_black_elo integer, p_fen text, p_ms integer, p_owner text,
  p_lease_seconds integer default 90
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
begin
  if p_white = p_black then
    raise exception 'a player cannot be seated against themselves';
  end if;
  insert into public.league_games (
    mode, white_id, black_id, white_name, black_name, white_elo_before, black_elo_before,
    fen, white_ms, black_ms, owner, lease_until
  ) values (
    p_mode, p_white, p_black, p_white_name, p_black_name, p_white_elo, p_black_elo,
    p_fen, p_ms, p_ms, p_owner, now() + make_interval(secs => p_lease_seconds)
  ) returning id into gid;
  insert into public.league_seats (mode, player_id, game_id) values
    (p_mode, p_white, gid), (p_mode, p_black, gid);
  return gid;
end;
$$;

-- ------------------------------------------------------------
--  6. league_finish: the result, the ratings, the seats — once
--
--     The update is guarded on status = 'live'. A second caller — the same
--     server finishing twice, or a second server that thought it owned the
--     game — matches no row, gets no row back, and moves no rating: the
--     winner cannot be paid twice. Ratings move by a flat four points, in the
--     column of the vision that was played and in no other; a draw moves
--     nothing. Returns the before-and-after numbers for the log.
-- ------------------------------------------------------------
create or replace function public.league_finish(
  p_game uuid, p_result text, p_winner uuid, p_termination text,
  p_moves text, p_sans text, p_fen text, p_ply integer, p_pgn text,
  p_white_ms integer, p_black_ms integer, p_points integer default 4
)
returns table (
  white_id uuid, black_id uuid, white_before integer, black_before integer,
  white_after integer, black_after integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.league_games%rowtype;
  col text;
  w_before integer;
  b_before integer;
  w_delta integer := 0;
  b_delta integer := 0;
begin
  update public.league_games
     set status = 'finished', result = p_result, winner_id = p_winner,
         termination = p_termination, moves = p_moves, sans = p_sans, fen = p_fen,
         ply = p_ply, pgn = p_pgn, white_ms = p_white_ms, black_ms = p_black_ms,
         finished_at = now(), owner = null, lease_until = null
   where id = p_game and status = 'live'
   returning * into g;
  if g.id is null then
    return;                         -- already settled by somebody: nothing to do, twice
  end if;

  col := case g.mode
           when 'sighted' then 'rating'
           when 'total'   then 'complete_blindfold_rating'
           when 'blind'   then 'board_only_rating'
           when 'fog'     then 'fog_of_war_rating'
         end;
  execute format('select %I from public.profiles where id = $1', col) into w_before using g.white_id;
  execute format('select %I from public.profiles where id = $1', col) into b_before using g.black_id;
  w_before := coalesce(w_before, g.white_elo_before);
  b_before := coalesce(b_before, g.black_elo_before);

  if p_result = '1-0' then
    w_delta := p_points; b_delta := -p_points;
  elsif p_result = '0-1' then
    w_delta := -p_points; b_delta := p_points;
  end if;

  execute format('update public.profiles set %I = $1 where id = $2', col)
    using w_before + w_delta, g.white_id;
  execute format('update public.profiles set %I = $1 where id = $2', col)
    using b_before + b_delta, g.black_id;
  update public.league_games
     set white_elo_before = w_before, black_elo_before = b_before,
         white_elo_after = w_before + w_delta, black_elo_after = b_before + b_delta
   where id = p_game;
  delete from public.league_seats where game_id = p_game;

  return query select g.white_id, g.black_id, w_before, b_before,
                      w_before + w_delta, b_before + b_delta;
end;
$$;

-- ------------------------------------------------------------
--  7. league_abandon: a live game nobody can carry on with
--
--     A row whose moves no longer replay, or that a server found it could
--     not resume. No result, no rating change, seats freed. Guarded the same
--     way as finish, so it cannot un-finish a settled game.
-- ------------------------------------------------------------
create or replace function public.league_abandon(p_game uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.league_games
     set status = 'abandoned', termination = p_reason, finished_at = now(),
         owner = null, lease_until = null
   where id = p_game and status = 'live';
  get diagnostics n = row_count;
  delete from public.league_seats where game_id = p_game;
  return n > 0;
end;
$$;

-- Only the server's key may call any of the three.
revoke all on function public.league_start(text, uuid, uuid, text, text, integer, integer, text, integer, text, integer) from public;
revoke all on function public.league_finish(uuid, text, uuid, text, text, text, text, integer, text, integer, integer, integer) from public;
revoke all on function public.league_abandon(uuid, text) from public;
grant execute on function public.league_start(text, uuid, uuid, text, text, integer, integer, text, integer, text, integer) to service_role;
grant execute on function public.league_finish(uuid, text, uuid, text, text, text, text, integer, text, integer, integer, integer) to service_role;
grant execute on function public.league_abandon(uuid, text) to service_role;

commit;

-- ------------------------------------------------------------
--  Check it worked. Each on its own; none of them writes anything.
--
--    -- twenty on each of the three new ladders, every one a bot
--    select count(*) filter (where complete_blindfold_rating is not null) as total,
--           count(*) filter (where board_only_rating is not null) as blind,
--           count(*) filter (where fog_of_war_rating   is not null) as fog
--      from public.profiles where is_bot;
--
--    -- the browser still cannot write any rating. Expect four rows of false.
--    select column_name, has_column_privilege('authenticated', 'public.profiles', column_name, 'update')
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'profiles'
--       and column_name in ('rating', 'complete_blindfold_rating', 'board_only_rating', 'fog_of_war_rating');
--
--    -- nothing is live yet; the server fills this the moment it starts
--    select mode, status, count(*) from public.league_games group by 1, 2;
-- ------------------------------------------------------------
