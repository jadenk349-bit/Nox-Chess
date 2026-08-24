"""Writing the columns the browser is not allowed to write.

supabase_auth.py holds no secret at all: it verifies tokens against a public
key set. This module is the other half — the one that needs a real credential,
because it writes `profiles.puzzle_rating`, and the whole point of that column
is that the player cannot set it themselves. Progress is different and does not
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
