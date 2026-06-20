# yanzyaha-bot Dockerfile — Hermes Edition
# Base image udah punya hermes CLI + Python (untuk Hermes Agent subprocess).
# Kita tambahin Node.js + ffmpeg + yt-dlp untuk WA bot.

FROM nousresearch/hermes-agent:latest

ENV HERMES_HOME=/opt/data

# Install Node.js + ffmpeg (untuk video clipping)
# Base image mungkin Alpine (apk) atau Debian (apt) — handle dua-duanya
RUN if command -v apk >/dev/null 2>&1; then \
      apk add --no-cache nodejs npm ffmpeg tzdata git curl ca-certificates; \
    elif command -v apt-get >/dev/null 2>&1; then \
      apt-get update && \
      apt-get install -y --no-install-recommends \
        nodejs npm ffmpeg tzdata git curl ca-certificates && \
      rm -rf /var/lib/apt/lists/*; \
    else \
      echo "ERROR: no apk or apt-get found"; exit 1; \
    fi

# Install yt-dlp (pake pip3 dari base image)
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && yt-dlp --version

# Tentukan working dir
WORKDIR /app

# Install npm deps dulu (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy app source
COPY . .

# Persistent dirs
RUN mkdir -p /tmp/wa-tmp /opt/data && chmod 777 /tmp/wa-tmp

ENV TZ=Asia/Jakarta

# CMD: optional yt-dlp update + jalanin WA bot
# Hermes dipanggil sebagai subprocess dari handler-hermes.cjs
CMD ["sh", "-c", "if [ \"$UPDATE_YT_DLP\" = \"1\" ]; then echo '[start] Updating yt-dlp...'; yt-dlp -U 2>&1 || echo '[start] yt-dlp update failed (non-fatal)'; fi; mkdir -p /tmp/wa-tmp /opt/data; chmod 777 /tmp/wa-tmp 2>/dev/null || true; echo '[start] Launching yanzyaha-bot with Hermes Agent...'; exec node index.js"]

# Note: Untuk Railway volume mount, set HERMES_HOME=/opt/data di env vars
# Supaya session/memory persistent across deploys