"""The seven house rooms on the friendly page, without a socket.

test_two_clients.py joins each of them over the wire. What is here is the part
worth poking at directly: what the list says and in what order, what a join
does to it, and the handful of guarantees about what a house room is *not* —
not a queue entry, not an account, not a name anybody else can wear, not a way
into a ranked game, and never a hole in the list.

No server, no network:  python3 server/test_house_rooms.py
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server          # noqa: E402
import supabase_auth   # noqa: E402

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


class FakeClient(server.Client):
    """A player with no socket under them, and a list where the wire would be."""

    def __init__(self, who):
        server.Client.__init__(self, None, ("test", 0))
        self.id = who
        self.name = who
        self.sent = []

    def send(self, obj):
        self.sent.append(obj)

    def got(self, kind):
        return [m for m in self.sent if m.get("t") == kind]


def house():
    with server.lock:
        return [r for r in server.room_list() if r["name"] in NAMES]


NAMES = [n for _, n, _, _, _ in server.HOUSE_ROOMS]


def main():
    server.LOG = False
    server.seed_house_rooms()

    print("\nThe list")
    rows = house()
    check("seven rooms", len(rows), 7)
    check("two of each hidden vision and one Sighted",
          sorted(r["mode"] for r in rows), ["blind", "blind", "fog", "fog", "sighted", "total", "total"])
    check("in slot order", [r["name"] for r in rows], NAMES)
    check("seven different names", len(set(NAMES)), 7)
    check("every name passes the server's own name rule",
          [n for n in NAMES if supabase_auth.clean_name(n) != n], [])
    check("none says what it is",
          [n for n in NAMES if any(w in n.lower() for w in
                                   ("bot", "computer", "engine", "stockfish", "cpu", "nox"))], [])
    check("none is a ranked fallback name", sorted(set(NAMES) & set(server.AI_NAMES)), [])
    check("a card is a vision, a name, a rating, a clock, a colour and an id",
          sorted(rows[0].keys()), ["color", "id", "inc", "minutes", "mode", "name", "rating"])
    check("the rating on the card is the one the game is played at",
          [r["rating"] for r in rows], [e for _, _, e, _, _ in server.HOUSE_ROOMS])
    check("seeding again adds nothing", (server.seed_house_rooms(), len(house()))[1], 7)
    with server.lock:
        check("nobody is in the ranked or friendly queue for it", dict(server.lobby), {})
        check("no house bot is registered under an account", dict(server.by_user), {})

    print("\nThe names are the house's")
    c = FakeClient("c1")
    with server.lock:
        server.claim_name(c, NAMES[1])
    check("a guest who turns up wearing one is renamed", c.name != NAMES[1], True)
    check("...to a guest name", c.name.startswith("Guest-"), True)
    with server.lock:
        server.release_name(c)
        check("and the hold survives a guest letting go", NAMES[1].lower() in server.names, True)

    print("\nJoining one")
    watcher = FakeClient("watch")
    server.handle_lobby(watcher)
    before = house()
    room = before[0]
    joiner = FakeClient("j1")
    server.handle_join(joiner, {"room": room["id"]})
    starts = joiner.got("start")
    check("the joiner is seated", len(starts), 1)
    st = starts[0] if starts else {}
    check("in that vision", st.get("mode"), room["mode"])
    check("on that clock", (st.get("minutes"), st.get("inc")), (room["minutes"], room["inc"]))
    check("as a friendly game", st.get("kind"), "friendly")
    check("with the other colour", st.get("color"), "b" if room["color"] == "w" else "w")
    check("against the name on the card", st.get("opponent"), room["name"])
    check("and told, by the server alone, that the page plays the other side",
          st.get("ai"), {"name": room["name"], "elo": room["rating"], "bot": True})
    game = joiner.game
    check("the bot is the other seat", game is not None and game.opponent_of(joiner).is_ai, True)
    check("and is not a system profile", game.opponent_of(joiner).is_bot, False)
    after = house()
    check("the list is seven long again at once", len(after), 7)
    check("the same seven names, in the same order", [r["name"] for r in after], NAMES)
    check("with a fresh room in that slot", after[0]["id"] != room["id"], True)
    check("the watcher was told once", len(watcher.got("rooms")), 2)   # the first listing, then this
    with server.lock:
        fresh = next(r for r in server.rooms.values() if r.slot == 0)
    check("hosted by a different seat from the one in the game",
          fresh.host is game.opponent_of(joiner), False)
    check("under the same name", fresh.host.name, room["name"])
    with server.lock:
        check("nothing was queued anywhere", dict(server.lobby), {})

    print("\nPlaying it")
    server.handle_move(joiner, {"ply": 0, "from": 52, "to": 36, "san": "e4"})
    check("a move is played at home, not relayed, and not refused",
          joiner.got("error"), [])
    check("...and not recorded here either", game.moves, [])
    server.handle_resign(joiner)
    overs = joiner.got("over")
    check("resigning ends it", [o["reason"] for o in overs], ["resign"])
    check("the game is let go of", joiner.game, None)
    check("and remembered for a rematch", joiner.last_game["id"], game.id)

    joiner.sent = []
    server.handle_rematch(joiner, {"game": game.id})
    again = joiner.got("start")
    check("a rematch is granted on the spot", len(again), 1)
    a = again[0] if again else {}
    check("colours swapped", a.get("color"), "w" if st.get("color") == "b" else "b")
    check("still friendly", a.get("kind"), "friendly")
    check("same opponent", (a.get("opponent"), (a.get("ai") or {}).get("elo")),
          (room["name"], room["rating"]))
    joiner.sent = []
    server.handle_draw_offer(joiner)
    deadline = time.time() + 3.5
    while time.time() < deadline and not joiner.got("over"):
        time.sleep(0.05)
    check("a draw offered to it is accepted", [o["reason"] for o in joiner.got("over")], ["draw"])

    print("\nA person's room beside them")
    host = FakeClient("h1")
    server.handle_host(host, {"mode": "fog", "minutes": 7, "color": "w"})
    with server.lock:
        listed = server.room_list()
    check("the house's seven come first", [r["name"] for r in listed[:7]], NAMES)
    check("then theirs", [r["name"] for r in listed[7:]], ["h1"])
    check("with a name and a rating like any other card",
          (listed[7]["name"], listed[7]["rating"]), ("h1", server.START_ELO))
    server.handle_unhost(host)
    check("and closing it leaves the seven", len(house()), 7)

    print("\nThe ranked queue is not involved")
    seeker = FakeClient("s1")
    seeker.verified = True
    seeker.user_id = "user-1"
    server.handle_find(seeker, {"mode": "blind", "minutes": 3, "inc": 0, "kind": "ranked"})
    with server.lock:
        queued = [c for q in server.lobby.values() for c in q]
        check("a ranked search queues the seeker and nobody else", queued, [seeker])
        check("no house bot is in any queue", any(c.is_ai for c in queued), False)
        server.cancel_ai_fallback(seeker)
        server.leave_lobby(seeker)

    print("\n%d passed, %d failed" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
