#!/usr/bin/env python3
"""Prove the practice table behaves, against the real database.

Like tools/check_supabase_puzzles.py, this is about row-level security and
column grants, which only exist on the server side of the wire and only apply
to a real signed-in identity — nothing in the JS test suites can see them. So
this asks for one access token and runs the checks that need it.

    1. open the game, sign in with Google
    2. devtools console:  (await sb.auth.getSession()).data.session.access_token
       (`sb` is the page's own client — a top-level `let`, so it answers to
       that name in the console but is not on `window`. If the page has not
       finished signing in, Application → Local Storage → the sb-*-auth-token
       entry → "access_token" has the same string.)
    3. SUPABASE_TEST_TOKEN='eyJ...' python3 tools/check_supabase_practice.py

What it writes: one row in practice_progress under mode 'probe', which is not
a real mode key (they are `square`, `lines`, `piece`, `attack`, `hold`,
`tracker`, `after`, `forcing`, `calc`, `branches`, `progressive`, and the
reserved `course` row) and so cannot be read as progress on any real drill.
The row is left behind because the browser role has no DELETE grant on
purpose; the command to remove it is printed at the end.

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
PROBE_MODE = "probe"
FOREIGN_UID = "00000000-0000-0000-0000-000000000000"

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

    # A signed-out (anon-key-only) select is also the closest thing to a
    # migration check available with no token: practice_progress revokes
    # anon's default SELECT (see supabase-migrate-practice.sql), so a
    # locked-down table refuses the anon key with an empty list or a
    # 401/403. If the migration has not been run yet, PostgREST instead
    # says the table itself is missing (code PGRST205), which fails this
    # the same way — and the detail printed below says why.
    print("\n\033[1mWithout a token, nothing is selectable\033[0m")
    status, body = rest("GET", "/rest/v1/practice_progress?select=mode&limit=5")
    check("the anon key alone cannot select any row",
          (status == 200 and body == []) or status in (401, 403),
          "(%s %s)" % (status, body))

    if not token:
        print("\n\033[1mThe rest needs a signed-in token\033[0m")
        for label in ("the probe row upserts as the token's own user",
                      "reading it back shows level 3",
                      "a foreign user_id is rewritten to the caller's own",
                      "mode 'not valid!' is refused by the check constraint"):
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

    print("\n\033[1mA row upserts and reads back as the token's own user\033[0m")
    status, body = rest("POST", "/rest/v1/practice_progress",
                        {"user_id": uid, "mode": PROBE_MODE, "level": 3},
                        token=token, prefer="resolution=merge-duplicates,return=representation")
    check("upsert {mode:'probe', level:3} succeeds",
          status in (200, 201) and isinstance(body, list) and body and body[0]["level"] == 3,
          "(%s %s)" % (status, body))
    status, rows = rest("GET",
                        "/rest/v1/practice_progress?select=level&mode=eq." + PROBE_MODE,
                        token=token)
    check("reading it back shows level 3",
          status == 200 and rows and rows[0]["level"] == 3,
          "(%s %s)" % (status, rows))

    print("\n\033[1mA foreign user_id cannot be made to stick\033[0m")
    # practice_touch is BEFORE INSERT/UPDATE and overwrites new.user_id with
    # auth.uid() before the RLS "with check" ever sees the row — so this
    # write does not fail, it lands under the caller's own id, merged onto
    # the same (user_id, mode) row the probe upsert above just made.
    status, body = rest("POST", "/rest/v1/practice_progress",
                        {"user_id": FOREIGN_UID, "mode": PROBE_MODE, "level": 7},
                        token=token, prefer="resolution=merge-duplicates,return=representation")
    status, rows = rest("GET",
                        "/rest/v1/practice_progress?select=user_id&mode=eq." + PROBE_MODE,
                        token=token)
    check("the row under this mode is only ever the caller's own",
          status == 200 and rows and all(r["user_id"] == uid for r in rows),
          "(%s %s)" % (status, rows))
    status, foreign_rows = rest("GET",
                                "/rest/v1/practice_progress?select=user_id&mode=eq." + PROBE_MODE +
                                "&user_id=eq." + FOREIGN_UID,
                                token=token)
    check("no row exists under the foreign uuid",
          foreign_rows == [], "(%s)" % (foreign_rows,))

    print("\n\033[1mAn invalid mode is refused\033[0m")
    status, body = rest("POST", "/rest/v1/practice_progress",
                        {"user_id": uid, "mode": "not valid!", "level": 1},
                        token=token, prefer="return=representation")
    check("mode 'not valid!' is refused by the check constraint",
          isinstance(status, int) and 400 <= status < 500,
          "(%s %s)" % (status, body))

    return report()


def report():
    print("\n\033[1m%d passed, %d failed, %d skipped\033[0m" % (passed, failed, skipped))
    print("\nTo clear what this wrote, in the Supabase SQL editor:")
    print("  delete from public.practice_progress where mode = 'probe';\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
