"""The puzzle rating, without a socket.

test_two_clients.py can only reach the guest branch: signing a token needs
SUPABASE_JWT_SECRET, and a server that has one refuses to start without PyJWT.
The signed-in branch is the one that matters most — it is the branch that
decides what a real player is worth — so it is tested here directly, against
the handler itself.

No server, no network:  python3 server/test_puzzle_rating.py
"""

import base64
import json
import os
import sys
import urllib.error as urllib_error
import urllib.request as urllib_request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server
import supabase_db

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


class FakeClient:
    """Enough of a client for the handler: an identity and somewhere to reply."""

    def __init__(self, user_id=None):
        self.id = user_id or "guest"
        self.user_id = user_id
        self.verified = user_id is not None
        self.sent = []

    def send(self, msg):
        self.sent.append(msg)

    @property
    def last(self):
        return self.sent[-1]


def main():
    # a small set of our own, so these numbers do not move when the ladders are
    # regenerated
    server.PUZZLE_RATINGS.clear()
    server.PUZZLE_RATINGS.update({"pz-easy": 600, "pz-even": 1200, "pz-hard": 1900})
    server.puzzle_ratings.clear()
    server.rated_puzzles.clear()

    print("\n\033[1mThe arithmetic\033[0m")

    check("an even match is worth half of K", server.elo_after(1200, 1200, True) - 1200, 10)
    check("and costs the same when lost", 1200 - server.elo_after(1200, 1200, False), 10)
    # eight hundred points up, the solver is expected to fail about 99 times in
    # 100, so finding it is worth the whole of K
    check("beating a much stronger puzzle is worth all of K",
          server.elo_after(1200, 2000, True) - 1200, 20)
    check("beating a much weaker one is worth almost nothing",
          server.elo_after(1200, 400, True) - 1200, 0)
    check("but losing to it hurts", 1200 - server.elo_after(1200, 400, False), 20)
    check("nothing falls through the floor", server.elo_after(400, 3200, False), 400)
    check("nor climbs past the ceiling", server.elo_after(3200, 400, True), 3200)

    print("\n\033[1mA player the server knows\033[0m")

    me = FakeClient("user-1")
    server.handle_puzzle_result(me, {"t": "puzzleResult", "puzzleId": "pz-even", "solved": True})
    check("a new player starts at the opening rating and moves up",
          me.last["rating"], server.elo_after(server.PUZZLE_START, 1200, True))
    check("the move is reported", me.last["delta"], 10)
    check("and it is remembered", server.puzzle_ratings["user-1"], me.last["rating"])
    check("stored only where there is somewhere to store it",
          me.last["saved"], supabase_db.enabled())

    after_first = me.last["rating"]
    server.handle_puzzle_result(me, {"t": "puzzleResult", "puzzleId": "pz-even", "solved": True})
    check("the same puzzle again moves nothing", me.last["delta"], 0)
    check("and leaves the rating where it was", me.last["rating"], after_first)

    # The browser opens a socket per result, so the guard has to survive one
    # closing. A fresh connection for the same account is the same player.
    again = FakeClient("user-1")
    server.handle_puzzle_result(again, {"t": "puzzleResult", "puzzleId": "pz-even", "solved": True})
    check("nor does it on a brand new connection", again.last["delta"], 0)
    check("which is the whole point, since every result opens one",
          again.last["rating"], after_first)
    # but a puzzle that account has not been rated on still counts
    server.handle_puzzle_result(again, {"t": "puzzleResult", "puzzleId": "pz-easy", "solved": True})
    check("a puzzle it has not done yet still counts", again.last["delta"] >= 0, True)
    # and another account is unaffected by any of it
    fresh = FakeClient("user-9")
    server.handle_puzzle_result(fresh, {"t": "puzzleResult", "puzzleId": "pz-even", "solved": True})
    check("a different account is rated on it normally", fresh.last["delta"] > 0, True)

    server.handle_puzzle_result(me, {"t": "puzzleResult", "puzzleId": "pz-hard", "solved": True})
    check("a different puzzle still counts", me.last["rating"] > after_first, True)

    # the browser's claim about its own rating is ignored for a signed-in player
    liar = FakeClient("user-2")
    server.handle_puzzle_result(liar, {
        "t": "puzzleResult", "puzzleId": "pz-even", "solved": True, "playerRating": 3000,
    })
    check("a signed-in player cannot name their own rating",
          liar.last["rating"], server.elo_after(server.PUZZLE_START, 1200, True))

    # failing is not free
    loser = FakeClient("user-3")
    server.handle_puzzle_result(loser, {"t": "puzzleResult", "puzzleId": "pz-easy", "solved": False})
    check("failing an easy puzzle costs", loser.last["rating"] < server.PUZZLE_START, True)

    print("\n\033[1mA player it does not\033[0m")

    guest = FakeClient(None)
    server.handle_puzzle_result(guest, {
        "t": "puzzleResult", "puzzleId": "pz-even", "solved": True, "playerRating": 1500,
    })
    check("a guest is priced from what they report",
          guest.last["rating"], server.elo_after(1500, 1200, True))
    check("and nothing is stored", guest.last["saved"], False)
    check("nor kept anywhere on the server", "guest" in server.puzzle_ratings, False)

    server.handle_puzzle_result(guest, {
        "t": "puzzleResult", "puzzleId": "pz-even", "solved": True, "playerRating": "nonsense",
    })
    check("a rating that is not a number falls back to the opening one",
          guest.last["rating"], server.elo_after(server.PUZZLE_START, 1200, True))

    print("\n\033[1mWhat it refuses\033[0m")

    bad = FakeClient("user-4")
    server.handle_puzzle_result(bad, {"t": "puzzleResult", "puzzleId": "nope", "solved": True})
    check("an unknown puzzle is refused", bad.last["t"], "error")
    server.handle_puzzle_result(bad, {"t": "puzzleResult", "solved": True})
    check("a missing puzzle id is refused", bad.last["t"], "error")
    server.handle_puzzle_result(bad, {"t": "puzzleResult", "puzzleId": 7, "solved": True})
    check("an id that is not a string is refused", bad.last["t"], "error")
    check("and none of that rated anybody", "user-4" in server.puzzle_ratings, False)

    print("\n\033[1mStoring it, and knowing whether it stored\033[0m")

    # PostgREST answers 204 to an UPDATE that changed nothing, including one
    # row-level security filtered away, so "no error" is not "saved". These
    # stand in for the four things the network can come back with.
    import urllib.error
    calls = []

    def answering(result):
        def fake(method, path, body=None, prefer=None):
            calls.append((method, path, body, prefer))
            if isinstance(result, Exception):
                raise result
            return result
        return fake

    real_request, real_url, real_key = supabase_db._request, supabase_db.REST, supabase_db.SERVICE_KEY
    supabase_db.REST, supabase_db.SERVICE_KEY = "https://example.test/rest/v1", "service-key"
    try:
        supabase_db._request = answering([{"puzzle_rating": 1300}])
        check("a row that comes back changed is stored",
              supabase_db.set_puzzle_rating("user-1", 1300), True)
        check("and it asked for the row back, not for silence",
              calls[-1][3], "return=representation")

        supabase_db._request = answering([])
        check("a write that changed no row is not stored",
              supabase_db.set_puzzle_rating("user-1", 1300), False)

        supabase_db._request = answering([{"puzzle_rating": 1200}])
        check("nor is one that came back holding something else",
              supabase_db.set_puzzle_rating("user-1", 1300), False)

        supabase_db._request = answering(urllib.error.URLError("down"))
        check("nor is one that never arrived",
              supabase_db.set_puzzle_rating("user-1", 1300), False)

        supabase_db._request = answering([{"puzzle_rating": 1400}])
        check("reading a rating back works the same way",
              supabase_db.get_puzzle_rating("user-1"), 1400)
        supabase_db._request = answering([])
        check("and a profile with no row reads as nothing",
              supabase_db.get_puzzle_rating("user-1"), None)
    finally:
        supabase_db._request, supabase_db.REST, supabase_db.SERVICE_KEY = real_request, real_url, real_key

    check("with nothing configured it never claims to have stored",
          supabase_db.set_puzzle_rating("user-1", 1300), False)

    print("\n\033[1mThe rating survives a restart, when there is a key\033[0m")

    # A stand-in for the profiles table, wired in where the HTTP would be. This
    # is the loop the deployment depends on: the server prices an attempt, the
    # row changes, and a server that has just started up reads it back instead
    # of starting everybody at 1200 again.
    stored_rows = {"user-restart": {"puzzle_rating": 1200}}

    def fake_rest(method, path, body=None, prefer=None):
        uid = path.split("id=eq.")[1].split("&")[0]
        row = stored_rows.setdefault(uid, {"puzzle_rating": 1200})
        if method == "PATCH":
            row.update(body)
        return [dict(row)]

    real_request = supabase_db._request
    real_url, real_key = supabase_db.REST, supabase_db.SERVICE_KEY
    supabase_db._request = fake_rest
    supabase_db.REST, supabase_db.SERVICE_KEY = "https://example.test/rest/v1", "sb_secret_pretend"
    server.puzzle_ratings.clear()
    server.rated_puzzles.clear()
    try:
        check("with a key configured, the server says it can store", supabase_db.enabled(), True)

        who = FakeClient("user-restart")
        server.handle_puzzle_result(who, {"t": "puzzleResult", "puzzleId": "pz-hard", "solved": True})
        earned = who.last["rating"]
        check("a solve is reported as stored", who.last["saved"], True)
        check("and the row really holds the new rating",
              stored_rows["user-restart"]["puzzle_rating"], earned)
        check("which is not where it started", earned != 1200, True)

        # the restart: everything the process was holding goes away
        server.puzzle_ratings.clear()
        server.rated_puzzles.clear()
        back = FakeClient("user-restart")
        check("a restarted server reads the stored rating back",
              server.puzzle_rating_of(back), earned)

        # and the next attempt continues from it rather than from 1200
        server.handle_puzzle_result(back, {"t": "puzzleResult", "puzzleId": "pz-even", "solved": True})
        check("the next attempt carries on from there",
              back.last["rating"], earned + back.last["delta"])
        check("and that is stored too",
              stored_rows["user-restart"]["puzzle_rating"], back.last["rating"])

        # a player nobody has rated yet still opens at the starting rating
        check("an account with no history opens at the start",
              server.puzzle_rating_of(FakeClient("user-brand-new")), server.PUZZLE_START)
    finally:
        supabase_db._request = real_request
        supabase_db.REST, supabase_db.SERVICE_KEY = real_url, real_key
        server.puzzle_ratings.clear()
        server.rated_puzzles.clear()

    print("\n\033[1mWhich key, and which headers it travels in\033[0m")

    # Supabase issues two shapes of secret. The modern one is not a JWT, and
    # PostgREST tries to parse the Bearer header as one, so it must not go
    # there — see the module docstring for the 401 that results.
    import importlib

    def with_key(key, url="https://example.test"):
        os.environ["SUPABASE_URL"] = url
        os.environ["SUPABASE_SERVICE_KEY"] = key
        # the module complains about a bad key on import, which is the point of
        # it — but these cases hand it bad keys deliberately, so the complaint
        # is caught here rather than printed through the middle of the results
        noise, sys.stderr = sys.stderr, open(os.devnull, "w")
        try:
            return importlib.reload(supabase_db)
        finally:
            sys.stderr.close()
            sys.stderr = noise

    def headers_for(key):
        mod = with_key(key)
        seen = {}
        real = urllib_request.urlopen

        def fake(req, timeout=0):
            seen.update({k.lower(): v for k, v in req.header_items()})
            raise urllib_error.URLError("not actually sent")

        urllib_request.urlopen = fake
        try:
            mod.get_puzzle_rating("someone")
        finally:
            urllib_request.urlopen = real
        return mod, seen

    def jwt_like(role):
        seg = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip("=")
        return seg({"alg": "HS256"}) + "." + seg({"role": role}) + ".signature"

    mod, seen = headers_for("sb_secret_pretend_not_a_real_key")
    check("a modern secret key is accepted", mod.enabled(), True)
    check("and identifies itself in apikey", seen.get("Apikey".lower()) is not None, True)
    check("and never in Authorization, which PostgREST reads as a JWT",
          "authorization" in seen, False)

    mod, seen = headers_for(jwt_like("service_role"))
    check("a legacy service_role JWT is accepted", mod.enabled(), True)
    check("and does travel in Authorization too", "authorization" in seen, True)

    mod = with_key("sb_publishable_pretend")
    check("a publishable key is refused outright", mod.enabled(), False)
    mod = with_key(jwt_like("anon"))
    check("so is a legacy anon JWT", mod.enabled(), False)
    mod = with_key(jwt_like("authenticated"))
    check("and so is a user's own token", mod.enabled(), False)

    mod = with_key("  sb_secret_padded  ")
    check("whitespace around a pasted key is trimmed", mod.enabled(), True)
    mod = with_key("sb_secret_pretend", url="")
    check("a key with no project URL is not enough", mod.enabled(), False)

    os.environ.pop("SUPABASE_URL", None)
    os.environ.pop("SUPABASE_SERVICE_KEY", None)
    importlib.reload(supabase_db)

    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
