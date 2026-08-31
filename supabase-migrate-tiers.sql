-- ============================================================
--  NOX CHESS — migration: the ranked ladder
--
--  For a database created from an EARLIER supabase-setup.sql, back when a new
--  account started at 1200 and the tiers were called Novice … Master. The
--  setup file itself already carries the new ladder, so a project created
--  from scratch today needs nothing from here — `create table if not exists`
--  is why an existing project does: it left the old table exactly as it was.
--
--  It changes two things and nothing else:
--    · the DEFAULT rating for accounts made from now on: 1200 → 100
--    · the generated `tier` column: the seven rungs the ranked screen draws
--      its badges from
--
--  It deliberately does NOT touch anybody's rating. Every existing row keeps
--  the number it has — see the note at the foot of this file, because a
--  player sitting on the old default of 1200 will now read as Platinum.
--
--  Run it once in the Supabase SQL editor. Running it twice is harmless.
-- ============================================================

begin;

-- ------------------------------------------------------------
--  0. Refuse to run against a table this was not written for
--
--     Step 2 drops `tier` and adds it back, which is the only way to change a
--     generated column's expression — Postgres has no ALTER for it. That is
--     safe precisely because a generated column holds nothing of its own:
--     every value is recomputed from `rating` the moment it returns. If some
--     hand-written `tier` ever replaced it, though, dropping it would throw
--     away data that cannot be recomputed, so stop instead.
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'profiles'
       and column_name  = 'tier'
       and is_generated = 'NEVER'
  ) then
    raise exception 'public.profiles.tier is a plain column, not a generated one. Stopping: dropping it would destroy values nothing can recompute.';
  end if;
end $$;


-- ------------------------------------------------------------
--  1. New accounts start at the foot of the ladder
--
--     A default only ever applies to rows inserted after it, so this changes
--     what the signup trigger will hand the next new player and nothing at
--     all about the players already here.
-- ------------------------------------------------------------
alter table public.profiles
  alter column rating set default 100;


-- ------------------------------------------------------------
--  2. The tier ladder the ranked screen draws
--
--     Dropped without CASCADE on purpose. If this errors saying something
--     depends on `tier` — a view, a policy, an index you added — that is the
--     migration doing its job: look at what depends on it and decide, rather
--     than letting this quietly take it with it.
--
--     These thresholds are also written out in blind-chess.html, as TIERS,
--     which is what picks the badge. Move one and move the other.
-- ------------------------------------------------------------
alter table public.profiles
  drop column if exists tier;

alter table public.profiles
  add column tier text generated always as (
    case
      when rating >= 2500 then 'Grandmaster'
      when rating >= 2000 then 'Master'
      when rating >= 1600 then 'Diamond'
      when rating >= 1200 then 'Platinum'
      when rating >= 800  then 'Gold'
      when rating >= 500  then 'Silver'
      else 'Bronze'
    end
  ) stored;

commit;


-- ------------------------------------------------------------
--  Check it worked. Paste these into a new query and run them on their own —
--  the editor shows one result at a time, and none of them write anything.
--
--    -- the default is 100, and tier is generated from the new ladder
--    select column_name, column_default, is_generated, generation_expression
--      from information_schema.columns
--     where table_schema = 'public' and table_name = 'profiles'
--       and column_name in ('rating', 'tier');
--
--    -- every account still here, now wearing a badge from the new ladder
--    select id, display_name, rating, tier from public.profiles order by rating desc;
--
--    -- the load-bearing grant survived the drop: the browser reads tier and
--    -- still cannot write rating. Expect true, then false.
--    select has_column_privilege('authenticated', 'public.profiles', 'tier',   'select') as reads_tier,
--           has_column_privilege('authenticated', 'public.profiles', 'rating', 'update') as writes_rating;
--
--
--  One consequence worth knowing about, which this file leaves alone: an
--  account created before the migration still has whatever rating it had, and
--  the old default was 1200 — which on the new ladder is Platinum, four rungs
--  up from where a new player now starts. If those are test accounts and you
--  would rather they began again alongside everyone else, that is a decision
--  about your data, not part of this migration, and it is one statement:
--
--    update public.profiles set rating = 100;
-- ------------------------------------------------------------
