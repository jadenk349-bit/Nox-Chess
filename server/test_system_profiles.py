"""The system profiles, as the server sees them — which is to say, as it refuses them.

supabase-system-profiles.sql puts twenty-one accounts at the top of the
leaderboard. The browser finds them through the profiles table exactly as it
finds anybody, and that half needs no test here: there is nothing in the page
that knows they exist. What this file checks is the other half — that nothing
in this process can ever seat one:

  · a token for one is turned away at hello, whether the server learnt the id
    from the database or read the flag off the token's own app_metadata
  · the connection it leaves behind is a guest that the ranked door, the queue
    and the fallback's second-waiter check all refuse by name
  · the fallback opponent is never one of them — its names are not rows, and
    the two lists share nothing
  · the SQL file says exactly what the brief says, name for name and number
    for number, and every name is one the server's own rule would accept

No server, no network:  python3 server/test_system_profiles.py
"""

import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time

# The server reads its settings at import. A shared secret is enough for it to
# verify HS256 tokens without a project to talk to — the same arrangement
# test_two_clients.py uses — and no SUPABASE_URL means supabase_db stays off,
# which is the branch a hobby server runs in and the one where the token's own
# app_metadata has to be enough.
os.environ["SUPABASE_JWT_SECRET"] = "not-a-secret-just-a-test"
os.environ.pop("SUPABASE_URL", None)
os.environ.pop("SUPABASE_SERVICE_KEY", None)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server            # noqa: E402
import supabase_auth     # noqa: E402
import supabase_db       # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SQL = os.path.join(os.path.dirname(HERE), "supabase-system-profiles.sql")

# The brief, verbatim. The SQL file is checked against this rather than the
# other way round, so a typo in the file is caught by the file being wrong.
WANTED = [
    ("Arvenko", 2854), ("LeoFromPrague", 2832), ("novaendgame", 2814),
    ("Kasper21", 2809), ("tomasik_", 2801), ("MarekZed", 2793),
    ("Noah_Vortex", 2788), ("Cedro", 2765), ("ivanorbit", 2754),
    ("Velmor", 2742), ("chessnori", 2733), ("Luca_Mirnov", 2711),
    ("CedricChessLab", 2705), ("Artem_Koslov", 2694), ("NemoPlays", 2655),
    ("Milo_Anders", 2623), ("Kasper_Nova", 2611), ("tacticalmango", 2596),
    ("justleon", 2569), ("Nash_B", 2493), ("fiftyfourthmove", 2478),
]

passed = 0
failed = 0


def check(label, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print("  \033[32mPASS\033[0m %s  ->  %r" % (label, got))
    else:
        failed += 1
        print("  \033[31mFAIL\033[0m %s\n        got  %r\n        want %r" % (label, got, want))


def token(sub, app_meta=None, name="Tester"):
    """An HS256 token the server will accept, signed with the test secret."""
    def seg(raw):
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")
    header = seg(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    claims = {
        "sub": sub,
        "aud": "authenticated",
        "exp": int(time.time()) + 600,
        "user_metadata": {"game_name": name},
    }
    if app_meta is not None:
        claims["app_metadata"] = app_meta
    body = seg(json.dumps(claims).encode())
    signing_input = ("%s.%s" % (header, body)).encode()
    sig = seg(hmac.new(os.environ["SUPABASE_JWT_SECRET"].encode(), signing_input, hashlib.sha256).digest())
    return "%s.%s.%s" % (header, body, sig)


class FakeClient(server.Client):
    """A player with no socket under them, and a list where the wire would be."""

    def __init__(self, who):
        server.Client.__init__(self, None, ("test", 0))
        self.id = who
        self.sent = []

    def send(self, obj):
        self.sent.append(obj)

    def got(self, kind):
        return [m for m in self.sent if m.get("t") == kind]


def clear():
    with server.lock:
        server.lobby.clear()
        server.games.clear()
        server.by_user.clear()
        server.ai_recent.clear()
        server.player_ratings.clear()
        server.bot_ids = set()
        server.bot_ids_read = time.time()      # fresh: hello will not try the network


def rows_in_sql():
    """The (name, rating, id) triples the SQL file seeds, in file order."""
    text = open(SQL, encoding="utf-8").read()
    body = text.split("as t(id, name, rating)")[0]
    found = re.findall(r"\('([0-9a-f-]{36})'::uuid,\s*'([^']+)',\s*(\d+)\)", body)
    return [(name, int(rating), uid) for uid, name, rating in found]


def main():
    print("\n\033[1mWhat the SQL file seeds\033[0m")

    rows = rows_in_sql()
    check("twenty-one rows", len(rows), 21)
    check("the names and ratings are the brief's, in order",
          [(n, r) for n, r, _ in rows], WANTED)
    check("every id is distinct", len({uid for _, _, uid in rows}), 21)
    check("every name is distinct", len({n for n, _, _ in rows}), 21)
    check("every name passes the server's own name rule",
          [n for n, _, _ in rows if supabase_auth.clean_name(n) != n], [])
    check("none of them is a fallback opponent's name",
          sorted(set(server.AI_NAMES) & {n for n, _, _ in rows}), [])
    text = open(SQL, encoding="utf-8").read()
    check("the profile flag is the column the server reads",
          "is_bot boolean not null default false" in text
          and "/profiles?select=id&is_bot=eq.true" in open(os.path.join(HERE, "supabase_db.py")).read(),
          True)
    check("the auth rows carry the flag in app_metadata",
          "'is_bot', true" in text, True)
    check("the seed re-asserts rather than duplicates",
          "on conflict (id) do update" in text and "on conflict (id) do nothing" in text, True)

    print("\n\033[1mReading the flag from the database\033[0m")

    calls = []

    def fake_request(method, path, body=None, prefer=None):
        calls.append((method, path))
        return [{"id": "sys-1"}, {"id": "sys-2"}, {"nope": 1}]

    real_request, real_enabled = supabase_db._request, supabase_db.enabled
    supabase_db._request = fake_request
    supabase_db.enabled = lambda: True
    try:
        check("the ids flagged is_bot, and only those",
              supabase_db.bot_ids(), {"sys-1", "sys-2"})
        check("asked for with one read of one column",
              calls, [("GET", "/profiles?select=id&is_bot=eq.true")])
        clear()
        with server.lock:
            server.bot_ids_read = 0.0
        server.refresh_bot_ids()
        check("the server keeps the set", server.bot_ids, {"sys-1", "sys-2"})

        def failing(method, path, body=None, prefer=None):
            raise OSError("no route to host")
        supabase_db._request = failing
        with server.lock:
            server.bot_ids_read = 0.0
        server.refresh_bot_ids()
        check("a read that fails keeps the last set rather than emptying it",
              server.bot_ids, {"sys-1", "sys-2"})
        supabase_db._request = fake_request
        before = server.bot_ids_read
        server.refresh_bot_ids()
        check("and a fresh set is not re-read", server.bot_ids_read, before)
    finally:
        supabase_db._request, supabase_db.enabled = real_request, real_enabled
    check("with no database the answer is None, not an empty set", supabase_db.bot_ids(), None)

    print("\n\033[1mSaying hello as one\033[0m")

    clear()
    person = FakeClient("P1")
    server.handle_hello(person, {"token": token("acct-p1", name="Tester P1")})
    check("a real account still signs in", person.verified, True)
    check("under its own name", person.name, "Tester P1")
    check("and is not flagged", person.is_bot, False)
    check("and is reachable", "acct-p1" in server.by_user, True)

    clear()
    with server.lock:
        server.bot_ids = {"sys-arvenko"}
    ghost = FakeClient("S1")
    server.handle_hello(ghost, {"token": token("sys-arvenko", name="Arvenko"), "name": "Arvenko"})
    welcome = ghost.got("welcome")
    check("a token for a system profile is answered", len(welcome), 1)
    check("but not verified", welcome[0].get("verified"), False)
    check("and says why", welcome[0].get("reason"), "system profiles cannot sign in")
    check("the connection is nobody", ghost.user_id, None)
    check("and is flagged for the queue to see", ghost.is_bot, True)
    check("and is not reachable as the account", "sys-arvenko" in server.by_user, False)

    clear()
    tagged = FakeClient("S2")
    server.handle_hello(tagged, {"token": token("sys-leo", app_meta={"is_bot": True})})
    check("the token's own app_metadata is enough, with no database",
          (tagged.verified, tagged.is_bot), (False, True))
    lying = FakeClient("S3")
    server.handle_hello(lying, {"token": token("acct-l", app_meta={"is_bot": "yes"})})
    check("only a real true counts as the flag", (lying.verified, lying.is_bot), (True, False))

    # user_metadata is the half a user can write, so it must not be read
    clear()
    fibber = FakeClient("S4")
    fib = token("acct-f")
    server.handle_hello(fibber, {"token": fib})
    check("user_metadata cannot make anybody a system profile", fibber.is_bot, False)

    clear()
    with server.lock:
        server.bot_ids = {"sys-arvenko"}
    again = FakeClient("S5")
    server.handle_hello(again, {"token": token("sys-arvenko")})
    server.handle_hello(again, {"token": token("acct-real", name="Real One")})
    check("a second hello as somebody else clears the flag", (again.verified, again.is_bot), (True, False))
    server.handle_hello(again, {"token": token("sys-arvenko")})
    check("and a second hello as a system profile sets it again", (again.verified, again.is_bot), (False, True))

    print("\n\033[1mThe ranked door\033[0m")

    clear()
    with server.lock:
        server.bot_ids = {"sys-arvenko"}
    ghost = FakeClient("G1")
    server.handle_hello(ghost, {"token": token("sys-arvenko")})
    check("may_play_ranked says no", server.may_play_ranked(ghost), False)
    real_enabled = supabase_auth.enabled
    supabase_auth.enabled = lambda: False
    try:
        anyone = FakeClient("A1")
        check("...on a server where every guest may (control)", server.may_play_ranked(anyone), True)
        check("...it still says no", server.may_play_ranked(ghost), False)
    finally:
        supabase_auth.enabled = real_enabled

    ghost.sent = []
    server.handle_find(ghost, {"mode": "blind", "minutes": 5, "inc": 0, "kind": "ranked"})
    errs = ghost.got("error")
    check("find is refused", len(errs), 1)
    check("by name", errs[0].get("msg"), "system profiles do not play")
    check("nothing is queued", server.lobby, {})
    check("no countdown to a bot was armed", ghost.ai_timer, None)
    ghost.sent = []
    server.handle_find(ghost, {"mode": "blind", "minutes": 5, "inc": 0, "kind": "friendly"})
    check("the friendly queue refuses it too", ghost.got("error")[0].get("msg"), "system profiles do not play")
    check("and is empty", server.lobby, {})

    print("\n\033[1mNever a candidate\033[0m")

    # Suppose one were standing in the queue anyway — some future route put it
    # there. The place a partner is actually chosen must still walk past it.
    clear()
    server.AI_WAIT = 0.15
    key = ("blind", 5, 0, "ranked")
    stray = FakeClient("X1")
    stray.is_bot = True
    seeker = FakeClient("K1")
    server.handle_hello(seeker, {"token": token("acct-k1", name="Seeker")})
    with server.lock:
        server.lobby[key] = [stray]
        stray.queue_key = key
    server.handle_find(seeker, {"mode": "blind", "minutes": 5, "inc": 0, "kind": "ranked"})
    check("a stray system profile in the queue is not chosen", seeker.got("start"), [])
    check("the seeker waits instead", len(seeker.got("waiting")), 1)
    time.sleep(0.6)
    starts = seeker.got("start")
    check("and the fallback seats a bot as if nobody were there", len(starts), 1)
    start = starts[0] if starts else {}
    check("the opponent is a fallback name", start.get("opponent") in server.AI_NAMES, True)
    check("not a system profile", start.get("opponent") in {n for n, _, _ in rows}, False)
    check("the stray was never seated", stray.game, None)
    with server.lock:
        server.lobby.clear()
    if seeker.game:
        server.drop_client(seeker)

    # The stray as the *seeker*: the same key, somebody real waiting.
    clear()
    waiting = FakeClient("W1")
    server.handle_hello(waiting, {"token": token("acct-w1", name="Waiting")})
    with server.lock:
        server.lobby[key] = [waiting]
        waiting.queue_key = key
    stray2 = FakeClient("X2")
    stray2.is_bot = True
    server.handle_find(stray2, {"mode": "blind", "minutes": 5, "inc": 0, "kind": "ranked"})
    check("a system profile asking to play is not paired with the person waiting",
          (waiting.got("start"), stray2.got("start")), ([], []))
    check("who is still waiting", server.lobby.get(key), [waiting])
    with server.lock:
        server.cancel_ai_fallback(waiting)
        server.lobby.clear()

    print("\n\033[1mThe fallback opponent is not one of them\033[0m")

    clear()
    bot = server.BotClient(server.AI_NAMES[0], 1221)
    check("a fallback seat has no account", bot.user_id, None)
    check("is the fallback", bot.is_ai, True)
    check("and is not a system profile", bot.is_bot, False)
    check("the fallback names are names, not rows in the file",
          [n for n in server.AI_NAMES if n in text], [])

    print("\n%d passed, %d failed" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
