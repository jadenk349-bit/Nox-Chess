"""One name per player, across the whole server.

Two boards that both say "Alex" are two boards lying to somebody, so the
server keeps one registry of every name in use — accounts and guests
together — and hands a name out only once. What is checked here is the
registry's own reasoning: who keeps a name and who is renamed, that an
account's tabs share theirs, that a guest's goes when their socket does,
that a guest wearing an account's name gives it up when the account arrives,
and that a second hello on the same socket does not collide with itself.

No server, no network:  python3 server/test_names.py
"""

import os
import sys

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
    """A connection with a list where the wire would be."""

    def __init__(self, who, user_id=None):
        server.Client.__init__(self, None, ("test", 0))
        self.id = who
        self.user_id = user_id
        self.verified = user_id is not None
        self.sent = []

    def send(self, obj):
        self.sent.append(obj)

    def got(self, kind):
        return [m for m in self.sent if m.get("t") == kind]


def hello(client, name=None, user_id=None):
    """The identifying half of handle_hello, without a token to verify."""
    was = client.user_id
    client.user_id = user_id
    client.verified = user_id is not None
    with server.lock:
        server.unregister_user(was, client)
        server.register_user(client)
        return server.claim_name(client, server.supabase_auth.clean_name(name))


def leave(client):
    with server.lock:
        server.unregister_user(client.user_id, client)
        server.release_name(client)


def clear():
    with server.lock:
        server.names.clear()
        server.by_user.clear()


def is_guest_shape(name):
    return name.startswith("Guest-") and len(name) == 11 and name[6:].isdigit()


def main():
    print("\n\033[1mGuests\033[0m")
    clear()
    a = FakeClient("c1")
    hello(a, "Guest-12345")
    check("a guest keeps the name it offers", a.name, "Guest-12345")
    b = FakeClient("c2")
    hello(b, "Guest-12345")
    check("a second guest offering the same name is renamed", b.name != "Guest-12345", True)
    check("...to a guest-shaped name", is_guest_shape(b.name), True)
    c = FakeClient("c3")
    hello(c, "guest-12345")
    check("case does not make a name different", c.name.lower() != "guest-12345", True)
    d = FakeClient("c4")
    hello(d, None)
    check("a guest offering no name is minted one", is_guest_shape(d.name), True)
    e = FakeClient("c5")
    hello(e, "!!")
    check("...and so is one offering a name that fails the rule", is_guest_shape(e.name), True)
    check("four guests, four names", len({a.name, b.name, c.name, d.name, e.name}), 5)
    leave(a)
    f = FakeClient("c6")
    hello(f, "Guest-12345")
    check("a name is free again once its guest has gone", f.name, "Guest-12345")
    hello(f, "Guest-12345")
    check("a guest saying hello again does not collide with itself", f.name, "Guest-12345")
    with server.lock:
        check("...and holds the name exactly once",
              server.names["guest-12345"].clients, {f})

    print("\n\033[1mAccounts\033[0m")
    clear()
    tab1 = FakeClient("t1", user_id="aaaaaaaa-1111")
    hello(tab1, "Alex", user_id="aaaaaaaa-1111")
    check("an account is called what its profile says", tab1.name, "Alex")
    tab2 = FakeClient("t2", user_id="aaaaaaaa-1111")
    hello(tab2, "Alex", user_id="aaaaaaaa-1111")
    check("a second tab of the same account shares the name", tab2.name, "Alex")
    other = FakeClient("t3", user_id="bbbbbbbb-2222")
    hello(other, "Alex", user_id="bbbbbbbb-2222")
    check("a different account with the same name gets its placeholder",
          other.name, "player_bbbbbbbb")
    leave(tab1)
    with server.lock:
        check("one tab leaving does not free the name", server.name_taken("alex", ("user", "x")), True)
    leave(tab2)
    with server.lock:
        check("the last tab leaving does", server.name_taken("alex", ("user", "x")), False)
    squatter = FakeClient("t4")
    hello(squatter, "player_cccccccc")
    owner = FakeClient("t5", user_id="cccccccc-3333")
    hello(owner, "player_cccccccc", user_id="cccccccc-3333")   # a profile with no name chosen
    check("an account's placeholder is the account's, not a guest's",
          owner.name, "player_cccccccc")
    check("...and the guest who had it is renamed", is_guest_shape(squatter.name), True)
    squat2 = FakeClient("t6", user_id="dddddddd-4444")
    hello(squat2, "player_cccccccc", user_id="dddddddd-4444")
    check("a second account on that placeholder falls back to its own",
          squat2.name, "player_dddddddd")
    # Only two profiles that agree on a name can bring this about, and the
    # unique index is there to stop them; but a server has to answer anyway.
    y = FakeClient("t7", user_id="yyyyyyyy-7777")
    hello(y, "player_xxxxxxxx", user_id="yyyyyyyy-7777")   # somebody else's placeholder, on file
    alex = FakeClient("t9", user_id="aaaaaaaa-1111")
    hello(alex, "Alex", user_id="aaaaaaaa-1111")
    x = FakeClient("t8", user_id="xxxxxxxx-8888")
    hello(x, "Alex", user_id="xxxxxxxx-8888")              # wants a taken name...
    check("an account whose own placeholder is also taken is numbered",
          x.name, "player_xxxxxxxx-2")

    print("\n\033[1mA guest in an account's name\033[0m")
    clear()
    g = FakeClient("g1")
    hello(g, "Priya")
    check("a hand-written guest may call itself anything that passes", g.name, "Priya")
    p = FakeClient("p1", user_id="eeeeeeee-5555")
    renamed = hello(p, "Priya", user_id="eeeeeeee-5555")
    check("the account gets its own name", p.name, "Priya")
    check("the guest is renamed", is_guest_shape(g.name), True)
    check("...and is handed back to the caller to be told", renamed, [g])
    with server.lock:
        check("the guest holds its new name", server.names[g.name.lower()].clients, {g})
        check("the account holds the old one", server.names["priya"].clients, {p})
    g2 = FakeClient("g2")
    hello(g2, "Priya")
    check("a guest arriving after the account is simply renamed", is_guest_shape(g2.name), True)

    print("\n\033[1mThe whole hello, through the handler\033[0m")
    clear()
    h1 = FakeClient("h1")
    server.handle_hello(h1, {"t": "hello", "name": "Guest-00001"})
    h2 = FakeClient("h2")
    server.handle_hello(h2, {"t": "hello", "name": "Guest-00001"})
    w1, w2 = h1.got("welcome")[-1], h2.got("welcome")[-1]
    check("the first hears its own name", w1["name"], "Guest-00001")
    check("the second hears the name it was given instead", w2["name"], h2.name)
    check("...which is not the first's", w2["name"] != "Guest-00001", True)
    server.drop_client(h2)
    with server.lock:
        check("dropping a client releases its name",
              h2.name.lower() in server.names, False)
    server.handle_hello(h1, {"t": "hello", "name": "Guest-00002"})
    with server.lock:
        check("a second hello lets go of the first name",
              "guest-00001" in server.names, False)
        check("...and takes the new one", "guest-00002" in server.names, True)

    # A guest who becomes somebody: the same socket, now signed in, must let go
    # of its guest name so that the next guest may have it.
    clear()
    s1 = FakeClient("s1")
    hello(s1, "Guest-00009")
    hello(s1, "Sam", user_id="ffffffff-6666")
    with server.lock:
        check("signing in on the same socket frees the guest name",
              "guest-00009" in server.names, False)
    check("...and takes the account's", s1.name, "Sam")

    print("\n%d passed, %d failed" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
