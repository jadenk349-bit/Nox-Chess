"""Writing the columns the browser is not allowed to write.

supabase_auth.py holds no secret at all: it verifies tokens against a public
key set. This module is the other half — the one that needs a real credential,
because it writes `profiles.puzzle_rating` — and, through record_rated_game(),
the four ranked ratings — and the whole point of those columns is that the
player cannot set them themselves. Progress is different and does not
come through here: which puzzles you have finished is personal state, so the
browser writes those rows directly under row-level security. What a player is
*worth* is not personal state.

    SUPABASE_URL           https://<ref>.supabase.co
    SUPABASE_SERVICE_KEY   a secret key from the project's API settings

Either kind of secret key works, and they are told apart by shape rather than
by a setting:

    sb_secret_...          the modern API key. Not a JWT — an opaque string
                           the API gateway resolves to the service role.
    eyJ... (three parts)   the legacy `service_role` JWT, which PostgREST
                           decodes itself to find the role claim.

The difference matters for exactly one header. Supabase authenticates on
`apikey`, and that header alone is enough for either kind — a request carrying
only `apikey` is accepted, and a request carrying only `Authorization` is
refused with "No API key found in request". `Authorization: Bearer ...` is then
additionally read by PostgREST, which parses whatever is in it *as a JWT*: hand
it a modern secret key and a request that would otherwise have worked comes
back "Expected 3 parts in JWT; got 1". So the Bearer header is sent only when
the key really is a JWT, and a modern key travels in `apikey` alone.

Whichever kind it is, a secret key bypasses row-level security. That is exactly
why it lives on the server and must never reach a browser. The publishable key
is not a substitute — it is the key the page already ships, it has no more
rights than a signed-out visitor, and this module refuses it by name rather
than letting every write fail quietly.

With no key set, this module is off and reports so. The server then keeps
puzzle ratings in memory for the lifetime of the process: ratings still move
while a player is on, and are forgotten on restart. That is a degradation, not
a failure, and it is the same shape as everything else here — a Nox Chess
server with no Supabase settings runs, and plays, and simply cannot remember
who anybody is.

Standard library only, like the rest of the server. PostgREST is plain HTTP.
"""

import base64
import json
import os
import sys
import urllib.error
import urllib.request

PROJECT_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
# Trimmed: a key pasted into a hosting dashboard arrives with a newline
# surprisingly often, and an invisible one is a miserable thing to debug.
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()

REST = (PROJECT_URL + "/rest/v1") if PROJECT_URL else ""
TIMEOUT = 5


def _is_jwt(key):
    """Three dot-separated parts: the legacy service_role key's shape."""
    return key.count(".") == 2


def _is_publishable(key):
    """The key the browser already has, which cannot write anything here.

    Worth catching by name. Pasted into SUPABASE_SERVICE_KEY it produces a
    server that looks configured, is refused by row-level security on every
    write, and stores nothing. The modern key announces itself in its prefix;
    a legacy anon JWT announces itself in a role claim that can be read without
    verifying anything, because this is a sanity check on our own configuration
    and not a security decision — nothing is trusted on the strength of it.
    """
    if key.startswith("sb_publishable_"):
        return True
    if not _is_jwt(key):
        return False
    body = key.split(".")[1]
    try:
        padded = body + "=" * (-len(body) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    except Exception:                       # noqa: BLE001 - a shape check, nothing more
        return False
    return claims.get("role") in ("anon", "authenticated")


# Checked once, and said out loud: a misconfigured key belongs in the log at
# startup, not in a puzzle rating that quietly never moves.
_REFUSED = bool(SERVICE_KEY) and _is_publishable(SERVICE_KEY)
if _REFUSED:
    sys.stderr.write(
        "SUPABASE_SERVICE_KEY looks like a publishable/anon key, which cannot "
        "write puzzle_rating. Use a secret key (sb_secret_... or the legacy "
        "service_role JWT). Puzzle ratings will be kept in memory only.\n"
    )


def enabled():
    """True when this server can actually read and write profile rows."""
    return bool(REST and SERVICE_KEY and not _REFUSED)


def _request(method, path, body=None, prefer=None):
    req = urllib.request.Request(REST + path, method=method)
    # `apikey` is what Supabase authenticates on, and it is enough on its own
    # for either kind of key. The Bearer header goes only with a JWT, because
    # PostgREST tries to parse whatever is in it as one.
    req.add_header("apikey", SERVICE_KEY)
    if _is_jwt(SERVICE_KEY):
        req.add_header("Authorization", "Bearer " + SERVICE_KEY)
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    if prefer:
        req.add_header("Prefer", prefer)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read()
    return json.loads(raw) if raw else None


def request(method, path, body=None, prefer=None):
    """One PostgREST call with the service key, for the league.

    The league (server/league.py) reads bot profiles, writes game rows and
    calls the three functions supabase-migrate-league.sql defines, and none of
    those is a puzzle rating — so the transport is opened up here rather than
    copied there. Errors are the caller's to interpret: a missing table and a
    network failure are both worth different log lines, and both come back as
    the urllib exception they were. Returns the decoded body, or None when the
    module is off, which every caller treats as "cannot be stored".
    """
    if not enabled():
        return None
    return _request(method, path, body, prefer)


def rpc(name, args):
    """Call a Postgres function by name, the way PostgREST exposes it.

    Written separately so the path is built in one place: /rpc/<name>, POST,
    the arguments as one JSON object keyed by parameter name.
    """
    return request("POST", "/rpc/" + name, args or {})


def error_body(err):
    """What PostgREST said, out of the HTTPError it said it in.

    A 404 with PGRST205 in it means the table is not there — the migration
    has not been run — and that is worth telling the operator in words rather
    than as a stack trace every ten seconds. Returns "" when there is nothing
    readable to show.
    """
    try:
        raw = err.read()
    except Exception:                       # noqa: BLE001 - best effort, for a log line
        return ""
    try:
        return raw.decode("utf-8", "replace")[:300]
    except Exception:                       # noqa: BLE001
        return ""


def get_puzzle_rating(user_id):
    """The stored rating, or None if there is nowhere to look or nothing there.

    None is also what a project that has not run supabase-migrate-puzzles.sql
    yet answers with, because the column does not exist. The caller treats that
    the same as an unconfigured server: keep it in memory and carry on.
    """
    if not enabled():
        return None
    try:
        rows = _request("GET", "/profiles?select=puzzle_rating&id=eq." + user_id)
    except (urllib.error.URLError, ValueError, OSError):
        return None
    if not rows:
        return None
    value = rows[0].get("puzzle_rating")
    return value if isinstance(value, int) else None


def set_puzzle_rating(user_id, rating):
    """Store a rating. True only when the row really changed.

    The answer is read back rather than assumed. PostgREST replies 204 to an
    UPDATE that matched nothing — including one that row-level security
    filtered away entirely — so a key without the privileges to write here
    looks exactly like a successful write if you only check the status code.
    That is the failure worth catching: a server started with the wrong key
    would report every rating as saved and store none of them. Asking for the
    updated row back turns that silence into a False, which the caller logs and
    passes to the client as saved: false.
    """
    if not enabled():
        return False
    try:
        rows = _request(
            "PATCH",
            "/profiles?id=eq." + user_id,
            {"puzzle_rating": int(rating)},
            prefer="return=representation",
        )
    except (urllib.error.URLError, ValueError, OSError):
        return False
    return bool(rows) and rows[0].get("puzzle_rating") == int(rating)


def get_rating(user_id):
    """A player's ranked rating, or None when it cannot be read.

    Read-only, and read for one reason: the fallback opponent's Elo is worked
    out from the player's own, and a number the browser sends is a number the
    browser can choose. `rating` is already a column the browser may read and
    never write — see the column grants at the bottom of supabase-setup.sql —
    so nothing here needs the service key's privileges. It uses them only
    because this is where the credential already lives.

    None on any failure, including a server with no Supabase at all. The caller
    falls back to the same starting rating the page shows an account-less
    player, which is what that player is looking at while they wait.
    """
    if not enabled() or not user_id:
        return None
    try:
        rows = _request("GET", "/profiles?select=rating&id=eq." + user_id)
    except (urllib.error.URLError, ValueError, OSError):
        return None
    if not rows:
        return None
    value = rows[0].get("rating")
    return value if isinstance(value, int) else None


def get_display_name(user_id):
    """The name a player's profile row carries, or None when it cannot be read.

    Read for the same reason `get_rating` is: the token's `game_name` is
    metadata the account can write through Supabase's own API, so a player
    who wanted somebody else's name could put it there and skip the username
    screen. `profiles.display_name` cannot be skipped — it is the column the
    unique index in supabase-migrate-usernames.sql is on — so it is the copy
    the server answers to when it can read it. Like `rating`, it is a column
    everybody may read; the service key is used only because it is the
    credential this module has.

    None on any failure, and the caller falls back to the token.
    """
    if not enabled() or not user_id:
        return None
    try:
        rows = _request("GET", "/profiles?select=display_name&id=eq." + user_id)
    except (urllib.error.URLError, ValueError, OSError):
        return None
    if not rows:
        return None
    value = rows[0].get("display_name")
    return value if isinstance(value, str) else None


def bot_ids():
    """The account ids of every system profile, or None when they cannot be read.

    The twenty-one names at the top of the ladder (supabase-system-profiles.sql)
    are flagged `is_bot` in profiles, and this is the server's copy of that
    flag: handle_hello() refuses a token for any id in it, so a system profile
    can never become a verified client, never mind a ranked one. The set is
    read whole rather than one id at a time because it is small, it changes
    only when that file is run, and one request every few minutes is cheaper
    than one per sign-in.

    None on any failure — including a project that has not run the file yet,
    where the column does not exist and PostgREST answers 400 — and the caller
    keeps whatever it last read. The flag also travels in the token's
    app_metadata, so a server that cannot read this still has a second way of
    telling; this is the one that does not depend on how the token was made.
    """
    if not enabled():
        return None
    try:
        rows = _request("GET", "/profiles?select=id&is_bot=eq.true")
    except (urllib.error.URLError, ValueError, OSError):
        return None
    return {row.get("id") for row in rows or [] if isinstance(row.get("id"), str)}


# ------------------------------------------------------------- the four ladders
#
# One rating per vision, each its own column on profiles, and this is the only
# place on the server that knows which column is which. The keys are the
# page's G.mode values, the same four the puzzle visions and the leaderboard
# panels answer to, so a game's mode names its ladder without translation.
# `rating` is the Sighted ladder and has been since supabase-setup.sql; the
# other three arrive with supabase-migrate-visions.sql, and the CASE at the
# heart of record_rated_game() in that file is this same table written in SQL
# — test_visions.py holds the two to each other, because a rating that moved
# under one name and was read under another would be a ladder that lies.
VISION_COLUMNS = {
    "sighted": "rating",
    "total": "complete_blindfold_rating",
    "blind": "board_only_rating",
    "fog": "fog_of_war_rating",
}

# The whole list, and there is no "show more": the page's LB_TOP says the same
# number, and its captions promise it.
LADDER_TOP = 20


def vision_column(mode):
    """The profiles column a vision's rating lives in, or a ValueError.

    Raised rather than defaulted on purpose: a mode this table does not know
    must never quietly become somebody's Sighted rating.
    """
    try:
        return VISION_COLUMNS[mode]
    except KeyError:
        raise ValueError("no rating column for vision %r" % (mode,))


def leaderboard(mode, limit=LADDER_TOP):
    """The top of one vision's ladder, highest first, or None if it cannot be read.

    Rows are {id, name, rating}, in ranking order — ties broken by name, so
    two reads agree on who is twentieth. The same query the page makes for
    its four panels, made here for whatever on the server wants a ladder
    (a log line, a test, a league) without a browser in front of it.

    None on any failure, including a project that has not run
    supabase-migrate-visions.sql yet, where three of the four columns do not
    exist and PostgREST answers 400. The caller must tell that apart from an
    empty ladder, which is [].
    """
    col = vision_column(mode)
    if not enabled():
        return None
    try:
        rows = _request(
            "GET",
            "/profiles?select=id,display_name,%s&order=%s.desc,display_name.asc&limit=%d"
            % (col, col, int(limit)),
        )
    except (urllib.error.URLError, ValueError, OSError):
        return None
    out = []
    for row in rows or []:
        value = row.get(col)
        if not isinstance(row.get("id"), str) or not isinstance(value, int):
            continue
        out.append({"id": row["id"], "name": row.get("display_name") or "Player", "rating": value})
    return out


def get_vision_rating(user_id, mode):
    """A player's rating in one vision, or None when it cannot be read.

    get_rating() is this for 'sighted' and predates it; it is kept as it is
    because the ranked queue reads it on a hot path and nothing there has a
    mode to hand over. Everything new asks by vision.
    """
    col = vision_column(mode)
    if not enabled() or not user_id:
        return None
    try:
        rows = _request("GET", "/profiles?select=%s&id=eq.%s" % (col, user_id))
    except (urllib.error.URLError, ValueError, OSError):
        return None
    if not rows:
        return None
    value = rows[0].get(col)
    return value if isinstance(value, int) else None


def record_rated_game(game_id, mode, white_id, black_id, result, points=4):
    """Settle one rated game: the vision's column moves, once, and nothing else.

    The rule lives in the database, in record_rated_game() from
    supabase-migrate-visions.sql, and this only carries the game there: its
    id, the vision it was played in, both accounts and the result as
    '1-0', '0-1' or '1/2-1/2'. Four points to the winner and four from the
    loser in the column of that vision — `rating` for a Sighted game and the
    vision's own column for the other three — and nothing on a draw. The
    numbers are read from the rows under a lock rather than sent from here,
    because a rating the server remembers is a rating that may be stale.

    Once per game id. The function keys its record on the id, so the same
    game settled twice — a handler that ran twice, a second process that
    also thought it owned the game — moves nothing the second time and says
    so: the answer is the recorded row with `applied` False. A caller that
    wants to know whether *its* call was the one that counted reads that flag
    and nothing else.

    Returns the function's row — applied, rating_column, white_before,
    black_before, white_after, black_after — or None when nothing could be
    written: no key, a network failure, a project that has not run the
    migration, or a refusal (an unknown vision, two identical seats, a
    profile that does not exist), all of which the log is the place for. A
    ValueError for a mode this module does not know is raised before any
    request is made, since that is a bug here and not a state of the
    database.
    """
    vision_column(mode)                      # refuse an unknown vision up front
    if result not in ("1-0", "0-1", "1/2-1/2"):
        raise ValueError("not a result: %r" % (result,))
    if not enabled():
        return None
    try:
        rows = _request(
            "POST",
            "/rpc/record_rated_game",
            {
                "p_game": str(game_id),
                "p_mode": mode,
                "p_white": white_id,
                "p_black": black_id,
                "p_result": result,
                "p_points": int(points),
            },
        )
    except (urllib.error.URLError, ValueError, OSError):
        return None
    if not rows or not isinstance(rows[0], dict) or "applied" not in rows[0]:
        return None
    return rows[0]
