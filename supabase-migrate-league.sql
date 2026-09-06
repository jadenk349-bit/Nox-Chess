-- ============================================================
--  NOX CHESS — migration: the 24/7 ranked AI league
--
--  Run once, by hand, in the Supabase SQL editor, AFTER supabase-migrate-visions.sql.
--  Running it twice is harmless. The order of the hand-run files is:
--
--    1. supabase-setup.sql
--    2. supabase-social.sql
--    3. supabase-migrate-usernames.sql
--    4. supabase-migrate-puzzles.sql
--    5. supabase-system-profiles.sql       the twenty-one AI accounts
--    6. supabase-migrate-visions.sql       the four rating columns, twenty more
--                                          AI accounts, record_rated_game()
--    7. supabase-migrate-league.sql        this file
--
--  This file owns NO rating. The four columns the ladders and the league
--  read — rating, complete_blindfold_rating, board_only_rating and
--  fog_of_war_rating — are the visions file's, and the one thing that moves
--  any of them is record_rated_game() from that same file: four points to
--  the winner and four from the loser in the column of the vision played,
--  nothing on a draw, once per game id. league_finish() below calls it and
--  adds nothing to the rule. Nor does this file seed a player: the league's
--  players are whoever the ladders already rank, read at run time.
--
--  What it adds is the league's memory — what the server needs so that a
--  restart, a redeploy or a crash resumes the games in progress rather than
--  starting over, and so that two server processes can never both play one:
--
--    · league_games — every AI game, live or finished: both accounts by id,
--      the moves, the position, the clocks, the result and how it came, the
--      ratings before and after, a PGN, and the lease that says which server
--      process is playing it.
--    · league_seats — one row per (vision, account) while they are at a
--      board. The primary key is the rule "never in two games at once in one
--      vision", enforced by the database rather than hoped for by the server.
--    · league_start / league_finish / league_abandon — the three writes that
--      must be all-or-nothing.
-- ============================================================

begin;

-- ------------------------------------------------------------
--  0. Refuse to run before the visions file
--
--     Everything below reads the vision columns and calls record_rated_game().
--     Without them the functions would compile and fail at the first game,
--     which is a worse place to find out than here.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name in ('complete_blindfold_rating', 'board_only_rating', 'fog_of_war_rating')
    having count(*) = 3
  ) then
    raise exception 'run supabase-migrate-visions.sql first: the vision rating columns are missing';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'record_rated_game'
  ) then
    raise exception 'run supabase-migrate-visions.sql first: record_rated_game() is missing';
  end if;
end $$;

-- ------------------------------------------------------------
--  1. The games
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
--
--     white_elo_before/after and black_elo_before/after are copied from what
--     record_rated_game() reports when the game is settled, so the row reads
--     on its own; rated_games (the visions file) remains the record of the
--     rating change itself.
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
--  2. Who is at a board right now
--
--     The primary key is the rule: an account has one seat per vision,
--     whichever colour it holds. Two games in one vision cannot both seat it,
--     because the second insert is a duplicate key. Rows live exactly as long
--     as the game does — league_finish and league_abandon delete them.
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
--  3. league_start: a game and both seats, or nothing
--
--     Returns the new game's id. Both accounts must be system profiles
--     (is_bot): the league never seats a person, and the database says so
--     as well as the server. A player already seated in this vision makes
--     the seat insert fail, the transaction roll back, and the caller hear
--     an error — which is the answer "no", and a better one than a game
--     that seats somebody twice.
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
  if p_mode not in ('sighted', 'total', 'blind', 'fog') then
    raise exception 'unknown vision %', p_mode;
  end if;
  if (select count(*) from public.profiles where id in (p_white, p_black) and is_bot) <> 2 then
    raise exception 'the league seats system profiles only';
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
--  4. league_finish: the result, the ratings, the seats — once
--
--     The update is guarded on status = 'live'. A second caller — the same
--     server finishing twice, or a second server that thought it owned the
--     game — matches no row, gets no row back, and moves no rating: the
--     winner cannot be paid twice. The ratings move through
--     record_rated_game(), keyed by this game's id, which is its own guard
--     against the same thing and the only place the rule (+4 / -4 / 0, in
--     the vision's own column) is written. Returns the before-and-after
--     numbers it reported, for the log and for the row.
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
  r record;
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

  select * into r
    from public.record_rated_game(g.id::text, g.mode, g.white_id, g.black_id, p_result, p_points);

  update public.league_games
     set white_elo_before = r.white_before, black_elo_before = r.black_before,
         white_elo_after = r.white_after, black_elo_after = r.black_after
   where id = p_game;
  delete from public.league_seats where game_id = p_game;

  return query select g.white_id, g.black_id, r.white_before, r.black_before,
                      r.white_after, r.black_after;
end;
$$;

-- ------------------------------------------------------------
--  5. league_abandon: a live game nobody can carry on with
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
revoke all on function public.league_start(text, uuid, uuid, text, text, integer, integer, text, integer, text, integer) from anon, authenticated;
revoke all on function public.league_finish(uuid, text, uuid, text, text, text, text, integer, text, integer, integer, integer) from anon, authenticated;
revoke all on function public.league_abandon(uuid, text) from anon, authenticated;
grant execute on function public.league_start(text, uuid, uuid, text, text, integer, integer, text, integer, text, integer) to service_role;
grant execute on function public.league_finish(uuid, text, uuid, text, text, text, text, integer, text, integer, integer, integer) to service_role;
grant execute on function public.league_abandon(uuid, text) to service_role;

commit;

-- ------------------------------------------------------------
--  Check it worked. Each on its own; none of them writes anything.
--
--    -- the two tables exist and are empty until the server starts
--    select mode, status, count(*) from public.league_games group by 1, 2;
--    select count(*) from public.league_seats;
--
--    -- the browser cannot start, finish or abandon a game (expect false ×3),
--    -- and the server can (true ×3)
--    select has_function_privilege('anon', 'public.league_finish(uuid, text, uuid, text, text, text, text, integer, text, integer, integer, integer)', 'execute'),
--           has_function_privilege('authenticated', 'public.league_finish(uuid, text, uuid, text, text, text, text, integer, text, integer, integer, integer)', 'execute'),
--           has_function_privilege('service_role', 'public.league_finish(uuid, text, uuid, text, text, text, text, integer, text, integer, integer, integer)', 'execute');
--
--    -- the whole chain, undone afterwards: a game is seated, settled 1-0,
--    -- Kasper21's fog rating is four higher and Velmor's four lower, the
--    -- seats are gone, and settling it again moves nothing
--    begin;
--      select public.league_start('fog',
--        (select id from public.profiles where display_name = 'Kasper21'),
--        (select id from public.profiles where display_name = 'Velmor'),
--        'Kasper21', 'Velmor', 2673, 2523,
--        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 1800000, 'probe') as game \gset
--      select * from public.league_finish(:'game', '1-0',
--        (select id from public.profiles where display_name = 'Kasper21'),
--        'probe', 'e2e4', 'e4', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
--        1, '', 1800000, 1800000);
--      select display_name, fog_of_war_rating from public.profiles
--       where display_name in ('Kasper21', 'Velmor');
--      select count(*) from public.league_seats;
--      select * from public.league_finish(:'game', '1-0', null, 'probe', '', '', '', 0, '', 0, 0);
--    rollback;
--    (In the Supabase editor, which has no \gset, run league_start on its own
--     inside the transaction and paste the returned id into the two calls.)
-- ------------------------------------------------------------
