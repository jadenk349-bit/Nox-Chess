-- ============================================================
--  NOX CHESS — account schema
--  Run this once in your Supabase project: SQL Editor → New query → Run.
--
--  Covers the foundation for all four goals:
--    · profiles      — who a player is (goal: identity)
--    · rating/tier   — derived, and NOT writable by the browser
--    · subscription  — a column the client can read but never set
--  Game history, friendships and online play come in later stages.
-- ============================================================


-- ------------------------------------------------------------
--  1. profiles: one row per signed-up account
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users on delete cascade,
  display_name      text not null,
  avatar_url        text,

  -- Rating is server-owned. The browser can read it; only server-side
  -- code (an edge function, after refereeing a game) may change it.
  rating            integer not null default 1200,

  -- Tier follows from rating automatically, so the two can never disagree.
  tier              text generated always as (
                      case
                        when rating >= 2000 then 'Master'
                        when rating >= 1800 then 'Expert'
                        when rating >= 1600 then 'Advanced'
                        when rating >= 1400 then 'Intermediate'
                        when rating >= 1200 then 'Casual'
                        else 'Novice'
                      end
                    ) stored,

  -- Set later by the Stripe webhook, never by the client.
  subscription      text not null default 'free',

  created_at        timestamptz not null default now()
);


-- ------------------------------------------------------------
--  2. Create the profile automatically when someone signs up
--
--     display_name starts as a neutral placeholder, NOT the Google name.
--     This table is readable by everyone (friend search needs that), so
--     seeding it from Google would publish a new player's real name before
--     they had chosen anything. The username screen overwrites it moments
--     later; until then there is nothing personal in here.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    'player_' || substr(new.id::text, 1, 8),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ------------------------------------------------------------
--  3. Row-level security
--     Profiles are publicly readable (you need this to search for
--     friends), but writable only by their owner.
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
  on public.profiles for select
  to authenticated, anon
  using (true);

drop policy if exists "you may edit only your own profile" on public.profiles;
create policy "you may edit only your own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);


-- ------------------------------------------------------------
--  4. THE IMPORTANT BIT: stop players writing their own rating
--
--     RLS alone would let a signed-in user UPDATE their row and set
--     rating = 3000. Column-level grants close that off: the browser
--     may only ever write these two columns. rating, tier and
--     subscription stay server-side.
-- ------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant  update (display_name, avatar_url) on public.profiles to authenticated;
grant  select on public.profiles to authenticated, anon;


-- ------------------------------------------------------------
--  Check it worked: sign in once through the game, then run
--     select id, display_name, rating, tier, subscription
--     from public.profiles;
--  and you should see exactly one row — yours.
-- ------------------------------------------------------------
