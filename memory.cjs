'use strict'
/**
 * memory.cjs — Memory layer untuk YANZYAHA-BOT
 *
 * Fitur utama:
 *  - Per-GROUP conversation memory (semua pesan di grup, shared context)
 *  - Per-sender private memory (delegasi ke handler-hermes, fallback di sini)
 *  - Sender name resolution (Kahfii → 628xxx@s.whatsapp.net)
 *  - Security guard (skip jailbreak / extraction / oversized messages)
 *  - Sliding window retention
 *  - Atomic writes (write tmp + rename) — no corruption on crash
 *  - Daily summary auto-generated for old messages (context compression)
 *
 * Storage layout (di $HERMES_HOME/sessions/):
 *   wa-{senderNumeric}/history.json       (private chat per-user)
 *   wa-groups/{groupJid}/history.json     (group conversation log)
 *   wa-groups/{groupJid}/participants.json (JID → display name cache)
 *   wa-groups/{groupJid}/summary.txt      (rolling summary of older messages)
 *
 * Defense layers (kokoh standard):
 *   L1 — Path traversal prevention (sanitize JID → safe filename)
 *   L2 — Atomic write (tmp + rename, fsync sebelum rename)
 *   L3 — Sliding window cap (max messages per JID)
 *   L4 — Length cap per message (max 4000 char, truncate)
 *   L5 — Security pre-filter (jailbreak/extraction → skip recording)
 *   L6 — Crash-safe reads (catch + return empty on corruption)
 *   L7 — Concurrency lock (in-process mutex per JID)
 */

const fsp = require('fs').promises
const fs = require('fs')
const path = require('path')

// ─── CONFIG ───────────────────────────────────────────────────
const HOME = process.env.HERMES_HOME || '/opt/data'
const SESSIONS_DIR = path.join(HOME, 'sessions')

// Groups yang di-enable memory-nya. Whitelist = safer.
// Tambah group lain di sini kalo mau.
const MEMORY_GROUPS = new Set([
  '120363405661184579@g.us',  // Grup Mata Kuliah Kahfii
])

// Retensi
const GROUP_HISTORY_MAX = 200      // max messages stored per group
const PRIVATE_HISTORY_MAX = 50     // max messages per private sender (delegasi ke handler-hermes tapi cap yang sama)
const CONTEXT_MESSAGES = 30        // berapa messages dikirim sebagai LLM context
const MESSAGE_MAX_LEN = 4000       // truncate per message
const SUMMARY_THRESHOLD = 100      // kalau history > threshold, summarize yang lama

// ─── PATH SAFETY (L1) ─────────────────────────────────────────
// Cegah path traversal: JID disanitasi jadi filename aman
// - Strip semua karakter non-aman
// - Tolak jika hasilnya kosong, atau dimulai dengan . (hidden file) atau / (path sep)
function safeId(jid) {
  if (!jid || typeof jid !== 'string') return '_invalid_'
  let s = jid.replace(/[^a-zA-Z0-9_@.\-]/g, '_').slice(0, 128)
  if (!s) return '_invalid_'
  // Prevent hidden files (Unix) and path traversal attempts
  if (s[0] === '.' || s[0] === '/' || s[0] === '-') return '_invalid_'
  return s
}

function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us')
}

// ─── IN-PROCESS MUTEX (L7) ───────────────────────────────────
// Cegah race condition saat concurrent write ke file yang sama
const locks = new Map()
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve()
  let release
  const next = new Promise(r => { release = r })
  locks.set(key, prev.then(() => next))
  try {
    await prev
    return await fn()
  } finally {
    release()
    if (locks.get(key) === next) locks.delete(key)
  }
}

// ─── ATOMIC WRITE (L2) ───────────────────────────────────────
async function atomicWrite(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now()
  const fh = await fsp.open(tmp, 'w')
  try {
    await fh.writeFile(typeof data === 'string' ? data : JSON.stringify(data, null, 2))
    await fh.sync()  // fsync — pastikan data committed ke disk
  } finally {
    await fh.close()
  }
  await fsp.rename(tmp, filePath)
}

// ─── SAFE READ (L6) ──────────────────────────────────────────
async function safeReadJson(filePath, fallback = null) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (e) {
    if (e.code === 'ENOENT') return fallback
    // Corrupt file → backup + return fallback (L6)
    try { await fsp.rename(filePath, filePath + '.corrupt.' + Date.now()) } catch (_) {}
    return fallback
  }
}

// ─── SECURITY GUARD (L5) ─────────────────────────────────────
// Inline regex sederhana (full security check ada di security.cjs, tapi
// untuk skip-recording cukup yang penting aja biar ga log payload attack)
const JAILBREAK_SKIP = /\b(ignore previous|forget instructions|system prompt|reveal your prompt|<\|im_start\|>|DAN mode|developer mode)\b/i
const SECRET_SKIP = /\b(sk-[a-zA-Z0-9]{20,}|sk-proj-[a-zA-Z0-9]{20,}|AIza[a-zA-Z0-9]{30,}|ghp_[a-zA-Z0-9]{30,}|gho_[a-zA-Z0-9]{30,}|AKIA[A-Z0-9]{16,})\b/

function shouldSkipRecording(body) {
  if (!body || typeof body !== 'string') return true
  const trimmed = body.trim()
  if (!trimmed) return true
  if (trimmed.length > MESSAGE_MAX_LEN) return true  // oversized
  if (JAILBREAK_SKIP.test(trimmed)) return true  // attack payload
  if (SECRET_SKIP.test(trimmed)) return true  // secret leak
  return false
}

// Truncate pesan panjang
function truncBody(body) {
  if (!body) return ''
  return body.length > MESSAGE_MAX_LEN ? body.slice(0, MESSAGE_MAX_LEN) + '…' : body
}

// ─── SENDER NAME RESOLUTION ──────────────────────────────────
// Resolve display name dari Baileys pushName + cache
async function loadParticipants(groupJid) {
  const file = path.join(SESSIONS_DIR, 'wa-groups', safeId(groupJid), 'participants.json')
  return await safeReadJson(file, {})
}

async function saveParticipants(groupJid, map) {
  const file = path.join(SESSIONS_DIR, 'wa-groups', safeId(groupJid), 'participants.json')
  await atomicWrite(file, map)
}

async function rememberParticipant(groupJid, sender, pushName) {
  if (!groupJid || !sender) return
  const map = await loadParticipants(groupJid)
  const id = safeId(sender)
  const cur = map[id]
  // Update only if we have a NEW name (or first time)
  if (pushName && (!cur || !cur.name || cur.name !== pushName)) {
    map[id] = { name: pushName, updated: Date.now() }
    await saveParticipants(groupJid, map)
  }
}

async function resolveName(groupJid, sender) {
  if (!groupJid || !sender) return null
  const map = await loadParticipants(groupJid)
  return map[safeId(sender)]?.name || null
}

// ─── HISTORY I/O (per-group + per-private) ───────────────────
function historyPath(jid) {
  if (isGroupJid(jid)) {
    return path.join(SESSIONS_DIR, 'wa-groups', safeId(jid), 'history.json')
  }
  return path.join(SESSIONS_DIR, 'wa-' + safeId(jid), 'history.json')
}

const MAX_FOR_TYPE = (jid) => isGroupJid(jid) ? GROUP_HISTORY_MAX : PRIVATE_HISTORY_MAX

async function loadRawHistory(jid) {
  return await safeReadJson(historyPath(jid), { messages: [], updated: 0 })
}

async function loadMessages(jid) {
  const data = await loadRawHistory(jid)
  return Array.isArray(data.messages) ? data.messages : []
}

async function saveMessages(jid, messages) {
  const capped = messages.slice(-MAX_FOR_TYPE(jid))
  await atomicWrite(historyPath(jid), { messages: capped, updated: Date.now() })
}

// ─── APPEND MESSAGE (entry point utama) ──────────────────────
/**
 * Append satu message ke history.
 * Otomatis route: group → group history, private → private history.
 *
 * @param {string} jid - remoteJid (group atau private)
 * @param {object} msgInfo - { sender, pushName, body, isBot, ts?, mentions? }
 * @returns {boolean} true kalau berhasil di-record
 */
async function appendMessage(jid, msgInfo) {
  if (!jid || !msgInfo) return false
  if (!MEMORY_GROUPS.has(jid) && !isGroupJid(jid)) {
    // Private: record juga (delegasi ke handler-hermes biasanya, tapi support di sini)
  }
  // Skip group yang ga di-whitelist
  if (isGroupJid(jid) && !MEMORY_GROUPS.has(jid)) return false

  const { sender, pushName, body, isBot = false, mentions = [] } = msgInfo
  const safeBody = truncBody((body || '').toString())

  // L5: skip attack/secret/oversized
  if (!isBot && shouldSkipRecording(safeBody)) return false

  // Update participant cache untuk group
  if (isGroupJid(jid) && sender && pushName) {
    await rememberParticipant(jid, sender, pushName).catch(() => {})
  }

  const entry = {
    ts: msgInfo.ts || Date.now(),
    sender: safeId(sender || (isBot ? 'bot' : 'unknown')),
    senderName: pushName || (isBot ? 'Bot' : null),
    body: safeBody,
    isBot: !!isBot,
    mentions: Array.isArray(mentions) ? mentions.slice(0, 10) : [],
  }

  return withLock('hist:' + safeId(jid), async () => {
    const msgs = await loadMessages(jid)
    msgs.push(entry)
    await saveMessages(jid, msgs)
    // Trigger summary kalau lewat threshold
    if (isGroupJid(jid) && msgs.length > SUMMARY_THRESHOLD) {
      await maybeSummarize(jid, msgs).catch(() => {})
    }
    return true
  })
}

// ─── LOAD CONTEXT FOR LLM ───────────────────────────────────
/**
 * Load recent N messages dari history sebagai LLM context array.
 * Format: [{ role: 'user'|'assistant', name?, content }]
 *
 * @param {string} jid
 * @param {object} opts - { limit?: number, systemPrompt?: string }
 * @returns {Promise<Array>}
 */
async function loadContext(jid, opts = {}) {
  const limit = opts.limit || CONTEXT_MESSAGES
  const sysPrompt = opts.systemPrompt || null
  const msgs = await loadMessages(jid)

  // Ambil N message terakhir, format sebagai LLM messages
  const recent = msgs.slice(-limit)
  const ctx = []
  let lastUserKey = null  // batch consecutive messages from same user

  for (const m of recent) {
    if (m.isBot) {
      // Reset batching
      lastUserKey = null
      ctx.push({
        role: 'assistant',
        content: m.body,
      })
    } else {
      const tag = m.senderName ? `${m.senderName} (@${m.sender.replace(/[^0-9]/g, '').slice(-6)})` : `@${m.sender.replace(/[^0-9]/g, '').slice(-6)}`
      const time = new Date(m.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      const line = `[${tag} jam ${time}]: ${m.body}`
      // Batch kalau pengirim sama dengan sebelumnya
      const key = m.sender + ':' + Math.floor((m.ts || 0) / 60000)
      if (key === lastUserKey && ctx.length && ctx[ctx.length - 1].role === 'user') {
        ctx[ctx.length - 1].content += '\n' + line
      } else {
        ctx.push({
          role: 'user',
          content: line,
        })
        lastUserKey = key
      }
    }
  }

  // Add summary as system context kalau ada
  let summary = null
  if (isGroupJid(jid)) {
    summary = await loadSummary(jid).catch(() => null)
  }

  const out = []
  if (sysPrompt) {
    let sp = sysPrompt
    if (summary) sp += '\n\n## Ringkasan chat sebelumnya:\n' + summary
    out.push({ role: 'system', content: sp })
  } else if (summary) {
    out.push({ role: 'system', content: 'Ringkasan chat sebelumnya di grup ini:\n' + summary })
  }
  out.push(...ctx)
  return out
}

// ─── SUMMARY (rolling compression untuk old messages) ────────
async function loadSummary(groupJid) {
  const file = path.join(SESSIONS_DIR, 'wa-groups', safeId(groupJid), 'summary.txt')
  try {
    return (await fsp.readFile(file, 'utf8')).trim() || null
  } catch { return null }
}

async function saveSummary(groupJid, text) {
  const file = path.join(SESSIONS_DIR, 'wa-groups', safeId(groupJid), 'summary.txt')
  await atomicWrite(file, text.slice(0, 4000))  // cap summary
}

async function maybeSummarize(groupJid, msgs) {
  // Compress messages older than last CONTEXT_MESSAGES jadi summary
  // Implementation: keep last 30 as-is, summarize the rest sebagai key points
  const oldMsgs = msgs.slice(0, -CONTEXT_MESSAGES)
  if (oldMsgs.length < 50) return  // belum worth summarizing

  // Extract key info: who said what (top 5 unique participants + their recent msgs)
  const bySender = new Map()
  for (const m of oldMsgs) {
    if (m.isBot) continue
    const key = m.senderName || m.sender
    if (!bySender.has(key)) bySender.set(key, [])
    if (bySender.get(key).length < 3) bySender.get(key).push(m.body.slice(0, 100))
  }

  const parts = []
  for (const [name, quotes] of bySender) {
    parts.push(`- ${name}: ${quotes.join(' | ').slice(0, 200)}`)
  }
  const summary = `[Auto-summary dari ${oldMsgs.length} pesan lama]\n${parts.join('\n').slice(0, 3500)}`
  await saveSummary(groupJid, summary)
}

// ─── CLEAR MEMORY (.forget) ──────────────────────────────────
async function clear(jid) {
  return withLock('hist:' + safeId(jid), async () => {
    try {
      await fsp.unlink(historyPath(jid))
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    // Clear summary juga untuk group
    if (isGroupJid(jid)) {
      try { await fsp.unlink(path.join(SESSIONS_DIR, 'wa-groups', safeId(jid), 'summary.txt')) } catch (_) {}
    }
    return true
  })
}

// ─── STATS (untuk .memory command) ───────────────────────────
async function getStats(jid) {
  const msgs = await loadMessages(jid)
  const participants = isGroupJid(jid) ? await loadParticipants(jid) : {}
  const summary = isGroupJid(jid) ? await loadSummary(jid) : null

  // Hitung per-sender breakdown
  const bySender = {}
  let botCount = 0
  for (const m of msgs) {
    if (m.isBot) { botCount++; continue }
    const key = m.senderName || m.sender
    bySender[key] = (bySender[key] || 0) + 1
  }

  return {
    jid,
    isGroup: isGroupJid(jid),
    totalMessages: msgs.length,
    botMessages: botCount,
    userMessages: msgs.length - botCount,
    participants,
    summary,
    bySender,
    oldest: msgs[0]?.ts || null,
    newest: msgs[msgs.length - 1]?.ts || null,
  }
}

// ─── LIST RECORDED GROUPS ────────────────────────────────────
async function listRecordedGroups() {
  try {
    const dir = path.join(SESSIONS_DIR, 'wa-groups')
    const entries = await fsp.readdir(dir).catch(() => [])
    return entries
  } catch { return [] }
}

// ─── SEARCH (basic keyword match) ────────────────────────────
async function search(jid, query, limit = 10) {
  if (!query) return []
  const msgs = await loadMessages(jid)
  const q = query.toLowerCase()
  return msgs
    .filter(m => (m.body || '').toLowerCase().includes(q))
    .slice(-limit)
    .reverse()  // newest first
}

// ─── EXPORTS ─────────────────────────────────────────────────
module.exports = {
  // Config
  MEMORY_GROUPS,
  CONTEXT_MESSAGES,
  GROUP_HISTORY_MAX,
  PRIVATE_HISTORY_MAX,

  // Core
  appendMessage,
  loadContext,
  loadMessages,
  saveMessages,
  clear,
  getStats,
  search,
  listRecordedGroups,

  // Helpers
  isGroupJid,
  safeId,
  resolveName,
  rememberParticipant,
  loadParticipants,

  // Internal (untuk testing)
  _internal: {
    safeReadJson,
    atomicWrite,
    withLock,
    shouldSkipRecording,
    truncBody,
    historyPath,
    SESSIONS_DIR,
  },
}
