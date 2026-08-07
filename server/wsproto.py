"""Just enough RFC 6455 to run a game server and talk to it from a test client.

The stdlib has no WebSocket support and this machine has no package manager we
want to lean on, so the handshake and framing live here. Both server.py and
test_two_clients.py import this module.
"""

import base64
import hashlib
import os
import struct

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

OP_CONT  = 0x0
OP_TEXT  = 0x1
OP_BIN   = 0x2
OP_CLOSE = 0x8
OP_PING  = 0x9
OP_PONG  = 0xA


class WSError(Exception):
    pass


class WSClosed(WSError):
    pass


def accept_key(client_key):
    """The Sec-WebSocket-Accept value for a client's Sec-WebSocket-Key."""
    digest = hashlib.sha1((client_key + GUID).encode()).digest()
    return base64.b64encode(digest).decode()


def read_http_head(sock):
    """Read up to the blank line that ends an HTTP head. Returns raw bytes."""
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise WSClosed("closed before the request head arrived")
        buf += chunk
        if len(buf) > 65536:
            raise WSError("request head too large")
    return buf


def parse_http_head(raw):
    """-> (request_line, {lowercased header: value}, leftover_bytes)"""
    head, _, rest = raw.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    request_line = lines[0]
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, _, v = line.partition(":")
            headers[k.strip().lower()] = v.strip()
    return request_line, headers, rest


def _recv_exact(sock, n, buf=b""):
    """Read exactly n bytes, starting from whatever is already in buf."""
    out = bytearray(buf[:n])
    rest = buf[n:]
    while len(out) < n:
        chunk = sock.recv(n - len(out))
        if not chunk:
            raise WSClosed("connection closed mid-frame")
        out += chunk
    return bytes(out), rest


class Framer:
    """Frame reader/writer over a blocking socket.

    `mask_out` is True for clients (RFC 6455 requires client->server masking)
    and False for servers.
    """

    def __init__(self, sock, mask_out, leftover=b""):
        self.sock = sock
        self.mask_out = mask_out
        self._buf = leftover

    # ---- reading ----

    def _read_frame(self):
        head, self._buf = _recv_exact(self.sock, 2, self._buf)
        b0, b1 = head[0], head[1]
        fin = bool(b0 & 0x80)
        opcode = b0 & 0x0F
        masked = bool(b1 & 0x80)
        length = b1 & 0x7F
        if length == 126:
            ext, self._buf = _recv_exact(self.sock, 2, self._buf)
            length = struct.unpack("!H", ext)[0]
        elif length == 127:
            ext, self._buf = _recv_exact(self.sock, 8, self._buf)
            length = struct.unpack("!Q", ext)[0]
        if length > 1 << 20:
            raise WSError("frame too large")
        mask = b""
        if masked:
            mask, self._buf = _recv_exact(self.sock, 4, self._buf)
        data = b""
        if length:
            data, self._buf = _recv_exact(self.sock, length, self._buf)
        if masked:
            data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        return fin, opcode, data

    def read_message(self):
        """Return the next text message as str. Answers pings, raises on close."""
        parts = []
        op = None
        while True:
            fin, opcode, data = self._read_frame()
            if opcode == OP_CLOSE:
                raise WSClosed("peer sent close")
            if opcode == OP_PING:
                self.send(data, OP_PONG)
                continue
            if opcode == OP_PONG:
                continue
            if opcode in (OP_TEXT, OP_BIN):
                op = opcode
                parts = [data]
            elif opcode == OP_CONT:
                parts.append(data)
            else:
                raise WSError("unknown opcode %s" % opcode)
            if fin:
                payload = b"".join(parts)
                return payload.decode("utf-8", "replace") if op == OP_TEXT else payload

    # ---- writing ----

    def send(self, payload, opcode=OP_TEXT):
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        header = bytearray()
        header.append(0x80 | opcode)
        n = len(payload)
        mask_bit = 0x80 if self.mask_out else 0x00
        if n < 126:
            header.append(mask_bit | n)
        elif n < (1 << 16):
            header.append(mask_bit | 126)
            header += struct.pack("!H", n)
        else:
            header.append(mask_bit | 127)
            header += struct.pack("!Q", n)
        if self.mask_out:
            mask = os.urandom(4)
            header += mask
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + payload)

    def close(self):
        try:
            self.send(b"", OP_CLOSE)
        except OSError:
            pass


def client_handshake(sock, host, path="/ws"):
    """Perform the client side of the opening handshake. -> Framer"""
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        "GET %s HTTP/1.1\r\n"
        "Host: %s\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n" % (path, host, key)
    )
    sock.sendall(req.encode())
    raw = read_http_head(sock)
    status, headers, rest = parse_http_head(raw)
    if "101" not in status:
        raise WSError("handshake refused: %s" % status)
    if headers.get("sec-websocket-accept") != accept_key(key):
        raise WSError("bad Sec-WebSocket-Accept")
    return Framer(sock, mask_out=True, leftover=rest)
