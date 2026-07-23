#!/usr/bin/env bash
cd /opt/data/bots/yanzyaha-bot
set -a
[ -f .env ] && . ./.env
set +a
export PATH="/opt/data/bin:${PATH}"
export YTDLP_PATH="${YTDLP_PATH:-/opt/data/bin/yt-dlp}"
export HERMES_HOME="${HERMES_HOME:-/opt/data}"
exec /usr/local/bin/node index.js
