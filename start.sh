#!/data/data/com.termux/files/usr/bin/bash
cd /data/data/com.termux/files/home/wa-bot
echo "🤖 Bot dimulai..."
while true; do
  node index.js
  EXIT=$?
  if [ $EXIT -eq 2 ]; then
    echo "🔄 Restarting bot..."
    sleep 3
  else
    echo "🛑 Bot berhenti (exit code: $EXIT)"
    break
  fi
done
