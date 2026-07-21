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

function isLikelyPhone(n) {
  const s = String(n || '').replace(/[^0-9]/g, '')
  // Common WA phone: country code + national number, typically 10–15 digits.
  if (s.length < 10 || s.length > 15) return false
  if (/^62[2-9]\d{7,12}$/.test(s)) return true
  if (/^1\d{10}$/.test(s)) return true
  if (/^(60|65|61|81|44|91)\d{8,12}$/.test(s)) return true
  return false
}

/** Filter non-user / system JIDs that must never be broadcast targets */
function isJunkJid(jid) {
  const j = String(jid || '').toLowerCase()
  if (!j) return true
  if (j.includes('status@broadcast')) return true
  if (j.includes('@broadcast')) return true
  if (j.endsWith('@newsletter')) return true
  if (j.endsWith('@g.us')) return false // groups OK when intentionally added
  if (j.includes('server') || j === '0@s.whatsapp.net') return true
  // bare garbage like "status@broadcast@s.whatsapp.net"
  const userPart = j.split('@')[0] || ''
  if (!/^\d+$/.test(userPart)) return true
  return false
}

/**
 * Resolve a stored user record into a sendable WhatsApp JID.
 * Critical: LID users must use @lid, phone users use @s.whatsapp.net.
 */
function resolveUserJid(user) {
  if (!user || typeof user !== 'object') return null

  if (user.fullJid && /@(lid|s\.whatsapp\.net)$/i.test(user.fullJid)) {
    if (isJunkJid(user.fullJid)) return null
    return user.fullJid
  }

  const jidType = (user.jidType || '').toLowerCase()
  const id = String(user.lid || user.id || '').replace(/@(lid|s\.whatsapp\.net)$/i, '').split(':')[0]
  const nomor = String(user.nomor || '').replace(/[^0-9]/g, '')

  if (id && !/^\d+$/.test(id)) return null

  if (jidType === 'lid' && id) {
    const j = `${id}@lid`
    return isJunkJid(j) ? null : j
  }
  if (jidType === 's.whatsapp.net' && id) {
    const j = `${id}@s.whatsapp.net`
    return isJunkJid(j) ? null : j
  }

  // Prefer a *distinct* real phone number when available
  if (nomor && nomor !== id && isLikelyPhone(nomor)) {
    return `${nomor}@s.whatsapp.net`
  }
  if (nomor && isLikelyPhone(nomor) && jidType !== 'lid') {
    return `${nomor}@s.whatsapp.net`
  }

  if (!id) return null
  if (isLikelyPhone(id)) return `${id}@s.whatsapp.net`
  if (/^\d+$/.test(id)) return `${id}@lid`
  return null
}

function isBannedUser(user, banned) {
  const candidates = [user.lid, user.nomor, user.fullJid].filter(Boolean).map(String)
  return banned.some(b => {
    const bb = String(b).replace(/@(lid|s\.whatsapp\.net)$/i, '')
    return candidates.some(c => String(c).replace(/@(lid|s\.whatsapp\.net)$/i, '') === bb || String(c).includes(bb))
  })
}

/**
 * Prefer mapped phone JID when Baileys lidMapping knows it (more reliable delivery),
 * else keep original @lid. Never call onWhatsApp with LID — Baileys rejects that.
 */
async function preferSendableJid(sock, jid) {
  if (!jid || isJunkJid(jid)) return null
  if (jid.endsWith('@g.us')) return jid

  if (jid.endsWith('@lid')) {
    try {
      const getPN = sock?.signalRepository?.lidMapping?.getPNForLID?.bind(sock.signalRepository.lidMapping)
      if (getPN) {
        const pn = await getPN(jid)
        if (pn && /@s\.whatsapp\.net$/i.test(pn) && !isJunkJid(pn)) {
          return pn
        }
      }
    } catch (e) {
      console.log(`[BROADCAST] getPNForLID fail ${jid}:`, e.message)
    }
    // Send directly to @lid — this is valid in modern Baileys
    return jid
  }

  // Phone JID: optional existence check (only phones work with onWhatsApp)
  if (jid.endsWith('@s.whatsapp.net')) {
    const num = jid.replace(/@s\.whatsapp\.net$/i, '')
    if (!isLikelyPhone(num)) return null
    try {
      const check = await sock.onWhatsApp(num)
      if (Array.isArray(check) && check.length > 0) {
        const hit = check.find(c => c && c.exists)
        if (hit?.jid) return hit.jid
        if (!hit) {
          console.log(`[BROADCAST] Skipping non-WA phone: ${jid}`)
          return null
        }
      }
    } catch (e) {
      console.log(`[BROADCAST] onWhatsApp check failed for ${jid}:`, e.message)
      // fail-open for phones if API blips
    }
    return jid
  }

  return null
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
    let skippedJunk = 0
    let skippedBanned = 0
    let skippedVerify = 0

    for (const user of users) {
      if (isBannedUser(user, banned)) { skippedBanned++; continue }
      const userJid = resolveUserJid(user)
      if (!userJid) { skippedNoJid++; continue }
      if (isJunkJid(userJid) || userJid.endsWith('@g.us')) { skippedJunk++; continue }

      const sendJid = await preferSendableJid(sock, userJid)
      if (!sendJid) { skippedVerify++; continue }
      if (seen.has(sendJid)) continue
      seen.add(sendJid)
      targets.push({ jid: sendJid, type: 'private', source: userJid })
    }

    console.log(
      `[BROADCAST] private resolve: ok=${targets.filter(t => t.type === 'private').length}` +
      ` noJid=${skippedNoJid} junk=${skippedJunk} banned=${skippedBanned} verifyFail=${skippedVerify}`
    )
  }

  if (isGroupOnly || isAll) {
    for (const gJid of groups) {
      if (!gJid || !String(gJid).endsWith('@g.us')) continue
      if (seen.has(gJid)) continue
      seen.add(gJid)
      targets.push({ jid: gJid, type: 'group' })
    }
  }

  if (targets.length === 0) {
    await reply('❌ Tidak ada target untuk broadcast. Bot belum punya user/group tercatat (atau JID user tidak bisa di-resolve).')
    return true
  }

  const sample = targets.slice(0, 5).map(t => t.jid).join(', ')
  const nPrivate = targets.filter(t => t.type === 'private').length
  const nGroup = targets.filter(t => t.type === 'group').length
  const targetLabel = isPrivateOnly ? 'user private' : isGroupOnly ? 'grup' : `user (${nPrivate}) + grup (${nGroup})`
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
    report += `\n\n💡 Tip: kalau socket reconnect mid-broadcast, coba lagi saat bot stabil. User lama tanpa chat ulang juga bisa gagal session.`
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
module.exports.isJunkJid = isJunkJid
module.exports.isLikelyPhone = isLikelyPhone
