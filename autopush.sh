#!/bin/bash
cd ~/wa-bot
git add .
git commit -m "auto update $(date '+%Y-%m-%d %H:%M:%S')"
git push
