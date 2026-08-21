"""Nox Chess online play — matchmaking and move relay.

Stdlib only. One port serves both the page over HTTP and the game socket at
/ws, so a browser loads http://localhost:8787/ and connects straight back to
the origin it came from.

The rules live in the browser: both clients run the same move generator, so the
server's job is to pair players and to keep the two of them on one timeline. It
enforces whose turn it is and that plies arrive in order — a move from the wrong
player, or out of sequence, is refused rather than relayed. It does not judge
legality, so a hand-rolled client could still feed its opponent nonsense; the
receiving client rejects anything its own rules reject.

Run:  python3 server/server.py [--port 8787]
"""

import json
import os
import random
import socket
import sys
import threading
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wsproto
import supabase_auth
from wsproto import Framer, WSClosed, WSError

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(os.path.dirname(HERE), "blind-chess.html")

WHITE, BLACK = "w", "b"

lock = threading.RLock()
lobby = {}        # (mode, minutes, kind) -> Client waiting for a quick match
rooms = {}        # room id -> Room, the open rooms anyone may sit down at
lobby_subs = set()  # clients watching the room list right now
games = {}        # game id -> Game
LOG = True


def log(*a):
    if LOG:
        print("[%s]" % time.strftime("%H:%M:%S"), *a, flush=True)


class Client:
    def __init__(self, framer, addr):
        self.framer = framer
        self.addr = addr
        self.send_lock = threading.Lock()
        self.id = uuid.uuid4().hex[:8]
        self.game = None
        self.color = None
        self.queue_key = None
        self.room = None          # the room this client is hosting, if any
        self.alive = True
        # Identity, once the client says hello. A guest keeps user_id None:
        # they can still play friendly games, they just aren't anybody yet.
        self.user_id = None
        self.name = "Guest"
        self.verified = False

    def send(self, obj):
        if not self.alive:
            return
        try:
            with self.send_lock:
                self.framer.send(json.dumps(obj))
        except (OSError, WSError):
            self.alive = False

    def __repr__(self):
        return "<client %s>" % self.id


class Game:
    def __init__(self, white, black, mode, minutes):
        self.id = uuid.uuid4().hex[:8]
        self.players = {WHITE: white, BLACK: black}
        self.mode = mode
        self.minutes = minutes
        self.moves = []          # each: {ply, from, to, promo, san}
        self.turn = WHITE
        self.over = None
        self.started = time.time()

    def opponent_of(self, client):
        return self.players[BLACK if client.color == WHITE else WHITE]


class Room:
    """A game someone has set up and is sitting in, waiting for anyone to join."""

    def __init__(self, host, mode, minutes, color):
        self.id = uuid.uuid4().hex[:8]
        self.host = host
        self.mode = mode
        self.minutes = minutes
        self.color = color        # the colour the host will play; joiner takes the other
        self.created = time.time()

    def public(self):
        return {
            "id": self.id,
            "mode": self.mode,
            "minutes": self.minutes,
            "color": self.color,
        }


def broadcast_rooms():
    """Everyone watching the list sees it the moment it changes.

    The payload is built under the lock but sent outside it — a slow socket
    must not hold up the room list for everybody else.
    """
    with lock:
        payload = {"t": "rooms", "rooms": [r.public() for r in rooms.values()]}
        watchers = list(lobby_subs)
    for client in watchers:
        client.send(payload)


def finish_game(game, reason, winner=None, exclude=None):
    """Mark a game over and tell whoever is still connected."""
    if game.over:
        return
    game.over = reason
    for client in game.players.values():
        if client is not exclude:
            client.send({"t": "over", "reason": reason, "winner": winner})
    # Let go of the players too. Without this they stay "in a game" for the life
    # of the connection, and every later host or join is refused — which only
    # shows up once something reuses the socket after a game rather than
    # reconnecting, as returning to the room list does.
    for client in game.players.values():
        if client.game is game:
            client.game = None
            client.color = None
    games.pop(game.id, None)
    log("game %s over: %s" % (game.id, reason))


# ---------------------------------------------------------------- messages

def clean_guest_name(raw):
    """A guest may call themselves anything printable and short."""
    if not isinstance(raw, str):
        return "Guest"
    name = "".join(ch for ch in raw if ch.isprintable()).strip()[:20]
    return name or "Guest"


def handle_hello(client, msg):
    """Identify the player, by token if they have one.

    A valid token makes them a real account: the name comes from the token,
    not from the message, so nobody can wear a name they haven't signed in
    as. Without a token — or with a bad one — they stay a guest and may
    still play friendly games.
    """
    token = msg.get("token")
    if token:
        try:
            claims = supabase_auth.verify(token)
        except supabase_auth.AuthError as err:
            client.user_id = None
            client.verified = False
            client.name = clean_guest_name(msg.get("name"))
            log("%s rejected token: %s" % (client.id, err))
            client.send({
                "t": "welcome",
                "verified": False,
                "name": client.name,
                "reason": str(err),
            })
            return
        client.user_id = claims["sub"]
        client.name = supabase_auth.display_name(claims)
        client.verified = True
        log("%s signed in as %s (%s)" % (client.id, client.name, client.user_id[:8]))
    else:
        client.user_id = None
        client.verified = False
        client.name = clean_guest_name(msg.get("name"))

    client.send({
        "t": "welcome",
        "verified": client.verified,
        "name": client.name,
        "accounts": supabase_auth.enabled(),
    })


def handle_find(client, msg):
    mode = msg.get("mode", "blind")
    minutes = msg.get("minutes", 10)
    # ranked and friendly are separate queues: someone who came for a ranked game
    # must never be handed a friendly one, or the distinction means nothing
    kind = msg.get("kind", "friendly")
    if kind not in ("ranked", "friendly"):
        kind = "friendly"
    # A rating has to belong to somebody, so ranked play needs an account —
    # but only once this server can actually issue one. With no Supabase
    # configured nobody can ever verify, and refusing everyone would just
    # delete the ranked queue.
    if kind == "ranked" and supabase_auth.enabled() and not client.verified:
        client.send({"t": "error", "msg": "ranked play needs a signed-in account"})
        return
    if client.game:
        client.send({"t": "error", "msg": "already in a game"})
        return
    key = (mode, minutes, kind)
    with lock:
        waiting = lobby.get(key)
        if waiting and waiting is not client and waiting.alive:
            del lobby[key]
            # colours are the server's call, so neither client can pick for itself
            pair = [waiting, client]
            random.shuffle(pair)
            white, black = pair
            game = Game(white, black, mode, minutes)
            white.color, black.color = WHITE, BLACK
            white.game = black.game = game
            white.queue_key = black.queue_key = None
            games[game.id] = game
            log("matched %s (w) vs %s (b) — %s %s, %s min" % (white.id, black.id, kind, mode, minutes))
            for color, player in game.players.items():
                other = game.opponent_of(player)
                player.send({
                    "t": "start",
                    "game": game.id,
                    "color": color,
                    "mode": mode,
                    "minutes": minutes,
                    "kind": kind,
                    "opponent": other.name,
                    "opponentVerified": other.verified,
                })
        else:
            if waiting is client:
                return
            lobby[key] = client
            client.queue_key = key
            client.send({"t": "waiting"})
            log("%s waiting — %s %s, %s min" % (client.id, kind, mode, minutes))


def handle_lobby(client):
    """Start watching the room list, and get it as it stands right now."""
    with lock:
        lobby_subs.add(client)
        payload = {"t": "rooms", "rooms": [r.public() for r in rooms.values()]}
    client.send(payload)


def handle_unlobby(client):
    with lock:
        lobby_subs.discard(client)


def handle_host(client, msg):
    mode = msg.get("mode", "blind")
    minutes = msg.get("minutes", 10)
    color = msg.get("color", WHITE)
    if color not in (WHITE, BLACK):
        color = WHITE
    with lock:
        if client.game:
            client.send({"t": "error", "msg": "already in a game"})
            return
        if client.room:                     # one room per host — replace the old one
            rooms.pop(client.room.id, None)
        room = Room(client, mode, minutes, color)
        rooms[room.id] = room
        client.room = room
    client.send({"t": "hosting", "room": room.id})
    log("%s hosting %s — %s, %s min, host plays %s"
        % (client.id, room.id, mode, minutes, color))
    broadcast_rooms()


def handle_unhost(client):
    with lock:
        room = client.room
        if room:
            rooms.pop(room.id, None)
            client.room = None
    if room:
        log("%s closed room %s" % (client.id, room.id))
        broadcast_rooms()


def handle_join(client, msg):
    """Sit down at someone's room. First to arrive gets it."""
    with lock:
        room = rooms.get(msg.get("room"))
        if room is None:
            client.send({"t": "error", "msg": "that room is gone"})
            return
        if room.host is client:
            client.send({"t": "error", "msg": "that is your own room"})
            return
        if client.game or not room.host.alive:
            client.send({"t": "error", "msg": "that room is gone"})
            return
        del rooms[room.id]
        host = room.host
        host.room = None
        # the host plays the colour they asked for; the joiner takes the other
        white, black = (host, client) if room.color == WHITE else (client, host)
        game = Game(white, black, room.mode, room.minutes)
        white.color, black.color = WHITE, BLACK
        white.game = black.game = game
        games[game.id] = game
        lobby_subs.discard(host)
        lobby_subs.discard(client)
        outgoing = [(player, {
            "t": "start",
            "game": game.id,
            "color": color,
            "mode": room.mode,
            "minutes": room.minutes,
            "kind": "friendly",
            "opponent": game.opponent_of(player).name,
            "opponentVerified": game.opponent_of(player).verified,
        }) for color, player in game.players.items()]
    for player, payload in outgoing:
        player.send(payload)
    log("room %s filled — %s (w) vs %s (b), %s, %s min"
        % (room.id, white.id, black.id, room.mode, room.minutes))
    broadcast_rooms()


def handle_cancel(client):
    with lock:
        if client.queue_key and lobby.get(client.queue_key) is client:
            del lobby[client.queue_key]
        client.queue_key = None
    client.send({"t": "cancelled"})


def handle_move(client, msg):
    with lock:
        game = client.game
        if not game or game.over:
            client.send({"t": "error", "msg": "no game in progress"})
            return
        if client.color != game.turn:
            client.send({"t": "error", "msg": "not your turn", "ply": len(game.moves)})
            return
        ply = msg.get("ply")
        if ply != len(game.moves):
            client.send({"t": "error", "msg": "out of sequence", "ply": len(game.moves)})
            return
        move = {
            "ply": ply,
            "from": msg.get("from"),
            "to": msg.get("to"),
            "promo": msg.get("promo"),
            "san": msg.get("san"),
        }
        if not isinstance(move["from"], int) or not isinstance(move["to"], int) \
           or not (0 <= move["from"] < 64) or not (0 <= move["to"] < 64):
            client.send({"t": "error", "msg": "bad square"})
            return
        game.moves.append(move)
        game.turn = BLACK if game.turn == WHITE else WHITE
        opponent = game.opponent_of(client)
    out = dict(move)
    out["t"] = "move"
    opponent.send(out)


def handle_result(client, msg):
    """A client's rules said the game ended. Record it and let the other agree."""
    with lock:
        game = client.game
        if not game or game.over:
            return
        finish_game(game, msg.get("status", "game over"), msg.get("winner"), exclude=client)


def handle_resign(client):
    with lock:
        game = client.game
        if not game or game.over:
            return
        winner = BLACK if client.color == WHITE else WHITE
        finish_game(game, "resign", winner)


def handle_draw_offer(client):
    """Relayed, not decided: a draw needs the other player to agree."""
    with lock:
        game = client.game
        if not game or game.over:
            return
        opponent = game.opponent_of(client)
    opponent.send({"t": "draw-offer"})


def handle_draw_accept(client):
    with lock:
        game = client.game
        if not game or game.over:
            return
        finish_game(game, "draw", None)


def handle_draw_decline(client):
    with lock:
        game = client.game
        if not game or game.over:
            return
        opponent = game.opponent_of(client)
    opponent.send({"t": "draw-decline"})


def handle_message(client, raw):
    try:
        msg = json.loads(raw)
    except ValueError:
        client.send({"t": "error", "msg": "bad json"})
        return
    kind = msg.get("t")
    if kind == "hello":
        handle_hello(client, msg)
    elif kind == "find":
        handle_find(client, msg)
    elif kind == "lobby":
        handle_lobby(client)
    elif kind == "unlobby":
        handle_unlobby(client)
    elif kind == "host":
        handle_host(client, msg)
    elif kind == "unhost":
        handle_unhost(client)
    elif kind == "join":
        handle_join(client, msg)
    elif kind == "cancel":
        handle_cancel(client)
    elif kind == "move":
        handle_move(client, msg)
    elif kind == "result":
        handle_result(client, msg)
    elif kind == "resign":
        handle_resign(client)
    elif kind == "draw-offer":
        handle_draw_offer(client)
    elif kind == "draw-accept":
        handle_draw_accept(client)
    elif kind == "draw-decline":
        handle_draw_decline(client)
    elif kind == "ping":
        client.send({"t": "pong"})
    else:
        client.send({"t": "error", "msg": "unknown message %r" % (kind,)})


def drop_client(client):
    client.alive = False
    dropped_room = False
    with lock:
        if client.queue_key and lobby.get(client.queue_key) is client:
            del lobby[client.queue_key]
        lobby_subs.discard(client)
        if client.room:                  # a host who vanishes takes their room with them
            rooms.pop(client.room.id, None)
            client.room = None
            dropped_room = True
        game = client.game
        if game and not game.over:
            winner = BLACK if client.color == WHITE else WHITE
            finish_game(game, "left", winner, exclude=client)
        client.game = None
    log("%s disconnected" % client.id)
    if dropped_room:
        broadcast_rooms()


# ------------------------------------------------------------------- http

# An explicit allowlist rather than a static directory: there is no path to
# traverse if no part of the request ever reaches the filesystem. The wasm MIME
# type is not decoration — browsers refuse to stream-compile without it.
ROOT = os.path.dirname(HERE)
STATIC_FILES = {
    "/engine/stockfish.wasm.js": ("engine/stockfish.wasm.js", "text/javascript; charset=utf-8"),
    "/engine/stockfish.wasm":    ("engine/stockfish.wasm",    "application/wasm"),
    "/assets/nox-logo.png":      ("assets/nox-logo.png",      "image/png"),
}


def serve_static_file(sock, path):
    name, ctype = STATIC_FILES[path]
    try:
        with open(os.path.join(ROOT, name), "rb") as fh:
            body = fh.read()
    except OSError:
        sock.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
        return
    head = (
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: %s\r\n"
        "Content-Length: %d\r\n"
        # A week is fine because every reference carries ?v= — bump that when a
        # file changes, or browsers will serve the old one for days.
        "Cache-Control: public, max-age=604800\r\n"
        "\r\n" % (ctype, len(body))
    )
    sock.sendall(head.encode() + body)


def serve_http(sock, request_line):
    try:
        method, path, _ = request_line.split(" ", 2)
    except ValueError:
        sock.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
        return
    if method != "GET":
        sock.sendall(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
        return
    path = path.split("?", 1)[0]
    if path in ("/", "/index.html", "/blind-chess.html"):
        try:
            with open(PAGE, "rb") as fh:
                body = fh.read()
        except OSError:
            sock.sendall(b"HTTP/1.1 404 Not Found\r\n\r\n")
            return
        head = (
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/html; charset=utf-8\r\n"
            "Content-Length: %d\r\n"
            "Cache-Control: no-store\r\n"
            "\r\n" % len(body)
        )
        sock.sendall(head.encode() + body)
    elif path in STATIC_FILES:
        serve_static_file(sock, path)
    elif path == "/health":
        with lock:
            body = json.dumps({
                "ok": True,
                "waiting": len(lobby),
                "games": len(games),
            }).encode()
        sock.sendall(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
            + str(len(body)).encode() + b"\r\n\r\n" + body
        )
    else:
        sock.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")


# ------------------------------------------------------------ connections

def handle_connection(sock, addr):
    client = None
    try:
        raw = wsproto.read_http_head(sock)
        request_line, headers, rest = wsproto.parse_http_head(raw)

        # A proxy may fold the upgrade into a list ("keep-alive, Upgrade") and may
        # send it in any case, so match loosely on Upgrade alone and never require
        # an exact Connection header — that is what breaks servers behind proxies.
        upgrade = headers.get("upgrade", "").lower().strip()
        if upgrade != "websocket":
            serve_http(sock, request_line)
            return

        try:
            path = request_line.split(" ", 2)[1].split("?", 1)[0]
        except IndexError:
            path = ""
        if path.rstrip("/") not in ("/ws", ""):
            sock.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n")
            return

        version = headers.get("sec-websocket-version", "").strip()
        if version and version != "13":
            sock.sendall(
                b"HTTP/1.1 426 Upgrade Required\r\n"
                b"Sec-WebSocket-Version: 13\r\n"
                b"Content-Length: 0\r\n\r\n"
            )
            return

        key = headers.get("sec-websocket-key")
        if not key:
            sock.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            return
        resp = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            "Sec-WebSocket-Accept: %s\r\n"
            "\r\n" % wsproto.accept_key(key)
        )
        sock.sendall(resp.encode())
        client = Client(Framer(sock, mask_out=False, leftover=rest), addr)
        log("%s connected from %s" % (client.id, addr[0]))
        while True:
            raw_msg = client.framer.read_message()
            handle_message(client, raw_msg)
    except (WSClosed, ConnectionResetError, BrokenPipeError):
        pass
    except WSError as exc:
        log("protocol error: %s" % exc)
    except OSError:
        pass
    finally:
        if client:
            drop_client(client)
        try:
            sock.close()
        except OSError:
            pass


def main():
    # $PORT is what most hosts inject; --port wins when it is given explicitly
    port = int(os.environ.get("PORT") or 8787)
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    # 0.0.0.0, not 127.0.0.1: the process must be reachable from outside its
    # container or the proxy in front of it can never connect.
    server.bind(("0.0.0.0", port))
    server.listen(64)
    log("Nox Chess listening on 0.0.0.0:%d — page and socket share this port "
        "(socket at /ws). TLS, if any, is the proxy's job." % port)
    try:
        while True:
            sock, addr = server.accept()
            # a half-open connection through a proxy should not pin a thread forever
            try:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
            threading.Thread(target=handle_connection, args=(sock, addr), daemon=True).start()
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        server.close()


if __name__ == "__main__":
    main()
