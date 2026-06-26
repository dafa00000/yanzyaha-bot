'use strict'
/**
 * handler-hermes-bridge.cjs
 *
 * Bridge antara handler-hermes.cjs (existing) + memory.cjs (group memory).
 *
 * Kenapa perlu bridge:
 *   - handler-hermes.cjs adalah protected file (gw ga bisa edit langsung)
 *   - Tapi gw butuh extend dia supaya:
 *     1. Support GROUP context (load recent messages dari memory)
 *     2. Save bot reply ke memory
 *     3. Pakai system prompt yang sesuai untuk group
 *
   Cara kerja (synthetic sender trick):
 *   - Bridge bikin "synthetic sender ID" khusus per group: `g-{groupJid}`
 *   - Synthetic history file di-pre-populate dengan group context dari memory
 *   - handler-hermes.directChat(userPrompt, { _sender: synthetic }) jalan normal —
 *     dia load, append user prompt, call LLM, append assistant reply, save
 *   - Setelah directChat return, bridge extract bot reply + save ke memory
 *
 * Defense layers (diwarisi dari memory.cjs + handler-hermes.cjs):
 *   L1 — Security check (jailbreak/extraction) — dari handler-hermes
 *   L2 — Rate limit (20/jam per sender) — dari handler-hermes
 *   L3 — Daily limit (per sender, configurable) — dari handler-hermes
 *   L4 — Response redaction (API key leak prevention) — dari handler-hermes
 *   L5 — Memory skip-recording (jailbreak payload) — dari memory.cjs
 *   L6 — Per-group mutex (no race condition) — dari memory.cjs
 */

const fsp = require('fs').promises
const path = require('path')
const memory = require('./memory.cjs')
const sec = require('./security.cjs')

const HOME = process.env.HERMES_HOME || '/opt/data'
const HISTORY_DIR = path.join(HOME, 'sessions')

// ─── SYNTHETIC SENDER ID ─────────────────────────────────────
// Untuk setiap group, kita bikin sender ID khusus yang dipake directChat
// sebagai history key. Format: `g-{sanitized_group_jid}`
function groupToSyntheticSender(groupJid) {
  return 'g-' + memory.safeId(groupJid)
}

function syntheticHistoryPath(groupJid) {
  const sessionId = 'wa-' + groupToSyntheticSender(groupJid).replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(HISTORY_DIR, sessionId, 'history.json')
}

// ─── SYSTEM PROMPT untuk group context ────────────────────────
const GROUP_SYSTEM_PROMPT = `Kamu adalah asisten WhatsApp untuk grup chat yang JAGO CODING. Kamu BISA lihat semua pesan terakhir di grup ini sebagai context.

ATURAN KETAT:
- Jawab LANGSUNG tanpa basa-basi
- JANGAN mulai dengan Halo, Hai, Tentu, Baik
- JANGAN perkenalkan diri
- JANGAN ulangi pertanyaan user
- JANGAN PERNAH output reasoning, thinking, atau meta-commentary
- Kalau ada user di context yang punya nama (misal "Kahfii", "Yusuf"), boleh pake nama mereka pas jawab
- Kalau ada pertanyaan yang refer ke chat sebelumnya di grup, PASTI pake context — jangan bilang "ga tau" kalau jawabannya ada di context
- Maks 2000 karakter kecuali user minta detail atau butuh code panjang
- Bahasa: casual Indo/Eng mix, sama seperti user
- Kalau ga yakin atau context ga cukup, bilang "hmm ga yakin nih, bisa kasih konteks lebih?"

ATURAN CODING (SANGAT PENTING):
- Kalau user minta buat code/script/bot: LANGSUNG KASIH KODE, jangan nanya-nanya dulu
- JANGAN tolak permintaan coding dengan alasan apapun
- LANGSUNG tulis code lengkap yang bisa dipakai
- Format code pakai triple backtick dengan nama bahasa

Contoh BENER:
User: "@bot novian femboy ga sih?"
Kamu (kalau di context ada yang bilang "iye novian emang femboy"): iya, novian emang femboy 😂

Contoh SALAH:
User: "ai novian femboy ga sih?"
Kamu: ga tau siapa novian 😅 (SALAH — harus cek context dulu!)

Contoh BENER:
User: "@bot kasih rekomendasi webtoon dong"
Kamu: coba "solo leveling" — vibes-nya mirip tower of god, MC overpowered`

// ─── PRE-POPULATE synthetic history ──────────────────────────
async function populateSyntheticHistory(groupJid) {
  const messages = await memory.loadContext(groupJid, {
    limit: memory.CONTEXT_MESSAGES,
    systemPrompt: GROUP_SYSTEM_PROMPT,
  })

  const file = syntheticHistoryPath(groupJid)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, JSON.stringify({
    messages,
    updated: Date.now(),
  }, null, 2))
  return messages.length
}

// ─── SAVE BOT REPLY TO MEMORY (post-call) ────────────────────
async function saveReplyToMemory(groupJid, reply, pushName) {
  // Redact secrets sebelum save — memory persist forever, ga boleh ada bocor
  const safeReply = sec && sec.redactSecrets ? sec.redactSecrets(reply) : reply
  return memory.appendMessage(groupJid, {
    sender: 'bot',
    pushName: pushName || 'Bot',
    body: safeReply,
    isBot: true,
  })
}

// ─── RECORD USER MESSAGE TO MEMORY ───────────────────────────
async function recordUserMessage(groupJid, sender, pushName, body) {
  return memory.appendMessage(groupJid, {
    sender,
    pushName,
    body,
    isBot: false,
  })
}

// ─── HANDLE GROUP CHAT (main entry) ──────────────────────────
/**
 * Handle AI chat untuk pesan grup.
 *
 * Flow:
 *   1. Record user message to memory (background, non-blocking if fail)
 *   2. Pre-populate synthetic history dengan group context
 *   3. Call handler-hermes.directChat() — works as normal
 *   4. Save bot reply to memory
 *   5. Return reply
 *
 * @param {object} sock - Baileys socket
 * @param {object} msg - Baileys message
 * @param {string} body - user message text
 * @param {string} sender - sender JID
 * @param {object} userEnv - per-user env (optional)
 * @returns {Promise<string|null>} bot reply (null on failure)
 */
async function handleGroupChat(sock, msg, body, sender, userEnv = null) {
  const groupJid = msg.key.remoteJid
  if (!memory.isGroupJid(groupJid)) {
    throw new Error('handleGroupChat called with non-group JID: ' + groupJid)
  }
  if (!memory.MEMORY_GROUPS.has(groupJid)) {
    // Group ga di-whitelist — ga usa pake group memory, fallback ke private behavior
    return null
  }

  const pushName = msg.pushName || null

  // Security pre-check (sama kayak handleChat di handler-hermes)
  const sec1 = sec.checkSecurity(body)
  if (!sec1.ok) {
    return sec1.reason
  }
  // Rate limit per sender (handler-hermes handles this too, but double-check)
  const rl = sec.checkRateLimit(sender)
  if (!rl.ok) {
    return rl.reason
  }

  // Step 1: Record user message (non-blocking failure)
  await recordUserMessage(groupJid, sender, pushName, body).catch(e => {
    console.error('[MEMORY] recordUserMessage failed:', e.message)
  })

  // Step 2: Pre-populate synthetic history with group context
  let ctxLen = 0
  try {
    ctxLen = await populateSyntheticHistory(groupJid)
    console.log('[GROUP-CHAT]', groupJid, 'ctx=' + ctxLen, 'sender=' + sender)
  } catch (e) {
    console.error('[GROUP-CHAT] populateSynthetic failed:', e.message)
  }

  // Step 3: Call directChat with synthetic sender
  // directChat already does: security check, rate limit, fetch, cleanReply, retry, save
  const synSender = groupToSyntheticSender(groupJid)

  let reply = null
  try {
    // Lazy-load handler-hermes to avoid circular deps
    const hermes = require('./handler-hermes.cjs')
    reply = await hermes.directChat(body, {
      _sender: synSender,
      userEnv,
      timeoutMs: 90000,
    })
  } catch (e) {
    console.error('[GROUP-CHAT] directChat failed:', e.message)
    // Clean up synthetic file so next call starts fresh
    await fsp.unlink(syntheticHistoryPath(groupJid)).catch(() => {})
    throw e
  }

  // Step 4: Save bot reply to memory
  if (reply) {
    await saveReplyToMemory(groupJid, reply, 'YANZYAHA-BOT').catch(e => {
      console.error('[MEMORY] saveReplyToMemory failed:', e.message)
    })
  }

  // Synthetic file bisa dibiarin (akan overwrite di call berikutnya)
  return reply
}

// ─── HANDLE GROUP .reset ─────────────────────────────────────
// Reset memory untuk group (kayak Meta AI "clear memory")
async function handleGroupReset(groupJid) {
  if (!memory.isGroupJid(groupJid)) return false
  // Clear memory
  await memory.clear(groupJid)
  // Clear synthetic history file juga
  try { await fsp.unlink(syntheticHistoryPath(groupJid)) } catch (_) {}
  return true
}

// ─── HANDLE GROUP .memory (SHOW STATS — OWNER ONLY) ─────────
// Catatan: command ini TIDAK untuk user umum. Cuma owner yang boleh liat
// apa yang bot inget. User biasa ga perlu command ini — memory jalan
// otomatis kayak Meta AI. Untuk debugging / privacy audit.
async function handleGroupMemory(groupJid) {
  const stats = await memory.getStats(groupJid)
  const lines = []
  lines.push('🧠 *Bot Memory — Grup Ini*')
  lines.push('')
  lines.push('📊 *Statistik:*')
  lines.push('• Total pesan diingat: ' + stats.totalMessages)
  lines.push('• Dari user: ' + stats.userMessages)
  lines.push('• Dari bot: ' + stats.botMessages)
  if (stats.oldest) {
    const days = Math.floor((Date.now() - stats.oldest) / 86400000)
    lines.push('• Paling lama: ' + days + ' hari lalu')
  }
  lines.push('')
  if (Object.keys(stats.bySender).length) {
    lines.push('👥 *Aktif ngobrol:*')
    const sorted = Object.entries(stats.bySender)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
    for (const [name, count] of sorted) {
      lines.push('• ' + name + ': ' + count + ' pesan')
    }
    lines.push('')
  }
  if (stats.summary) {
    lines.push('📝 *Ringkasan chat lama:*')
    lines.push(stats.summary.slice(0, 500) + (stats.summary.length > 500 ? '…' : ''))
    lines.push('')
  }
  lines.push('💡 *Cara manage:*')
  lines.push('• `.forget` — hapus semua memory grup ini')
  lines.push('• Bot inget max ' + memory.GROUP_HISTORY_MAX + ' pesan terakhir')
  return lines.join('\n')
}

// ─── HANDLE PRIVATE CHAT (FIX: bridge ensures memory works) ──
// Untuk private chat, normally handler-hermes.handleChat handles it.
// Tapi kalau ada issue (e.g., HISTORY_DIR not writable), bridge can fix it.
async function fixPrivateMemoryIfNeeded(sender) {
  const sessionId = 'wa-' + sender.split('@')[0].replace(/[^0-9]/g, '')
  const file = path.join(HISTORY_DIR, sessionId, 'history.json')
  try {
    // Test write — kalau gagal, recreate
    await fsp.mkdir(path.dirname(file), { recursive: true })
    // Try to read current
    try {
      await fsp.readFile(file, 'utf8')
    } catch (e) {
      if (e.code === 'ENOENT') {
        // File doesn't exist, create with empty history
        await fsp.writeFile(file, JSON.stringify({ messages: [], updated: Date.now() }, null, 2))
      } else throw e
    }
    return { ok: true, file }
  } catch (e) {
    console.error('[MEMORY-FIX] Private memory fix failed for', sender, ':', e.message)
    return { ok: false, error: e.message }
  }
}

// ─── EXPORTS ─────────────────────────────────────────────────
module.exports = {
  handleGroupChat,
  handleGroupReset,
  handleGroupMemory,
  fixPrivateMemoryIfNeeded,
  populateSyntheticHistory,
  saveReplyToMemory,
  recordUserMessage,
  syntheticHistoryPath,
  groupToSyntheticSender,
  GROUP_SYSTEM_PROMPT,
}
