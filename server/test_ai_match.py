"""The ranked fallback opponent, without a socket.

test_two_clients.py drives the whole thing over the wire — five seconds of
waiting, a bot arriving, a draw offered to it. What is here is the part that
wants poking at directly: the arithmetic behind the rating on its tag, the
choosing of a name, and the handful of guarantees that are about what the bot
is *not* — not an account, not a queue entry, not something two players could
be given instead of each other.

The race itself is tested here too, because a race is easier to lose on purpose
in one process than across five sockets: the timer that seats a bot and the
pairing that seats a person are run against each other with the lock held, and
the answer must always be the person.

No server, no network:  python3 server/test_ai_match.py
"""

import os
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server

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

    def __init__(self, who, user_id=None):
        server.Client.__init__(self, None, ("test", 0))
        self.id = who
        self.user_id = user_id
        self.verified = user_id is not None
        self.name = who
        self.sent = []

    def send(self, obj):
        self.sent.append(obj)

    def got(self, kind):
        return [m for m in self.sent if m.get("t") == kind]


def clear():
    """Between tests: nobody is queueing, nobody is playing, nobody is remembered."""
    with server.lock:
        server.lobby.clear()
        server.games.clear()
        server.ai_recent.clear()
        server.player_ratings.clear()


def main():
    # No Supabase in a unit test, so every rating is the starting one. That is
    # the branch a hobby server actually runs in, and it is the one where the
    # arithmetic has to hold anyway.
    print("\n\033[1mWhat the bot is rated\033[0m")

    # the worked example from the brief, and its neighbours
    check("1200 faces 1221", server.ai_elo_for(1200), 1221)
    check("100 faces 110", server.ai_elo_for(100), 110)
    check("800 faces 817", server.ai_elo_for(800), 817)
    check("2000 faces 2029", server.ai_elo_for(2000), 2029)
    check("2400 faces 2433", server.ai_elo_for(2400), 2433)
    # a hundredth of a rating is rarely whole, and a rating is
    check("a fractional hundredth rounds", server.ai_elo_for(1234), 1255)
    check("the answer is always a whole number",
          all(isinstance(server.ai_elo_for(r), int) for r in range(100, 3000, 37)), True)
    check("it is always above the player",
          all(server.ai_elo_for(r) > r for r in range(0, 3000, 13)), True)
    check("and further above the higher they climb",
          server.ai_elo_for(3000) - 3000 > server.ai_elo_for(300) - 300, True)

    print("\n\033[1mWhich bot\033[0m")

    check("the seven names, and only those", server.AI_NAMES, [
        "cutydaeheech0", "TheNlEL", "goutham111", "Paradoxical_MovesbyJJ",
        "gaymonster", "jungjungkook", "676767",
    ])
    check("no two of them are the same", len(set(server.AI_NAMES)), len(server.AI_NAMES))

    clear()
    me = FakeClient("solo", user_id="acct-1")
    runs = [server.ai_name_for(me) for _ in range(40)]
    check("every name it hands out is one of the seven",
          set(runs) <= set(server.AI_NAMES), True)
    check("the same name never comes up twice running",
          any(a == b for a, b in zip(runs, runs[1:])), False)
    check("nor within the memory it keeps",
          any(runs[i] in runs[max(0, i - server.AI_NAME_MEMORY):i] for i in range(len(runs))),
          False)
    check("over forty games it uses the whole list", len(set(runs)), len(server.AI_NAMES))

    # Two players' memories are their own: what one just played does not make a
    # name stale for anybody else.
    clear()
    a = FakeClient("A", user_id="acct-a")
    b = FakeClient("B", user_id="acct-b")
    for _ in range(20):
        server.ai_name_for(a)
    check("one player's history does not empty another's list",
          server.ai_name_for(b) in server.AI_NAMES, True)
    check("each player is remembered separately", len(server.ai_recent), 2)

    # and the remembering is bounded, however many people play
    clear()
    for i in range(server.AI_RECENT_MAX + 50):
        server.ai_name_for(FakeClient("guest-%d" % i))
    check("the memory of who played what is capped",
          len(server.ai_recent) <= server.AI_RECENT_MAX, True)

    print("\n\033[1mWhat the bot is not\033[0m")

    bot = server.BotClient("TheNlEL", 1221)
    check("it is never a verified account", bot.verified, False)
    check("it belongs to nobody", bot.user_id, None)
    check("it says what it is", bot.is_ai, True)
    check("a real client says what it is too", FakeClient("real").is_ai, False)
    check("sending to it is a no-op", bot.send({"t": "over"}), None)
    check("it carries a rating for the game only", bot.elo, 1221)

    clear()
    with server.lock:
        server.register_user(bot)
    check("it cannot be registered as an account anybody can reach",
          server.by_user.get(None), None)

    print("\n\033[1mSeating one\033[0m")

    clear()
    server.AI_WAIT = 0.15
    player = FakeClient("P1", user_id="acct-p1")
    key = ("blind", 5, 0, "ranked")
    with server.lock:
        server.lobby[key] = player
        player.queue_key = key
        server.arm_ai_fallback(player, key)
    time.sleep(0.6)
    starts = player.got("start")
    check("a lone ranked player is eventually given a game", len(starts), 1)
    start = starts[0]
    check("the game is ranked, like the queue it came from", start["kind"], "ranked")
    check("the settings are the ones asked for",
          (start["mode"], start["minutes"], start["inc"]), ("blind", 5, 0))
    check("the opponent is one of the seven", start["opponent"] in server.AI_NAMES, True)
    check("and is not passed off as verified", start["opponentVerified"], False)
    check("the page is told it is a bot", start["ai"]["bot"], True)
    check("with the name on the tag matching the opponent",
          start["ai"]["name"], start["opponent"])
    check("and the rating worked out from the player's",
          start["ai"]["elo"], server.ai_elo_for(server.START_ELO))
    check("the player is out of the queue", server.lobby.get(key), None)
    check("and in a game", player.game is not None, True)
    check("the opponent in that game is the bot", player.game.ai is not None, True)
    check("no bot was left standing in the queue",
          any(getattr(c, "is_ai", False) for c in server.lobby.values()), False)

    print("\n\033[1mOffering it a draw\033[0m")

    player.sent = []
    server.handle_draw_offer(player)
    check("nothing is relayed to nobody", player.got("draw-offer"), [])
    deadline = time.time() + 4
    while not player.got("over") and time.time() < deadline:
        time.sleep(0.05)
    over = player.got("over")
    check("the offer is answered", len(over), 1)
    check("and it is accepted", over[0]["reason"], "draw")
    check("the game is cleaned up", player.game, None)
    check("and is gone from the server", server.games, {})

    print("\n\033[1mResigning to it\033[0m")

    clear()
    p2 = FakeClient("P2", user_id="acct-p2")
    key = ("fog", 3, 2, "ranked")
    with server.lock:
        server.lobby[key] = p2
        p2.queue_key = key
        server.arm_ai_fallback(p2, key)
    time.sleep(0.6)
    check("a second player gets their own game", len(p2.got("start")), 1)
    p2.sent = []
    server.handle_resign(p2)
    over = p2.got("over")
    check("resigning ends it at once", len(over), 1)
    check("the reason is a resignation", over[0]["reason"], "resign")
    check("and the win goes to the other colour",
          over[0]["winner"] != p2.color, True)
    check("nothing is left in games", server.games, {})

    print("\n\033[1mWalking out of one\033[0m")

    # A bot game with nobody in it is a game that must not still be a game.
    # Nothing on the far side will ever notice, so the only thing that can
    # clear it up is the same drop_client that clears up a game between two
    # people — which is exactly why the bot is a Client at all.
    clear()
    server.AI_WAIT = 0.15
    walker = FakeClient("W1", user_id="acct-w1")
    key = ("blind", 7, 0, "ranked")
    with server.lock:
        server.lobby[key] = walker
        walker.queue_key = key
        server.arm_ai_fallback(walker, key)
    time.sleep(0.6)
    check("the game is under way", len(server.games), 1)
    server.drop_client(walker)
    check("dropping mid-game takes the game with it", server.games, {})
    check("and the player is not left holding it", walker.game, None)
    check("nothing is left in the queue either", server.lobby, {})
    check("and no bot is left registered as anybody", server.by_user, {})

    print("\n\033[1mThe race a real player must always win\033[0m")

    # Somebody turning up inside the window is the ordinary case and the whole
    # point of the feature: no countdown, however far along, may take a game
    # away from two people who could play each other.
    late_pairings = 0
    for attempt in range(50):
        clear()
        server.AI_WAIT = 0.4
        first = FakeClient("R1-%d" % attempt, user_id="acct-r1")
        second = FakeClient("R2-%d" % attempt, user_id="acct-r2")
        ask = {"mode": "blind", "minutes": 10, "inc": 0, "kind": "ranked"}
        server.handle_find(first, dict(ask))
        time.sleep(0.3)                     # three quarters of the way through
        server.handle_find(second, dict(ask))
        s1, s2 = first.got("start"), second.got("start")
        if (len(s1) == 1 and len(s2) == 1 and s1[0]["game"] == s2[0]["game"]
                and "ai" not in s1[0] and "ai" not in s2[0]):
            late_pairings += 1
        first.ai_timer and server.cancel_ai_fallback(first)
    check("a player arriving late in the window is matched, every time",
          late_pairings, 50)

    # And the photo finish, made deterministic. The countdown fires while the
    # lock is being held by a pairing that is happening at that very moment, so
    # it has no choice but to wait — and what it must do when it gets the lock
    # is look again and find the queue already emptied. This is the re-check,
    # and this is the only thing standing between two waiting players and two
    # bots.
    photo = 0
    for attempt in range(25):
        clear()
        server.AI_WAIT = 0.05
        first = FakeClient("H1-%d" % attempt, user_id="acct-h1")
        second = FakeClient("H2-%d" % attempt, user_id="acct-h2")
        ask = {"mode": "blind", "minutes": 10, "inc": 0, "kind": "ranked"}
        with server.lock:
            server.handle_find(first, dict(ask))
            time.sleep(0.15)                # the countdown fires, and blocks here
            server.handle_find(second, dict(ask))
        time.sleep(0.2)                     # ...and now it wakes up to look
        s1, s2 = first.got("start"), second.got("start")
        if (len(s1) == 1 and len(s2) == 1 and s1[0]["game"] == s2[0]["game"]
                and "ai" not in s1[0] and "ai" not in s2[0]):
            photo += 1
    check("a countdown that fires mid-pairing seats nobody", photo, 25)

    print("\n\033[1mThe fallback is ranked-only\033[0m")

    clear()
    server.AI_WAIT = 0.15
    friendly = FakeClient("F1", user_id="acct-f1")
    server.handle_find(friendly, {"mode": "blind", "minutes": 5, "kind": "friendly"})
    time.sleep(0.6)
    check("a friendly queue is left alone", friendly.got("start"), [])
    check("and the player is still waiting", len(friendly.got("waiting")), 1)
    check("no countdown was ever armed", friendly.ai_timer, None)

    print("\n\033[1mGiving up before the five seconds\033[0m")

    clear()
    quitter = FakeClient("Q1", user_id="acct-q1")
    server.AI_WAIT = 0.5
    server.handle_find(quitter, {"mode": "blind", "minutes": 5, "kind": "ranked"})
    check("the countdown is running", quitter.ai_timer is not None, True)
    server.handle_cancel(quitter)
    check("cancelling stops it", quitter.ai_timer, None)
    time.sleep(0.9)
    check("and no game turns up afterwards", quitter.got("start"), [])
    check("the queue is empty", server.lobby, {})

    # ...and the same on a dropped connection
    clear()
    gone = FakeClient("Q2", user_id="acct-q2")
    server.handle_find(gone, {"mode": "blind", "minutes": 5, "kind": "ranked"})
    server.drop_client(gone)
    check("dropping stops it too", gone.ai_timer, None)
    time.sleep(0.9)
    check("a disconnected player is not seated with a bot", gone.got("start"), [])

    print("\n\033[1mQueueing twice\033[0m")

    # A player who re-queues on different settings must not be seated by the
    # countdown they already left behind — the timer that fires identifies
    # itself, and the one that fires is not the one that is armed.
    clear()
    server.AI_WAIT = 0.35
    fickle = FakeClient("X1", user_id="acct-x1")
    server.handle_find(fickle, {"mode": "blind", "minutes": 5, "kind": "ranked"})
    first_timer = fickle.ai_timer
    server.handle_find(fickle, {"mode": "fog", "minutes": 3, "kind": "ranked"})
    check("the second search arms a countdown of its own",
          fickle.ai_timer is not first_timer, True)
    time.sleep(1.0)
    starts = fickle.got("start")
    check("only one game arrives", len(starts), 1)
    check("and it is the game that was asked for second", starts[0]["mode"], "fog")

    # pressing the same button twice is not two searches
    clear()
    keen = FakeClient("X2", user_id="acct-x2")
    server.handle_find(keen, {"mode": "blind", "minutes": 5, "kind": "ranked"})
    again = keen.ai_timer
    server.handle_find(keen, {"mode": "blind", "minutes": 5, "kind": "ranked"})
    check("a repeated press does not restart the countdown", keen.ai_timer is again, True)
    time.sleep(0.9)
    check("and still brings exactly one game", len(keen.got("start")), 1)

    clear()
    print("\n\033[1m%d passed, %d failed\033[0m\n" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
