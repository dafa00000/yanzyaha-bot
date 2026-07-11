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

// Cache group JIDs — bot knows them from message history
// We store groups we've seen in a JSON file
const GROUPS_FILE = path.join(DATA_DIR, 'groups.json')

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

// Expose for index.js to call when bot sees a group message
module.exports.saveGroup = saveGroup

/**
 * Handle broadcast command
 * @param {object} sock - Baileys socket
 * @param {object} msg - incoming message
 * @param {string} text - command text (after prefix, includes command name)
 * @param {string} sender - sender JID
 * @param {string} body - full message body (for parsing)
 * @returns {Promise<boolean>} - true if handled
 */
async function handleBroadcast(sock, msg, text, sender, body) {
  const jid = msg.key.remoteJid
  const args = body.trim().split(/\s+/)
  const cmd = args[0]?.toLowerCase().replace(/^\./, '')
  const message = args.slice(1).join(' ').trim()

  // Check if it's a broadcast command
  if (!['broadcast', 'bc', 'broadcastgroup', 'bcgroup', 'broadcastall', 'bcall'].includes(cmd)) {
    return false
  }

  // Reply function
  const reply = async (t) => sock.sendMessage(jid, { text: t }, { quoted: msg })

  // Parse message — could be from .broadcast [pesan] or from reply to media
  let broadcastText = message

  // If no text but replying to a message, use replied message text
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
      '.reply media + `.broadcast [pesan]` → kirim media + caption ke semua'
    )
    return true
  }

  // Determine target type
  const isGroupOnly = cmd === 'broadcastgroup' || cmd === 'bcgroup'
  const isAll = cmd === 'broadcastall' || cmd === 'bcall'
  const isPrivateOnly = !isGroupOnly && !isAll

  // Collect targets
  const targets = []
  const banned = loadBanned()
  const users = loadUsers()
  const groups = loadGroups()

  if (isPrivateOnly || isAll) {
    for (const user of users) {
      const userJid = user.lid ? `${user.lid}@s.whatsapp.net` : user.nomor ? `${user.nomor}@s.whatsapp.net` : null
      if (!userJid) continue
      if (banned.some(b => b.includes(user.lid || user.nomor))) continue
      targets.push({ jid: userJid, type: 'private' })
    }
  }

  if (isGroupOnly || isAll) {
    for (const gJid of groups) {
      targets.push({ jid: gJid, type: 'group' })
    }
  }

  if (targets.length === 0) {
    await reply('❌ Tidak ada target untuk broadcast. Bot belum punya user/group tercatat.')
    return true
  }

  // Send progress
  const targetLabel = isPrivateOnly ? 'user private' : isGroupOnly ? 'grup' : 'user + grup'
  await reply(`📢 Mengirim broadcast ke ${targets.length} ${targetLabel}...\n\nPesan:\n"${broadcastText.slice(0, 100)}${broadcastText.length > 100 ? '...' : ''}"`)

  // Send broadcast
  let success = 0
  let failed = 0
  const errors = []

  for (const target of targets) {
    try {
      // Add small delay to avoid rate limit (WhatsApp ~1 msg/sec for broadcast)
      await new Promise(r => setTimeout(r, 500))

      // Check if there's media to forward
      const hasQuotedMedia = quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage || quoted.stickerMessage || quoted.documentMessage)

      if (hasQuotedMedia) {
        // Download media from quoted message and resend
        try {
          const { downloadMediaMessage } = require('@whiskeysockets/baileys')
          const fakeMsg = { message: quoted, key: msg.key }
          const buffer = await downloadMediaMessage(fakeMsg, 'buffer', {})

          const mediaType = quoted.imageMessage ? 'image' :
            quoted.videoMessage ? 'video' :
            quoted.audioMessage ? 'audio' :
            quoted.stickerMessage ? 'sticker' : 'document'

          const msgObj = {}
          if (mediaType === 'image') msgObj.image = buffer
          if (mediaType === 'video') msgObj.video = buffer
          if (mediaType === 'audio') { msgObj.audio = buffer; msgObj.mimetype = 'audio/mpeg' }
          if (mediaType === 'sticker') msgObj.sticker = buffer
          if (mediaType === 'document') msgObj.document = buffer

          msgObj.caption = `📢 *BROADCAST*\n\n${broadcastText}`
          if (mediaType === 'sticker') {
            // Stickers can't have caption, send separately
            await sock.sendMessage(target.jid, msgObj)
            await new Promise(r => setTimeout(r, 300))
            await sock.sendMessage(target.jid, { text: `📢 *BROADCAST*\n\n${broadcastText}` })
          } else {
            await sock.sendMessage(target.jid, msgObj)
          }
        } catch (mediaErr) {
          // Fallback: send text only
          await sock.sendMessage(target.jid, { text: `📢 *BROADCAST*\n\n${broadcastText}` })
        }
      } else {
        // Text only
        await sock.sendMessage(target.jid, { text: `📢 *BROADCAST*\n\n${broadcastText}` })
      }

      success++
    } catch (err) {
      failed++
      if (errors.length < 5) {
        errors.push(`${target.jid}: ${err.message?.slice(0, 80)}`)
      }
    }
  }

  // Report
  let report = `✅ *Broadcast selesai!*\n\n`
  report += `📊 Total target: ${targets.length}\n`
  report += `✅ Berhasil: ${success}\n`
  report += `❌ Gagal: ${failed}\n`
  if (errors.length > 0) {
    report += `\n*Error detail:*\n`
    report += errors.map(e => `• ${e}`).join('\n')
  }

  await reply(report)
  return true
}

module.exports.handleBroadcast = handleBroadcast
module.exports.loadUsers = loadUsers
module.exports.loadGroups = loadGroups
module.exports.loadBanned = loadBanned
