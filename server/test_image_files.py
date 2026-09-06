#!/usr/bin/env python3
"""Everything the server is willing to serve is actually in the image.

    python3 server/test_image_files.py        # no server needed, no Docker needed

`STATIC_FILES` in server.py is an allowlist — there is no directory serving and
no path to traverse, which is the point. The cost of that is a failure mode with
no error in it anywhere: adding an entry to the allowlist and forgetting the
matching `COPY` in the Dockerfile is not a build error (the Dockerfile does not
know what the server serves), not a server error (the process starts fine, and
`serve_static_file` answers a clean 404 on `OSError`), and not a page error
either. It is a feature that quietly reports itself as missing, in its own
words, to whoever opens it.

That is exactly how the two board Practices shipped: `practices/opening.json`
and `practices/middlegame.json` were checked in, allowlisted and correct, and
the image never carried them. `pcFetch()` cannot tell an absent file from an
empty one, so both cards on the Practice page said "Not installed yet" for a
whole deploy while working perfectly from a checkout. Nothing in the repo could
have caught it, because every test ran against the repo.

So this suite reads the two lists that have to agree and compares them: every
path in `STATIC_FILES` against the `COPY` lines that build the image. It reads
the Dockerfile as text rather than building it, so it costs milliseconds and
runs anywhere — a real `docker build` is still the only thing that proves the
image runs, and this is the thing that proves it will have anything to serve.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BOLD, GREEN, RED = "\033[1m", "\033[32m", "\033[31m"
OFF = "\033[0m"

passed = failed = 0


def check(label, got, want):
    global passed, failed
    if got == want:
        passed += 1
        print("  %sPASS%s %s  ->  %s" % (GREEN, OFF, label, got))
    else:
        failed += 1
        print("  %sFAIL%s %s\n        got  %r\n        want %r" % (RED, OFF, label, got, want))


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
        return fh.read()


def allowlisted():
    """The (url, file) pairs server.py will serve, read out of STATIC_FILES."""
    body = re.search(r"STATIC_FILES\s*=\s*\{(.*?)\n\}", read("server/server.py"), re.S)
    assert body, "STATIC_FILES not found in server.py — has it been renamed?"
    return re.findall(r'"(/[^"]*)":\s*\("([^"]+)"', body.group(1))


def copied():
    """The paths the Dockerfile brings into the image, as repo-relative names.

    Only the source half of each COPY matters here. A directory copy covers
    everything under it, which is why these are kept as prefixes rather than
    expanded: `COPY puzzles/ ./puzzles/` is what makes puzzles/modes/*.json
    present without anybody having to list the five pools again.
    """
    out = []
    for line in read("Dockerfile").splitlines():
        m = re.match(r"^COPY\s+(?!--)(\S+)\s+(\S+)\s*$", line)
        if m:
            out.append(m.group(1))
    return out


def in_image(path, prefixes):
    for p in prefixes:
        if p.endswith("/"):
            if path.startswith(p):
                return True
        elif path == p:
            return True
    return False


def main():
    print("\n%sEvery allowlisted file is in the image%s\n" % (BOLD, OFF))

    entries = allowlisted()
    prefixes = copied()

    check("the allowlist was found and is not empty", len(entries) > 0, True)
    check("the Dockerfile still copies things", len(prefixes) > 0, True)

    # 1. every allowlisted file exists in the repo at all
    absent = [f for _, f in entries if not os.path.exists(os.path.join(ROOT, f))]
    check("every allowlisted file exists in the repo", absent, [])

    # 2. and every one of them is inside something the Dockerfile copies.
    #    This is the check that was missing.
    uncopied = sorted({f for _, f in entries if not in_image(f, prefixes)})
    check("every allowlisted file is COPYed into the image", uncopied, [])

    # 3. the two that actually shipped broken, named outright — a regression
    #    test is worth more when it says which bug it is about
    for name in ("practices/opening.json", "practices/middlegame.json"):
        check("the image carries " + name, in_image(name, prefixes), True)
    check("...and it is one COPY that does it, not two",
          "practices/" in prefixes, True)

    # 4. the puzzle pools travel the same way, under puzzles/
    for pool in ("sighted", "board", "blindfold", "fog", "rush"):
        f = "puzzles/modes/%s.json" % pool
        check("the image carries " + f, in_image(f, prefixes), True)

    # 5. and the things that are deliberately OUT stay out: tools/ mines and
    #    verifies the corpus and education/concepts/ is research material, so
    #    an allowlist entry reaching into either is a mistake in the allowlist
    #    rather than a missing COPY.
    reaching = sorted({f for _, f in entries
                       if f.startswith("tools/") or f.startswith("education/concepts/")
                       or f.startswith("education/tools/") or f.startswith("work/")})
    check("nothing build-time or research-only is served", reaching, [])
    check("tools/ is not in the image", in_image("tools/sf.js", prefixes), False)

    print("\n%s%d passed, %d failed%s\n" % (BOLD, passed, failed, OFF))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
