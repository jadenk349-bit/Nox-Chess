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

# Dependencies first: this layer is cached until requirements.txt itself changes.
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# server.py serves the page from one directory above itself, so the layout
# inside the image has to match the repository: /app/blind-chess.html.
COPY server/ ./server/
COPY engine/ ./engine/
COPY assets/ ./assets/
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
