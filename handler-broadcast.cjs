'use strict'
/**
 * handler-broadcast.cjs
 * Broadcast message ke semua user bot.
 * Owner only. Kirim pesan ke semua user yang tercatat di users.json.
 *
 * Commands:
 *   .broadcast [pesan]          → kirim ke semua user (private)
 *   .broadcastgroup [pesan]    → kirim ke semua grup yang bot masuk
 *   .broadcastall [pesan]      → kirim ke semua user + grup
 *
 * Support media: reply media dengan .broadcast → kirim media+caption ke semua
 */

const fs = require('fs')
const path = require('path')

const DATA_DIR = process.env.HERMES_HOME || process.cwd()
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const BANNED_FILE = path.join(DATA_DIR, 'banned.json')
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json')

function loadUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))
    return Object.values(data)
  } catch {
    return []
  }
}

function loadBanned() {
  try {
    return JSON.parse(fs.readFileSync(BANNED_FILE, 'utf8'))
  } catch {
    return []
  }
}

function loadGroups() {
  try {
    const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function saveGroup(jid) {
  if (!jid || !jid.endsWith('@g.us')) return
  const groups = loadGroups()
  if (!groups.includes(jid)) {
    groups.push(jid)
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2))
  }
}

/**
 * Resolve a stored user record into a sendable WhatsApp JID.
 * Critical fix: LID users must use @lid, phone users use @s.whatsapp.net.
 * Old code always used @s.whatsapp.net → broadcast "succeeds" count but never delivers.
 */
function resolveUserJid(user) {
  if (!user || typeof user !== 'object') return null

  if (user.fullJid && /@(lid|s\.whatsapp\.net)$/i.test(user.fullJid)) {
    return user.fullJid
  }

  const jidType = (user.jidType || '').toLowerCase()
  const id = String(user.lid || user.id || '').replace(/@(lid|s\.whatsapp\.net)$/i, '').split(':')[0]
  const nomor = String(user.nomor || '').replace(/[^0-9]/g, '')

  if (jidType === 'lid' && id) return `${id}@lid`
  if (jidType === 's.whatsapp.net' && id) return `${id}@s.whatsapp.net`

  // Prefer a *distinct* real phone number when available
  if (nomor && nomor !== id && isLikelyPhone(nomor)) {
    return `${nomor}@s.whatsapp.net`
  }
  if (nomor && isLikelyPhone(nomor) && jidType !== 'lid') {
    // Only trust nomor==id if it clearly looks like a phone (country 62…), not a raw LID
    if (nomor === id && !isLikelyPhone(id)) {
      // fall through
    } else if (isLikelyPhone(nomor)) {
      return `${nomor}@s.whatsapp.net`
    }
  }

  if (!id) return null
  if (isLikelyPhone(id)) return `${id}@s.whatsapp.net`
  if (/^\d+$/.test(id)) return `${id}@lid`
  return null
}

function isLikelyPhone(n) {
  const s = String(n || '').replace(/[^0-9]/g, '')
  // Common WA phone: country code + national number, typically 10–15 digits.
  // Bias to real country codes used by this bot's audience; avoid treating long LIDs as phones.
  if (s.length < 10 || s.length > 15) return false
  // Indonesian mobile: 62 + 8… (total ~11–14)
  if (/^62[2-9]\d{7,12}$/.test(s)) return true
  // Other common: US/CA 1 + 10 digits exactly 11
  if (/^1\d{10}$/.test(s)) return true
  if (/^(60|65|61|81|44|91)\d{8,12}$/.test(s)) return true
  return false
}

function isBannedUser(user, banned) {
  const candidates = [user.lid, user.nomor, user.fullJid].filter(Boolean).map(String)
  return banned.some(b => {
    const bb = String(b).replace(/@(lid|s\.whatsapp\.net)$/i, '')
    return candidates.some(c => String(c).replace(/@(lid|s\.whatsapp\.net)$/i, '') === bb || String(c).includes(bb))
  })
}

/**
 * Handle broadcast command
 */
async function handleBroadcast(sock, msg, text, sender, body) {
  const jid = msg.key.remoteJid
  const args = body.trim().split(/\s+/)
  const cmd = args[0]?.toLowerCase().replace(/^\./, '')
  const message = args.slice(1).join(' ').trim()

  if (!['broadcast', 'bc', 'broadcastgroup', 'bcgroup', 'broadcastall', 'bcall'].includes(cmd)) {
    return false
  }

  const reply = async (t) => sock.sendMessage(jid, { text: t }, { quoted: msg })

  let broadcastText = message
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
  if (!broadcastText && quoted) {
    broadcastText = quoted.conversation || quoted.extendedTextMessage?.text || ''
  }

  if (!broadcastText) {
    await reply(
      '📢 *BROADCAST*\n\n' +
      'Cara pakai:\n' +
      '• `.broadcast [pesan]` → kirim ke semua user private\n' +
      '• `.broadcastgroup [pesan]` → kirim ke semua grup\n' +
      '• `.broadcastall [pesan]` → kirim ke semua user + grup\n\n' +
      'Reply media + `.broadcast [pesan]` → kirim media + caption ke semua'
    )
    return true
  }

  const isGroupOnly = cmd === 'broadcastgroup' || cmd === 'bcgroup'
  const isAll = cmd === 'broadcastall' || cmd === 'bcall'
  const isPrivateOnly = !isGroupOnly && !isAll

  const targets = []
  const seen = new Set()
  const banned = loadBanned()
  const users = loadUsers()
  const groups = loadGroups()

  if (isPrivateOnly || isAll) {
    let skippedNoJid = 0
    for (const user of users) {
      if (isBannedUser(user, banned)) continue
      const userJid = resolveUserJid(user)
      if (!userJid) { skippedNoJid++; continue }
      if (seen.has(userJid)) continue
      seen.add(userJid)
      targets.push({ jid: userJid, type: 'private' })
    }
    if (skippedNoJid > 0) {
      console.log(`[BROADCAST] skipped ${skippedNoJid} users without resolvable JID`)
    }
  }

  if (isGroupOnly || isAll) {
    for (const gJid of groups) {
      if (seen.has(gJid)) continue
      seen.add(gJid)
      targets.push({ jid: gJid, type: 'group' })
    }
  }

  if (targets.length === 0) {
    await reply('❌ Tidak ada target untuk broadcast. Bot belum punya user/group tercatat (atau JID user tidak bisa di-resolve).')
    return true
  }

  // Sample first few targets for owner diagnostics
  const sample = targets.slice(0, 3).map(t => t.jid).join(', ')
  const targetLabel = isPrivateOnly ? 'user private' : isGroupOnly ? 'grup' : 'user + grup'
  await reply(
    `📢 Mengirim broadcast ke *${targets.length}* ${targetLabel}...\n` +
    `Sample JID: ${sample}\n\n` +
    `Pesan:\n"${broadcastText.slice(0, 100)}${broadcastText.length > 100 ? '...' : ''}"`
  )

  let success = 0
  let failed = 0
  const errors = []

  // Pre-download media once (not per target)
  let mediaPayload = null
  const hasQuotedMedia = quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage || quoted.stickerMessage || quoted.documentMessage)
  if (hasQuotedMedia) {
    try {
      const { downloadMediaMessage } = require('@whiskeysockets/baileys')
      const fakeMsg = { message: quoted, key: msg.key }
      const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {})
      const mediaType = quoted.imageMessage ? 'image' :
        quoted.videoMessage ? 'video' :
        quoted.audioMessage ? 'audio' :
        quoted.stickerMessage ? 'sticker' : 'document'
      mediaPayload = { buffer, mediaType }
    } catch (e) {
      console.error('[BROADCAST] media download failed:', e.message)
      mediaPayload = null
    }
  }

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]
    try {
      // ~2 msg/sec soft rate-limit
      if (i > 0) await new Promise(r => setTimeout(r, 600))

      if (mediaPayload) {
        const msgObj = {}
        const { buffer, mediaType } = mediaPayload
        if (mediaType === 'image') msgObj.image = buffer
        if (mediaType === 'video') msgObj.video = buffer
        if (mediaType === 'audio') { msgObj.audio = buffer; msgObj.mimetype = 'audio/mpeg' }
        if (mediaType === 'sticker') msgObj.sticker = buffer
        if (mediaType === 'document') msgObj.document = buffer
        msgObj.caption = `📢 *BROADCAST*\n\n${broadcastText}`

        if (mediaType === 'sticker') {
          await sock.sendMessage(target.jid, { sticker: buffer })
          await new Promise(r => setTimeout(r, 300))
          await sock.sendMessage(target.jid, { text: `📢 *BROADCAST*\n\n${broadcastText}` })
        } else {
          await sock.sendMessage(target.jid, msgObj)
        }
      } else {
        await sock.sendMessage(target.jid, { text: `📢 *BROADCAST*\n\n${broadcastText}` })
      }

      success++
    } catch (err) {
      failed++
      console.error(`[BROADCAST] fail ${target.jid}:`, err?.message || err)
      if (errors.length < 8) {
        errors.push(`${target.jid}: ${(err.message || String(err)).slice(0, 100)}`)
      }
    }

    // progress every 25 targets
    if ((i + 1) % 25 === 0) {
      try {
        await sock.sendMessage(jid, { text: `⏳ Progress broadcast: ${i + 1}/${targets.length} (ok=${success} fail=${failed})` })
      } catch {}
    }
  }

  let report = `✅ *Broadcast selesai!*\n\n`
  report += `📊 Total target: ${targets.length}\n`
  report += `✅ Berhasil: ${success}\n`
  report += `❌ Gagal: ${failed}\n`
  if (errors.length > 0) {
    report += `\n*Error detail:*\n`
    report += errors.map(e => `• ${e}`).join('\n')
  }
  if (success === 0 && failed > 0) {
    report += `\n\n💡 Tip: user lama mungkin cuma punya LID. Biar broadcast akurat, minta user chat bot sekali lagi (biar JID ke-update).`
  }

  await reply(report)
  return true
}

module.exports.handleBroadcast = handleBroadcast
module.exports.loadUsers = loadUsers
module.exports.loadGroups = loadGroups
module.exports.loadBanned = loadBanned
module.exports.saveGroup = saveGroup
module.exports.resolveUserJid = resolveUserJid
