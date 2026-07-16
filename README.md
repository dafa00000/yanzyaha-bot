# 🤖 YANZYAHA-BOT

Bot **WhatsApp** multi-fitur berbasis [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) + Node.js.

Fitur utama: **AI chat** (OpenAI-compatible API: OpenRouter / Gemini / custom), download media, sticker, economy/game, group filter command, broadcast owner, config per-user, dan lainnya.

Repo: [dafa00000/yanzyaha-bot](https://github.com/dafa00000/yanzyaha-bot)

---

## ✨ Ringkasan fitur

| Kategori | Contoh command |
|----------|----------------|
| **Info** | `.menu` `.ping` `.botinfo` `.owner` `.groupid` |
| **AI chat** | Chat biasa (private) / `.ai` `.grok` · `.reset` / `.forget` · `.memory` |
| **Sticker** | `.sticker` / `.s` · `.toimg` / `.toimage` |
| **Download** | `.ytdl` `.ytmp3` `.ttdl` `.twdl` `.igdl` `.fbdl` `.dl` `.clip` `.autoclip` |
| **Auto-DL** | Kirim link YT/TT/IG/X/FB/Pinterest (tanpa prefix, aturan beda private vs grup) |
| **Search** | `.search` / `.ddg` · `.cuaca` |
| **Market / crypto** | `.market` `.saham` `.forex` `.crypto` `.cryptotop` `.cryptoprediksi` `.convert` |
| **Sosmed cek** | `.ig` `.tt` `.gh` `.roblox` `.yt` |
| **MLBB** | `.ml` `.mlhelp` (+ command lengkap owner) |
| **Game / economy** | `.daily` `.balance` `.shop` `.slot` `.bj` `.dadu` `.kuis` … |
| **Tools** | `.translate` / `.tr` · `.calc` · `.vn` (TTS) |
| **Menfess** | `.menfess` · `.menfessp @628… pesan` |
| **Config AI (user)** | `.setapikey` `.setbaseurl` `.setmodel` `.models` `.myconfig` `.resetmyconfig` |
| **Owner** | ban/users, broadcast, filter grup, menu global, restart/update, shell `.run` |

> Ketik **`.menu`** di chat bot untuk daftar live (owner dapat section ekstra).

---

## 🧠 AI backend

Bot memanggil endpoint **OpenAI-compatible** (`/chat/completions`):

| Provider | `OPENAI_BASE_URL` (contoh) | Model contoh |
|----------|----------------------------|--------------|
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4` |
| Gemini (OpenAI compat) | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-flash` |
| Custom / proxy | base URL kamu | model yang disupport endpoint |

### Override tanpa restart

| Level | Command |
|-------|---------|
| **Per-user** | `.setapikey` · `.setbaseurl` · `.setmodel` · `.resetmyconfig` |
| **Global (owner)** | `.setglobalkey` · `.setglobalurl` · `.setglobalmodel` · `.showconfig` · `.resetconfig` |

Prioritas: **config user → override global → `.env`**.

Untuk Gemini OpenAI-compat, model biasanya **tanpa** prefix `models/`  
(contoh: `gemini-2.5-flash`, bukan `models/gemini-2.5-flash`).

---

## 🔒 Filter command per grup (owner)

| Command | Fungsi |
|---------|--------|
| `.restrictgroup` | Batasi grup ke allowlist command |
| `.unrestrictgroup` | Lepas filter (semua command aktif lagi) |
| `.addcmd <cmd>` / `.removecmd <cmd>` | Manage allowlist grup ini |
| `.listcmd` | Lihat command diizinkan |
| `.addcmdall` / `.removecmdall` | Bulk ke semua grup terfilter |
| `.enablecmd` / `.disablecmd` | Fitur di menu global private |

**Penting:**

- Non-owner di restricted group cuma bisa command yang di allowlist.
- **Owner selalu bisa** command manage (termasuk `.unrestrictgroup`) — anti soft-lock.
- Menu di restricted group **ikut allowlist** (`.addcmd` langsung keliatan di `.menu` berikutnya).
- Persist: `$HERMES_HOME/restricted_groups.json`

---

## 📢 Broadcast (owner)

```text
.broadcast [pesan]       → semua user private
.broadcastgroup [pesan]  → semua grup tercatat
.broadcastall [pesan]    → user + grup
```

Reply media + `.broadcast caption` juga didukung.

Target private diambil dari `$HERMES_HOME/users.json` dengan resolusi JID `@lid` / `@s.whatsapp.net` (multi-device).

---

## 📋 Persyaratan

- **Node.js 18+** (disarankan 20/22)
- Linux / VPS / Railway / Termux
- **ffmpeg** (sticker, clip)
- **yt-dlp** (download YT & banyak platform)
- Koneksi stabil ke WhatsApp Web

---

## ⚙️ Environment (`.env`)

Salin contoh:

```bash
cp .env.example .env
chmod 600 .env
```

### Minimal

```env
PHONE_NUMBER=628xxxxxxxxxx
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
HERMES_MODEL=gemini-2.5-flash
HERMES_HOME=/opt/data
```

| Variable | Wajib | Keterangan |
|----------|-------|------------|
| `PHONE_NUMBER` | Ya (pairing) | Format `62…`, tanpa `+` |
| `OPENAI_API_KEY` | Ya (AI) | Key provider OpenAI-compat |
| `OPENAI_BASE_URL` | Ya (AI) | Base URL provider |
| `HERMES_MODEL` | Ya (AI) | Nama model default |
| `HERMES_HOME` | Direkomendasikan | Data persist: auth, users, restrict, config (`/opt/data`) |
| `HERMES_BIN` | Opsional | Path CLI Hermes (bridge subprocess) |
| `HERMES_TIMEOUT_MS` | Opsional | Default `180000` |
| `WA_AI_DAILY_LIMIT` | Opsional | `0` = unlimited |
| `GEMINI_KEY` / `GEMINI_API_KEY` | Opsional | Path native Gemini / autoclip |
| `GROQ_API_KEY` | Opsional | Fitur tambahan |
| `WEATHER_API_KEY` | Opsional | Cuaca (kalau dipakai provider berbayar) |
| `IG_SESSIONID` / cookies | Opsional | Bypass anti-bot IG/FB |
| `COBALT_URL` | Opsional | Instance cobalt self-host |
| `UPDATE_YT_DLP` | Opsional | `1` = update yt-dlp saat start (Docker) |

Contoh lengkap ada di [`.env.example`](./.env.example).

> **Jangan commit `.env`.** File ini di-ignore di git.

---

## 🚀 Cara running

### 1) Lokal / VPS

```bash
git clone https://github.com/dafa00000/yanzyaha-bot.git
cd yanzyaha-bot

# deps sistem (Debian/Ubuntu contoh)
sudo apt update
sudo apt install -y ffmpeg
# yt-dlp: pip/x package manager sesuai OS

npm install
cp .env.example .env
# edit .env → PHONE_NUMBER + AI keys + HERMES_HOME

export HERMES_HOME="${HERMES_HOME:-$PWD/data}"
mkdir -p "$HERMES_HOME/auth"
npm start
```

### 2) Pairing WhatsApp (pairing code)

Bot **tidak** mengandalkan QR di terminal production; pakai **pairing code**:

1. Set `PHONE_NUMBER` di `.env`
2. `npm start`
3. Log menampilkan:

```text
🔑 KODE PAIRING: XXXXXXXX
```

4. Di HP: **WhatsApp → Titik 3 → Perangkat tertaut → Tautkan dengan nomor telepon**
5. Masukkan kode
6. Tunggu `✅ BOT BERHASIL TERHUBUNG`

### 3) Docker / Railway

```bash
# build lokal
docker build -t yanzyaha-bot .
docker run --env-file .env -v yanzyaha-data:/opt/data yanzyaha-bot
```

- Image/Dockerfile sudah siapkan Node + ffmpeg (+ yt-dlp di pipeline Docker).
- **Volume wajib** untuk `HERMES_HOME` (default `/opt/data`) supaya session WA & data tidak hilang.

### 4) Hermes host (contoh layout)

```text
/opt/data/bots/yanzyaha-bot/   ← source + node_modules
/opt/data/.env                 ← opsional env host
/opt/data/bots/yanzyaha-bot/.env
/opt/data/auth/                ← session WA (JANGAN DIHAPUS)
/opt/data/users.json
/opt/data/restricted_groups.json
/opt/data/user_configs.json
```

```bash
cd /opt/data/bots/yanzyaha-bot
# pastikan .env ada
/usr/local/bin/node index.js
# long-running: jalankan sebagai process background / ensure script + watchdog
```

### 5) Restart aman (tanpa logout WA)

```bash
# hentikan process bot SAJA
# JANGAN: rm -rf auth /opt/data/auth

cd /path/to/yanzyaha-bot
node index.js
```

---

## ⚠️ Session WhatsApp (`auth`)

| Path | Isi |
|------|-----|
| `$HERMES_HOME/auth` | Multi-file Baileys session (`creds.json`, keys, …) |

**Jangan hapus folder auth** saat fix/deploy/restart — user harus pairing ulang.

Hanya hapus auth jika:

- sengaja logout / ganti nomor bot, atau  
- session benar-benar corrupt setelah troubleshooting.

Di Railway: pasang **persistent volume** di `HERMES_HOME` (mis. `/opt/data`).

---

## 🧪 Test

```bash
npm test
```

Menjalankan suite unit/smoke (menu, memory, bridge, format, restrict, dll).

---

## 📁 Struktur (ringkas)

```text
yanzyaha-bot/
├── index.js                 # Entry + switch command utama
├── handler.js               # Fallback (sticker, dll)
├── menu.js                  # Renderer .menu (user / owner / restricted)
├── restrictions.cjs         # Filter grup + enablecmd global
├── handler-hermes.cjs       # AI chat OpenAI-compat
├── handler-hermes-bridge.cjs
├── handler-config.cjs       # setapikey / setmodel / global config
├── handler-broadcast.cjs
├── handler-download.js
├── handler-economy.cjs
├── handler-*.js|cjs         # Modul fitur lain
├── src/features/            # sticker, youtube, tiktok, ml, …
├── Dockerfile
├── railway.toml
├── .env.example
└── tests/
```

---

## 🛠️ Owner cheat-sheet

```text
.menu
.restrictgroup / .unrestrictgroup / .listcmd / .addcmd
.broadcast [pesan]
.setglobalmodel gemini-2.5-flash
.setglobalurl https://generativelanguage.googleapis.com/v1beta/openai/
.setglobalkey <key>
.users / .banned / .unban
.restart
```

Whale tracker Solana di codebase **dinonaktifkan** di runtime menu/command (bisa diaktifkan lagi di code kalau dibutuhkan).

---

## 🐛 Troubleshooting

| Gejala | Cek |
|--------|-----|
| Pairing code gagal | Nomor `62…` benar? Internet/firewall? Restart process (auth tetap) |
| `.ai` error model/404 | Nama model + base URL cocok provider? Coba tanpa `models/` |
| `.ai` 429 | Kuota API habis / rate limit |
| Download gagal | `ffmpeg` / `yt-dlp` terpasang? Cookies IG? |
| Broadcast “sukses” tapi sepi | User chat bot sekali lagi (update JID `@lid`); cek report error di balasan broadcast |
| Restricted: semua command mati | Owner pakai `.unrestrictgroup` (owner bypass) atau `.addcmd` |
| Session hilang tiap deploy | Volume `HERMES_HOME` belum dipasang |

---

## 📄 Lisensi

ISC (lihat `package.json`).

---

## 🔗 Link

- Repo: https://github.com/dafa00000/yanzyaha-bot  
- Baileys: https://github.com/WhiskeySockets/Baileys  
- Gemini OpenAI compatibility: https://ai.google.dev/gemini-api/docs/openai  
