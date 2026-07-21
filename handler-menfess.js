// handler-menfess.js
// Menfess (Anonymous Confession) untuk YANZYAHA-BOT
//
// Commands:
// - .menfess <pesan>          : Kirim menfess anon ke grup ini (hanya grup)
// - .menfessp @nomor <pesan>  : Kirim menfess via DM bot ke NOMOR WA APA SAJA
//                              (tidak perlu pernah chat bot / tidak perlu ada di users.json)

import fs from 'fs'
import path from 'path'

const HERMES_HOME = process.env.HERMES_HOME || '/opt/data'
const MENFESS_FILE = path.join(HERMES_HOME, 'menfess.json')
const CONFIG_FILE = path.join(HERMES_HOME, 'menfess-config.json')
const USERS_FILE = path.join(HERMES_HOME, 'users.json')

// ─── HELPERS ──────────────────────────────────────────────────

function loadJSON(file, defaultVal = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return defaultVal
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function getMenfessData() {
  return loadJSON(MENFESS_FILE, { confessions: [], stats: {} })
}

function saveMenfessData(data) {
  saveJSON(MENFESS_FILE, data)
}

function getConfig() {
  return loadJSON(CONFIG_FILE, {
    bannedUsers: [],
    cooldownMs: 30000,
    maxLength: 2000
  })
}

function saveConfig(config) {
  saveJSON(CONFIG_FILE, config)
}

function formatJid(jid) {
  return String(jid || '').replace(/@(lid|s\.whatsapp\.net)$/i, '').split(':')[0]
}

function generateMenfessId() {
  return 'MF' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase()
}

/** Normalize any phone input → digits with country code (ID-friendly). */
function normalizePhoneInput(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^@+/, '')
  s = s.replace(/[^\d+]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  s = s.replace(/\D/g, '')
  // 08xxxxxxxxxx → 628xxxxxxxxxx (Indonesia local)
  if (/^0[8]\d{7,12}$/.test(s)) s = '62' + s.slice(1)
  // 8xxxxxxxxxx without country → assume ID mobile
  if (/^8\d{8,12}$/.test(s)) s = '62' + s
  return s
}

function isLikelyPhone(n) {
  const s = String(n || '').replace(/[^0-9]/g, '')
  if (s.length < 10 || s.length > 15) return false
  if (!/^[1-9]\d{9,14}$/.test(s)) return false
  return true
}

function normalizeUserJid(jid) {
  const s = String(jid || '').trim()
  if (!s.includes('@')) return null
  const [userPart, server] = s.split('@')
  if (!userPart || !server) return null
  const user = userPart.split(':')[0]
  if (!/^\d+$/.test(user)) return null
  const srv = server.toLowerCase()
  if (srv !== 'lid' && srv !== 's.whatsapp.net') return null
  return `${user}@${srv}`
}

function isOwnJid(sock, jid) {
  const me = sock?.user || sock?.authState?.creds?.me || {}
  const n = normalizeUserJid(jid)
  if (!n) return false
  const mePn = normalizeUserJid(me.id)
  const meLid = normalizeUserJid(me.lid)
  const bare = n.split('@')[0]
  if (mePn && (n === mePn || mePn.split('@')[0] === bare)) return true
  if (meLid && (n === meLid || meLid.split('@')[0] === bare)) return true
  return false
}

/**
 * Resolve ANY WhatsApp phone number to sendable JIDs.
 * Does NOT require users.json / prior chat — pure WA directory lookup.
 * Order: real @lid first, then @s.whatsapp.net.
 */
async function resolveAnyWhatsAppTarget(sock, rawNum) {
  const num = normalizePhoneInput(rawNum)
  const lids = []
  const pns = []
  const pushLid = (j) => {
    const n = normalizeUserJid(j)
    if (!n || !n.endsWith('@lid')) return
    if (isOwnJid(sock, n)) return
    if (!lids.includes(n)) lids.push(n)
  }
  const pushPn = (j) => {
    const n = normalizeUserJid(j)
    if (!n || !n.endsWith('@s.whatsapp.net')) return
    if (isOwnJid(sock, n)) return
    if (!pns.includes(n)) pns.push(n)
  }

  if (!isLikelyPhone(num)) {
    return { ok: false, reason: 'invalid_phone', num, candidates: [] }
  }

  // Optional boost only (NOT required): known LID if nomor already stored
  try {
    const users = loadJSON(USERS_FILE, {})
    for (const u of Object.values(users)) {
      if (!u || typeof u !== 'object') continue
      const nomor = String(u.nomor || '').replace(/[^0-9]/g, '')
      if (nomor && nomor === num) {
        if (u.fullJid) {
          if (/@lid$/i.test(u.fullJid)) pushLid(u.fullJid)
          else pushPn(u.fullJid)
        }
        if ((u.jidType || '') === 'lid' && u.lid) pushLid(`${String(u.lid).split('@')[0]}@lid`)
      }
    }
  } catch {}

  // 1) Confirm number is ON WhatsApp (directory lookup — any WA user worldwide)
  let existsOnWa = false
  let waJid = null
  try {
    const check = await sock.onWhatsApp(num)
    console.log('[MENFESS] onWhatsApp', num, JSON.stringify(check))
    if (Array.isArray(check)) {
      for (const c of check) {
        // Contact protocol: exists === true when attrs.type === 'in'
        if (c && c.exists === true) {
          existsOnWa = true
          if (c.jid) {
            waJid = c.jid
            if (String(c.jid).includes('@lid')) pushLid(c.jid)
            else pushPn(c.jid)
          }
        }
      }
    }
  } catch (e) {
    console.log('[MENFESS] onWhatsApp fail:', e.message)
  }

  if (!existsOnWa) {
    return { ok: false, reason: 'not_on_whatsapp', num, candidates: [] }
  }

  const pnJid = (normalizeUserJid(waJid) && String(waJid).includes('@s.whatsapp.net'))
    ? normalizeUserJid(waJid)
    : `${num}@s.whatsapp.net`
  pushPn(pnJid)

  // 2) PN → LID via lidMapping (USync). Critical for modern WA cold-DM delivery.
  try {
    const getLID = sock?.signalRepository?.lidMapping?.getLIDForPN?.bind(sock.signalRepository.lidMapping)
    if (getLID) {
      const lid = await getLID(pnJid)
      console.log('[MENFESS] getLIDForPN', pnJid, '→', lid)
      if (lid) pushLid(lid)
    }
  } catch (e) {
    console.log('[MENFESS] getLIDForPN fail:', e.message)
  }

  // 3) Warm device list (helps multi-device delivery)
  try {
    if (typeof sock.getUSyncDevices === 'function') {
      const devices = await sock.getUSyncDevices([pnJid, ...lids], false, false)
      console.log('[MENFESS] devices', (devices || []).map(d => d.jid || d).slice(0, 8))
      for (const d of devices || []) {
        if (d?.jid) {
          if (String(d.jid).includes('@lid')) pushLid(d.jid)
          else if (String(d.jid).includes('@s.whatsapp.net')) pushPn(d.jid)
        }
      }
    }
  } catch (e) {
    console.log('[MENFESS] getUSyncDevices fail:', e.message)
  }

  const candidates = [...lids, ...pns].filter(j => !isOwnJid(sock, j))
  console.log('[MENFESS] candidates', num, candidates)

  if (!candidates.length) {
    return { ok: false, reason: 'no_candidates', num, candidates: [] }
  }

  return { ok: true, reason: 'ok', num, candidates, lids, pns, existsOnWa: true }
}

async function prepareSessions(sock, jids) {
  const list = [...new Set((jids || []).map(normalizeUserJid).filter(Boolean))]
  if (!list.length) return
  try {
    if (typeof sock.assertSessions === 'function') {
      await sock.assertSessions(list, true)
      console.log('[MENFESS] assertSessions ok', list)
    }
  } catch (e) {
    console.log('[MENFESS] assertSessions fail:', e.message)
  }
}

/**
 * WhatsApp new-chat quota / reachout status for this bot account.
 * total_quota:0 + NOT_ELIGIBLE = cannot start cold 1:1 chats (error 463 path).
 */
async function getAccountSendHealth(sock) {
  const health = { cap: null, lock: null, coldDmBlocked: false, detail: '' }
  try {
    if (typeof sock.fetchNewChatMessageCap === 'function') {
      const cap = await sock.fetchNewChatMessageCap()
      health.cap = cap
      console.log('[MENFESS] newChatCap', JSON.stringify(cap))
      const total = Number(cap?.total_quota ?? cap?.totalQuota ?? -1)
      const used = Number(cap?.used_quota ?? cap?.usedQuota ?? 0)
      const mv = String(cap?.mv_status || cap?.mvStatus || '')
      const ote = String(cap?.ote_status || cap?.oteStatus || '')
      if (total === 0 || mv === 'NOT_ELIGIBLE' || ote === 'NOT_ELIGIBLE') {
        health.coldDmBlocked = true
        health.detail = `newChatCap total=${total} used=${used} mv=${mv} ote=${ote}`
      }
    }
  } catch (e) {
    console.log('[MENFESS] newChatCap fail:', e.message)
  }
  try {
    if (typeof sock.fetchAccountReachoutTimelock === 'function') {
      const lock = await sock.fetchAccountReachoutTimelock()
      health.lock = lock
      console.log('[MENFESS] reachoutLock', JSON.stringify(lock))
      if (lock?.isActive) {
        health.coldDmBlocked = true
        health.detail = (health.detail ? health.detail + ' | ' : '') + `reachoutLock active until ${lock.timeEnforcementEnds || '?'}`
      }
    }
  } catch (e) {
    console.log('[MENFESS] reachoutLock fail:', e.message)
  }
  return health
}

/**
 * Wait for messages.update ack for a sent message id.
 * status: 0=ERROR, 1=PENDING, 2=SERVER_ACK, 3=DELIVERY, 4=READ
 * Baileys 463 restriction often arrives as status 0 + stub ["463", "...restricted"]
 */
function waitForMessageOutcome(sock, msgId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (!msgId || !sock?.ev) {
      resolve({ ok: false, reason: 'no_msg_id' })
      return
    }

    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { sock.ev.off('messages.update', onUpdate) } catch {}
      resolve(result)
    }

    const timer = setTimeout(() => {
      // no negative ack in time — treat as soft-ok (server accepted, delivery unknown)
      finish({ ok: true, reason: 'timeout_no_nack', status: null, soft: true })
    }, timeoutMs)

    const onUpdate = (updates) => {
      for (const u of updates || []) {
        const id = u?.key?.id
        if (id !== msgId) continue
        const st = u?.update?.status
        const stub = u?.update?.messageStubParameters
        const stubText = Array.isArray(stub) ? stub.join(' ') : String(stub || '')
        console.log('[MENFESS] messages.update', msgId, 'status=', st, 'stub=', stubText)

        if (st === 0 || /463|restrict|not.?eligible/i.test(stubText)) {
          finish({
            ok: false,
            reason: 'ack_error',
            status: st,
            stub: stubText,
            restricted: /463|restrict/i.test(stubText)
          })
          return
        }
        if (typeof st === 'number' && st >= 2) {
          finish({ ok: true, reason: 'acked', status: st, delivered: st >= 3 })
          return
        }
      }
    }

    sock.ev.on('messages.update', onUpdate)
  })
}

async function tryIssuePrivacyToken(sock, jid) {
  try {
    if (typeof sock.issuePrivacyTokens !== 'function') return
    const t = Math.floor(Date.now() / 1000)
    await sock.issuePrivacyTokens([jid], t)
    console.log('[MENFESS] issuePrivacyTokens ok', jid)
  } catch (e) {
    console.log('[MENFESS] issuePrivacyTokens fail', jid, e.message)
  }
}

/**
 * Cold-DM send to any WA user.
 * - Prefer real @lid then PN
 * - Wait for ack so we don't fake "terkirim"
 * - Surface WA account restriction (463 / newChatCap)
 */
async function trySendMenfess(sock, candidates, text) {
  const health = await getAccountSendHealth(sock)
  await prepareSessions(sock, candidates)

  let lastErr = null
  let sawRestriction = health.coldDmBlocked

  for (const targetJid of candidates) {
    try {
      await tryIssuePrivacyToken(sock, targetJid)
      await prepareSessions(sock, [targetJid])

      const sent = await sock.sendMessage(targetJid, { text })
      const msgId = sent?.key?.id || null
      console.log(`[MENFESS] send queued → ${targetJid} id=${msgId}`)

      const outcome = await waitForMessageOutcome(sock, msgId, 10000)
      console.log('[MENFESS] outcome', targetJid, outcome)

      if (outcome.ok) {
        return {
          ok: true,
          jid: targetJid,
          msgId,
          status: outcome.status,
          soft: !!outcome.soft,
          health
        }
      }

      if (outcome.restricted) sawRestriction = true
      lastErr = new Error(outcome.stub || outcome.reason || 'ack_error')
      // Baileys: do NOT spam-retry on 463 (worsens restriction) — try next addressing once only
    } catch (err) {
      lastErr = err
      console.error(`[MENFESS] send fail ${targetJid}:`, err?.message || err)
    }
  }

  return {
    ok: false,
    error: lastErr,
    restricted: sawRestriction,
    health
  }
}

// ─── COOLDOWN CHECK ───────────────────────────────────────────

const userCooldowns = new Map()

function checkCooldown(senderJid, cooldownMs) {
  const now = Date.now()
  const lastTime = userCooldowns.get(senderJid) || 0
  if (now - lastTime < cooldownMs) {
    const remaining = Math.ceil((cooldownMs - (now - lastTime)) / 1000)
    return { allowed: false, remaining }
  }
  userCooldowns.set(senderJid, now)
  return { allowed: true }
}

// ─── FORMAT MESSAGE ───────────────────────────────────────────

function formatMenfessMessage(confession) {
  const { message, timestamp } = confession
  const date = new Date(timestamp).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  return (
    `📮 *MENFESS ANONIM*\n\n` +
    `${message}\n\n` +
    `🕐 ${date} WIB`
  )
}

// ─── MAIN HANDLER ─────────────────────────────────────────────

export async function handleMenfess(sock, msg, text, command) {
  const from = msg.key.remoteJid
  const sender = msg.key.participant || msg.key.remoteJid
  const isGroup = from.endsWith('@g.us')
  const senderId = formatJid(sender)
  const config = getConfig()
  const menfessData = getMenfessData()

  const reply = async (replyText, mentions = []) => {
    await sock.sendMessage(from, { text: replyText, mentions }, { quoted: msg })
  }

  // ── .menfessp (private via DM) ──────────────────────────────
  if (command === 'menfessp') {
    if (isGroup) {
      return reply('❌ Command `.menfessp` hanya bisa di *Private Chat* (DM ke bot).')
    }

    if (!text) {
      return reply(
        `📮 *MENFESS PRIVATE*\n\n` +
        `Format: \`.menfessp @628xxx pesanmu\`\n\n` +
        `Contoh:\n\`.menfessp @6285123456789 Halo ini menfess anon\`\n` +
        `Atau: \`.menfessp @08123456789 pesan\`\n\n` +
        `_Bisa ke nomor WA apa saja (tidak harus pernah chat bot)._\n` +
        `_Pesan dikirim anonim dari nomor bot._`
      )
    }

    const targetMatch = text.match(/^@?([+\d][\d\s\-]{7,20})\s+/)
    if (!targetMatch) {
      return reply('❌ Format salah. Contoh: `.menfessp @6285123456789 Halo ini menfess`')
    }

    const targetRaw = targetMatch[1]
    const targetNumber = normalizePhoneInput(targetRaw)
    const message = text.slice(targetMatch[0].length).trim()

    if (!message) {
      return reply('❌ Pesan menfess tidak boleh kosong!')
    }

    if (message.length > config.maxLength) {
      return reply(`❌ Pesan terlalu panjang (max ${config.maxLength} karakter)`)
    }

    if (config.bannedUsers?.includes(senderId) || config.bannedUsers?.includes(targetNumber)) {
      // still only ban sender typically; keep sender check
    }
    if (config.bannedUsers?.includes(senderId)) {
      return reply('❌ Kamu dibanned dari fitur menfess.')
    }

    const cooldown = checkCooldown(senderId, config.cooldownMs)
    if (!cooldown.allowed) {
      return reply(`⏳ Tunggu ${cooldown.remaining} detik sebelum kirim menfess lagi.`)
    }

    try {
      const resolved = await resolveAnyWhatsAppTarget(sock, targetNumber)
      if (!resolved.ok) {
        if (resolved.reason === 'not_on_whatsapp') {
          return reply(`❌ Nomor \`${resolved.num}\` tidak terdaftar di WhatsApp.`)
        }
        if (resolved.reason === 'invalid_phone') {
          return reply('❌ Nomor tidak valid. Pakai format `62812…` / `0812…`.')
        }
        return reply('❌ Gagal resolve nomor target. Coba lagi sebentar.')
      }

      const candidates = resolved.candidates
      const menfessId = generateMenfessId()
      const confession = {
        id: menfessId,
        message,
        sender: senderId,
        senderName: msg.pushName || senderId,
        timestamp: Date.now(),
        targetNumber: resolved.num,
        targetCandidates: candidates,
        isPrivate: true,
        status: 'pending'
      }

      const formattedMsg = formatMenfessMessage(confession)
      const sent = await trySendMenfess(sock, candidates, formattedMsg)

      if (!sent.ok) {
        confession.status = 'failed'
        confession.error = String(sent.error?.message || sent.error || 'unknown')
        confession.restricted = !!sent.restricted
        menfessData.confessions.push(confession)
        saveMenfessData(menfessData)

        if (sent.restricted || sent.health?.coldDmBlocked) {
          return reply(
            `❌ *Gagal kirim menfess ke* \`${resolved.num}\`\n\n` +
            `⚠️ *Akun bot kena pembatasan WhatsApp (cold DM / error 463).*\n` +
            `WA memblokir mulai chat baru dari nomor bot ini.\n\n` +
            `Yang masih jalan:\n` +
            `• \`.menfess\` di *grup* (bukan DM orang random)\n` +
            `• DM ke orang yang *sudah pernah chat bot*\n\n` +
            `Cara benerin (sisi akun, bukan kode):\n` +
            `1. Buka WA di HP utama nomor bot, biarkan online\n` +
            `2. Jangan spam cold DM massal\n` +
            `3. Warming: chat manual dulu beberapa nomor\n` +
            `4. Atau ganti nomor bot yang belum di-restrict\n\n` +
            `_Detail: ${sent.health?.detail || sent.error?.message || 'restricted'}_`
          )
        }

        return reply(
          `❌ Gagal kirim menfess ke \`${resolved.num}\`.\n` +
          `Err: ${(sent.error?.message || 'unknown').slice(0, 120)}`
        )
      }

      confession.status = 'sent'
      confession.targetJid = sent.jid
      confession.msgId = sent.msgId || null
      confession.ackStatus = sent.status
      menfessData.confessions.push(confession)
      menfessData.stats[senderId] = (menfessData.stats[senderId] || 0) + 1
      saveMenfessData(menfessData)

      let extra = ''
      if (sent.soft) {
        extra = `\n\n_Catatan: server terima pesan, tapi belum ada ACK delivery. Cek HP target._`
      }
      if (sent.health?.coldDmBlocked) {
        extra += `\n\n⚠️ Akun bot masih flag cold-DM terbatas — beberapa nomor bisa gagal diam-diam.`
      }

      await reply(
        `✅ *Menfess Terkirim!*\n\n` +
        `📱 Ke: ${resolved.num}\n` +
        `🔗 Via: ${sent.jid}\n` +
        `🕐 Baru saja` +
        extra
      )

      console.log(`[MENFESS] Private #${menfessId} from ${senderId} → ${sent.jid} (num=${resolved.num}) candidates=${candidates.join(',')}`)
    } catch (err) {
      console.error('[MENFESS] Error:', err.message)
      return reply(`❌ Gagal kirim menfess: ${err.message}`)
    }
    return
  }

  // ── .menfess (langsung di grup) ────────────────────────────
  if (!isGroup) {
    return reply('❌ Command `.menfess` hanya bisa di *Grup*.\nGunakan `.menfessp` di Private Chat untuk kirim ke nomor lain.')
  }

  if (!text) {
    return reply(
      `📮 *MENFESS GRUP*\n\n` +
      `Format: \`.menfess <pesan>\`\n\n` +
      `Contoh: \`.menfess Halo ini confession anonimku\`\n\n` +
      `Pesan akan dikirim anonim di grup ini.`
    )
  }

  if (text.length > config.maxLength) {
    return reply(`❌ Pesan terlalu panjang (max ${config.maxLength} karakter)`)
  }

  if (config.bannedUsers?.includes(senderId)) {
    return reply('❌ Kamu dibanned dari fitur menfess.')
  }

  const cooldown = checkCooldown(senderId, config.cooldownMs)
  if (!cooldown.allowed) {
    return reply(`⏳ Tunggu ${cooldown.remaining} detik sebelum kirim menfess lagi.`)
  }

  const menfessId = generateMenfessId()
  const confession = {
    id: menfessId,
    message: text,
    sender: senderId,
    senderName: msg.pushName || senderId,
    timestamp: Date.now(),
    targetGroup: from,
    isPrivate: false,
    status: 'sent'
  }

  menfessData.confessions.push(confession)
  menfessData.stats[senderId] = (menfessData.stats[senderId] || 0) + 1
  saveMenfessData(menfessData)

  const formattedMsg = formatMenfessMessage(confession)
  await sock.sendMessage(from, { text: formattedMsg })

  let groupName = 'grup ini'
  try {
    groupName = (await sock.groupMetadata(from)).subject
  } catch {}

  await reply(
    `✅ *Menfess Terkirim!*\n\n` +
    `📍 Grup: ${groupName}\n` +
    `🕐 Baru saja\n\n` +
    `_Pesanmu dikirim anonim ke grup ini_`
  )

  console.log(`[MENFESS] Group menfess #${menfessId} from ${senderId} in ${from}`)
}

// ─── ADMIN COMMANDS ───────────────────────────────────────────

export async function handleMenfessAdmin(sock, msg, text, command) {
  const from = msg.key.remoteJid
  const sender = msg.key.participant || msg.key.remoteJid
  const senderId = formatJid(sender)

  const isOwner = senderId === '62895618805248' || senderId === '83807763972304' || senderId === '110857451221063'
  if (!isOwner) return false

  const config = getConfig()
  const menfessData = getMenfessData()

  const reply = async (replyText) => {
    await sock.sendMessage(from, { text: replyText }, { quoted: msg })
  }

  switch (command) {
    case 'menfessban': {
      const target = text?.trim()
      if (!target) return reply('Format: `.menfessban <nomor>`')
      const targetId = normalizePhoneInput(target)
      if (!config.bannedUsers) config.bannedUsers = []
      if (!config.bannedUsers.includes(targetId)) {
        config.bannedUsers.push(targetId)
        saveConfig(config)
      }
      return reply(`✅ User ${targetId} dibanned dari menfess.`)
    }

    case 'menfessunban': {
      const target = text?.trim()
      if (!target) return reply('Format: `.menfessunban <nomor>`')
      const targetId = normalizePhoneInput(target)
      config.bannedUsers = config.bannedUsers?.filter(u => u !== targetId) || []
      saveConfig(config)
      return reply(`✅ User ${targetId} di-unban dari menfess.`)
    }

    case 'menfesslist': {
      const banned = config.bannedUsers?.length || 0
      const totalConfessions = menfessData.confessions?.length || 0
      const today = new Date().toDateString()
      const todayCount = menfessData.confessions?.filter(c =>
        new Date(c.timestamp).toDateString() === today
      ).length || 0

      return reply(
        `📊 *MENFESS STATS*\n\n` +
        `📝 Total Konfesi: ${totalConfessions}\n` +
        `📅 Hari Ini: ${todayCount}\n` +
        `🚫 Banned Users: ${banned}\n` +
        `⏱ Cooldown: ${config.cooldownMs / 1000} detik\n` +
        `📏 Max Length: ${config.maxLength} char`
      )
    }

    case 'menfesscooldown': {
      const seconds = parseInt(text?.trim() || '0')
      if (!seconds || seconds < 5) return reply('Format: `.menfesscooldown <detik>` (min 5)')
      config.cooldownMs = seconds * 1000
      saveConfig(config)
      return reply(`✅ Cooldown diatur ke ${seconds} detik.`)
    }

    case 'menfessmaxlen': {
      const len = parseInt(text?.trim() || '0')
      if (!len || len < 10) return reply('Format: `.menfessmaxlen <karakter>` (min 10)')
      config.maxLength = len
      saveConfig(config)
      return reply(`✅ Max panjang pesan: ${len} karakter.`)
    }
  }

  return false
}

export default {
  handleMenfess,
  handleMenfessAdmin
}
