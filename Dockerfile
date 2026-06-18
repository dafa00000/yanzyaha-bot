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

# Use a startup script that optionally updates yt-dlp before launching
# Set UPDATE_YT_DLP=1 in Railway env to update yt-dlp on every deploy
# (YT changes anti-bot frequently, fresh yt-dlp = higher success rate)
COPY start-docker.sh /usr/local/bin/start-docker.sh
RUN chmod +x /usr/local/bin/start-docker.sh

CMD ["start-docker.sh"]
