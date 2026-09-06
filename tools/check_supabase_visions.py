#!/usr/bin/env python3
"""Prove the four ladders behave, against the real database.

supabase-migrate-visions.sql cannot be run from this repository, and nothing
here can tell whether it has been. This asks the project — with the page's own
publishable key, so it cannot end up checking a different project from the
one the game talks to — and reports one of two things:

    the migration has not been run     three columns missing; the home page's
                                       three vision panels will say which file
                                       to run, and this says the same
    the migration is in place          then every check below is made

What it checks with no token: the four columns exist; each ladder's top
twenty is twenty rows, highest first, twenty different names; the three
vision ladders are system profiles from top to bottom; the same player
stands at different numbers on different ladders; the Sighted ladder still
reads exactly as supabase-system-profiles.sql wrote it; and neither the seed
record, the game record nor record_rated_game() is reachable from the
browser's role.

With SUPABASE_TEST_TOKEN — see tools/check_supabase_puzzles.py for how to
get one — it also tries, as a signed-in player, to write each of the four
rating columns, and expects to be refused on all four while still being
allowed to write display_name. Nothing it writes changes anything: the one
write that succeeds puts the name back to the value it already has.

    python3 tools/check_supabase_visions.py
    SUPABASE_TEST_TOKEN='eyJ...' python3 tools/check_supabase_visions.py
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAGE = os.path.join(ROOT, "blind-chess.html")
SYSTEM_SQL = os.path.join(ROOT, "supabase-system-profiles.sql")
MIGRATION = "supabase-migrate-visions.sql"

LADDERS = [
    ("Sighted", "rating"),
    ("Complete Blindfold", "complete_blindfold_rating"),
    ("Board Only", "board_only_rating"),
    ("Fog of War", "fog_of_war_rating"),
]

passed = failed = skipped = 0


def check(label, ok, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print("  \033[32mPASS\033[0m %s" % label)
    else:
        failed += 1
        print("  \033[31mFAIL\033[0m %s %s" % (label, detail))


def skip(label, why):
    global skipped
    skipped += 1
    print("  \033[33mSKIP\033[0m %s — %s" % (label, why))


def page_keys():
    with open(PAGE, encoding="utf-8") as fh:
        src = fh.read()
    url = re.search(r"const SUPABASE_URL\s*=\s*'([^']+)'", src)
    key = re.search(r"const SUPABASE_ANON_KEY\s*=\s*'([^']+)'", src)
    if not url or not key:
        sys.exit("could not read the Supabase keys out of blind-chess.html")
    return url.group(1).rstrip("/"), key.group(1)


URL, ANON = page_keys()


def rest(method, path, body=None, token=None, prefer=None):
    """-> (status, parsed body or text)"""
    req = urllib.request.Request(URL + path, method=method)
    req.add_header("apikey", ANON)
    req.add_header("Authorization", "Bearer " + (token or ANON))
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps(body).encode()
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            return err.code, json.loads(raw)
        except ValueError:
            return err.code, raw
    except Exception as err:                     # noqa: BLE001 - reported, not raised
        return None, str(err)


def ladder(column):
    status, rows = rest("GET", "/rest/v1/profiles?select=id,display_name,is_bot,%s"
                        "&order=%s.desc,display_name.asc&limit=20" % (column, column))
    return status, rows


def system_profiles():
    """name -> rating, as supabase-system-profiles.sql wrote them."""
    text = open(SYSTEM_SQL, encoding="utf-8").read().split("as t(id, name, rating)")[0]
    return {name: int(rating)
            for _, name, rating in re.findall(r"\('([0-9a-f-]{36})'::uuid,\s*'([^']+)',\s*(\d+)\)", text)}


def main():
    token = os.environ.get("SUPABASE_TEST_TOKEN", "").strip()
    print("\n\033[1mProject\033[0m\n  %s" % URL)

    print("\n\033[1mThe migration\033[0m")
    missing = []
    for label, column in LADDERS:
        status, body = rest("GET", "/rest/v1/profiles?select=%s&limit=1" % column)
        if status != 200:
            missing.append(column)
    if missing:
        check("profiles has the four rating columns", False,
              "\n        missing: %s\n        run %s in the Supabase SQL editor; until then the home "
              "page's vision panels say the same" % (", ".join(missing), MIGRATION))
        return report()
    check("profiles has the four rating columns", True)

    print("\n\033[1mThe four ladders\033[0m")
    standing = {}                       # name -> {column: rating}
    for label, column in LADDERS:
        status, rows = ladder(column)
        ok = status == 200 and isinstance(rows, list)
        check("%s: readable without an account" % label, ok, "(%s %s)" % (status, rows))
        if not ok:
            continue
        ratings = [r[column] for r in rows]
        names = [r["display_name"] for r in rows]
        check("%s: twenty rows" % label, len(rows) == 20, "(%d)" % len(rows))
        check("%s: highest first" % label, ratings == sorted(ratings, reverse=True), "(%s)" % ratings)
        check("%s: twenty different names" % label, len({n.lower() for n in names}) == len(names))
        if column != "rating":
            check("%s: system profiles from top to bottom" % label,
                  all(r.get("is_bot") is True for r in rows),
                  "(%s)" % [r["display_name"] for r in rows if not r.get("is_bot")])
        for r in rows:
            standing.setdefault(r["display_name"], {})[column] = r[column]

    shared = {n: v for n, v in standing.items() if len(v) >= 2}
    check("a player on several ladders stands at a different number on each",
          bool(shared) and all(len(set(v.values())) == len(v) for v in shared.values()),
          "(%s)" % {n: v for n, v in shared.items() if len(set(v.values())) != len(v)})

    print("\n\033[1mThe Sighted ladder is exactly what it was\033[0m")
    wanted = system_profiles()
    status, rows = rest("GET", "/rest/v1/profiles?select=display_name,rating&is_bot=eq.true"
                        "&display_name=in.(%s)" % ",".join('"%s"' % n for n in wanted))
    got = {r["display_name"]: r["rating"] for r in (rows or [])} if status == 200 else {}
    moved = {n: (wanted[n], got.get(n)) for n in wanted if got.get(n) != wanted[n]}
    check("the twenty-one system profiles keep their Sighted ratings", not moved, "(%s)" % moved)

    print("\n\033[1mClosed to the browser's role\033[0m")
    status, body = rest("GET", "/rest/v1/rating_seeds?select=mode&limit=1")
    check("the seed record is not readable", status in (401, 403, 404) or body == [], "(%s %s)" % (status, body))
    status, body = rest("GET", "/rest/v1/rated_games?select=id&limit=1")
    check("the game record is not readable", status in (401, 403, 404) or body == [], "(%s %s)" % (status, body))
    status, body = rest("POST", "/rest/v1/rpc/record_rated_game",
                        {"p_game": "probe-refused", "p_mode": "fog",
                         "p_white": "00000000-0000-0000-0000-000000000000",
                         "p_black": "00000000-0000-0000-0000-000000000001",
                         "p_result": "1-0"})
    check("record_rated_game() cannot be called signed out",
          status in (401, 403, 404), "(%s %s)" % (status, body))

    if not token:
        print("\n\033[1mThe rest needs a signed-in token\033[0m")
        for label, column in LADDERS:
            skip("the browser cannot change %s" % column, "set SUPABASE_TEST_TOKEN (see the top of this file)")
        skip("record_rated_game() cannot be called signed in", "set SUPABASE_TEST_TOKEN")
        skip("the browser can still change its display name", "set SUPABASE_TEST_TOKEN")
        return report()

    print("\n\033[1mWho the token is\033[0m")
    status, me = rest("GET", "/auth/v1/user", token=token)
    if status != 200 or not isinstance(me, dict) or not me.get("id"):
        check("the token is a live session", False, "(%s %s)" % (status, me))
        return report()
    uid = me["id"]
    check("the token is a live session", True)
    print("  (signed in as %s)" % (me.get("email") or uid))

    print("\n\033[1mNo rating is the player's to set\033[0m")
    cols = ",".join(c for _, c in LADDERS)
    status, before = rest("GET", "/rest/v1/profiles?select=display_name,%s&id=eq.%s" % (cols, uid), token=token)
    current = before[0] if before else {}
    for label, column in LADDERS:
        status, body = rest("PATCH", "/rest/v1/profiles?id=eq." + uid,
                            {column: 3000}, token=token, prefer="return=representation")
        denied = (status in (401, 403)) or body == []
        check("the browser cannot change %s" % column, denied, "(%s %s)" % (status, body))
    status, after = rest("GET", "/rest/v1/profiles?select=%s&id=eq.%s" % (cols, uid), token=token)
    unchanged = bool(after) and all(after[0][c] == current.get(c) for _, c in LADDERS)
    check("and none of the four moved", unchanged, "(%s -> %s)" % (current, after))
    status, body = rest("POST", "/rest/v1/rpc/record_rated_game",
                        {"p_game": "probe-refused", "p_mode": "fog", "p_white": uid,
                         "p_black": "00000000-0000-0000-0000-000000000001", "p_result": "1-0"},
                        token=token)
    check("record_rated_game() cannot be called signed in", status in (401, 403, 404), "(%s %s)" % (status, body))

    # the control: the same token writing a column it *is* granted, put back as
    # it was. Without this, "cannot write" might just mean "token is broken".
    status, body = rest("PATCH", "/rest/v1/profiles?id=eq." + uid,
                        {"display_name": current.get("display_name")},
                        token=token, prefer="return=representation")
    check("the browser can still change its display name",
          isinstance(body, list) and len(body) == 1, "(%s %s)" % (status, body))
    return report()


def report():
    print("\n\033[1m%d passed, %d failed, %d skipped\033[0m\n" % (passed, failed, skipped))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
