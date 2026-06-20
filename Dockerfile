# yanzyaha-bot Dockerfile — Hermes Edition
# Base image udah punya hermes CLI + Python (untuk Hermes Agent subprocess).
# Kita tambahin Node.js + ffmpeg + yt-dlp untuk WA bot.

FROM nousresearch/hermes-agent:latest

ENV HERMES_HOME=/opt/data

# Install Node.js + ffmpeg + python3-pip (untuk yt-dlp install)
# Base image punya Python tapi pip binary-nya belum ke-install
RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache nodejs npm ffmpeg tzdata git curl ca-certificates py3-pip; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && \
      apt-get install -y --no-install-recommends \
        python3-pip nodejs npm ffmpeg tzdata git curl ca-certificates && \
      rm -rf /var/lib/apt/lists/*; \
    else \
      echo "ERROR: no apk or apt-get found"; exit 1; \
    fi

# Install yt-dlp — coba pip3, fallback ke python3 -m pip (lebih portable)
RUN if command -v pip3 >/dev/null 2>&1; then \
      pip3 install --no-cache-dir --break-system-packages yt-dlp; \
    elif command -v python3 >/dev/null 2>&1; then \
      python3 -m pip install --no-cache-dir --break-system-packages yt-dlp; \
    else \
      echo "ERROR: no pip available for yt-dlp"; exit 1; \
    fi \
    && yt-dlp --version

# Install Deno — JS runtime untuk yt-dlp (YouTube butuh JS extraction
# sejak 2024; tanpa runtime → 403 Forbidden)
RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache deno; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && \
      apt-get install -y --no-install-recommends curl unzip && \
      curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y && \
      ln -sf /usr/local/bin/deno /usr/bin/deno && \
      rm -rf /var/lib/apt/lists/*; \
    else \
      echo "WARN: no apk or apt-get for deno install (yt-dlp JS extraction may fail)"; \
    fi \
    && deno --version || echo "deno not available"

# Tentukan working dir
WORKDIR /app

# Install npm deps dulu (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy app source
COPY . .

# Persistent dirs (chmod 777 karena Hermes base image jalanin service sebagai non-root user)
RUN mkdir -p /tmp/wa-tmp /opt/data /app/auth && \
    chmod 777 /tmp/wa-tmp /opt/data /app && \
    chmod 777 /app/auth 2>/dev/null || true

ENV TZ=Asia/Jakarta

# CMD: optional yt-dlp update + jalanin WA bot
# Hermes dipanggil sebagai subprocess dari handler-hermes.cjs
CMD ["sh", "-c", "if [ \"$UPDATE_YT_DLP\" = \"1\" ]; then echo '[start] Updating yt-dlp...'; yt-dlp -U 2>&1 || echo '[start] yt-dlp update failed (non-fatal)'; fi; mkdir -p /tmp/wa-tmp /opt/data \"${HERMES_HOME:-/opt/data}/auth\" 2>/dev/null || true; chmod -R 777 /opt/data 2>/dev/null || true; echo '[start] Launching yanzyaha-bot with Hermes Agent...'; exec node index.js"]

# Note: Untuk Railway volume mount, set HERMES_HOME=/opt/data di env vars
# Supaya session/memory persistent across deploys