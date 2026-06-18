#!/bin/sh
# start-docker.sh — Railway / Docker entrypoint
# Cross-platform (Alpine + Debian slim), unlike start.sh which is Termux-specific.

set -e

# Optional: update yt-dlp to latest on every container start
# Enable by setting UPDATE_YT_DLP=1 in Railway env vars
if [ "$UPDATE_YT_DLP" = "1" ]; then
  echo "[start] Updating yt-dlp..."
  yt-dlp -U 2>&1 || echo "[start] yt-dlp update failed (non-fatal)"
fi

# Ensure tmp dir exists (Railway containers can be recreated)
mkdir -p /tmp/wa-tmp
chmod 777 /tmp/wa-tmp 2>/dev/null || true

echo "[start] Launching bot..."
exec node index.js
