# 📱 PANDUAN TERMUX - YANZYAHA-BOT
> Simpan file ini, baca kalau lupa!

---

## 📄 LIHAT FILE

# Lihat seluruh isi file
cat namafile.js

# Lihat per baris (range)
sed -n '10,20p' namafile.js   # baris 10 sampai 20
sed -n '50p' namafile.js      # baris 50 saja

# Lihat dengan nomor baris
cat -n namafile.js

# Lihat atas/bawah file
head -20 namafile.js    # 20 baris pertama
tail -20 namafile.js    # 20 baris terakhir
tail -f namafile.js     # live update (cocok untuk log)

---

## ✏️ EDIT FILE

# Buka dengan nano
nano namafile.js
nano +50 namafile.js    # langsung ke baris 50

# Shortcut di dalam nano:
# Ctrl+O  = simpan file
# Ctrl+X  = keluar
# Ctrl+W  = cari teks
# Ctrl+K  = hapus 1 baris
# Ctrl+U  = paste baris yang dihapus
# Ctrl+\  = cari dan ganti teks
# Alt+G   = pergi ke baris tertentu

---

## 🔍 CARI TEKS DALAM FILE

# Cari kata + tampilkan nomor baris
grep -n "kata" namafile.js

# Cari di semua file dalam folder
grep -rn "kata" ~/wa-bot/

# Cari tanpa peduli huruf besar/kecil
grep -in "kata" namafile.js

---

## ✂️ EDIT TANPA BUKA FILE (sed)

# Ganti teks (semua kemunculan)
sed -i 's/teks_lama/teks_baru/g' namafile.js

# Hapus baris tertentu
sed -i '50d' namafile.js        # hapus baris 50
sed -i '50,55d' namafile.js     # hapus baris 50 sampai 55

# Sisipkan teks setelah baris tertentu
sed -i '50a\teks baru' namafile.js

# Ganti seluruh isi baris 50
sed -i '50s/.*/teks pengganti/' namafile.js

---

## 📁 COPY, PINDAH, RENAME FILE

# Copy file di tempat yang sama
cp namafile.js namafile.bak

# Copy file ke folder lain
cp namafile.js ~/folder-tujuan/
cp namafile.js ~/wa-bot/handler-baru.js

# Copy dari Download ke Home Termux
cp ~/storage/downloads/namafile.js ~/
cp ~/storage/downloads/namafile.js ~/wa-bot/

# Copy dari galeri ke folder bot
cp ~/storage/pictures/foto.jpg ~/wa-bot/assets/

# Copy folder beserta isinya
cp -r ~/folder-lama/ ~/folder-baru/

# Pindahkan file (cut+paste)
mv namafile.js ~/folder-tujuan/
mv ~/storage/downloads/script.js ~/wa-bot/

# Pindahkan dari Download ke Home
mv ~/storage/downloads/file.js ~/

# Rename file
mv nama-lama.js nama-baru.js

# Rename + pindahkan sekaligus
mv ~/storage/downloads/file.js ~/wa-bot/handler-baru.js

---

## 🗑️ HAPUS FILE/FOLDER

rm namafile.js              # hapus 1 file
rm -rf namafolder/          # hapus folder + semua isinya
rm *.log                    # hapus semua file .log
rm file1.js file2.js        # hapus beberapa file sekaligus

---

## 🔎 CARI FILE

find ~/wa-bot -name "*.js"         # cari semua file .js
find ~/wa-bot -name "handler*"     # cari nama yang diawali handler
find ~ -name "*.mp4"               # cari semua video
find ~/storage -name "*.js"        # cari di storage HP

---

## 📂 NAVIGASI FOLDER

pwd                    # lihat posisi folder sekarang
ls                     # lihat isi folder
ls -lh                 # lihat isi + ukuran file
ls ~/wa-bot/           # lihat isi folder tertentu
cd ~/wa-bot            # masuk ke folder wa-bot
cd ~                   # kembali ke home
cd ..                  # mundur 1 folder
cd ../..               # mundur 2 folder

---

## 💾 BACKUP & RESTORE

cp index.js index.js.bak      # backup file
cp index.js.bak index.js      # restore file
cp -r ~/wa-bot ~/wa-bot-backup # backup folder bot
ls *.bak                       # lihat semua file backup

---

## 🔗 PATH PENTING DI TERMUX

~                          = home Termux
~/wa-bot                   = folder bot WhatsApp
~/storage/downloads        = folder Download HP
~/storage/pictures         = folder Foto/Gambar HP
~/storage/dcim             = folder Kamera HP
~/storage/dcim/Screenshots = folder Screenshot HP
~/storage/music            = folder Musik HP

---

## 💡 TIPS PENTING

# Selalu backup dulu sebelum edit!
cp index.js index.js.bak

# Kalau bot error, lihat baris yang disebutkan
sed -n '140,150p' index.js

# Cari posisi kode dulu
grep -n "kata kunci" index.js

# Jalankan bot
node index.js

# Jalankan bot di background (tetap jalan walau Termux ditutup)
nohup node index.js &

# Lihat proses yang berjalan
ps aux | grep node

# Matikan proses node
pkill node
