/**
 * ============================================================
 *  FILE MANAGER - WhatsApp Bot
 *  Kelola file bot via chat WhatsApp
 *  Admin: 6282389424044 & 62895618805248
 * ============================================================
 *
 *  CARA INSTALL DI TERMUX:
 *  1. Taruh file ini di folder root bot kamu
 *  2. Di index.js atau handler.js, tambahkan:
 *       const fileManager = require('./file-manager');
 *       // lalu panggil: fileManager.handle(sock, m)
 *  3. Pastikan ada library: fs, path (built-in Node.js)
 *
 *  PERINTAH YANG TERSEDIA (kirim via WhatsApp):
 *  .ls              - Lihat semua file & folder
 *  .ls [folder]     - Lihat isi folder tertentu
 *  .cat [file]      - Baca isi file (maks 3000 karakter)
 *  .rename [lama] [baru] - Rename file/folder
 *  .delete [file]   - Hapus file
 *  .mkdir [nama]    - Buat folder baru
 *  .find [nama]     - Cari file berdasarkan nama
 *  .info [file]     - Info detail file (ukuran, tanggal, dll)
 *  .send [file]     - Kirim file ke chat (dokumen)
 *  .edit [file]     - Mulai mode edit file (lihat isi)
 *  .write [file] [isi] - Tulis/timpa isi file
 *  .append [file] [isi] - Tambah teks ke akhir file
 *  .replace [file] [cari] | [ganti] - Cari & ganti teks dalam file
 *  .zip [file/folder] - Kompres file/folder jadi .zip
 *  .unzip [file.zip] - Ekstrak file zip
 *  .backup          - Backup semua file penting ke zip
 *  .stat            - Statistik disk & folder bot
 *  .help            - Tampilkan semua perintah
 * ============================================================
 */


const fs   = require('fs');
const path = require('path');

// ── KONFIGURASI ──────────────────────────────────────────────
const CONFIG = {
  // Nomor admin yang boleh menggunakan file manager
  ADMINS: ['6282389424044', '110857451221063', '83807763972304', '110857451221063'],

  // Root directory bot (folder tempat bot berjalan)
  BOT_ROOT: process.cwd(),

  // Prefix perintah file manager
  PREFIX: '.',

  // Batas ukuran file yang boleh dikirim via WhatsApp (50 MB)
  MAX_SEND_SIZE: 50 * 1024 * 1024,

  // Batas karakter isi file yang ditampilkan di chat
  MAX_READ_CHARS: 150000,

  // Folder & file yang tidak boleh diakses/dihapus (protected)
  PROTECTED: [
    'node_modules',
    '.git',
    'auth',
    'package.json',
    'package-lock.json',
  ],
};
// ─────────────────────────────────────────────────────────────

// ── UTILITAS ─────────────────────────────────────────────────

/**
 * Cek apakah pengirim adalah admin
 */
function isAdmin(sender) {
  const num = sender.replace(/@s.whatsapp.net|@g.us|@lid/g, '').split(':')[0]
  return CONFIG.ADMINS.includes(num)
}

/**
 * Cek apakah path termasuk yang dilindungi
 */
function isProtected(targetPath) {
  const base = path.basename(targetPath);
  return CONFIG.PROTECTED.includes(base);
}

/**
 * Resolusi path aman (mencegah path traversal di luar BOT_ROOT)
 */
function safePath(inputPath) {
  const resolved = path.resolve(CONFIG.BOT_ROOT, inputPath);
  if (!resolved.startsWith(CONFIG.BOT_ROOT)) {
    throw new Error('❌ Akses ditolak: path di luar direktori bot');
  }
  return resolved;
}

/**
 * Format ukuran file ke string yang mudah dibaca
 */
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format tanggal ke string lokal
 */
function formatDate(date) {
  return new Date(date).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Emoji berdasarkan ekstensi file
 */
function fileEmoji(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.js': '🟨', '.ts': '🔷', '.json': '📋', '.md': '📝',
    '.txt': '📄', '.sh': '⚙️',  '.env': '🔐', '.log': '📜',
    '.zip': '🗜️', '.tar': '🗜️', '.gz':  '🗜️',
    '.jpg': '🖼️', '.jpeg':'🖼️', '.png': '🖼️', '.gif': '🖼️',
    '.mp4': '🎬', '.mp3': '🎵',
    '.pdf': '📕',
    '.html':'🌐', '.css': '🎨',
  };
  return map[ext] || '📄';
}

// ── HANDLER PERINTAH ─────────────────────────────────────────

/**
 * .ls [folder?] — Daftar file & folder
 */
async function cmdLs(args) {
  const targetDir = args[0] ? safePath(args[0]) : CONFIG.BOT_ROOT;

  if (!fs.existsSync(targetDir)) {
    return `❌ Folder tidak ditemukan: *${args[0]}*`;
  }

  const items = fs.readdirSync(targetDir);
  if (items.length === 0) return `📂 Folder kosong: *${args[0] || '/'}*`;

  const dirs  = [];
  const files = [];

  for (const item of items) {
    const fullPath = path.join(targetDir, item);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        dirs.push(`📁 ${item}/`);
      } else {
        files.push(`${fileEmoji(item)} ${item} _(${formatSize(stat.size)})_`);
      }
    } catch {
      files.push(`❓ ${item}`);
    }
  }

  const relative = path.relative(CONFIG.BOT_ROOT, targetDir) || '.';
  let result = `📂 *Isi folder: ${relative}*\n`;
  result += `${'─'.repeat(30)}\n`;
  if (dirs.length)  result += dirs.join('\n')  + '\n';
  if (files.length) result += files.join('\n') + '\n';
  result += `${'─'.repeat(30)}\n`;
  result += `📊 ${dirs.length} folder, ${files.length} file`;
  return result;
}

/**
 * .cat [file] — Tampilkan isi file
 */
async function cmdCat(args) {
  if (!args[0]) return '⚠️ Penggunaan: *.cat [nama_file]*';

  const filePath = safePath(args[0]);
  if (!fs.existsSync(filePath)) return `❌ File tidak ditemukan: *${args[0]}*`;

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) return `❌ *${args[0]}* adalah folder, bukan file`;

  if (stat.size > 1 * 1024 * 1024) {
    return `⚠️ File terlalu besar (${formatSize(stat.size)}). Gunakan *.send ${args[0]}* untuk mengunduh.`;
  }

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return `❌ Gagal membaca file (mungkin file binary)`;
  }

  const truncated = content.length > CONFIG.MAX_READ_CHARS;
  const display   = truncated ? content.slice(0, CONFIG.MAX_READ_CHARS) : content;

  return (
    `📄 *${args[0]}* (${formatSize(stat.size)})\n` +
    `${'─'.repeat(30)}\n` +
    `\`\`\`\n${display}\n\`\`\`` +
    (truncated ? `\n\n⚠️ _Ditampilkan ${CONFIG.MAX_READ_CHARS} karakter pertama dari ${content.length} karakter_` : '')
  );
}

/**
 * .rename [lama] [baru] — Rename file/folder
 */
async function cmdRename(args) {
  if (args.length < 2) return '⚠️ Penggunaan: *.rename [nama_lama] [nama_baru]*';

  const oldPath = safePath(args[0]);
  const newPath = safePath(args[1]);

  if (!fs.existsSync(oldPath)) return `❌ File/folder tidak ditemukan: *${args[0]}*`;
  if (isProtected(oldPath))    return `🔒 File *${args[0]}* dilindungi, tidak bisa diubah`;
  if (fs.existsSync(newPath))  return `❌ Nama *${args[1]}* sudah ada`;

  fs.renameSync(oldPath, newPath);
  return `✅ Berhasil rename:\n*${args[0]}* → *${args[1]}*`;
}

/**
 * .delete [file] — Hapus file/folder
 */
async function cmdDelete(args) {
  if (!args[0]) return '⚠️ Penggunaan: *.delete [nama_file]*';

  const filePath = safePath(args[0]);
  if (!fs.existsSync(filePath)) return `❌ File/folder tidak ditemukan: *${args[0]}*`;
  if (isProtected(filePath))    return `🔒 File *${args[0]}* dilindungi, tidak bisa dihapus`;

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    fs.rmSync(filePath, { recursive: true, force: true });
    return `🗑️ Folder *${args[0]}* dan semua isinya berhasil dihapus`;
  } else {
    fs.unlinkSync(filePath);
    return `🗑️ File *${args[0]}* berhasil dihapus`;
  }
}

/**
 * .mkdir [nama] — Buat folder baru
 */
async function cmdMkdir(args) {
  if (!args[0]) return '⚠️ Penggunaan: *.mkdir [nama_folder]*';

  const dirPath = safePath(args[0]);
  if (fs.existsSync(dirPath)) return `❌ Folder/file *${args[0]}* sudah ada`;

  fs.mkdirSync(dirPath, { recursive: true });
  return `✅ Folder *${args[0]}* berhasil dibuat`;
}

/**
 * .find [nama] — Cari file berdasarkan nama (rekursif)
 */
async function cmdFind(args) {
  if (!args[0]) return '⚠️ Penggunaan: *.find [kata_kunci]*';

  const keyword = args[0].toLowerCase();
  const results = [];

  function walk(dir, depth = 0) {
    if (depth > 5) return; // Batasi kedalaman rekursi
    let items;
    try { items = fs.readdirSync(dir); } catch { return; }

    for (const item of items) {
      if (item === 'node_modules' || item === '.git') continue;
      const fullPath = path.join(dir, item);
      const relative = path.relative(CONFIG.BOT_ROOT, fullPath);
      if (item.toLowerCase().includes(keyword)) {
        const stat = fs.statSync(fullPath);
        results.push(
          stat.isDirectory()
            ? `📁 ${relative}/`
            : `${fileEmoji(item)} ${relative} _(${formatSize(stat.size)})_`
        );
      }
      try {
        if (fs.statSync(fullPath).isDirectory()) walk(fullPath, depth + 1);
      } catch { /* skip */ }
    }
  }

  walk(CONFIG.BOT_ROOT);

  if (results.length === 0) return `🔍 Tidak ada file/folder yang mengandung kata *"${args[0]}"*`;

  return (
    `🔍 *Hasil pencarian: "${args[0]}"*\n` +
    `${'─'.repeat(30)}\n` +
    results.join('\n') +
    `\n${'─'.repeat(30)}\n` +
    `📊 Ditemukan ${results.length} item`
  );
}

/**
 * .info [file] — Info detail file
 */
async function cmdInfo(args) {
  if (!args[0]) return '⚠️ Penggunaan: *.info [nama_file]*';

  const filePath = safePath(args[0]);
  if (!fs.existsSync(filePath)) return `❌ File tidak ditemukan: *${args[0]}*`;

  const stat = fs.statSync(filePath);
  const isDir = stat.isDirectory();

  let info = `ℹ️ *Info: ${args[0]}*\n${'─'.repeat(30)}\n`;
  info += `📌 Tipe    : ${isDir ? 'Folder' : 'File'}\n`;
  info += `📦 Ukuran  : ${formatSize(stat.size)}\n`;
  info += `📅 Dibuat  : ${formatDate(stat.birthtime)}\n`;
  info += `🔄 Diubah  : ${formatDate(stat.mtime)}\n`;
  info += `👁️ Diakses : ${formatDate(stat.atime)}\n`;

  if (!isDir) {
    info += `📎 Ekstensi: ${path.extname(args[0]) || '(tidak ada)'}\n`;
  } else {
    try {
      const children = fs.readdirSync(filePath);
      info += `📂 Isi     : ${children.length} item\n`;
    } catch { /* skip */ }
  }

  return info;
}

/**
 * .write [file] [isi] — Tulis/timpa isi file
 * Contoh: .write test.txt Halo dunia!
 */
async function cmdWrite(args) {
  if (args.length < 2) return '⚠️ Penggunaan: *.write [nama_file] [isi_teks]*';

  const filePath = safePath(args[0]);
  if (isProtected(filePath)) return `🔒 File *${args[0]}* dilindungi, tidak bisa ditulis`;

  const content = args.slice(1).join(' ');
  fs.writeFileSync(filePath, content, 'utf8');

  return `✅ File *${args[0]}* berhasil ditulis (${formatSize(Buffer.byteLength(content, 'utf8'))})`;
}

/**
 * .append [file] [isi] — Tambah teks ke akhir file
 */
async function cmdAppend(args) {
  if (args.length < 2) return '⚠️ Penggunaan: *.append [nama_file] [teks]*';

  const filePath = safePath(args[0]);
  if (isProtected(filePath)) return `🔒 File *${args[0]}* dilindungi`;

  const content = '\n' + args.slice(1).join(' ');
  fs.appendFileSync(filePath, content, 'utf8');

  return `✅ Teks berhasil ditambahkan ke *${args[0]}*`;
}

/**
 * .replace [file] [cari] | [ganti] — Cari & ganti teks dalam file
 * Contoh: .replace index.js helloWorld | hiWorld
 */
async function cmdReplace(args) {
  if (args.length < 1) return '⚠️ Penggunaan: *.replace [file] [cari] | [ganti]*';

  const filePath = safePath(args[0]);
  if (!fs.existsSync(filePath)) return `❌ File tidak ditemukan: *${args[0]}*`;
  if (isProtected(filePath))    return `🔒 File *${args[0]}* dilindungi`;

  // Gabungkan semua argumen setelah nama file, lalu split dengan ' | '
  const rest   = args.slice(1).join(' ');
  const parts  = rest.split(' | ');
  if (parts.length < 2) return '⚠️ Gunakan ` | ` (spasi-pipa-spasi) sebagai pemisah\nContoh: *.replace file.js teks_lama | teks_baru*';

  const search  = parts[0].trim();
  const replace = parts[1].trim();

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return '❌ Gagal membaca file (mungkin file binary)';
  }

  const count   = (content.split(search).length - 1);
  if (count === 0) return `⚠️ Teks *"${search}"* tidak ditemukan di *${args[0]}*`;

  const newContent = content.split(search).join(replace);
  fs.writeFileSync(filePath, newContent, 'utf8');

  return `✅ Berhasil mengganti *${count}x* "${search}" → "${replace}" di *${args[0]}*`;
}

/**
 * .stat — Statistik bot & disk
 */
async function cmdStat() {
  function getDirSize(dirPath) {
    let total = 0;
    try {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        if (item === 'node_modules' || item === '.git') continue;
        const full = path.join(dirPath, item);
        try {
          const s = fs.statSync(full);
          total += s.isDirectory() ? getDirSize(full) : s.size;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
    return total;
  }

  const totalSize  = getDirSize(CONFIG.BOT_ROOT);
  const allItems   = fs.readdirSync(CONFIG.BOT_ROOT);
  const folders    = allItems.filter(i => {
    try { return fs.statSync(path.join(CONFIG.BOT_ROOT, i)).isDirectory(); } catch { return false; }
  });
  const files      = allItems.filter(i => {
    try { return fs.statSync(path.join(CONFIG.BOT_ROOT, i)).isFile(); } catch { return false; }
  });

  // Cek ukuran node_modules
  const nmPath = path.join(CONFIG.BOT_ROOT, 'node_modules');
  const nmSize = fs.existsSync(nmPath) ? getDirSize(nmPath) : 0;

  let stat = `📊 *Statistik Bot*\n${'─'.repeat(30)}\n`;
  stat += `📁 Root       : ${CONFIG.BOT_ROOT}\n`;
  stat += `📂 Folder     : ${folders.length}\n`;
  stat += `📄 File       : ${files.length}\n`;
  stat += `💾 Total size : ${formatSize(totalSize)}\n`;
  stat += `📦 node_modules: ${formatSize(nmSize)}\n`;
  stat += `${'─'.repeat(30)}\n`;
  stat += `🔐 Admin aktif: ${CONFIG.ADMINS.join(', ')}`;
  return stat;
}

/**
 * .zip [file/folder] — Kompres file
 * Menggunakan Node.js built-in zlib + archiver jika tersedia
 */
async function cmdZip(args) {
  if (!args[0]) return '⚠️ Penggunaan: *.zip [nama_file_atau_folder]*';

  const targetPath = safePath(args[0]);
  if (!fs.existsSync(targetPath)) return `❌ File/folder tidak ditemukan: *${args[0]}*`;

  // Cek apakah archiver tersedia
  let archiver;
  try {
    archiver = require('archiver'); if (typeof archiver !== 'function') archiver = archiver.default;
  } catch {
    return (
      '❌ Library *archiver* tidak tersedia.\n' +
      'Install dulu di Termux:\n' +
      '```\nnpm install archiver\n```\n' +
      'Lalu kirim ulang perintah ini.'
    );
  }

  const zipName = path.basename(args[0]) + '_' + Date.now() + '.zip';
  const zipPath = path.join(CONFIG.BOT_ROOT, 'temp', zipName);

  // Pastikan folder temp ada
  fs.mkdirSync(path.join(CONFIG.BOT_ROOT, 'temp'), { recursive: true });

  return new Promise((resolve) => {
    const output  = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      resolve(
        `✅ Zip berhasil dibuat!\n` +
        `📦 *${zipName}* (${formatSize(archive.pointer())})\n` +
        `📂 Tersimpan di: temp/${zipName}\n` +
        `Gunakan *.send temp/${zipName}* untuk mendownload`
      );
    });

    archive.on('error', (err) => resolve(`❌ Gagal zip: ${err.message}`));
    archive.pipe(output);

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      archive.directory(targetPath, path.basename(args[0]));
    } else {
      archive.file(targetPath, { name: path.basename(args[0]) });
    }

    archive.finalize();
  });
}

/**
 * .backup — Backup file-file penting bot
 */
async function cmdBackup() {
  let archiver;
  try {
    archiver = require('archiver'); if (typeof archiver !== 'function') archiver = archiver.default;
  } catch {
    return (
      '❌ Library *archiver* tidak tersedia.\n' +
      'Install: `npm install archiver`'
    );
  }

  const backupFiles = [
    'index.js', 'config.js', 'handler.js', 'menu.js',
    'handler-crypto.js', 'handler-download.js', 'handler-menfess.js',
    'handler-search.js', 'handler-sosmed.js', 'youtube.js',
    'tiktok.js', 'instagram.js', 'roblox.js', 'github.js',
    'package.json', 'src',
  ];

  const zipName = `backup_bot_${Date.now()}.zip`;
  const zipPath = path.join(CONFIG.BOT_ROOT, 'temp', zipName);
  fs.mkdirSync(path.join(CONFIG.BOT_ROOT, 'temp'), { recursive: true });

  return new Promise((resolve) => {
    const output  = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const added   = [];

    output.on('close', () => {
      resolve(
        `✅ *Backup berhasil!*\n` +
        `📦 ${zipName} (${formatSize(archive.pointer())})\n` +
        `📄 File: ${added.join(', ')}\n` +
        `\nGunakan *.send temp/${zipName}* untuk download`
      );
    });

    archive.on('error', (err) => resolve(`❌ Gagal backup: ${err.message}`));
    archive.pipe(output);

    for (const file of backupFiles) {
      const fullPath = path.join(CONFIG.BOT_ROOT, file);
      if (!fs.existsSync(fullPath)) continue;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        archive.directory(fullPath, file);
      } else {
        archive.file(fullPath, { name: file });
      }
      added.push(file);
    }

    archive.finalize();
  });
}

/**
 * .help — Tampilkan semua perintah
 */
function cmdHelp() {
  return (
    `🗂️ *FILE MANAGER BOT*\n` +
    `${'═'.repeat(32)}\n` +
    `\n📋 *MELIHAT FILE*\n` +
    `• \`.ls\` — Lihat semua file\n` +
    `• \`.ls src\` — Lihat isi folder src\n` +
    `• \`.cat config.js\` — Baca isi file\n` +
    `• \`.info handler.js\` — Detail file\n` +
    `• \`.find keyword\` — Cari file\n` +
    `• \`.stat\` — Statistik bot\n` +
    `\n✏️ *EDIT FILE*\n` +
    `• \`.write nama.txt isi teks\` — Buat/timpa file\n` +
    `• \`.append nama.txt teks\` — Tambah ke file\n` +
    `• \`.replace file.js lama | baru\` — Cari & ganti\n` +
    `\n📁 *KELOLA FILE*\n` +
    `• \`.rename lama baru\` — Rename\n` +
    `• \`.delete nama.txt\` — Hapus file\n` +
    `• \`.mkdir namafolder\` — Buat folder\n` +
    `• \`.send src/index.js\` — Kirim file\n` +
    `\n🗜️ *BACKUP & KOMPRES*\n` +
    `• \`.zip handler.js\` — Zip file\n` +
    `• \`.zip src\` — Zip folder\n` +
    `• \`.backup\` — Backup semua file penting\n` +
    `\n🔒 *File yang dilindungi:*\n` +
    `_${CONFIG.PROTECTED.join(', ')}_\n` +
    `${'═'.repeat(32)}`
  );
}

// ── ENTRY POINT ───────────────────────────────────────────────

/**
 * Fungsi utama yang dipanggil dari handler bot
 *
 * @param {object} sock  - Socket WhatsApp (baileys)
 * @param {object} m     - Pesan masuk
 * @returns {boolean}    - true jika pesan ditangani, false jika bukan perintah FM
 *
 * CARA INTEGRASI DI handler.js / index.js:
 * ─────────────────────────────────────────
 * const fileManager = require('./file-manager');
 *
 * // Di dalam fungsi utama handler pesan:
 * const handled = await fileManager.handle(sock, m);
 * if (handled) return; // Sudah ditangani file manager
 */
async function handle(sock, m) {
  // Ambil teks pesan
  const body =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text ||
    m.message?.imageMessage?.caption ||
    m.message?.videoMessage?.caption ||
    '';

  if (!body.startsWith(CONFIG.PREFIX)) return false;

  // Pecah perintah
  
  const fullCmd = body.slice(CONFIG.PREFIX.length).trim();
const firstSpace = fullCmd.indexOf(' ');
const command_raw = firstSpace === -1 ? fullCmd : fullCmd.slice(0, firstSpace);
const rest_raw = firstSpace === -1 ? '' : fullCmd.slice(firstSpace + 1);
const command = command_raw.toLowerCase();
const args = command_raw === 'replace'
  ? [rest_raw.split(' ')[0], ...rest_raw.slice(rest_raw.indexOf(' ') + 1).split('\n')]
  : rest_raw.split(/\s+/).filter(Boolean);

  // Daftar perintah file manager
  const FM_COMMANDS = [
    'ls','cat','rename','delete','rm','mkdir','find',
    'info','write','append','replace','zip','unzip',
    'backup','stat','send','help','fm',
  ];

  if (!FM_COMMANDS.includes(command)) return false;

  // Cek admin
  console.log('SENDER:', m.key?.participant, m.key?.remoteJid);
  const sender = m.key?.participant || m.key?.remoteJid || '';
  if (!isAdmin(sender)) {
    await sock.sendMessage(m.key.remoteJid, {
      text: '⛔ Kamu tidak memiliki izin untuk menggunakan File Manager.',
    }, { quoted: m });
    return true;
  }

  // Jalankan perintah
  let response = '';
  try {
    switch (command) {
      case 'ls':
        response = await cmdLs(args);
        break;
      case 'cat':
        response = await cmdCat(args);
        break;
      case 'rename':
        response = await cmdRename(args);
        break;
      case 'delete':
      case 'rm':
        response = await cmdDelete(args);
        break;
      case 'mkdir':
        response = await cmdMkdir(args);
        break;
      case 'find':
        response = await cmdFind(args);
        break;
      case 'info':
        response = await cmdInfo(args);
        break;
      case 'write':
        response = await cmdWrite(args);
        break;
      case 'append':
        response = await cmdAppend(args);
        break;
      case 'replace':
        response = await cmdReplace(args);
        break;
      case 'zip':
        response = await cmdZip(args);
        break;
      case 'backup':
        response = await cmdBackup();
        break;
      case 'stat':
        response = await cmdStat();
        break;

      // ── KIRIM FILE VIA CHAT ───────────────────────────────────
      case 'send': {
        if (!args[0]) {
          response = '⚠️ Penggunaan: *.send [nama_file]*';
          break;
        }

        const sendPath = safePath(args[0]);
        if (!fs.existsSync(sendPath)) {
          response = `❌ File tidak ditemukan: *${args[0]}*`;
          break;
        }

        const sendStat = fs.statSync(sendPath);
        if (sendStat.isDirectory()) {
          response = `❌ Tidak bisa mengirim folder langsung. Gunakan *.zip ${args[0]}* terlebih dahulu.`;
          break;
        }

        if (sendStat.size > CONFIG.MAX_SEND_SIZE) {
          response = `❌ File terlalu besar: ${formatSize(sendStat.size)} (maks ${formatSize(CONFIG.MAX_SEND_SIZE)})`;
          break;
        }

        // Kirim file sebagai dokumen
        await sock.sendMessage(
          m.key.remoteJid,
          {
            document: fs.readFileSync(sendPath),
            fileName: path.basename(sendPath),
            mimetype: 'application/octet-stream',
            caption: `📤 *${path.basename(sendPath)}*\n📦 Ukuran: ${formatSize(sendStat.size)}`,
          },
          { quoted: m }
        );
        return true; // Sudah di-handle, tidak perlu kirim text response
      }

      case 'help':
      case 'fm':
      default:
        response = cmdHelp();
        break;
    }
  } catch (err) {
    response = `❌ *Error:* ${err.message}`;
  }

  if (response) {
    await sock.sendMessage(m.key.remoteJid, { text: response }, { quoted: m });
  }

  return true;
}

// Export
module.exports = { handle, isAdmin, CONFIG };
