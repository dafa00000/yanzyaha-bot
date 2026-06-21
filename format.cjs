'use strict'
/**
 * format.cjs — utility untuk render output WA biar RAPI & KONSISTEN
 *
 * Masalah yang dipecahkan:
 *   - Padding manual di box (╭─│╰) sering salah, susah diliat alignment-nya
 *   - Emoji ada yang 1 char (⚡, ⌬) dan 2 char (📌, 🤖) di JS .length
 *   - Tiap handler punya gaya footer beda-beda
 *
 * Style guide:
 *   - TOTAL box width = 30 char (fixed)
 *   - Border: '╭─' + content + '─' + '╮' (header), '╰' + '─' + '╯' (footer)
 *   - Row: '│ ' + emoji_slot(2) + ' ' + label(10) + ' : ' + value(N) + ' │'
 *   - Bahasa Indonesia untuk deskripsi
 *   - Footer format: '\n\n_Pesan_'
 *
 * Konvensi emoji slot:
 *   - Emoji 2-char JS (📌 🤖 ⚙️ 👤 🟢 📦 ⌨️ 👥): tetap 2 char
 *   - Emoji 1-char JS (⚡ ⌬): di-pad jadi 2 char dengan spasi
 */

const TOTAL_WIDTH = 36
const EMOJI_SLOT = 2
const LABEL_WIDTH = 10
const VALUE_WIDTH = TOTAL_WIDTH - 4 - EMOJI_SLOT - 1 - LABEL_WIDTH - 3
// Breakdown: '│ ' (2) + emoji (2) + ' ' (1) + label (10) + ' : ' (3) + value (N) + ' │' (2)
// TOTAL = 20 + N → N = TOTAL - 20 = 16

// ─── Alignment helpers ───────────────────────────────────────
function padR(s, n) {
  s = String(s == null ? '' : s)
  if (s.length >= n) return s.slice(0, n)
  return s + ' '.repeat(n - s.length)
}

function padL(s, n) {
  s = String(s == null ? '' : s)
  if (s.length >= n) return s.slice(0, n)
  return ' '.repeat(n - s.length) + s
}

// Normalize emoji to 2-char slot (handles ⚡, ⌬, etc.)
function emojiSlot(emoji) {
  if (!emoji) return '  '
  if (emoji.length >= EMOJI_SLOT) return emoji.slice(0, EMOJI_SLOT)
  return emoji + ' '.repeat(EMOJI_SLOT - emoji.length)
}

// ─── BOX: info / key-value ──────────────────────────────────
/**
 * Render box dengan title dan rows.
 *
 * @param {string} title - emoji + judul (e.g. '⚡ YANZYAHA-BOT')
 * @param {Array<{emoji?: string, label: string, value: string}>} rows
 * @returns {string}
 *
 * Output (semua line = TOTAL_WIDTH):
 *   ╭─「 ⚡ YANZYAHA-BOT 」────────╮
 *   │ 📌 Prefix     : .            │
 *   │ 👤 Owner      : wa.me/628x…  │
 *   ╰──────────────────────────────╯
 */
function box(title, rows) {
  const lines = []
  // Header
  const titlePart = `「 ${title} 」`
  const headerFill = Math.max(0, TOTAL_WIDTH - 3 - titlePart.length)  // -3 for ╭─ and ╮
  lines.push('╭─' + titlePart + '─'.repeat(headerFill) + '╮')

  // Rows
  for (const r of rows) {
    const e = emojiSlot(r.emoji || '')
    const label = padR(r.label || '', LABEL_WIDTH)
    const value = String(r.value == null ? '-' : r.value)
    const valueTrunc = value.length > VALUE_WIDTH
      ? value.slice(0, VALUE_WIDTH - 1) + '…'
      : value
    lines.push('│ ' + e + ' ' + label + ' : ' + padR(valueTrunc, VALUE_WIDTH) + ' │')
  }

  // Footer
  lines.push('╰' + '─'.repeat(TOTAL_WIDTH - 2) + '╯')
  return lines.join('\n')
}

// ─── SECTION: list of commands ──────────────────────────────
/**
 * Render section dengan title dan list of commands.
 * Auto-size cmd column berdasarkan command terpanjang.
 *
 * @param {string} title - emoji + judul (e.g. '📌 INFO')
 * @param {Array<{cmd: string, desc: string}>} items
 * @returns {string}
 *
 * Output:
 *   ╭─「 📌 INFO 」────────────────╮
 *   │ ⌬ .ping    » Cek status      │
 *   │ ⌬ .botinfo » Info lengkap bo │
 *   ╰──────────────────────────────╯
 */
function section(title, items) {
  const lines = []
  const titlePart = `「 ${title} 」`
  const headerFill = Math.max(0, TOTAL_WIDTH - 3 - titlePart.length)
  lines.push('╭─' + titlePart + '─'.repeat(headerFill) + '╮')

  // Auto-size cmd column: longest cmd + 1 padding, capped at 16
  const longestCmd = items && items.length
    ? items.reduce((m, it) => Math.max(m, (it.cmd || '').length), 0)
    : 0
  const CMD_WIDTH = Math.min(Math.max(longestCmd + 1, 4), 16)
  const CMD_PREFIX = '⌬ '
  const CMD_SEP = ' » '
  const CMD_COL = CMD_PREFIX.length + CMD_WIDTH + CMD_SEP.length
  const DESC_WIDTH = TOTAL_WIDTH - 4 - CMD_COL  // -4 for '│ ' and ' │'

  for (const it of items || []) {
    const cmd = padR(it.cmd || '', CMD_WIDTH)
    const desc = String(it.desc || '')
    const descTrunc = desc.length > DESC_WIDTH
      ? desc.slice(0, DESC_WIDTH - 1) + '…'
      : desc
    lines.push('│ ' + CMD_PREFIX + cmd + CMD_SEP + padR(descTrunc, DESC_WIDTH) + ' │')
  }

  lines.push('╰' + '─'.repeat(TOTAL_WIDTH - 2) + '╯')
  return lines.join('\n')
}

// ─── FOOTER ─────────────────────────────────────────────────
function footer(text) {
  if (!text) return ''
  return '\n\n_' + String(text) + '_'
}

// ─── DIVIDER ────────────────────────────────────────────────
function divider() {
  return '─'.repeat(TOTAL_WIDTH)
}

// ─── HEADER (with name + prefix + jid) ──────────────────────
/**
 * Render header untuk menu/info.
 *
 * @param {object} opts
 * @param {string} opts.name - bot name
 * @param {string} [opts.jid] - remote JID (group or private)
 * @param {string} [opts.senderJid] - sender JID (for "Kamu" field in groups)
 * @param {boolean} [opts.isGroup] - if true, show Group field
 * @param {string} [opts.prefix] - command prefix (default '.')
 * @returns {string}
 */
function header({ name, jid = null, senderJid = null, isGroup = false, prefix = '.' }) {
  // For private chat, jid IS the sender. For group, jid is group, senderJid is user.
  const remoteDisplay = jid
    ? (jid.length > VALUE_WIDTH + 2 ? jid.slice(0, VALUE_WIDTH - 1) + '…' : jid)
    : '-'
  // Sender display (Kamu / User field)
  const senderId = senderJid || jid
  const user = senderId ? senderId.split('@')[0].split(':')[0] : 'unknown'

  if (isGroup) {
    return box('⚡ ' + (name || 'YANZYAHA-BOT'), [
      { emoji: '👥', label: 'Group', value: remoteDisplay },
      { emoji: '👤', label: 'Kamu', value: '@' + user },
      { emoji: '⌨️', label: 'Prefix', value: prefix },
    ])
  }
  return box('⚡ ' + (name || 'YANZYAHA-BOT'), [
    { emoji: '👤', label: 'User', value: '@' + user },
    { emoji: '⌨️', label: 'Prefix', value: prefix },
  ])
}

// ─── EXPORTS ─────────────────────────────────────────────────
module.exports = {
  TOTAL_WIDTH,
  VALUE_WIDTH,
  LABEL_WIDTH,
  EMOJI_SLOT,
  padR,
  padL,
  emojiSlot,
  box,
  section,
  footer,
  divider,
  header,
}
