#!/bin/bash

# ================================================
#   WA Bot Installer untuk Termux / Linux
# ================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "╔══════════════════════════════════╗"
echo "║     WA BOT - AUTO INSTALLER      ║"
echo "╚══════════════════════════════════╝"
echo -e "${NC}"

# Cek apakah di Termux
IS_TERMUX=false
if [ -d "/data/data/com.termux" ]; then
  IS_TERMUX=true
  echo -e "${YELLOW}📱 Terdeteksi: Termux${NC}"
else
  echo -e "${YELLOW}💻 Terdeteksi: Linux biasa${NC}"
fi

# ---- INSTALL PAKET SISTEM ----
echo -e "\n${CYAN}[1/4] Menginstall paket sistem...${NC}"

if [ "$IS_TERMUX" = true ]; then
  pkg update -y && pkg upgrade -y
  pkg install -y nodejs-lts python make pkg-config libjpeg-turbo
else
  sudo apt-get update -y
  sudo apt-get install -y nodejs npm python3 make g++ pkg-config libjpeg-dev
fi

# Cek Node.js versi
NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}❌ Node.js minimal versi 18! Versi kamu: $(node -v)${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Node.js: $(node -v)${NC}"

# ---- BUAT FOLDER TEMP & AUTH ----
echo -e "\n${CYAN}[2/4] Membuat folder...${NC}"
mkdir -p temp auth
echo -e "${GREEN}✅ Folder temp/ dan auth/ dibuat${NC}"

# ---- INSTALL NPM PACKAGES ----
echo -e "\n${CYAN}[3/4] Menginstall npm packages...${NC}"
echo -e "${YELLOW}⚠️  Proses ini bisa memakan waktu 5-15 menit...${NC}"

# Gunakan --no-bin-links untuk kompatibilitas Termux
npm install --no-bin-links --legacy-peer-deps

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ npm install gagal!${NC}"
  echo -e "${YELLOW}Coba jalankan manual: npm install --no-bin-links --legacy-peer-deps${NC}"
  exit 1
fi
echo -e "${GREEN}✅ Package berhasil diinstall${NC}"

# ---- SELESAI ----
echo -e "\n${GREEN}╔══════════════════════════════════╗"
echo "║    ✅ INSTALASI SELESAI!          ║"
echo "╚══════════════════════════════════╝${NC}"
echo ""
echo -e "Jalankan bot dengan perintah:"
echo -e "${CYAN}  npm start${NC}"
echo ""
echo -e "Lalu scan QR Code dengan WhatsApp kamu."
echo ""
