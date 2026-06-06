'use strict';

// ─── ROTASI API KEY GROQ ──────────────────────────────────────────────────────
// Tambahkan key-key Groq kamu di sini (daftar gratis di console.groq.com)
const GROQ_KEYS = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

let groqKeyIndex = 0;

function getNextGroqKey() {
  if (!GROQ_KEYS.length) return null;
  const key = GROQ_KEYS[groqKeyIndex];
  groqKeyIndex = (groqKeyIndex + 1) % GROQ_KEYS.length;
  return key;
}

const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');

const BOT_ROOT   = process.cwd();
const BACKUP_DIR = path.join(BOT_ROOT, 'backup-ai');

// ─── API ENDPOINTS ────────────────────────────────────────────────────────────
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant'; // model terbaik Groq untuk coding

// ─── MEMORY PERCAKAPAN (per user, max 20 pesan) ───────────────────────────────
const chatHistory = new Map();
const MAX_HISTORY = 20;

function getHistory(userId) {
  if (!chatHistory.has(userId)) chatHistory.set(userId, []);
  return chatHistory.get(userId);
}

function addHistory(userId, role, content) {
  const hist = getHistory(userId);
  hist.push({ role, content });
  if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
}

function clearHistory(userId) {
  chatHistory.set(userId, []);
}

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah asisten AI pintar di WhatsApp bernama "YANZYAHA-BOT".

KEPRIBADIAN:
- Ramah, to the point, tidak bertele-tele
- Jawab dalam Bahasa Indonesia kecuali user pakai bahasa lain
- Untuk kode: selalu berikan penjelasan singkat + kode yang siap pakai

KEAHLIAN UTAMA:
- Programming (JavaScript, Python, dll) — berikan kode lengkap yang bisa langsung dijalankan
- Debug dan fix error — analisis error dengan teliti
- Penjelasan konsep teknis dengan bahasa sederhana
- Pertanyaan umum, matematika, sains

FORMAT WHATSAPP:
- Gunakan *bold* untuk poin penting
- Gunakan \`kode\` untuk inline code
- Gunakan blok kode dengan bahasa: \`\`\`javascript ... \`\`\`
- Jangan terlalu panjang, max 3-4 paragraf kecuali diminta detail
- Emoji boleh tapi jangan berlebihan

BATASAN:
- Jangan buat konten berbahaya, SARA, atau ilegal
- Jika tidak tahu, jujur saja`;

// ─── GROQ CHAT (untuk percakapan + coding) ───────────────────────────────────



// ─── ANTI JAILBREAK ───────────────────────────────────────────────────────────
const JAILBREAK_PATTERNS = [
  /akujilust/i,
  /jailbreak/i,
  /\bdan mode\b/i,
  /do anything now/i,
  /unfiltered/i,
  /amoral/i,
  /no ethical/i,
  /ignore (all |previous |your )?(rules|instructions|guidelines)/i,
  /pretend (you are|to be)/i,
  /act as (if )?you (have no|are free|are not)/i,
  /you are free from/i,
  /bypass (your |all )?(rules|filters|restrictions)/i,
  /you have no rules/i,
  /without (any |ethical )?restrictions/i,
  /kamu tidak punya aturan/i,
  /pura-pura jadi/i,
  /lupakan instruksi/i,
  /abaikan instruksi/i,
];

function isJailbreak(text) {
  return JAILBREAK_PATTERNS.some(p => p.test(text));
}

async function groqChat(apiKey, userId, userMessage) {
  addHistory(userId, 'user', userMessage);
  const history = getHistory(userId);

  // Rotasi key: coba semua key sampai berhasil
  const keys = GROQ_KEYS.length ? GROQ_KEYS : [apiKey];
  let lastError = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const currentKey = keys[(groqKeyIndex + attempt) % keys.length];
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentKey}`,
        },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
      ],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

      const data = await res.json();
      if (!res.ok) {
        // Kalau rate limit, coba key berikutnya
        if (data.error?.message?.includes('Rate limit') || res.status === 429) {
          lastError = new Error(data.error?.message || 'Rate limit');
          groqKeyIndex = (groqKeyIndex + 1) % keys.length;
          continue;
        }
        throw new Error(data.error?.message || 'Groq API error');
      }

      const reply = data.choices?.[0]?.message?.content || '❌ Tidak ada respons';
      addHistory(userId, 'assistant', reply);
      return reply;
    } catch (err) {
      if (err.message?.includes('Rate limit') || err.message?.includes('429')) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  // Semua key kena rate limit
  throw new Error('Semua API key sedang rate limit. Coba lagi nanti atau tambah key baru.');
}

// ─── GEMINI (untuk .addfeature — nulis kode otomatis) ────────────────────────
async function gemini(apiKey, prompt) {
  const isOAuth = apiKey.startsWith('AQ.')
  const url = isOAuth ? GEMINI_URL : `${GEMINI_URL}?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(isOAuth ? { 'Authorization': `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Gemini API error');
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function backup(file) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `${path.basename(file)}.${Date.now()}.bak`);
  fs.copyFileSync(file, dest);
  return dest;
}

function latestBackup(fileName) {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const list = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(fileName + '.'))
    .sort().reverse();
  return list[0] ? path.join(BACKUP_DIR, list[0]) : null;
}

function extractCode(text) {
  const m = text.match(/```(?:javascript|js)?\n([\s\S]+?)```/);
  return m ? m[1].trim() : text.trim();
}

function restartBot() {
  const child = spawn('node', [path.join(BOT_ROOT, 'index.js')], {
    detached: true, stdio: 'ignore', cwd: BOT_ROOT,
  });
  child.unref();
  setTimeout(() => process.exit(0), 500);
}

// ─── COMMAND HANDLERS ────────────────────────────────────────────────────────
async function cmdAddFeature(sock, m, args, geminiKey, groqKey) {
  if (!args.length) return (
    '⚠️ Cara pakai:\n*.addfeature [deskripsi fitur]*\n\n' +
    'Contoh:\n*.addfeature tambahkan command .cuaca [kota]*'
  );

  const desc = args.join(' ');
  const file  = path.join(BOT_ROOT, 'index.js');
  const code  = fs.readFileSync(file, 'utf8');

  const prompt = `Kamu adalah programmer Node.js expert untuk WhatsApp bot Baileys.

Kode index.js saat ini:
\`\`\`javascript
${code}
\`\`\`

Tugas: Tambahkan fitur berikut TANPA menghapus fitur yang sudah ada:
"${desc}"

ATURAN WAJIB:
- Return HANYA kode JavaScript lengkap, tidak ada penjelasan
- Gunakan ES module (import/export) seperti kode aslinya
- Tambahkan case baru di dalam switch(command) yang sudah ada
- Jangan ubah struktur, import, atau fungsi yang sudah ada
- Bungkus dalam \`\`\`javascript ... \`\`\``;

  await sock.sendMessage(m.key.remoteJid,
    { text: '🤖 Gemini AI sedang menulis kode baru...\n⏳ Mohon tunggu 10-30 detik' },
    { quoted: m }
  );

  const response = await groqChat(groqKey, 'addfeature', prompt);
  const newCode  = extractCode(response);

  if (!newCode || newCode.length < 500) {
    throw new Error('Kode yang dihasilkan AI tidak valid, coba deskripsi lebih detail');
  }

  const bak = backup(file);
  fs.writeFileSync(file, newCode, 'utf8');

  await sock.sendMessage(m.key.remoteJid, {
    text: `✅ *Fitur berhasil ditambahkan!*\n\n` +
          `📝 ${desc}\n` +
          `💾 Backup: ${path.basename(bak)}\n` +
          `🔄 Bot restart dalam 3 detik...\n\n` +
          `_Jika error, kirim .rollback_`
  }, { quoted: m });

  setTimeout(restartBot, 3000);
  return null;
}

async function cmdRollback(sock, m) {
  const file = path.join(BOT_ROOT, 'index.js');
  const bak  = latestBackup('index.js');
  if (!bak) return '❌ Tidak ada backup tersedia.';

  fs.copyFileSync(bak, file);
  fs.unlinkSync(bak);

  await sock.sendMessage(m.key.remoteJid, {
    text: `♻️ *Rollback berhasil!*\n💾 ${path.basename(bak)}\n🔄 Bot restart dalam 3 detik...`
  }, { quoted: m });

  setTimeout(restartBot, 3000);
  return null;
}

function cmdBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return '📂 Belum ada backup.';
  const list = fs.readdirSync(BACKUP_DIR).sort().reverse().slice(0, 10);
  if (!list.length) return '📂 Belum ada backup.';
  return `📂 *Backup tersedia:*\n\n` + list.map((f, i) => {
    const t = new Date(fs.statSync(path.join(BACKUP_DIR, f)).mtime)
      .toLocaleString('id-ID');
    return `${i + 1}. \`${f}\`\n   📅 ${t}`;
  }).join('\n');
}

// ─── COMMAND LIST ─────────────────────────────────────────────────────────────
// Command khusus AI (tidak perlu prefix di sini, sudah dihandle di handle())
const BOT_CMDS = ['addfeature', 'rollback', 'backups', 'clearchat', 'aistatus'];

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
async function handle(sock, m, geminiKey, groqKey) {
  const body =
    m.message?.conversation ||
    m.message?.extendedTextMessage?.text || '';

  if (!body || body.trim() === '') return false;

  const from   = m.key.remoteJid;
  const isGroup = from.endsWith('@g.us');
  const sender  = isGroup ? m.key.participant : from;
  const userId  = sender || from;

  const sendText = (t) => sock.sendMessage(from, { text: t }, { quoted: m });

  // ── Handle command khusus AI (dengan prefix .) ──
  if (body.startsWith('.')) {
    const parts   = body.slice(1).trim().split(/\s+/);
    const command = parts.shift().toLowerCase();

    if (!BOT_CMDS.includes(command)) return false;

    try {
      switch (command) {
        case 'addfeature': {
          if (!geminiKey) {
            await sendText('❌ Gemini API Key belum diisi di config.cjs\nDapatkan gratis: https://aistudio.google.com/app/apikey');
            return true;
          }
          const r = await cmdAddFeature(sock, m, parts, geminiKey, groqKey);
          if (r) await sendText(r);
          break;
        }
        case 'rollback': {
          const r = await cmdRollback(sock, m);
          if (r) await sendText(r);
          break;
        }
        case 'backups':
          await sendText(cmdBackups());
          break;

        case 'clearchat':
          clearHistory(userId);
          await sendText('🗑️ *Riwayat percakapan dihapus!*\nAI sudah lupa semua chat sebelumnya.');
          break;

        case 'aistatus':
          await sendText(
            `🤖 *Status AI Bot*\n\n` +
            `🟢 Groq (Chat): ${groqKey ? 'Aktif' : '❌ Tidak ada key'}\n` +
            `🟢 Gemini (Kode): ${geminiKey ? 'Aktif' : '❌ Tidak ada key'}\n` +
            `🧠 Model chat: ${GROQ_MODEL}\n` +
            `💬 History kamu: ${getHistory(userId).length} pesan`
          );
          break;
      }
    } catch (err) {
      await sendText(`❌ *Error:* ${err.message}`);
    }
    return true;
  }

  // ── Chat biasa → Groq AI ──
  // Abaikan pesan grup kecuali mention bot atau reply ke bot
  if (isGroup) {
    const isReply = m.message?.extendedTextMessage?.contextInfo?.participant;
    const isMention = body.includes('@') || body.toLowerCase().includes('bot');
    if (!isReply && !isMention) return false;
  }

  // Abaikan pesan yang diawali prefix . (sudah dihandle switch command di index.js)
  if (body.startsWith('.')) return false;

  // Abaikan pesan sangat pendek (emoji, "ok", "oke", dll)
  if (body.trim().length < 3) return false;

  if (!groqKey) return false;

  try {
    // Cek jailbreak
    if (isJailbreak(body)) {
      await sendText('⚠️ Pesan tidak dapat diproses.');
      return true;
    }

    await sock.sendPresenceUpdate('composing', from);
    const reply = await groqChat(groqKey, userId, body);
    await sendText(reply);
  } catch (err) {
    await sendText(`❌ AI Error: ${err.message}`);
  }

  return true;
}

module.exports = { handle };
