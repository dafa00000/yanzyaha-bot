// handler-autodl.js
// Auto-detect URL di pesan TANPA prefix.
// User tinggal kirim link → bot auto download.
// Differentiator:
//   - Plain URL              → full download (YT/TT/X/Pinterest/Instagram)
//   - "clip <url> <start> <end>" → manual clip (reuse handler-download clip)
//   - "auto <url>"           → AI-powered autoclip (handler-autoclip)
//   - "MM:SS <url>"          → clip 60 detik mulai dari MM:SS
//
// Catatan:
//   • Prefix commands (`.ytdl`, `.ttdl`, `.igdl`, dll) tetap jalan — autodl cuma nambah.
//   • Di private chat: trigger kalau ada URL di body.
//   • Di group: trigger cuma kalau message starts-with URL / keyword (biar gak nabrak chat normal).

import { handleDownload } from './handler-download.js'
import { handleAutoClip } from './handler-autoclip.js'

// ─── URL PATTERNS ──────────────────────────────────────────────────────────
const RE = {
  youtube:   /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{11}/i,
  tiktok:    /https?:\/\/(?:www\.|vm\.)?tiktok\.com\/[\w@/?=&-]+/i,
  twitter:   /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[\w]+\/status\/\d+/i,
  pinterest: /https?:\/\/(?:www\.|pin\.)?(?:pinterest\.com\/[\w/?=&-]+|pinterest\.com\/pin\/[\w/?=&-]+|pin\.it\/[\w]+)/i,
  // Instagram: reels, posts (with video), tv — shortcodes are alphanumeric 8-15 chars
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[\w-]+\/?/i,
  anyUrl:    /https?:\/\/\S+/i,

  // Timestamp prefix: "0:42 <url>" or "1:23:45 <url>"
  timestamp: /^(\d{1,2}(?::\d{1,2}){1,2})\s+(https?:\/\/\S+)/,

  // Clip keyword: "clip <url> [start] [end]"
  clipKw:    /^(?:clip|potong)\s+(https?:\/\/\S+)(?:\s+(\S+))?(?:\s+(\S+))?$/i,

  // Auto/AI clip keyword: "auto <url>" / "autoclip <url>"
  autoKw:    /^(?:auto|autoclip|ai)\s+(https?:\/\/\S+)/i,
}

// Cooldown per sender (avoid spam)
const COOLDOWN_MS = 8000
const cooldownMap = new Map()

// ─── DETECT ────────────────────────────────────────────────────────────────

/**
 * Detect a no-prefix download action from message body.
 * @param {string} body  - message text
 * @param {boolean} isGroup - true if message is from group
 * @returns {object|null} - { type, url, ...params } or null
 */
export function detectAction(body, isGroup = false) {
  if (!body || typeof body !== 'string') return null
  const text = body.trim()
  if (!text) return null

  // 1) AI autoclip keyword — YT only
  const autoMatch = text.match(RE.autoKw)
  if (autoMatch) {
    const url = cleanUrl(autoMatch[1])
    if (RE.youtube.test(url)) return { type: 'autoclip', url }
    return null
  }

  // 2) Manual clip with keyword + optional start/end
  const clipMatch = text.match(RE.clipKw)
  if (clipMatch) {
    const url   = cleanUrl(clipMatch[1])
    const start = clipMatch[2] || null
    const end   = clipMatch[3] || null
    if (RE.youtube.test(url)) return { type: 'manualClip', url, start, end }
    return null
  }

  // 3) Timestamp prefix — YT only, default 60s clip from start
  const tsMatch = text.match(RE.timestamp)
  if (tsMatch) {
    const startSec = parseTimestamp(tsMatch[1])
    const url      = cleanUrl(tsMatch[2])
    if (RE.youtube.test(url)) return { type: 'tsClip', url, startSec, duration: 60 }
    return null
  }

  // 4) Plain URL — full download
  const urlMatch = text.match(RE.anyUrl)
  if (!urlMatch) return null
  const url = cleanUrl(urlMatch[0])

  // Detect platform
  let platform = null
  if (RE.youtube.test(url)) platform = 'youtube'
  else if (RE.tiktok.test(url)) platform = 'tiktok'
  else if (RE.twitter.test(url)) platform = 'twitter'
  else if (RE.pinterest.test(url)) platform = 'pinterest'
  else if (RE.instagram.test(url)) platform = 'instagram'
  if (!platform) return null

  // Di group: cuma respond kalau message "essentially" cuma URL (atau starts-with URL)
  // Biar gak nabrak chat normal yang nyebut URL di tengah kalimat.
  if (isGroup) {
    const stripped = text.replace(/https?:\/\/\S+/gi, '').replace(/[\s.,!?]+/g, '')
    if (stripped.length > 0) return null
  }

  return { type: 'download', url, platform }
}

// ─── DISPATCH ──────────────────────────────────────────────────────────────

const CMD_MAP = {
  youtube:   'ytdl',
  tiktok:    'ttdl',
  twitter:   'twdl',
  pinterest: 'pindl',
  instagram: 'igdl',
}

/**
 * Dispatch a detected action to the appropriate handler.
 */
export async function dispatchAction(sock, msg, action) {
  const from = msg.key.remoteJid
  const sendText = async (t) => await sock.sendMessage(from, { text: t }, { quoted: msg })

  try {
    switch (action.type) {
      case 'download': {
        const cmd = CMD_MAP[action.platform]
        if (!cmd) return await sendText('❌ Platform belum disupport.')
        return await handleDownload(sock, msg, action.url, cmd)
      }

      case 'autoclip': {
        // AI-powered clip — uses transcript + Gemini
        return await handleAutoClip(sock, msg, action.url)
      }

      case 'manualClip': {
        // "clip <url> [start] [end]"
        if (!action.start || !action.end) {
          return await sendText(
            '⚠️ *Format clip:*\n' +
            '`clip <url> <mulai> <akhir>`\n\n' +
            'Contoh: `clip https://youtu.be/xxx 01:30 02:45`'
          )
        }
        // Reuse handler-download's clip command (text = "url start end")
        return await handleDownload(sock, msg, `${action.url} ${action.start} ${action.end}`, 'clip')
      }

      case 'tsClip': {
        // "MM:SS <url>" → 60s clip from startSec
        const startStr = formatSec(action.startSec)
        const endStr   = formatSec(action.startSec + action.duration)
        return await handleDownload(sock, msg, `${action.url} ${startStr} ${endStr}`, 'clip')
      }
    }
  } catch (err) {
    console.error('[AUTODL ERROR]', err)
    await sendText(`❌ Gagal: ${err.message}`)
  }
}

// ─── TOP-LEVEL ENTRY ───────────────────────────────────────────────────────

/**
 * Called from index.js. Returns true kalau message ke-handle (URL detected).
 * Returns false kalau bukan URL action → caller fallback ke AI chat / prefix command.
 */
export async function handleAutoDownload(sock, msg, body, isGroup) {
  const sender = msg.key.participant || msg.key.remoteJid
  const action = detectAction(body, isGroup)
  if (!action) return false

  // Cooldown (skip for owner? — implement if needed)
  const lastTs = cooldownMap.get(sender) || 0
  const now = Date.now()
  if (now - lastTs < COOLDOWN_MS) {
    return true // silently swallow during cooldown
  }
  cooldownMap.set(sender, now)

  await dispatchAction(sock, msg, action)
  return true
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

function parseTimestamp(ts) {
  const parts = ts.split(':').map(Number)
  if (parts.some(isNaN)) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

function formatSec(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

function cleanUrl(url) {
  // Strip trailing punctuation that might get caught in the URL match
  // (but preserve URL-encoded chars & query params)
  return url.replace(/[.,!?;)\]}>'"`]+$/, '')
}

// Export utilities for testing
export const _test = { RE, parseTimestamp, formatSec, cleanUrl, detectAction }
