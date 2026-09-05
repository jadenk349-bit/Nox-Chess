# Nox Chess — online play server.
#
# Almost all standard-library Python. The exception is PyJWT (and the
# `cryptography` it pulls in), used to verify the ES256 tokens Supabase issues
# — see requirements.txt. Both ship manylinux wheels, so this installs without
# a compiler and there is still no build stage.

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8787

WORKDIR /app

# A native Stockfish, for the 24/7 AI league (server/league.py): the strongest
# bot accounts play each other around the clock, and the moves have to come
# from somewhere when no browser is open. Debian's package is a generic build
# rather than the fastest one for this CPU, which is fine — the league asks
# for a few hundred milliseconds a move and paces the games itself. The path
# can be overridden with NOX_STOCKFISH if a different binary is wanted.
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*
# Debian installs it as /usr/games/stockfish, and /usr/games is not on PATH
# in the python:*-slim images — so a server asking for "stockfish" found
# nothing in the very container that had just installed it, and the league
# never started. Put it on PATH, and refuse to build an image whose engine
# does not answer `uci`, so this cannot regress quietly. league.py also
# looks in /usr/games itself (STOCKFISH_CANDIDATES), for a box that is not
# this image.
ENV PATH="/usr/games:${PATH}"
RUN command -v stockfish \
    && printf 'uci\nquit\n' | stockfish | grep -q '^uciok'

# Dependencies first: this layer is cached until requirements.txt itself changes.
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# server.py serves the page from one directory above itself, so the layout
# inside the image has to match the repository: /app/blind-chess.html.
COPY server/ ./server/
COPY engine/ ./engine/
COPY assets/ ./assets/
# The three puzzle ladders. Generated offline by tools/generate_puzzles.js and
# checked in, so the image needs no engine run and no network: without these
# the Puzzles menu has nothing to open and the server rates nothing, because it
# reads its own copy of what each puzzle is worth from exactly these files.
# tools/ itself is deliberately absent — it is a build-time thing, not a
# serving one.
COPY puzzles/ ./puzzles/
# The Education System's runtime half, and only that half. lib/ is the three
# files the page evaluates to name concepts; dist/ is the corpus as one bundle.
# education/concepts/, education/state/ and education/tools/ are research and
# build-time material and stay out for the same reason tools/ does — the bundle
# in dist/ is what serving needs, and it is checked in.
COPY education/lib/ ./education/lib/
COPY education/dist/ ./education/dist/
COPY blind-chess.html ./blind-chess.html

# Nothing here needs root, and the process only ever reads these files.
RUN useradd --create-home --shell /usr/sbin/nologin app \
    && chown -R app:app /app
USER app

EXPOSE 8787

# No curl in the slim image — ask Python, which is already here.
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s --retries=3 \
    CMD ["python3", "-c", \
         "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT','8787') + '/health').read()"]

CMD ["python3", "server/server.py"]
