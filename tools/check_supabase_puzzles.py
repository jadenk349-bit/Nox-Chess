#!/usr/bin/env python3
"""Prove the puzzle tables behave, against the real database.

Everything else in this repository can be tested without Supabase. These
checks cannot: they are about row-level security and column grants, which only
exist on the server side of the wire and only apply to a real signed-in
identity. So this asks for one access token and runs the checks that need it.

    1. open the game, sign in with Google
    2. devtools console:  (await sb.auth.getSession()).data.session.access_token
       (`sb` is the page's own client — a top-level `let`, so it answers to
       that name in the console but is not on `window`. If the page has not
       finished signing in, Application → Local Storage → the sb-*-auth-token
       entry → "access_token" has the same string.)
    3. SUPABASE_TEST_TOKEN='eyJ...' python3 tools/check_supabase_puzzles.py

What it writes: one row in puzzle_progress with puzzle_id 'probe-selftest',
which is not a real puzzle id and so cannot affect any ladder, and one write of
your display_name back to the value it already has. Nothing else. The row is
left behind because the browser role has no DELETE grant on purpose; the
command to remove it is printed at the end.

The project URL and publishable key are read out of blind-chess.html, so this
cannot end up checking a different project from the one the game talks to.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), "blind-chess.html")
PROBE_ID = "probe-selftest"

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
    with open(PAGE) as fh:
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


def main():
    token = os.environ.get("SUPABASE_TEST_TOKEN", "").strip()
    print("\n\033[1mProject\033[0m\n  %s" % URL)

    print("\n\033[1mThe migration is in place\033[0m")
    status, rows = rest("GET", "/rest/v1/profiles?select=id,rating,puzzle_rating&limit=1")
    check("profiles has a puzzle_rating column",
          status == 200 and isinstance(rows, list) and (not rows or "puzzle_rating" in rows[0]),
          "(%s %s)" % (status, rows))
    status, body = rest("GET", "/rest/v1/puzzle_progress?select=puzzle_id&limit=1")
    check("puzzle_progress exists and is queryable", status == 200, "(%s %s)" % (status, body))

    print("\n\033[1mWithout an account, nothing is readable or writable\033[0m")
    status, rows = rest("GET", "/rest/v1/puzzle_progress?select=*&limit=5")
    check("a signed-out reader sees no progress at all", rows == [], "(%s)" % (rows,))
    status, body = rest("POST", "/rest/v1/puzzle_progress",
                        {"user_id": "00000000-0000-0000-0000-000000000000",
                         "track": "opening", "puzzle_id": PROBE_ID, "solved": True},
                        prefer="return=representation")
    check("a signed-out writer is refused by row-level security",
          status in (401, 403) and isinstance(body, dict) and body.get("code") == "42501",
          "(%s %s)" % (status, body))

    if not token:
        print("\n\033[1mThe rest needs a signed-in token\033[0m")
        for label in ("progress saves to the account",
                      "progress reads back from the account",
                      "one account cannot read another's progress",
                      "one account cannot write to another's progress",
                      "a reveal cannot undo a stored solve",
                      "the browser cannot change puzzle_rating",
                      "the browser can still change its display name"):
            skip(label, "set SUPABASE_TEST_TOKEN (see the top of this file)")
        return report()

    print("\n\033[1mWho the token is\033[0m")
    status, me = rest("GET", "/auth/v1/user", token=token)
    if status != 200 or not isinstance(me, dict) or not me.get("id"):
        check("the token is a live session", False, "(%s %s)" % (status, me))
        return report()
    uid = me["id"]
    check("the token is a live session", True)
    print("  (signed in as %s)" % (me.get("email") or uid))

    print("\n\033[1mProgress belongs to the account\033[0m")
    status, body = rest("POST", "/rest/v1/puzzle_progress",
                        {"user_id": uid, "track": "opening", "puzzle_id": PROBE_ID, "solved": True},
                        token=token, prefer="resolution=merge-duplicates,return=representation")
    check("progress saves to the account",
          status in (200, 201) and isinstance(body, list) and body and body[0]["solved"] is True,
          "(%s %s)" % (status, body))
    status, rows = rest("GET",
                        "/rest/v1/puzzle_progress?select=track,puzzle_id,solved&puzzle_id=eq." + PROBE_ID,
                        token=token)
    check("progress reads back from the account",
          status == 200 and rows and rows[0]["puzzle_id"] == PROBE_ID,
          "(%s %s)" % (status, rows))
    check("and it carries its track",
          bool(rows) and rows[0]["track"] == "opening", "(%s)" % (rows,))

    print("\n\033[1mAnother account's progress is out of reach\033[0m")
    status, others = rest("GET", "/rest/v1/profiles?select=id&limit=20")
    stranger = next((r["id"] for r in (others or []) if r["id"] != uid), None)
    if stranger is None:
        skip("one account cannot read another's progress", "this project has only one account")
        skip("one account cannot write to another's progress", "this project has only one account")
    else:
        status, rows = rest("GET",
                            "/rest/v1/puzzle_progress?select=*&user_id=eq." + stranger, token=token)
        check("one account cannot read another's progress", rows == [],
              "(saw %s)" % (rows,))
        status, body = rest("POST", "/rest/v1/puzzle_progress",
                            {"user_id": stranger, "track": "opening",
                             "puzzle_id": "probe-intrusion", "solved": True},
                            token=token, prefer="return=representation")
        check("one account cannot write to another's progress",
              status in (401, 403) and isinstance(body, dict) and body.get("code") == "42501",
              "(%s %s)" % (status, body))

    print("\n\033[1mA solve is never undone\033[0m")
    status, body = rest("PATCH",
                        "/rest/v1/puzzle_progress?puzzle_id=eq." + PROBE_ID + "&user_id=eq." + uid,
                        {"solved": False}, token=token, prefer="return=representation")
    check("a reveal cannot undo a stored solve",
          isinstance(body, list) and body and body[0]["solved"] is True,
          "(%s %s)" % (status, body))

    print("\n\033[1mThe rating is not the browser's to set\033[0m")
    status, before = rest("GET", "/rest/v1/profiles?select=display_name,puzzle_rating&id=eq." + uid,
                          token=token)
    current = before[0] if before else {}
    status, body = rest("PATCH", "/rest/v1/profiles?id=eq." + uid,
                        {"puzzle_rating": 3000}, token=token, prefer="return=representation")
    denied = (status in (401, 403)) or body == []
    check("the browser cannot change puzzle_rating", denied, "(%s %s)" % (status, body))
    status, after = rest("GET", "/rest/v1/profiles?select=puzzle_rating&id=eq." + uid, token=token)
    check("and the stored rating did not move",
          after and after[0]["puzzle_rating"] == current.get("puzzle_rating"),
          "(%s -> %s)" % (current.get("puzzle_rating"), after))

    # the control: the same token writing a column it *is* granted, put back as
    # it was. Without this, "cannot write" might just mean "token is broken".
    status, body = rest("PATCH", "/rest/v1/profiles?id=eq." + uid,
                        {"display_name": current.get("display_name")},
                        token=token, prefer="return=representation")
    check("the browser can still change its display name",
          isinstance(body, list) and len(body) == 1, "(%s %s)" % (status, body))

    return report()


def report():
    print("\n\033[1m%d passed, %d failed, %d skipped\033[0m" % (passed, failed, skipped))
    print("\nTo clear what this wrote, in the Supabase SQL editor:")
    print("  delete from public.puzzle_progress where puzzle_id like 'probe-%';\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
