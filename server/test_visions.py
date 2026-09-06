"""The three vision ratings: what the migration seeds, and what the server writes.

supabase-migrate-visions.sql gives Complete Blindfold, Board Only and Fog of
War a rating column each on profiles, seeds the sixty places the home page
used to carry as a fixture, and installs record_rated_game(), the one door
through which any of the four ratings moves. None of that can be run here —
there is no Postgres in this repository — so this suite reads the file the
way test_system_profiles.py reads its file: the brief is written out below,
verbatim, and the SQL is checked against it rather than the other way round.

The server half is run for real, against a stand-in for PostgREST that
records what it was asked: supabase_db.leaderboard() must order by the
vision's own column, record_rated_game() must carry the game to the function
by its right name and refuse a vision it does not know before touching the
network, and the column each vision maps to must be the same in the page,
in supabase_db.py and in the SQL — a rating moved under one name and read
under another is a ladder that lies.

No server, no network:  python3 server/test_visions.py
"""

import os
import re
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import server            # noqa: E402
import supabase_auth     # noqa: E402
import supabase_db       # noqa: E402

SQL = os.path.join(ROOT, "supabase-migrate-visions.sql")
SYSTEM_SQL = os.path.join(ROOT, "supabase-system-profiles.sql")
PAGE = os.path.join(ROOT, "blind-chess.html")

# The brief, verbatim: the three ladders as blind-chess.html carried them, in
# the order it carried them. The one edit is the fog table's second Kasper21
# (2501), which the page discarded in favour of the higher standing when it
# drew the ladder, and which the file must not seed.
WANTED = [
    ("total", "NemoPlays", 2501), ("total", "Velmor", 2474), ("total", "Kasper21", 2455),
    ("total", "fiftyfourthmove", 2430), ("total", "CedricChessLab", 2407), ("total", "Noah_Vortex", 2386),
    ("total", "tacticalmango", 2344), ("total", "LeoFromPrague", 2268), ("total", "Milo_Anders", 2253),
    ("total", "Cedro", 2247), ("total", "novaendgame", 2242), ("total", "Nash_B", 2239),
    ("total", "Luca_Mirnov", 2199), ("total", "Arvenko", 2185), ("total", "chessnori", 2180),
    ("total", "tomasik_", 2175), ("total", "Artem_Koslov", 2172), ("total", "ivanorbit", 2144),
    ("total", "justleon", 2143), ("total", "MarekZed", 2140),
    ("fog", "Kasper21", 2673), ("fog", "RivenCross", 2648), ("fog", "tacticalmango", 2622),
    ("fog", "ElianVoss", 2597), ("fog", "Luca_Mirnov", 2574), ("fog", "OrionVale", 2549),
    ("fog", "Velmor", 2523), ("fog", "MaxenRook", 2498), ("fog", "justleon", 2471),
    ("fog", "SorenKnight", 2446), ("fog", "Cedro", 2421), ("fog", "nova_ember", 2397),
    ("fog", "Artem_Koslov", 2372), ("fog", "FelixArden", 2348), ("fog", "NemoPlays", 2324),
    ("fog", "rookzero", 2299), ("fog", "MarekZed", 2277), ("fog", "LevinCore", 2254),
    ("fog", "ViktorEndgame", 2847), ("fog", "Leonid64", 2826),
    ("blind", "Velmor", 2762), ("blind", "DorianVale", 2744), ("blind", "FelixArden", 2725),
    ("blind", "KaiVektor", 2706), ("blind", "RookHarbor", 2687), ("blind", "Cedro", 2669),
    ("blind", "MilanCore", 2650), ("blind", "Kasper21", 2631), ("blind", "TheoDrift", 2612),
    ("blind", "chessnori", 2594), ("blind", "ElianVoss", 2575), ("blind", "NovaRook", 2556),
    ("blind", "NemoPlays", 2537), ("blind", "SorenKnight", 2519), ("blind", "Varek_17", 2500),
    ("blind", "MarekZed", 2481), ("blind", "LennoxFile", 2462), ("blind", "tacticalmango", 2444),
    ("blind", "ArloKnight", 2423), ("blind", "RivenCross", 2402),
]

COLUMNS = {
    "sighted": "rating",
    "total": "complete_blindfold_rating",
    "blind": "board_only_rating",
    "fog": "fog_of_war_rating",
}

passed = 0
failed = 0


def check(label, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print("  \033[32mPASS\033[0m %s" % label)
    else:
        failed += 1
        print("  \033[31mFAIL\033[0m %s\n        got  %r\n        want %r" % (label, got, want))


def read(path):
    return open(path, encoding="utf-8").read()


def places_in_sql(text):
    """The (mode, name, elo) places the file seeds, in file order."""
    body = text.split("as t(mode, name, elo)")[0]
    body = body[body.rindex("select * from (values"):]
    found = re.findall(r"\('(total|fog|blind)',\s*'([^']+)',\s*(\d+)\)", body)
    return [(mode, name, int(elo)) for mode, name, elo in found]


def created_in_sql(text):
    """The (id, name) system profiles the file may create, in file order."""
    body = text.split("as t(id, name)")[0]
    body = body[body.rindex("select * from (values"):]
    return re.findall(r"\('([0-9a-f-]{36})'::uuid,\s*'([^']+)'\)", body)


def system_profiles():
    """The twenty-one of supabase-system-profiles.sql, as (id, name)."""
    text = read(SYSTEM_SQL).split("as t(id, name, rating)")[0]
    return re.findall(r"\('([0-9a-f-]{36})'::uuid,\s*'([^']+)',\s*\d+\)", text)


def strip_comments(text):
    """The SQL without its comments, for checks that must not be fooled by prose."""
    return re.sub(r"--[^\n]*", "", text)


def main():
    text = read(SQL)
    code = strip_comments(text)

    print("\n\033[1mThe columns\033[0m")
    for mode in ("total", "blind", "fog"):
        col = COLUMNS[mode]
        check("%s is added shaped exactly like rating" % col,
              "add column if not exists %s integer not null default 100" % col in text, True)
    check("rating itself is neither dropped nor renamed",
          bool(re.search(r"\b(drop|rename)\s+column\b", code, re.I)), False)
    check("nothing is dropped, truncated or deleted",
          bool(re.search(r"\b(drop\s+table|truncate|delete\s+from)\b", code, re.I)), False)
    check("the browser's UPDATE grant is restated, exactly as setup wrote it",
          all(l in text for l in (
              "revoke update on public.profiles from authenticated;",
              "grant  update (display_name, avatar_url) on public.profiles to authenticated;",
              "grant  select on public.profiles to authenticated, anon;")), True)
    check("no rating column is ever granted to the browser",
          [c for c in COLUMNS.values()
           if re.search(r"grant\s+update\s*\([^)]*\b%s\b" % c, text)], [])
    check("the whole file is one transaction", text.count("\nbegin;") == 1 and "\ncommit;" in text, True)

    print("\n\033[1mThe sixty places\033[0m")
    places = places_in_sql(text)
    check("sixty places, the brief's, in order", places, WANTED)
    for mode, label in (("total", "Complete Blindfold"), ("blind", "Board Only"), ("fog", "Fog of War")):
        names = [n for m, n, _ in places if m == mode]
        check("%s: twenty players" % label, len(names), 20)
        check("%s: twenty different players" % label, len({n.lower() for n in names}), 20)
    check("Kasper21 stands once in Fog of War, at the higher number",
          [(m, n, e) for m, n, e in places if m == "fog" and n == "Kasper21"], [("fog", "Kasper21", 2673)])
    check("a place is written only once, and never over a moved rating",
          "insert into public.rating_seeds" in text and "on conflict (mode, profile_id) do nothing" in text
          and "if not found then" in text, True)
    check("a place with no profile is reported, not invented",
          "NOT FOUND" in text and "raise notice" in text, True)
    check("a human wearing a fixture name is left alone",
          "NOT A SYSTEM PROFILE" in text and "if not who.is_bot then" in text, True)
    check("places are matched by name the way the username index compares them",
          "lower(display_name) = lower(place.name)" in text, True)
    check("the seed writes the vision's column and no other",
          re.findall(r"when '(total|blind|fog)'\s+then '(\w+)'",
                     code.split("create or replace function public.record_rated_game")[0]),
          [("total", COLUMNS["total"]), ("blind", COLUMNS["blind"]), ("fog", COLUMNS["fog"])])

    print("\n\033[1mThe twenty new system profiles\033[0m")
    made = created_in_sql(text)
    known = system_profiles()
    known_names = {n.lower() for _, n in known}
    seeded_names = {n.lower() for _, n, _ in places}
    check("twenty are created", len(made), 20)
    check("every one is a fixture name that no system profile already holds",
          sorted(n.lower() for _, n in made),
          sorted(seeded_names - known_names))
    check("every fixture name is either a system profile or created here",
          sorted(seeded_names - known_names - {n.lower() for _, n in made}), [])
    check("twenty different ids", len({i for i, _ in made}), 20)
    check("none of the ids is one of the twenty-one's",
          sorted({i for i, _ in made} & {i for i, _ in known}), [])
    check("the ids are what the file says they are (UUIDv5 of the name, URL namespace)",
          [(i, n) for i, n in made
           if uuid.UUID(i) != uuid.uuid5(uuid.NAMESPACE_URL,
                                         "https://system.noxchess.invalid/profile/" + n.lower())], [])
    check("every name passes the server's own name rule",
          [n for _, n in made if supabase_auth.clean_name(n) != n], [])
    check("none of them is a fallback opponent's name",
          sorted(set(server.AI_NAMES) & {n for _, n in made}), [])
    check("they are made on the system profiles' terms: flagged, banned, no password",
          all(s in text for s in ("'is_bot', true", "'3000-01-01 00:00:00+00'",
                                  "@system.noxchess.invalid", "on conflict (id) do nothing",
                                  "on conflict (id) do update")), True)
    check("a name already in profiles is never created twice",
          "a profile of that name already exists, so none is created" in text, True)

    print("\n\033[1mrecord_rated_game\033[0m")
    fn = text[text.index("create or replace function public.record_rated_game"):]
    fn = fn[:fn.index("\n$$;") + 4]
    check("each vision moves its own column and no other",
          dict(re.findall(r"when '(\w+)'\s+then '(\w+)'", fn)), COLUMNS)
    check("an unknown vision is refused", "raise exception 'unknown vision %'" in fn, True)
    check("four points each way, nothing on a draw",
          "p_points  integer default 4" in fn
          and "w_delta :=  p_points; b_delta := -p_points;" in fn
          and "w_delta := -p_points; b_delta :=  p_points;" in fn
          and "elsif p_result <> '1/2-1/2' then" in fn, True)
    check("once per game: keyed on the game id, and a repeat answers applied = false",
          "id            text primary key" in text
          and "return query select false, col, done.white_before" in fn
          and "exception when unique_violation then" in fn, True)
    check("both rows are locked, in id order, before they are read",
          "order by id for update" in fn, True)
    check("the system-profile guard stands down for the game, not for the session",
          "set_config('nox.seeding_system_profiles', 'on', true)" in fn, True)
    check("security definer, with an empty search path",
          "security definer" in fn and "set search_path = ''" in fn, True)
    sig = "public.record_rated_game(text, text, uuid, uuid, text, integer)"
    check("only the server's key may call it",
          "revoke all on function %s from public;" % sig in text
          and "revoke all on function %s from anon, authenticated;" % sig in text
          and "grant  execute on function %s to service_role;" % sig in text, True)
    check("the record of games is closed to the browser",
          "alter table public.rated_games enable row level security;" in text
          and not re.search(r"grant\s+\w+\s+on\s+public\.rated_games", text), True)

    print("\n\033[1mOne set of columns, three files\033[0m")
    check("supabase_db.py maps the four visions to the same four columns",
          supabase_db.VISION_COLUMNS, COLUMNS)
    page = read(PAGE)
    block = page[page.index("const LB_VISIONS = {"):]
    block = block[:block.index("\n};") + 3]
    check("the page maps the four visions to the same four columns",
          dict(re.findall(r"(\w+):\s*\{\s*column:\s*'(\w+)'", block)), COLUMNS)
    check("the page names the migration a missing column is waiting for",
          block.count("needs: 'supabase-migrate-visions.sql'"), 3)
    check("the page no longer carries the fixture",
          "LB_BOARDS" in page or "renderStaticBoards" in page, False)
    check("the page's top is the server's top",
          re.search(r"const LB_TOP = (\d+);", page).group(1), str(supabase_db.LADDER_TOP))

    print("\n\033[1mThe server's reads and writes\033[0m")
    supabase_db.REST = "https://example.invalid/rest/v1"
    supabase_db.SERVICE_KEY = "sb_secret_test"
    supabase_db._REFUSED = False
    asked = []

    def fake_request(method, path, body=None, prefer=None):
        asked.append((method, path, body))
        if path.startswith("/rpc/record_rated_game"):
            return [{"applied": True, "rating_column": COLUMNS[body["p_mode"]],
                     "white_before": 2673, "black_before": 2523,
                     "white_after": 2677, "black_after": 2519}]
        one = re.search(r"select=(\w+)&id=eq\.(\w+)", path)
        if one:
            return [{one.group(1): 2631}]
        col = re.search(r"select=id,display_name,(\w+)", path).group(1)
        return [{"id": "k", "display_name": "Kasper21", col: 2673},
                {"id": "v", "display_name": "Velmor", col: 2523},
                {"id": "x", "display_name": "Broken", col: None}]

    supabase_db._request = fake_request

    check("vision_column answers for all four",
          [supabase_db.vision_column(m) for m in ("sighted", "total", "blind", "fog")],
          ["rating", "complete_blindfold_rating", "board_only_rating", "fog_of_war_rating"])
    try:
        supabase_db.vision_column("sighted2")
        check("and refuses a vision it does not know", "no error", "ValueError")
    except ValueError:
        check("and refuses a vision it does not know", "ValueError", "ValueError")

    rows = supabase_db.leaderboard("fog")
    check("leaderboard('fog') asks for the fog column, highest first, then by name, top twenty",
          asked[-1][1],
          "/profiles?select=id,display_name,fog_of_war_rating"
          "&order=fog_of_war_rating.desc,display_name.asc&limit=20")
    check("and hands back people in that order, skipping a row with no number",
          rows, [{"id": "k", "name": "Kasper21", "rating": 2673},
                 {"id": "v", "name": "Velmor", "rating": 2523}])
    supabase_db.leaderboard("sighted")
    check("leaderboard('sighted') is still profiles.rating",
          "select=id,display_name,rating&order=rating.desc" in asked[-1][1], True)
    supabase_db.get_vision_rating("k", "blind")
    check("get_vision_rating reads the vision's column for the one row",
          asked[-1][1], "/profiles?select=board_only_rating&id=eq.k")

    before = len(asked)
    try:
        supabase_db.record_rated_game("g1", "sighted2", "w", "b", "1-0")
        check("an unknown vision is refused before any request is made", "no error", "ValueError")
    except ValueError:
        check("an unknown vision is refused before any request is made", len(asked), before)
    try:
        supabase_db.record_rated_game("g1", "fog", "w", "b", "2-0")
        check("a result that is not a result is refused", "no error", "ValueError")
    except ValueError:
        check("a result that is not a result is refused", len(asked), before)

    out = supabase_db.record_rated_game("game-42", "fog", "w-id", "b-id", "1-0")
    check("a rated game is carried to record_rated_game() by name",
          asked[-1][0:2], ("POST", "/rpc/record_rated_game"))
    check("with the game id, the vision, both seats, the result and the rule",
          asked[-1][2], {"p_game": "game-42", "p_mode": "fog", "p_white": "w-id",
                         "p_black": "b-id", "p_result": "1-0", "p_points": 4})
    check("and the function's answer comes back whole",
          (out["applied"], out["rating_column"], out["white_after"], out["black_after"]),
          (True, "fog_of_war_rating", 2677, 2519))
    for mode in ("sighted", "total", "blind"):
        supabase_db.record_rated_game("game-%s" % mode, mode, "w-id", "b-id", "1/2-1/2")
        check("a %s game names itself as %s and nothing else" % (mode, mode),
              asked[-1][2]["p_mode"], mode)

    supabase_db.SERVICE_KEY = ""
    check("with no service key, nothing is read", supabase_db.leaderboard("fog"), None)
    check("and nothing is written",
          supabase_db.record_rated_game("game-43", "fog", "w-id", "b-id", "1-0"), None)

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
