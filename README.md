# 🤖 WA Bot Simple

Bot WhatsApp dengan berbagai fitur, dibuat menggunakan [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys).

---

## ✨ Fitur

### 📌 Info & Tools
| Command | Fungsi |
|---------|--------|
| `.menu` | Tampilkan daftar fitur |
| `.ping` | Cek status & latensi bot |
| `.info` | Info bot & sistem |
| `.owner` | Kontak owner |

### 📥 Download
| Command | Fungsi |
|---------|--------|
| `.ytdl [link]` | Download video YouTube (maks 10 menit) |
| `.ytmp3 [link]` | Download audio YouTube |
| `.ttdl [link]` | Download video TikTok (tanpa watermark) |
| `.clip [link] [mulai] [akhir]` | Clip YouTube (range waktu) |

### ⚡ Auto-Download (Tanpa Prefix)
Kirim link langsung — bot auto-download. Bisa juga pake keyword untuk mode khusus.

| Format User | Aksi |
|-------------|------|
| `https://youtu.be/xxx` | Full download YouTube |
| `https://vm.tiktok.com/xxx` | Download TikTok (no watermark) |
| `https://x.com/user/status/123` | Download video Twitter/X |
| `https://pin.it/xxx` | Download Pinterest |
| `0:42 https://youtu.be/xxx` | Clip 60 detik mulai dari 0:42 |
| `1:30:00 https://youtu.be/xxx` | Clip 60 detik mulai dari 1j 30m |
| `clip https://youtu.be/xxx 01:30 02:45` | Clip range waktu spesifik |
| `auto https://youtu.be/xxx` | AI-powered autoclip (picks best moment) |

> 📝 **Catatan:** Di grup, auto-download cuma trigger kalau message essentially cuma URL (biar gak nabrak chat normal). Di private chat, auto-detect selama ada URL di body.

### 👤 Cek Profil Sosmed
| Command | Fungsi |
|---------|--------|
| `.ig [username]` | Cek profil Instagram |
| `.tt [username]` | Cek profil TikTok |
| `.gh [username]` | Cek profil GitHub |
| `.roblox [username]` | Cek profil Roblox |
| `.yt [nama channel]` | Cek info channel YouTube |

### 🎮 Mobile Legends
| Command | Fungsi |
|---------|--------|
| `.ml [ID] [Zone]` | Cek profil Mobile Legends |
| `.mlhelp` | Cara cari ID dan Zone ML |

### 🔍 Search *(Baru!)*
| Command | Fungsi |
|---------|--------|
| `.google [query]` | Cari informasi di Google |
| `.wiki [query]` | Cari artikel Wikipedia |
| `.berita [topik]` | Cari berita terkini |
| `.gambar [query]` | Cari gambar |


### 💰 Crypto *(Baru!)*
| Command | Fungsi |
|---------|--------|
| `.crypto [koin]` | Cek harga koin (contoh: `.crypto BTC`) |
| `.dominan` | Dominasi pasar crypto hari ini |
| `.trending` | Koin yang sedang trending |
| `.konversi [jumlah] [koin] [mata uang]` | Konversi nilai crypto |

### 📨 Menfess
| Command | Fungsi |
|---------|--------|
| `.menfess [pesan]` | Kirim pesan anonim ke grup |
| `.menfessp [pesan]` | Kirim pesan anonim ke private |

### 📝 Lainnya
| Command | Fungsi |
|---------|--------|
| `.teks [pesan]` | Echo teks |
| `.sticker` / `.s` | Buat stiker dari foto/video |
| `.toimg` | Ubah stiker jadi foto |

---

## 📋 Persyaratan

- Node.js **v18 atau lebih baru**
- Termux (Android) atau Linux
- Koneksi internet

---

## 🚀 Cara Install & Jalankan

### Di Termux (Android)

```bash
# 1. Clone repo
git clone https://github.com/USERNAME/wa-bot-simple
cd wa-bot-simple

# 2. Jalankan installer otomatis
chmod +x install.sh
bash install.sh

# 3. Jalankan bot
npm start
```

### Di Linux / VPS

```bash
git clone https://github.com/USERNAME/wa-bot-simple
cd wa-bot-simple
bash install.sh
npm start
```

---

## ⚠️ Penting: Untuk Termux

Jika `npm install` gagal dengan error `ENOSYS symlink`, pastikan project ada di **home Termux** (bukan di storage internal):

```bash
# Pindahkan project ke home Termux
mv /storage/emulated/0/wa-bot-simple ~/wa-bot-simple
cd ~/wa-bot-simple
bash install.sh
```

---

## 📱 Cara Pakai

1. Jalankan `npm start`
2. Scan QR Code yang muncul dengan WhatsApp
3. Tunggu hingga muncul "✅ BOT BERHASIL TERHUBUNG"
4. Kirim `.menu` ke bot untuk melihat fitur

---

## 📁 Struktur Project

```
wa-bot-simple/
├── src/
│   ├── index.js            ← Entry point
│   ├── handler.js          ← Handler semua pesan
│   └── features/
│       ├── sticker.js      ← Fitur stiker
│       ├── youtube.js      ← Download YouTube
│       ├── tiktok.js       ← Download TikTok
│       ├── info.js         ← Info sistem
│       ├── search.js       ← Fitur pencarian
│       ├── market.js       ← Fitur market
│       └── crypto.js       ← Fitur crypto
├── auth/                   ← Session WA (auto-generated)
├── temp/                   ← File sementara (auto-generated)
├── menu.js                 ← Teks & konfigurasi menu
├── install.sh              ← Script installer
├── package.json
└── README.md
```

---

## 🔄 Update Bot

```bash
git pull
npm install --no-bin-links --legacy-peer-deps
npm start
```

---

## ❓ FAQ

**Q: Bot disconnect terus?**
A: Bot akan otomatis reconnect. Jika logout, hapus folder `auth/` lalu scan QR lagi.

**Q: Error saat install di Termux?**
A: Pastikan jalankan `pkg update && pkg upgrade` dulu, lalu coba lagi.

**Q: Download YouTube gagal?**
A: YouTube sering update. Coba update ytdl-core: `npm install ytdl-core@latest`

**Q: Fitur crypto tidak akurat?**
A: Data diambil dari API publik (CoinGecko). Harga bisa berbeda beberapa detik dari harga real-time.

---

## 📄 Lisensi

MIT License — bebas digunakan dan dimodifikasi.
