import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import pino from 'pino'
import readline from 'readline'
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

import 'dotenv/config'
import { checkMLProfile, formatMLProfile } from './ml-profile.js'
import { handleSosmed } from './handler-sosmed.js'
import { handleDownload } from './handler-download.js'
import { getMenuText, getStartRedirectText } from './menu.js'
import restrictions from './restrictions.cjs'
const { isCommandAllowed, isRestrictedGroup, getAllowedCommands, restrictGroup, unrestrictGroup, addCommand, addCommandAll, removeCommand, removeCommandAll, listRestrictedGroups, getGlobalEnabledCommands, enableCommand, disableCommand } = restrictions
const memoryModule = (() => { try { return require('./memory.cjs') } catch (_) { return null } })()
const bridge = (() => { try { return require('./handler-hermes-bridge.cjs') } catch (_) { return null } })()
const sec = (() => { try { return require('./security.cjs') } catch (_) { return null } })()
import { handleSearch } from './handler-search.js'
import { handleMenfess } from './handler-menfess.js'
import { handleCrypto } from './handler-crypto.js'
import { handleAutoClip } from './handler-autoclip.js'
import {
  handleMarket,
  handleSaham,
  handleForex,
  handleTA,
  handleCrypto as handleCryptoMarket,
} from './handler-market.js'
import {
  handleDadu,
  handleKoin,
  handleSuit,
  handleTebak,
  handleKuis,
  handleJawab,
  handleGame,
} from './handler-game.js'
import { handleCekML, handleMLAcc, handleMLZone, handleMLMenu } from './handler-ml-cek.js'
// import { execute as imagineExec, handleImagine, handleAutoImagine } from "./handler-imagine.js"  // REMOVED: image generation disabled
import { handleWeather } from './handler-weather.js'
import { handleUpdate, handleRestart } from './handler-update.js'
import { handleMessage } from "./handler.js"
import { handleAutoDownload } from './handler-autodl.js'

const require = createRequire(import.meta.url)
const fileManager = require('./file-manager.cjs')
const aiUpdate = require('./handler-ai-update.cjs')
const hermesHandler = require('./handler-hermes.cjs')
const configHandler = require('./handler-config.cjs')
const botConfig = require('./config.cjs')
const format = require('./format.cjs')
const economy = require('./handler-economy.cjs')
const tools = require('./handler-tools.cjs')

// Bot version & metadata
const BOT_VERSION = '2.2.0'
const BOT_NAME = 'YANZYAHA-BOT'
const BOT_LIBRARY = 'Baileys'
const BOT_AI_ENGINE = 'Hermes Agent'

// Load runtime config overrides dari $HERMES_HOME/config.json
configHandler.loadConfig()
// Load per-user configs dari $HERMES_HOME/user_configs.json
configHandler.loadUserConfigs()

const PREFIX = '.'
let isReconnecting = false
const OWNER = '62895618805248'
const OWNER_LIDS = ['62895618805248', '83807763972304', '110857451221063']
const logger = pino({ level: 'silent' })

const WEATHER_API_KEY = process.env.WEATHER_API_KEY || ''

function tanya(pertanyaan) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(pertanyaan, ans => { rl.close(); resolve(ans.trim()) }))
}

// ─── GLOBAL ERROR SHIELDS (defense: bot never crashes, never loses WA session) ──
// Tanpa ini, satu unhandled rejection dari handler manapun akan kill Node process
// → Railway restart → WA session bisa ke-reset → user harus scan QR lagi.
//
// Tiap handler juga punya try/catch sendiri, tapi ini safety net global kalau ada
// yang bocor (mis. error dari library Baileys, fs, atau process async yang ga di-catch).
process.on('uncaughtException', (err, origin) => {
  console.error('[FATAL] uncaughtException — bot survived, no restart needed')
  console.error('  Message:', err?.message)
  console.error('  Stack:', err?.stack?.split('\n').slice(0, 5).join('\n'))
  console.error('  Origin:', origin)
  // JANGAN process.exit() — biarkan bot tetap jalan
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] unhandledRejection — bot survived')
  console.error('  Reason:', reason?.message || reason)
  if (reason?.stack) console.error('  Stack:', reason.stack.split('\n').slice(0, 5).join('\n'))
  // JANGAN process.exit()
})
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received — graceful exit')
  // Tutup socket dengan bersih kalau ada
  if (typeof sock !== 'undefined' && sock?.end) {
    try { sock.end() } catch {}
  }
  setTimeout(() => process.exit(0), 1000)
})
process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received — graceful exit')
  if (typeof sock !== 'undefined' && sock?.end) {
    try { sock.end() } catch {}
  }
  setTimeout(() => process.exit(0), 1000)
})

async function startBot() {
  // Auth path: $HERMES_HOME/auth (persistent volume di Railway).
  // Fallback ke ./auth kalo ga di-set (untuk dev lokal).
  const authPath = process.env.HERMES_HOME
    ? path.join(process.env.HERMES_HOME, 'auth')
    : './auth'
  // eslint-disable-next-line no-console
  console.log(`[auth] Using auth dir: ${authPath}`)
  const { state, saveCreds } = await useMultiFileAuthState(authPath)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    markOnlineOnConnect: false,
  })

  sock.ev.on('creds.update', saveCreds)

  if (!sock.authState.creds.registered) {
    console.log('ENV PHONE:', process.env.PHONE_NUMBER)
    let nomor = process.env.PHONE_NUMBER || await tanya('📱 Masukkan nomor WA kamu...')
    nomor = nomor.replace(/[^0-9]/g, '')
    if (nomor.startsWith('0')) nomor = '62' + nomor.slice(1)

    console.log(`\n✅ Nomor: ${nomor}`)
    console.log('⏳ Meminta kode pairing...\n')
    await new Promise(r => setTimeout(r, 3000))

    try {
      const code = await sock.requestPairingCode(nomor)
      console.log(`\n╔══════════════════════════╗`)
      console.log(`║  🔑 KODE PAIRING: ${code}  ║`)
      console.log(`╚══════════════════════════╝`)
      console.log('\n1. Buka WhatsApp')
      console.log('2. Titik 3 → Perangkat Tertaut')
      console.log('3. Tautkan dengan Nomor Telepon')
      console.log('4. Masukkan kode di atas\n')
    } catch (e) {
      console.log('❌ Gagal minta kode:', e.message)
    }
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode
      if (code === DisconnectReason.loggedOut) {
        console.log('🚫 Logout! Hapus folder auth/ lalu jalankan ulang.')
        process.exit(1)
      } else if (!isReconnecting) {
        isReconnecting = true
        console.log('🔄 Reconnect dalam 5 detik...')
        setTimeout(() => {
          isReconnecting = false
          startBot()
        }, 5000)
      }
    } else if (connection === 'open') {
      console.clear()
      console.log('╔════════════════════════════════╗')
      console.log('║   ✅ BOT BERHASIL TERHUBUNG!   ║')
      console.log('╚════════════════════════════════╝')
      console.log(`\n📱 Nomor : ${sock.user?.id?.split(':')[0]}`)
      console.log(`📛 Nama  : ${sock.user?.name}`)
      console.log('\n🤖 Bot siap!\n')
    }
  })

  
// ─── BANNED LIST ─────────────────────────────────────────────
const BANNED_FILE = './banned.json';
function loadBanned() {
  try { return JSON.parse(fs.readFileSync(BANNED_FILE, 'utf8')); } catch { return []; }
}
function saveBanned(list) {
  fs.writeFileSync(BANNED_FILE, JSON.stringify(list, null, 2));
}
// ─── USER LIST ─────────────────────────────────────────────
const USERS_FILE = './users.json';
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; }
}
function saveUser(lid, nomor) {
  const users = loadUsers();
  const clean = lid.replace(/@(lid|s\.whatsapp\.net)$/, '');
  if (!users[clean]) {
    users[clean] = { lid: clean, nomor: nomor || '', firstSeen: new Date().toISOString() };
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
}
function findLidByNomor(nomor) {
  const users = loadUsers();
  const cleanNomor = nomor.replace(/[^0-9]/g, '');
  const found = Object.values(users).find(u => u.nomor && u.nomor.replace(/[^0-9]/g, '') === cleanNomor);
  return found ? found.lid : null;
}

function isOwner(nomor) {
  const ownerLids = ['110857451221063', '83807763972304'];
  const clean = nomor.replace(/@(lid|s\.whatsapp\.net)$/, '');
  return ownerLids.includes(clean);
}

function isBanned(nomor) {
  // Support both @lid and @s.whatsapp.net format
  const num = nomor.replace(/@(lid|s\.whatsapp\.net)$/, "").replace(/[^0-9]/g, "");
  return loadBanned().some(b => b.replace(/@(lid|s\.whatsapp\.net)$/, "") === num);
}

sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    const msg = messages[0]
    if (!msg?.message || msg.key.fromMe) return

    // ─── OUTER TRY/CATCH + DIAGNOSTIC LOG (no more silent drop) ───
    // Tanpa ini, satu error di handler mana aja akan kill handler chain
    // → user ga dapet response, ga ada log yang nyebut error spesifik.
    // Sekarang: error apapun → fallback reply "⚠️ bot error" + log stack trace.
    try {
      const from = msg.key.remoteJid
      const isGroup = from.endsWith('@g.us')
      const sender = isGroup ? msg.key.participant : from
      const _logBody = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption || ''
      ).slice(0, 80)
      console.log(`📨 [ARRIVE] ${from} from=${sender} body="${_logBody}"`)

      console.log('[USER LID]', sender);
      // Catat user
      const senderNomor = sender ? sender.replace(/@(lid|s\.whatsapp\.net)$/, '') : '';
      saveUser(sender, senderNomor);

      // Log group JID (if applicable) — was missing before, caused confusion
      if (isGroup) {
        console.log('[GROUP JID]', from, '| sender=', sender, '| members via metadata on demand');
      }

      // Catat user

      // Cek banned
      if (sender && !isOwner(sender) && isBanned(sender)) { console.log('[BANNED] Blocked:', sender); return; }

    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption || ''

    const aiHandled = await aiUpdate.handle(sock, msg, botConfig.GEMINI_KEY, botConfig.GROQ_KEY)
    if (aiHandled) return
    const fmHandled = await fileManager.handle(sock, msg)
    if (fmHandled) return

    const sendText = async (t) => sock.sendMessage(from, { text: t }, { quoted: msg })

    // ================== SETMENU VIDEO ==================
    if (msg.message?.videoMessage && body.trim().toLowerCase() === '.setmenu') {
      const senderNum = sender.replace('@s.whatsapp.net','').replace('@lid','').split(':')[0]
      if (!OWNER_LIDS.includes(senderNum)) {
        await sendText('❌ Hanya owner yang bisa mengatur video menu!')
        return
      }
      try {
        const { downloadMediaMessage } = await import('@whiskeysockets/baileys')
        const { writeFileSync: wfs, mkdirSync } = await import('fs')
        mkdirSync('./assets', { recursive: true })
        const buffer = await downloadMediaMessage(msg, 'buffer', {})
        // Hapus file menu lama
        const { existsSync: ex, unlinkSync: ul } = await import('fs')
        if (ex('./assets/menu.mp4')) ul('./assets/menu.mp4')
        if (ex('./assets/menu.jpg')) ul('./assets/menu.jpg')
        wfs('./assets/menu.mp4', buffer)
        await sendText('✅ Video menu berhasil disimpan! File lama dihapus. Ketik .menu untuk cek.')
      } catch (err) {
        await sendText('❌ Gagal simpan video: ' + err.message)
      }
      return
    }
    // ================== END SETMENU ==================

    // ================== AUTO-DOWNLOAD (NO PREFIX) ==================
    // Detect URL di pesan TANPA prefix command.
    // - Private: trigger kalau body ada URL
    // - Group  : trigger cuma kalau message essentially cuma URL
    // - Supported: YouTube, TikTok, Twitter/X, Pinterest, Instagram (reel/reels/p/tv)
    // - Differentiator:
    //     plain URL              → full download
    //     "clip <url> <s> <e>"   → manual clip
    //     "auto <url>"           → AI autoclip (Gemini)
    //     "MM:SS <url>"          → clip 60 detik dari MM:SS
    if (body && !body.startsWith(PREFIX)) {
      const autoHandled = await handleAutoDownload(sock, msg, body, isGroup)
      if (autoHandled) return
    }
    // ================== END AUTO-DOWNLOAD ==================

    // ================== GROUP MEMORY (Meta AI style) ==================
    // Untuk grup di MEMORY_GROUPS whitelist:
    //   - Auto-record semua pesan
    //   - Saat bot di-@ atau user pakai .ai, bot respond pakai group context
    if (isGroup && memoryModule && memoryModule.MEMORY_GROUPS.has(from)) {
      // Record (non-blocking, error ga boleh stop flow lain)
      memoryModule.appendMessage(from, {
        sender,
        pushName: msg.pushName || null,
        body,
        isBot: false,
      }).catch(e => console.error('[MEMORY] record:', e.message))

      // Detect @bot atau .ai command
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
      const botNumber = (sock.user?.id || '').split(':')[0]
      const isMentioned = botNumber && mentioned.some(j => (j || '').includes(botNumber))
      const lowerBody = (body || '').toLowerCase().trim()
      const hasAiCmd = lowerBody === '.ai' || lowerBody.startsWith('.ai ')

      if ((isMentioned || hasAiCmd) && bridge) {
        let prompt = body
        if (hasAiCmd) prompt = body.replace(/^\.ai\s*/i, '').trim() || 'halo'

        // Skip kalau ini URL (sudah di-handle autodl)
        const isUrl = /^https?:\/\/\S+$/i.test(prompt.trim())
        if (!isUrl && prompt) {
          try {
            const userEnv = configHandler.getEffectiveEnv(sender)
            const reply = await bridge.handleGroupChat(sock, msg, prompt, sender, userEnv)
            if (reply) {
              await sendText(sec ? sec.redactSecrets(reply.slice(0, 4000)) : reply.slice(0, 4000))
              return
            }
          } catch (e) {
            console.error('[GROUP-CHAT]', e.message)
            await sendText('❌ ' + (sec ? sec.redactSecrets(e.message) : e.message))
            return
          }
        }
      }
    }
    // ================== END GROUP MEMORY ==================

    // ================== AI CHAT (Hermes Agent) ==================
    // Chat bebas di private chat → spawn Hermes subprocess.
    // Memory per-user via --resume session (persist di $HERMES_HOME).
    if (body && !body.startsWith(PREFIX)) {
      if (isGroup) return
      const userEnv = configHandler.getEffectiveEnv(sender)
      await hermesHandler.handleChat(sock, msg, body, sender, userEnv)
      return
    }
    // ================== END AI CHAT ==================


    if (!body.startsWith(PREFIX)) return

    const args = body.slice(PREFIX.length).trim().split(/\s+/)
    const command = args[0]?.toLowerCase()
    const text = args.slice(1).join(' ')

    // Group restriction check: silently ignore blocked commands in restricted groups.
    if (isGroup && command && !isCommandAllowed(from, command)) {
      return  // silent ignore
    }

    // Log: distinguish group vs private + show full JID (not just numeric prefix)
    const jidType = isGroup ? 'GROUP' : 'PRIVATE'
    const fromDisplay = isGroup
      ? `${from} (sender=${sender.split('@')[0]})`
      : sender.split('@')[0]
    console.log(`📩 [${jidType}] ${fromDisplay}: ${body}`)

    try {
      switch (command) {
        case 'menu':
        case 'help': {
          // Always send menu as TEXT (most reliable).
          // WhatsApp caption limit = 1024 chars, our menu is 2400+ chars.
          // Sending media + long caption → rejected silently, user sees nothing.
          // We do NOT use the video/image in assets/ for menu delivery anymore.
          // (If user wants a custom banner, use .setmenu video, but the menu
          //  text always goes as a separate message.)
          const fullText = getMenuText(msg)
          console.log('[MENU] Request from', from, 'isGroup:', isGroup, 'len=' + fullText.length)
          try {
            await sendText(fullText)
            console.log('[MENU] Sent OK to', from)
          } catch (menuErr) {
            console.error('[MENU] Send failed:', menuErr.message)
            // Fallback: send shorter version
            try {
              await sendText(fullText.slice(0, 2000) + '\n\n...(truncated, kirim .menu lagi buat part 2)')
            } catch {}
          }
          break
        }
        case 'ping': {
          const start = Date.now()
          await sendText(`🏓 *Pong!*\n⚡ Respon: ${Date.now() - start}ms`)
          break
        }
        case 'groupid':
        case 'groupinfo':
        case 'idgc': {
          if (!isGroup) {
            await sendText('⚠️ Command ini cuma buat di dalam grup.')
            break
          }
          // Show group metadata
          const groupMeta = await sock.groupMetadata(from).catch(() => null)
          const subject = groupMeta?.subject || '(unknown)'
          const desc = groupMeta?.desc || '(tidak ada deskripsi)'
          const memberCount = groupMeta?.participants?.length || 0
          const created = groupMeta?.creation
            ? new Date(groupMeta.creation * 1000).toLocaleDateString('id-ID', {
                day: 'numeric', month: 'long', year: 'numeric',
              })
            : '?'
          const ownerJid = groupMeta?.owner || '(tidak ada info owner)'
          const senderJid = sender

          // Try to resolve sender's phone number (works in non-LID groups)
          let senderDisplay = senderJid
          if (senderJid.includes('@s.whatsapp.net')) {
            senderDisplay = senderJid.split('@')[0]
          } else if (senderJid.includes('@lid')) {
            const real = groupMeta?.participants?.find(p => p.id === senderJid || p.lid === senderJid)
            if (real?.phoneNumber) senderDisplay = real.phoneNumber.split('@')[0]
            else senderDisplay = senderJid + ' (LID)'
          }

          const out = format.box('🆔 ' + subject, [
            { emoji: '👥', label: 'Members', value: memberCount + ' orang' },
            { emoji: '👤', label: 'Owner', value: ownerJid.split('@')[0] },
            { emoji: '📅', label: 'Dibuat', value: created },
            { emoji: '📝', label: 'Desc', value: desc.slice(0, 200) + (desc.length > 200 ? '…' : '') },
          ]) +
          '\n\n' +
          `📋 *Copy JID:*\n• Group: \`${from}\`\n• You:   \`${senderJid}\`` +
          '\n\n' +
          format.footer(`Phone kamu: ${senderDisplay}`)

          await sendText(out)
          break
        }
        case 'botinfo': {
          // Dynamic values — jangan hardcode!
          const activeModel = process.env.HERMES_MODEL
            || configHandler.getEffectiveEnv(sender)?.HERMES_MODEL
            || 'MiniMax-M3'
          const uptimeSec = Math.floor(process.uptime())
          const uptimeStr = uptimeSec < 60
            ? `${uptimeSec}d`
            : uptimeSec < 3600
              ? `${Math.floor(uptimeSec / 60)}m`
              : `${Math.floor(uptimeSec / 3600)}j ${Math.floor((uptimeSec % 3600) / 60)}m`

          const out = format.box('⚡ ' + BOT_NAME, [
            { emoji: '📌', label: 'Prefix', value: PREFIX },
            { emoji: '👤', label: 'Owner', value: 'wa.me/' + OWNER },
            { emoji: '⚙️', label: 'Library', value: BOT_LIBRARY },
            { emoji: '🤖', label: 'Model', value: activeModel },
            { emoji: '🟢', label: 'Status', value: `Online · ${uptimeStr}` },
            { emoji: '📦', label: 'Versi', value: BOT_VERSION },
          ])
          await sendText(out + format.footer(`Powered by ${BOT_NAME} + ${BOT_AI_ENGINE} 🧠`))
          break
        }
        case 'owner':
          await sendText(`👤 *Owner Bot*\nwa.me/${OWNER}`)
          break
        case 'search':
        case 'ddg':
          await handleSearch(sock, msg, text, command)
          break
        case 'searchhelp':
          await sendText(`Gunakan *${PREFIX}search [kata kunci]* untuk mencari di DuckDuckGo.`)
          break
        case 'ml': {
          const parts = text.replace(/[()]/g, '').trim().split(/\s+/)
          const userId = parts[0]
          const zoneId = parts[1]
          if (!userId || !zoneId) {
            return sendText(
              `❌ Format salah!\n\n` +
              `Cara pakai: *${PREFIX}ml [ID] [Zone]*\n` +
              `Contoh: *${PREFIX}ml 123456789 2107*\n\n` +
              `Ketik *${PREFIX}mlhelp* untuk panduan`
            )
          }
          await sendText('⏳ Sedang mengecek profil ML...')
          try {
            const data = await checkMLProfile(userId, zoneId)
            await sendText(formatMLProfile(data))
          } catch (err) {
            await sendText(`❌ ${err.message}`)
          }
          break
        }
        case 'mlacc':
        case 'mltaut':
          await handleMLAcc(sock, msg, body)
          break
        case 'mlzone':
          await handleMLZone(sock, msg)
          break
        case 'mlmenu':
          await handleMLMenu(sock, msg)
          break
        case 'cekml':
        case 'mlinfo':
          await handleCekML(sock, msg, body)
          break
        case 'mlhelp':
          await sendText(
            `📖 *Cara Cari ID dan Zone ML*\n\n` +
            `1. Buka Mobile Legends\n` +
            `2. Tap foto profil\n` +
            `3. Lihat angka di bawah nama\n\n` +
            `Format: *123456789 (2107)*\n` +
            `• 123456789 = ID\n` +
            `• 2107 = Zone\n\n` +
            `Contoh: *${PREFIX}ml 123456789 2107*`
          )
          break
        case 'ig':
        case 'tt':
        case 'gh':
        case 'roblox':
        case 'yt':
          await handleSosmed(sock, msg, text, command)
          break
        case 'ytdl':
case 'ytmp3':
case 'ttdl':
case 'twdl':
case 'xdl':
case 'pindl':
case 'igdl':
case 'fbdl':
case 'clip':
case 'dl':
case 'download':
case 'toaudio':
case 'tomp3':
  await handleDownload(sock, msg, text, command)
          break
        case 'autoclip':
        case 'clip':
          await handleAutoClip(sock, msg, text)
          break
        case 'market':
          await handleMarket(sock, msg)
          break
        case 'saham':
          await handleSaham(sock, msg, text)
          break
        case 'forex':
          await handleForex(sock, msg, text)
          break
        case 'ta':
          await handleTA(sock, msg, text)
          break
        case 'crypto':
          await handleCrypto(sock, msg, text, command)
          break
        case 'game':
          await handleGame(sock, msg)
          break
        case 'dadu':
          await handleDadu(sock, msg)
          break
        case 'koin':
          await handleKoin(sock, msg)
          break
        case 'suit':
          await handleSuit(sock, msg, text)
          break
        case 'tebak':
          await handleTebak(sock, msg, text)
          break
        case 'kuis':
          await handleKuis(sock, msg)
          break
        case 'jawab':
          await handleJawab(sock, msg, text)
          break
          
        // ═══════════════════════════════════════════════
        // ECONOMY & GAMES (NEW)
        // ═══════════════════════════════════════════════
        case 'daily': {
          const result = economy.claimDaily(sender)
          await sendText(result.message)
          break
        }
        case 'balance':
        case 'saldo':
        case 'bal': {
          const bal = economy.getBalance(sender)
          const user = economy.getUser(sender)
          const rank = economy.getRank(sender)
          const progressBar = economy.formatProgressBar(rank.progress, 10)
          const isOwnerUser = economy.isOwner(sender)
          
          // Owner shows unlimited
          const balDisplay = isOwnerUser ? '∞ *Unlimited*' : `💎 ${economy.formatNumber(bal)} poin`
          
          await sendText(
            `💰 *SALDO LO*\n\n` +
            `${balDisplay}\n` +
            `${rank.label}\n` +
            `📊 ${progressBar}\n` +
            `🎮 ${user.totalGames} game dimainkan\n` +
            `🏆 ${user.wins} menang | ${user.losses} kalah`
          )
          break
        }
        case 'pay':
        case 'transfer': {
          if (!text) { await sendText('❌ Contoh: .pay @user 100'); break }
          const parts = text.trim().split(/\s+/)
          const target = parts[0]?.replace(/[@+]/g, '')
          const amount = parseInt(parts[1])
          if (!target || isNaN(amount)) { await sendText('❌ Contoh: .pay 628xxx 100'); break }
          const result = economy.transfer(sender, target + '@s.whatsapp.net', amount)
          await sendText(result.message)
          break
        }
        case 'shop': {
          const items = economy.getShop()
          let shopText = '🛒 *SHOP*\n\n'
          items.forEach((item, i) => {
            shopText += `${item.emoji} ${item.name}\n`
            shopText += `   ${item.desc}\n`
            shopText += `   💰 ${economy.formatNumber(item.price)} poin\n\n`
          })
          shopText += `Ketik: .buy [item_id]\n`
          shopText += `Contoh: .buy shield`
          await sendText(shopText)
          break
        }
        case 'buy': {
          if (!text) { await sendText('❌ Contoh: .buy shield\nAtau: .buy shield 5 (beli 5 sekaligus)'); break }
          
          // Parse: .buy [item name] [quantity]
          const buyParts = text.trim().split(/\s+/)
          let quantity = 1
          let itemQuery = ''
          
          // Check if last part is a number (quantity)
          const lastPart = buyParts[buyParts.length - 1]
          if (/^\d+$/.test(lastPart) && buyParts.length > 1) {
            quantity = parseInt(lastPart)
            itemQuery = buyParts.slice(0, -1).join(' ')
          } else {
            itemQuery = text.trim()
          }
          
          if (quantity < 1) quantity = 1
          if (quantity > 100) quantity = 100
          
          const result = economy.buyItem(sender, itemQuery.toLowerCase(), quantity)
          await sendText(result.message)
          break
        }
        case 'slot': {
          const bet = parseInt(text) || 100
          const result = economy.playSlot(sender, bet)
          await sendText(result.message)
          break
        }
        case 'bj':
        case 'blackjack': {
          if (!text) { await sendText('❌ Contoh: .bj 100'); break }
          const result = economy.startBlackjack(sender, parseInt(text))
          await sendText(result.message)
          break
        }
        case 'hit': {
          const result = economy.hitBlackjack(sender)
          await sendText(result.message)
          break
        }
        case 'stand': {
          const result = economy.standBlackjack(sender)
          await sendText(result.message)
          break
        }
        case 'roulette':
        case 'roul': {
          if (!text) {
            await sendText(
              `🎡 *ROULETTE*\n\n` +
              `Cara: .roulette [pilihan] [bet]\n\n` +
              `Pilihan:\n` +
              `• merah/hitam (2x)\n` +
              `• genap/ganjil (2x)\n` +
              `• angka 0-36 (36x)\n\n` +
              `Contoh: .roulette merah 100`
            )
            break
          }
          const parts = text.trim().split(/\s+/)
          const choice = parts[0]
          const bet = parseInt(parts[1]) || 100
          const result = economy.playRoulette(sender, choice, bet)
          await sendText(result.message)
          break
        }
        case 'trivia': {
          if (text && ['A', 'B', 'C', 'D', 'a', 'b', 'c', 'd'].includes(text.trim().toUpperCase())) {
            const result = economy.answerTrivia(sender, text.trim())
            await sendText(result.message)
          } else {
            const result = economy.startTrivia(sender)
            await sendText(result.message)
          }
          break
        }
        case 'word': {
          if (text) {
            const result = economy.answerWordGame(sender, text.trim())
            await sendText(result.message)
          } else {
            const result = economy.startWordGame(sender)
            await sendText(result.message)
          }
          break
        }
        case 'startnum': {
          if (!isGroup) { await sendText('❌ Command ini cuma buat grup!'); break }
          const result = economy.startNumberGame(sender, from)
          await sendText(result.message)
          break
        }
        case 'guess': {
          if (!isGroup) { await sendText('❌ Command ini cuma buat grup!'); break }
          const num = parseInt(text)
          if (isNaN(num)) { await sendText('❌ Contoh: .guess 50'); break }
          const result = economy.guessNumber(sender, from, num)
          await sendText(result.message)
          break
        }
        case 'top':
        case 'leaderboard':
        case 'ranking': {
          const lb = economy.getLeaderboard(10)
          const { text: lbText, mentions } = economy.formatLeaderboard(lb)
          await sock.sendMessage(from, { text: lbText, mentions }, { quoted: msg })
          break
        }
        
        // ═══════════════════════════════════════════════
        // TOOLS (NEW)
        // ═══════════════════════════════════════════════
        case 'translate':
        case 'tr': {
          if (!text) {
            await sendText(
              `🌐 *TRANSLATE*\n\n` +
              `Cara: .tr [teks] [bahasa]\n\n` +
              `Contoh:\n` +
              `.tr hello world\n` +
              `.tr halo dunia en\n` +
              `.tr こんにちは ja\n\n` +
              `Auto-detect bahasa! Target default: Indonesia`
            )
            break
          }
          // Parse: .tr [text] [lang]
          const trParts = text.trim().split(/\s+/)
          let trText, trLang = 'id'
          
          // Check if last word is a language code
          const lastWord = trParts[trParts.length - 1].toLowerCase()
          if (tools.LANGUAGES[lastWord] && trParts.length > 1) {
            trLang = lastWord
            trText = trParts.slice(0, -1).join(' ')
          } else {
            trText = text
          }
          
          const result = await tools.translate(trText, trLang)
          await sendText(result.message)
          break
        }
        case 'calc':
        case 'kalkulator': {
          if (!text) { await sendText('❌ Contoh: .calc 2+2*3'); break }
          const result = tools.calculate(text)
          await sendText(result.message)
          break
        }
        case 'vn': {
          if (!text) {
            await sendText(
              `🎤 *VOICE NOTE*\n\n` +
              `Cara: .vn [teks]\n\n` +
              `Contoh: .vn hello world\n\n` +
              `Suara default: Ana (US Cute Girl)\n\n` +
              `Bahasa lain:\n` +
              `.vn id halo dunia\n` +
              `.vn ja こんにちは\n` +
              `.vn ko 안녕하세요\n\n` +
              `Semua bahasa: en, id, ja, ko, zh, es, fr, de, pt, ar, th, vi, ms, ru, it, tr, hi`
            )
            break
          }
          
          await sendText('🎤 Bikin voice note...')
          
          let vnText = text
          let voice = 'en-US-AnaNeural' // Default: suara imut English (Ana)
          
          // Check for language prefix
          const vnParts = text.split(/\s+/)
          const firstWord = vnParts[0].toLowerCase()
          if (tools.CUTE_VOICES[firstWord]) {
            voice = tools.CUTE_VOICES[firstWord].name
            vnText = vnParts.slice(1).join(' ')
          }
          
          const result = await tools.textToVoice(vnText, voice)
          if (result.success) {
            await sock.sendMessage(from, {
              audio: { url: result.path },
              mimetype: 'audio/ogg; codecs=opus',
              ptt: true // Push to talk = voice note
            }, { quoted: msg })
            // Cleanup
            try { fs.unlinkSync(result.path) } catch {}
          } else {
            await sendText(result.message)
          }
          break
        }
        case 'convert': {
          if (!text) {
            await sendText(
              `💱 *CURRENCY CONVERTER*\n\n` +
              `Cara: .convert [jumlah] [dari] to [ke]\n\n` +
              `Contoh:\n` +
              `• .convert 100 usd to idr\n` +
              `• .convert 1 btc to usd\n` +
              `• .convert 1 eth to btc\n` +
              `• .convert 500000 idr to usd\n\n` +
              `Supported crypto: btc, eth, sol, bnb, xrp, doge, ada, dot, etc.\n` +
              `Supported fiat: usd, idr, eur, jpy, gbp, cny, krw, sgd, myr, dll.`
            )
            break
          }

          const cvParts = text.trim().split(/\s+/)
          const cvAmount = parseFloat(cvParts[0])
          const cvFrom = cvParts[1]?.toLowerCase()
          const cvTo = cvParts[3]?.toLowerCase()

          if (isNaN(cvAmount) || !cvFrom || !cvTo || cvParts[2]?.toLowerCase() !== 'to') {
            await sendText('❌ Format salah! Contoh: .convert 100 usd to idr')
            break
          }

          const cryptoMap = {
            btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
            xrp: 'ripple', doge: 'dogecoin', ada: 'cardano', dot: 'polkadot',
            avax: 'avalanche-2', matic: 'matic-network', polygon: 'matic-network',
            link: 'chainlink', uni: 'uniswap', atom: 'cosmos',
            xlm: 'stellar', algo: 'algorand', near: 'near', ftm: 'fantom',
            trx: 'tron', shib: 'shiba-inu', ltc: 'litecoin',
            bch: 'bitcoin-cash', etc: 'ethereum-classic',
          }

          const fiatList = ['usd','idr','eur','jpy','gbp','cny','krw','sgd','myr','thb','vnd','php','inr','aud','cad','chf','hkd','twd','brl','mxn','zar','rub','try','ngn','pkr','egp']

          const isFromCrypto = !!cryptoMap[cvFrom]
          const isToCrypto = !!cryptoMap[cvTo]
          const isFromFiat = fiatList.includes(cvFrom)
          const isToFiat = fiatList.includes(cvTo)

          await sendText('💱 Menghitung...')

          try {
            if (isFromCrypto && isToCrypto) {
              const fromId = cryptoMap[cvFrom]
              const toId = cryptoMap[cvTo]
              const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${fromId},${toId}&vs_currencies=usd`)
              const data = await res.json()
              const fromPrice = data[fromId]?.usd
              const toPrice = data[toId]?.usd
              if (!fromPrice || !toPrice) throw new Error('Data harga tidak ditemukan')
              const cvRate = fromPrice / toPrice
              const cvResult = cvAmount * cvRate
              await sendText(
                `💱 *CONVERT*\n\n` +
                `${cvAmount} ${cvFrom.toUpperCase()} = ${cvResult.toFixed(8)} ${cvTo.toUpperCase()}\n\n` +
                `📊 1 ${cvFrom.toUpperCase()} = ${cvRate.toFixed(8)} ${cvTo.toUpperCase()}\n` +
                `💰 ${cvFrom.toUpperCase()}: $${fromPrice.toLocaleString()}\n` +
                `💰 ${cvTo.toUpperCase()}: $${toPrice.toLocaleString()}`
              )
            } else if (isFromCrypto && isToFiat) {
              const fromId = cryptoMap[cvFrom]
              const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${fromId}&vs_currencies=${cvTo}`)
              const data = await res.json()
              const price = data[fromId]?.[cvTo]
              if (!price) throw new Error('Data harga tidak ditemukan')
              const cvResult = cvAmount * price
              await sendText(
                `💱 *CONVERT*\n\n` +
                `${cvAmount} ${cvFrom.toUpperCase()} = ${cvTo.toUpperCase()} ${cvResult.toLocaleString('id-ID', { maximumFractionDigits: 2 })}\n\n` +
                `📊 1 ${cvFrom.toUpperCase()} = ${cvTo.toUpperCase()} ${price.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`
              )
            } else if (isFromFiat && isToCrypto) {
              const toId = cryptoMap[cvTo]
              const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${toId}&vs_currencies=${cvFrom}`)
              const data = await res.json()
              const price = data[toId]?.[cvFrom]
              if (!price) throw new Error('Data harga tidak ditemukan')
              const cvResult = cvAmount / price
              await sendText(
                `💱 *CONVERT*\n\n` +
                `${cvFrom.toUpperCase()} ${cvAmount.toLocaleString('id-ID')} = ${cvResult.toFixed(8)} ${cvTo.toUpperCase()}\n\n` +
                `📊 1 ${cvTo.toUpperCase()} = ${cvFrom.toUpperCase()} ${price.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`
              )
            } else if (isFromFiat && isToFiat) {
              const res = await fetch(`https://api.frankfurter.app/latest?amount=${cvAmount}&from=${cvFrom.toUpperCase()}&to=${cvTo.toUpperCase()}`)
              const data = await res.json()
              const cvResult = data.rates?.[cvTo.toUpperCase()]
              if (!cvResult) throw new Error('Data kurs tidak ditemukan')
              const cvRate = cvResult / cvAmount
              await sendText(
                `💱 *CONVERT*\n\n` +
                `${cvFrom.toUpperCase()} ${cvAmount.toLocaleString('id-ID')} = ${cvTo.toUpperCase()} ${cvResult.toLocaleString('id-ID', { maximumFractionDigits: 2 })}\n\n` +
                `📊 1 ${cvFrom.toUpperCase()} = ${cvRate.toFixed(4)} ${cvTo.toUpperCase()}\n` +
                `📅 Rate: ${data.date}`
              )
            } else {
              await sendText('❌ Mata uang tidak dikenali! Ketik .convert tanpa argumen untuk lihat daftar.')
            }
          } catch (cvErr) {
            await sendText(`❌ Gagal convert: ${cvErr.message}\n\nPastikan kode mata uang benar (contoh: usd, idr, btc, eth)`)
          }
          break
        }
        case 'cuaca':
        case 'weather':
          await handleWeather(sock, msg, text, WEATHER_API_KEY)
          break
        case 'menfess':
          await handleMenfess(sock, msg, text, command)
          break
        case 'update':
          await handleUpdate(sock, msg)
          break
        case 'restart':
          await handleRestart(sock, msg)
          break
        case 'teks':
          if (!text) return sendText(`❌ Contoh: ${PREFIX}teks Halo Dunia`)
          await sendText(text)
          break
                // ==================== AI CHAT (.ai alias untuk chat biasa) ====================
        // .ai dan .grok sekarang SAMA dengan chat bebas (handleChat).
        // Untuk grup di MEMORY_GROUPS, pakai bridge (group context).
        // Untuk private / grup biasa, pakai handler-hermes (per-user memory).
        case 'ai':
        case 'grok': {
          const queryText = text || (body.split(/\s+/).slice(1).join(' '))
          if (!queryText.trim()) return sendText(`Contoh: ${PREFIX}ai halo apa kabar?`)
          if (isGroup && bridge && memoryModule && memoryModule.MEMORY_GROUPS.has(from)) {
            // Group with memory: pakai bridge untuk group context
            try {
              const userEnv = configHandler.getEffectiveEnv(sender)
              const reply = await bridge.handleGroupChat(sock, msg, queryText, sender, userEnv)
              if (reply) await sendText(sec ? sec.redactSecrets(reply.slice(0, 4000)) : reply.slice(0, 4000))
            } catch (e) {
              await sendText('❌ ' + (sec ? sec.redactSecrets(e.message) : e.message))
            }
            return
          }
          const userEnv = configHandler.getEffectiveEnv(sender)
          await hermesHandler.handleChat(sock, msg, queryText, sender, userEnv)
          return
        }

        // ==================== MEMORY COMMANDS ====================
        // .start — di restricted group: redirect ke .menu. Di tempat lain: tampilkan menu.
        case 'start': {
          if (isGroup && isRestrictedGroup(from)) {
            const txt = getStartRedirectText(from)
            if (txt) {
              await sendText(txt)
              return
            }
          }
          // Fallback: tampilkan menu
          const senderNum = (sender || '').split('@')[0].split(':')[0]
          await sendText(getMenuText(msg, { isOwner: OWNER_LIDS.includes(senderNum) }))
          break
        }

        // .forget — hapus memory (group atau private)
        case 'forget': {
          if (isGroup && bridge) {
            await bridge.handleGroupReset(from)
            await sendText('🧹 *Memory grup ini udah dihapus!* ✅\n\nBot bakal mulai inget chat dari nol lagi ya kak.')
          } else {
            // Private: pakai handler-hermes.reset
            await hermesHandler.handleReset(sock, msg, sender)
          }
          break
        }

        // .memory — owner-only debug: liat memory stats
        case 'memory': {
          const senderNum = (sender || '').replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
          if (!OWNER_LIDS.includes(senderNum)) {
            await sendText('🔒 *Command ini khusus owner.*')
            return
          }
          if (isGroup && bridge && memoryModule) {
            const txt = await bridge.handleGroupMemory(from)
            await sendText(txt)
          } else if (memoryModule) {
            const stats = await memoryModule.getStats(sender)
            const out = format.box('🧠 Memory Private', [
              { emoji: '📊', label: 'Total', value: String(stats.totalMessages) },
              { emoji: '👤', label: 'User', value: String(stats.userMessages) },
              { emoji: '🤖', label: 'Bot', value: String(stats.botMessages) },
            ]) + format.footer('Memory ID: wa-' + senderNum)
            await sendText(out)
          } else {
            await sendText('❌ Memory module ga tersedia')
          }
          break
        }

        // ==================== GROUP RESTRICTION MANAGEMENT (owner only) ====================
        case 'restrictgroup': {
          const senderNum2 = (sender || '').replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
          if (!OWNER_LIDS.includes(senderNum2)) {
            await sendText('🔒 *Command ini khusus owner.*')
            return
          }
          if (!isGroup) {
            await sendText('❌ Command ini cuma bisa dipake di dalam grup.')
            return
          }
          if (isRestrictedGroup(from)) {
            await sendText('⚠️ Grup ini sudah terfilter. Gunakan `.listcmd` untuk lihat command yang diizinkan.')
            return
          }
          restrictGroup(from)
          await sendText(
            '✅ *Grup ini sekarang terfilter!*)\n\n' +
            'Hanya command yang diizinkan yang bisa dipake.\n' +
            '• `.addcmd <cmd>` — tambah command\n' +
            '• `.removecmd <cmd>` — hapus command\n' +
            '• `.listcmd` — liat daftar command\n' +
            '• `.unrestrictgroup` — hapus filter'
          )
          break
        }

        case 'unrestrictgroup': {
          const senderNum3 = (sender || '').replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
          if (!OWNER_LIDS.includes(senderNum3)) {
            await sendText('🔒 *Command ini khusus owner.*')
            return
          }
          if (!isGroup) {
            await sendText('❌ Command ini cuma bisa dipake di dalam grup.')
            return
          }
          if (!isRestrictedGroup(from)) {
            await sendText('⚠️ Grup ini tidak terfilter.')
            return
          }
          unrestrictGroup(from)
          await sendText('✅ *Filter grup ini dihapus!* Semua command sekarang tersedia.')
          break
        }

        case 'addcmd': {
          const senderNum4 = (sender || '').replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
          if (!OWNER_LIDS.includes(senderNum4)) {
            await sendText('🔒 *Command ini khusus owner.*')
            return
          }
          if (!isGroup) {
            await sendText('❌ Command ini cuma bisa dipake di dalam grup.')
            return
          }
          if (!text) {
            await sendText('⚠️ Contoh: `.addcmd download`\n\nGunakan `.listcmd` untuk lihat command yang sudah diizinkan.')
            return
          }
          const result = addCommand(from, text.trim())
          if (result.ok) {
            await sendText(`✅ Command *.${result.cmd}* ditambahkan ke grup ini!\n\nGunakan \`.listcmd\` untuk lihat daftar lengkap.`)
          } else {
            await sendText(`❌ ${result.reason}`)
          }
          break
        }

        case 'removecmd': {
          const senderNum5 = (sender || '').replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
          if (!OWNER_LIDS.includes(senderNum5)) {
            await sendText('🔒 *Command ini khusus owner.*')
            return
          }
          if (!isGroup) {
            await sendText('❌ Command ini cuma bisa dipake di dalam grup.')
            return
          }
          if (!text) {
            await sendText('⚠️ Contoh: `.removecmd download`')
            return
          }
          const result2 = removeCommand(from, text.trim())
          if (result2.ok) {
            await sendText(`✅ Command *.${result2.cmd}* dihapus dari grup ini!`)
          } else {
            await sendText(`❌ ${result2.reason}`)
          }
          break
        }

        case 'listcmd': {
          if (!isGroup) {
            await sendText('❌ Command ini cuma bisa dipake di dalam grup.')
            return
          }
          if (!isRestrictedGroup(from)) {
            await sendText('ℹ️ Grup ini *tidak terfilter*. Semua command tersedia.')
            return
          }
          const allowed = getAllowedCommands(from) || []
          const cmdList = allowed.map(c => `• \`.${c}\``).join('\n')
          await sendText(
            `📋 *Command yang diizinkan di grup ini:*\n\n${cmdList}\n\n` +
            `Total: *${allowed.length}* command\n\n` +
            (OWNER_LIDS.includes((sender || '').split('@')[0].split(':')[0])
              ? 'Owner: `.addcmd <cmd>` / `.removecmd <cmd>` untuk manage'
              : 'Hubungi owner untuk menambah/menghapus command')
          )
          break
        }

        case 'addcmdall': {
          const senderNum6 = (sender || '').replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
          if (!OWNER_LIDS.includes(senderNum6)) {
            await sendText('🔒 *Command ini khusus owner.*')
            return
          }
          if (!text) {
            await sendText('⚠️ Contoh: `.addcmdall sticker`\n\nTambah command ke SEMUA grup terfilter sekaligus.')
            return
          }
          const result3 = addCommandAll(text.trim())
          if (result3.ok) {
            await sendText(`✅ Command *.${result3.cmd}* ditambahkan ke *${result3.count}* grup terfilter!`)
          } else {
            await sendText(`❌ ${result3.reason}`)
          }
          break
        }

        case 'removecmdall': {
          const senderNum7 = (sender || '').replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
          if (!OWNER_LIDS.includes(senderNum7)) {
            await sendText('🔒 *Command ini khusus owner.*')
            return
          }
          if (!text) {
            await sendText('⚠️ Contoh: `.removecmdall sticker`\n\nHapus command dari SEMUA grup terfilter sekaligus.')
            return
          }
          const result4 = removeCommandAll(text.trim())
          if (result4.ok) {
            await sendText(`✅ Command *.${result4.cmd}* dihapus dari *${result4.count}* grup terfilter!`)
          } else {
            await sendText(`❌ ${result4.reason}`)
          }
          break
        }

        // ==================== GLOBAL CMD MANAGEMENT (owner only) ====================
        case 'enablecmd': {
          const senderNum8 = (sender || '').replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
          if (!OWNER_LIDS.includes(senderNum8)) {
            await sendText('🔒 *Command ini khusus owner.*')
            return
          }
          if (!text) {
            const enabled = getGlobalEnabledCommands()
            await sendText(
              '📢 *Command Aktif untuk Semua User*\n\n' +
              enabled.map(c => `• \`.${c}\``).join('\n') + '\n\n' +
              'Tambah: `.enablecmd <nama>`\n' +
              'Hapus: `.disablecmd <nama>`'
            )
            return
          }
          const res5 = enableCommand(text.trim())
          if (res5.ok) {
            await sendText(`✅ Command *.${res5.cmd}* sekarang aktif untuk SEMUA user di private chat!`)
          } else {
            await sendText(`❌ ${res5.reason}`)
          }
          break
        }

        case 'disablecmd': {
          const senderNum9 = (sender || '').replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
          if (!OWNER_LIDS.includes(senderNum9)) {
            await sendText('🔒 *Command ini khusus owner.*')
            return
          }
          if (!text) {
            await sendText('⚠️ Contoh: `.disablecmd sticker`')
            return
          }
          const res6 = disableCommand(text.trim())
          if (res6.ok) {
            await sendText(`✅ Command *.${res6.cmd}* dihapus dari menu global.`)
          } else {
            await sendText(`❌ ${res6.reason}`)
          }
          break
        }

        // ==================== CONFIG (per-user + global owner) ====================
        // Per-user: setapikey, setbaseurl, setmodel, models, myconfig, resetmyconfig
        // Owner-only: showconfig, resetconfig
        case 'setapikey':
        case 'setkey':
        case 'setbaseurl':
        case 'seturl':
        case 'setmodel':
        case 'showconfig':
        case 'cfg':
        case 'resetconfig':
        case 'cfgreset':
        case 'models':
        case 'myconfig':
        case 'mycfg':
        case 'myapikey':
        case 'mybaseurl':
        case 'mymodel':
        case 'mykeys':
        case 'resetmyconfig':
        case 'clearmyconfig':
        case 'apitest':
        case 'testapikey':
        case 'checkapi':
        case 'setglobalkey':
        case 'setglobalapikey':
        case 'setglobalurl':
        case 'setglobalbaseurl':
        case 'setglobalmodel':
        case 'setglobalhermesmodel':
        case 'showglobalconfig':
        case 'globalconfig':
        case 'globalcfg': {
          const handled = await configHandler.handle(sock, msg, body, sender)
          // handle() returns null kalau command ga match → biarin flow lanjut
          if (handled !== null) break
          return
        }


        case 'run': {
          if (!text) return sendText('❌ Contoh: .run ls')
          const { exec } = await import('child_process')
          exec(text, { timeout: 10000, cwd: process.cwd() }, async (err, stdout, stderr) => {
            const out = stdout || stderr || err?.message || '(tidak ada output)'
            await sendText('📟 Output:\n' + out.slice(0, 3000))
          })
          break
        }
        case 'banned': {
          if (!text) {
            const list = loadBanned();
            if (!list.length) return sendText('📋 Belum ada user yang dibanned.');
            return sendText('🚫 *Daftar Banned:*\n\n' + list.map((n,i) => (i+1) + '. ' + n.replace('@s.whatsapp.net','')).join('\n'));
          }
          const banNum = text.replace(/[^0-9]/g, '');
          if (!banNum) return sendText('❌ Nomor tidak valid');
          const banList = loadBanned();
          const banJid = banNum;
          if (isOwner(banJid)) return sendText('❌ Tidak bisa banned owner!');
          if (banList.includes(banJid)) return sendText('⚠️ User sudah dibanned sebelumnya.');
          banList.push(banJid);
          saveBanned(banList);
          await sendText('✅ @' + banNum + ' telah di-banned dari bot.', { mentions: [banJid] });
          break;
        }

        case 'users': {
          const users = loadUsers();
          const keys = Object.keys(users);
          if (!keys.length) return sendText('📋 Belum ada user yang tercatat.');
          const banned = loadBanned();
          let msg2 = '👥 *Daftar User:*\n\n';
          keys.forEach((lid, i) => {
            const isBan = banned.includes(lid) ? ' 🚫' : '';
            msg2 += (i+1) + '. ' + lid + isBan + '\n';
          });
          msg2 += '\n_🚫 = banned_';
          return sendText(msg2);
        }
        case 'unban': {
          if (!text) return sendText('❌ Format: .unban [nomor]');
          const unbanNum = text.replace(/[^0-9]/g, '');
          if (!unbanNum) return sendText('❌ Nomor tidak valid');
          const unbanJid = findLidByNomor(unbanNum) || unbanNum;
          const newList = loadBanned().filter(n => n !== unbanJid);
          saveBanned(newList);
          await sendText('✅ @' + unbanNum + ' telah di-unban.', { mentions: [unbanJid] });
          break;
        }

      default:
  await handleMessage(sock, msg)
  break
      }
    } catch (err) {
      console.error('Error:', err)
      await sendText(`❌ Error: ${err.message}`)
    }
    } catch (fatalErr) {
      console.error('💥 [FATAL-HANDLER]', fatalErr?.message)
      console.error('  Stack:', fatalErr?.stack?.split('\n').slice(0, 5).join('\n'))
      // Best-effort fallback reply — jangan throw lagi
      try {
        const errJid = msg.key.remoteJid
        await sock.sendMessage(errJid, {
          text: '⚠️ Bot error, coba lagi ya. (Error udah di-log, owner bisa cek Railway logs.)'
        }, {})
        console.log(`📤 [FALLBACK-REPLY] sent to ${errJid}`)
      } catch (sendErr) {
        console.error('💥 [FALLBACK-REPLY-FAIL]', sendErr?.message)
        console.error('  JID:', msg.key.remoteJid, '| fromMe:', msg.key.fromMe)
      }
    }
  })
}

console.log('\n🚀 Memulai WA Bot...\n')
startBot()
