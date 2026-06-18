FROM node:20-alpine

# System deps:
#   python3 + py3-pip : runtime for yt-dlp
#   ffmpeg             : required for video clipping (-ss/-to in handler-download)
#   ca-certificates    : HTTPS certs for yt-dlp
#   git                : some yt-dlp extractors need it
RUN apk add --no-cache \
      python3 \
      py3-pip \
      ffmpeg \
      ca-certificates \
      git \
      curl \
      tzdata

# Install latest yt-dlp via pip
# Note: Alpine's default Python 3.11+ requires --break-system-packages
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && yt-dlp --version

WORKDIR /app

# Install npm deps first (better layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy app source
COPY . .

# Persistent tmp dir for downloads (ephemeral on Railway but works for single session)
RUN mkdir -p /tmp/wa-tmp && chmod 777 /tmp/wa-tmp

# ⚠️ Railway detects Node.js projects via package.json and wraps CMD with `node`.
# If we say CMD ["start-docker.sh"], it becomes `node start-docker.sh` → ERR_UNKNOWN_FILE_EXTENSION.
# Fix: use shell-form CMD with explicit `sh -c` so Railway can't wrap it.
#
# Set UPDATE_YT_DLP=1 in Railway env to update yt-dlp on every deploy
# (YT changes anti-bot frequently, fresh yt-dlp = higher success rate)
CMD ["sh", "-c", "if [ \"$UPDATE_YT_DLP\" = \"1\" ]; then echo '[start] Updating yt-dlp...'; yt-dlp -U 2>&1 || echo '[start] yt-dlp update failed (non-fatal)'; fi; mkdir -p /tmp/wa-tmp; chmod 777 /tmp/wa-tmp 2>/dev/null || true; echo '[start] Launching bot...'; exec node index.js"]


# Note: start-docker.sh kept in repo for local docker use / debugging.
# For Railway, the inline CMD above is used (Railway can't wrap `sh -c ...`).
# To use start-docker.sh locally:
#   docker build -t yanzyaha-bot .
#   docker run -it yanzyaha-bot sh /usr/local/bin/start-docker.sh
COPY start-docker.sh /usr/local/bin/start-docker.sh
RUN chmod +x /usr/local/bin/start-docker.sh
