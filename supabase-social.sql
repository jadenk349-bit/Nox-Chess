-- ============================================================
--  NOX CHESS — the social schema: friends, and the requests that make them
--  Run this once in your Supabase project: SQL Editor → New query → Run.
--  It expects supabase-setup.sql to have been run first — everything here
--  hangs off public.profiles, which that file creates.
--
--  Challenges are deliberately NOT in here. A challenge is a live thing that
--  exists only while both players are connected, so it rides the game socket
--  in server/server.py alongside rooms and quick match, rather than becoming
--  a row somebody has to garbage-collect. Friendships outlive a session; a
--  challenge does not.
-- ============================================================


-- ------------------------------------------------------------
--  1. friendships: ONE row per pair, not two
--
--     A friendship has no direction, so storing it twice would mean two
--     rows that could disagree — one removed and the other left behind.
--     Instead the pair is stored sorted, least uuid first, and the check
--     constraint makes that the only way a row can exist. The primary key
--     on the sorted pair is then also the "already friends" guard: there
--     is no second row to insert.
--
--     Reading it from either side is the same query, `user_low = me or
--     user_high = me`, and removing it is one delete that both players see.
-- ------------------------------------------------------------
create table if not exists public.friendships (
  user_low   uuid not null references public.profiles(id) on delete cascade,
  user_high  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint friendship_is_sorted check (user_low < user_high)
);

create index if not exists friendships_high_idx on public.friendships (user_high);


-- ------------------------------------------------------------
--  2. friend_requests: the pending ones, and only those
--
--     A request is deleted the moment it is answered — accepted ones become
--     a friendship row, declined ones simply go. No status column, because
--     nothing here ever wants to know about a request that is over, and a
--     table of dead rows is a table somebody has to prune.
-- ------------------------------------------------------------
create table if not exists public.friend_requests (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid not null references public.profiles(id) on delete cascade,
  recipient  uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint request_has_two_people check (sender <> recipient),
  constraint one_request_per_direction unique (sender, recipient)
);

create index if not exists friend_requests_recipient_idx on public.friend_requests (recipient);


-- ------------------------------------------------------------
--  3. Accepting, as one indivisible step
--
--     Accepting is two writes — make the friendship, drop the request — and
--     the browser must not be trusted to do only the first. It is also the
--     one place a client would otherwise need INSERT on friendships, which
--     would let anyone declare themselves someone else's friend.
--
--     So there is no insert policy on friendships at all. This function is
--     the only way a row gets there, it runs as the definer, and the first
--     thing it does is check that the caller is the person the request was
--     addressed to. `security invoker = false` plus that check is what stops
--     a third party accepting a request between two other people.
-- ------------------------------------------------------------
create or replace function public.accept_friend_request(req_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.friend_requests;
begin
  select * into req
    from public.friend_requests
   where id = req_id
     and recipient = auth.uid();          -- yours to answer, or not yours at all

  if req is null then
    raise exception 'no such friend request';
  end if;

  insert into public.friendships (user_low, user_high)
  values (least(req.sender, req.recipient), greatest(req.sender, req.recipient))
  on conflict do nothing;                 -- already friends: accepting is a no-op

  -- Both directions go: if each had asked the other, answering one settles both.
  delete from public.friend_requests
   where (sender = req.sender    and recipient = req.recipient)
      or (sender = req.recipient and recipient = req.sender);

  return req.sender;
end;
$$;

revoke all on function public.accept_friend_request(uuid) from public;
grant execute on function public.accept_friend_request(uuid) to authenticated;


-- ------------------------------------------------------------
--  4. Row-level security
--
--     The shape of it: you can see, and end, only the friendships you are in;
--     you can see only the requests you sent or were sent; and you can create
--     a request only as yourself.
-- ------------------------------------------------------------
alter table public.friendships     enable row level security;
alter table public.friend_requests enable row level security;

drop policy if exists "see your own friendships" on public.friendships;
create policy "see your own friendships"
  on public.friendships for select
  to authenticated
  using (auth.uid() = user_low or auth.uid() = user_high);

-- Either side may end it, and there is only one row, so it ends for both.
drop policy if exists "either friend may end it" on public.friendships;
create policy "either friend may end it"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = user_low or auth.uid() = user_high);

-- No insert and no update policy on purpose: accept_friend_request() above is
-- the only door in, and a friendship has nothing to amend.

drop policy if exists "see requests you are part of" on public.friend_requests;
create policy "see requests you are part of"
  on public.friend_requests for select
  to authenticated
  using (auth.uid() = sender or auth.uid() = recipient);

/*  Sending one. Four things have to hold, and all four are enforced here
    rather than in the page, because the page is only one of the clients that
    can reach this database:
      · you are the sender          — nobody sends in someone else's name
      · not to yourself             — also the table's check constraint
      · you are not already friends — there would be nothing to accept
      · they have not already asked you — that would be two live requests
                                        between the same two people, and
                                        answering one would leave the other
    The unique constraint covers the fourth case in your own direction; this
    covers the other one.                                                    */
drop policy if exists "send a request as yourself" on public.friend_requests;
create policy "send a request as yourself"
  on public.friend_requests for insert
  to authenticated
  with check (
    auth.uid() = sender
    and sender <> recipient
    and not exists (
      select 1 from public.friendships f
       where f.user_low  = least(sender, recipient)
         and f.user_high = greatest(sender, recipient)
    )
    and not exists (
      select 1 from public.friend_requests r
       where r.sender = recipient and r.recipient = sender
    )
  );

-- Declining and withdrawing are the same delete from two different sides.
drop policy if exists "answer or withdraw a request" on public.friend_requests;
create policy "answer or withdraw a request"
  on public.friend_requests for delete
  to authenticated
  using (auth.uid() = sender or auth.uid() = recipient);


-- ------------------------------------------------------------
--  5. Grants, the same belt-and-braces as profiles
--
--     RLS decides which rows; grants decide which verbs. Neither table has
--     anything a client should ever UPDATE, so that verb is simply not there,
--     and friendships cannot be INSERTed at all.
-- ------------------------------------------------------------
revoke all on public.friendships     from authenticated, anon;
revoke all on public.friend_requests from authenticated, anon;
grant select, delete         on public.friendships     to authenticated;
grant select, insert, delete on public.friend_requests to authenticated;


-- ------------------------------------------------------------
--  6. Realtime
--
--     The page subscribes to both tables so a request lands in the other
--     player's notifications without them reloading. Two things are needed:
--     the table has to be in the publication, and it needs REPLICA IDENTITY
--     FULL — without that a DELETE carries only the primary key, and Supabase
--     cannot apply the SELECT policy above to decide who is allowed to hear
--     about it, so nobody hears about it at all. Removing a friend, declining
--     a request and accepting one are all deletes, so this is most of the
--     feature.
-- ------------------------------------------------------------
alter table public.friendships     replica identity full;
alter table public.friend_requests replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.friend_requests;
exception when duplicate_object then null;
end $$;


-- ------------------------------------------------------------
--  7. Search by part of a username
--
--     The page looks players up with `display_name ilike '%something%'`,
--     which no ordinary btree index can help with. A trigram index can.
--     Harmless to skip if the extension is unavailable — the query still
--     works, it just scans.
-- ------------------------------------------------------------
create extension if not exists pg_trgm;
create index if not exists profiles_display_name_trgm
  on public.profiles using gin (display_name gin_trgm_ops);


-- ------------------------------------------------------------
--  Check it worked: with two accounts signed up, one of them running
--     insert into public.friend_requests (sender, recipient)
--     values (auth.uid(), '<the other id>');
--  should succeed once and fail the second time.
-- ------------------------------------------------------------
