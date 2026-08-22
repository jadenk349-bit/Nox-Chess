"""Verify Supabase access tokens.

The browser signs in with Google through Supabase and gets back a JWT. It
hands that token to us on connect; this module decides whether to believe it.

Supabase signs with an elliptic-curve key (ES256, NIST P-256) and publishes the
matching *public* key at its JWKS endpoint, so this server holds no secret of
any kind. One setting, and it is not sensitive:

    SUPABASE_URL          https://<ref>.supabase.co

The older shared-secret arrangement still works if a project is set up that way
— set SUPABASE_JWT_SECRET as well and HS256 tokens will verify too. Projects
that have rotated to ES256 do not need it.

Signature checking and claim validation are PyJWT's job (it uses `cryptography`
underneath); this module's own work is fetching the key set, caching it, and
coping with rotation. See requirements.txt — this is the one part of the server
that is not standard library, because hand-rolling elliptic-curve verification
is not a thing to do in a program that guards accounts.

With neither setting present, verification is simply off: verify() rejects
every token and everyone plays as a guest, exactly as before accounts existed.
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

try:
    import jwt
except ImportError:                        # pragma: no cover - depends on install
    jwt = None

PROJECT_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")     # legacy HS256 projects

# PyJWT is only needed to verify tokens. A server with no Supabase settings has
# no tokens to verify, so it still runs on a bare Python with nothing installed
# — but one that is *meant* to have accounts must say so now, loudly, rather
# than quietly letting everybody in as a guest.
if (PROJECT_URL or JWT_SECRET) and jwt is None:
    raise ImportError(
        "SUPABASE_URL/SUPABASE_JWT_SECRET are set, so accounts are expected, "
        "but PyJWT is not installed. Run: pip install -r requirements.txt"
    )

JWKS_URL = (PROJECT_URL + "/auth/v1/.well-known/jwks.json") if PROJECT_URL else ""
ISSUER = (PROJECT_URL + "/auth/v1") if PROJECT_URL else ""
AUDIENCE = "authenticated"

JWKS_TIMEOUT = 5           # seconds to wait on the network
JWKS_TTL = 600             # re-read the key set at least this often
JWKS_MIN_REFETCH = 30      # floor between fetches prompted by an unknown kid

# A little slack for clock drift between Supabase and this machine.
LEEWAY = 60


class AuthError(Exception):
    """The token is missing, malformed, expired, or not ours."""


def enabled():
    """True when this server is in a position to verify anybody."""
    return bool(JWKS_URL or JWT_SECRET)


# ---------------------------------------------------------------- JWKS

_jwks_lock = threading.Lock()
_jwks = {}              # kid -> jwk dict
_jwks_fetched = 0.0


def _load_jwks():
    """Read the key set from Supabase. Network work happens outside the lock."""
    global _jwks, _jwks_fetched
    req = urllib.request.Request(JWKS_URL, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=JWKS_TIMEOUT) as response:
            body = response.read()
    except (urllib.error.URLError, OSError, ValueError) as err:
        raise AuthError("could not reach the key set: %s" % (err,))
    try:
        keys = json.loads(body).get("keys") or []
    except ValueError:
        raise AuthError("key set was not JSON")

    fresh = {}
    for key in keys:
        kid = key.get("kid")
        if kid:
            fresh[kid] = key
    with _jwks_lock:
        _jwks = fresh
        _jwks_fetched = time.time()
    return fresh


def _key_for(kid):
    """The JWK with this id, fetching or refreshing the set when needed."""
    if not JWKS_URL:
        raise AuthError("SUPABASE_URL is not set, so ES256 cannot be checked")
    with _jwks_lock:
        cached, age = _jwks, time.time() - _jwks_fetched
    if cached and kid in cached and age < JWKS_TTL:
        return cached[kid]
    # Unknown id, or a stale set: Supabase rotates keys, so look again —
    # but not so often that a bad token can turn into a fetch per connect.
    if not cached or age > JWKS_MIN_REFETCH:
        cached = _load_jwks()
    if kid not in cached:
        raise AuthError("token signed by an unknown key")
    return cached[kid]


def _signing_key(jwk_dict):
    """Turn a JWK into a key object PyJWT can verify with."""
    try:
        return jwt.PyJWK(jwk_dict).key
    except Exception as err:                 # PyJWKError and friends
        raise AuthError("unusable signing key: %s" % (err,))


# ---------------------------------------------------------------- verify

def verify(token):
    """Return the token's claims, or raise AuthError.

    The algorithm is pinned to what the key can actually be, so a token cannot
    talk us into "alg": "none", or into checking an ES256 token with its own
    public key as an HMAC secret.
    """
    if not enabled():
        raise AuthError("accounts are not configured on this server")
    if not token or not isinstance(token, str):
        raise AuthError("no token")

    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as err:
        raise AuthError("malformed token: %s" % (err,))

    alg = header.get("alg")
    if alg == "ES256":
        kid = header.get("kid")
        if not kid:
            raise AuthError("token names no key")
        key = _signing_key(_key_for(kid))
    elif alg == "HS256":
        if not JWT_SECRET:
            raise AuthError("HS256 token but no shared secret is configured")
        key = JWT_SECRET
    else:
        raise AuthError("unexpected signing algorithm %r" % (alg,))

    options = {"require": ["exp", "sub", "aud"]}
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience=AUDIENCE,
            issuer=ISSUER or None,           # only checked if we know the project
            leeway=LEEWAY,
            options=options,
        )
    except jwt.ExpiredSignatureError:
        raise AuthError("token expired")
    except jwt.InvalidAudienceError:
        raise AuthError("not an authenticated-user token")
    except jwt.InvalidIssuerError:
        raise AuthError("token is from another project")
    except jwt.MissingRequiredClaimError as err:
        raise AuthError("token is missing %s" % (err.claim,))
    except jwt.InvalidTokenError as err:     # bad signature, malformed, etc.
        raise AuthError("bad signature" if "signature" in str(err).lower()
                        else "invalid token: %s" % (err,))

    if not claims.get("sub"):
        raise AuthError("token has no subject")
    return claims


# The name a player chooses for the game: 3-25 characters, English only, and
# with at least one letter in it. The page checks this too, but user metadata
# can be written through Supabase's own API, so the rule is applied again here
# rather than trusting whatever arrives in the token.
NAME_MIN, NAME_MAX = 3, 25
_NAME_ALLOWED = re.compile(r"^[A-Za-z0-9 _-]+$")
_NAME_HAS_LETTER = re.compile(r"[A-Za-z]")


def clean_name(raw):
    """The name if it passes the rules, otherwise None."""
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    if not (NAME_MIN <= len(name) <= NAME_MAX):
        return None
    if not _NAME_ALLOWED.match(name) or not _NAME_HAS_LETTER.search(name):
        return None
    return name


def display_name(claims):
    """The name to show for a verified player.

    Taken from the token, never from whatever the client typed — otherwise
    signing in would be a way to wear somebody else's name. The name chosen
    for the game wins; the Google name is only a fallback for accounts that
    have not picked one yet, and it has to pass the same rules.
    """
    meta = claims.get("user_metadata") or {}
    chosen = clean_name(meta.get("game_name"))
    if chosen:
        return chosen
    for key in ("full_name", "name", "preferred_username"):
        fallback = clean_name(meta.get(key))
        if fallback:
            return fallback
    email = claims.get("email")
    if isinstance(email, str) and "@" in email:
        fallback = clean_name(email.split("@")[0])
        if fallback:
            return fallback
    return "Player"
