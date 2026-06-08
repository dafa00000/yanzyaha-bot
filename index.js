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

import 'dotenv/config'
import { checkMLProfile, formatMLProfile } from './ml-profile.js'
import { handleSosmed } from './handler-sosmed.js'
import { handleDownload } from './handler-download.js'
import { getMenuText } from './menu.js'
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
import { execute as imagineExec, handleImagine, handleAutoImagine } from "./handler-imagine.js"
import { handleWeather } from './handler-weather.js'
import { handleUpdate, handleRestart } from './handler-update.js'
import { handleMessage } from "./handler.js"

const require = createRequire(import.meta.url)
const fileManager = require('./file-manager.cjs')
const aiUpdate = require('./handler-ai-update.cjs')
const botConfig = require('./config.cjs')

const PREFIX = '.'
const chatHistory = new Map()
let isReconnecting = false
const OWNER = '62895618805248'
const OWNER_LIDS = ['62895618805248', '83807763972304', '110857451221063']
const logger = pino({ level: 'silent' })

const WEATHER_API_KEY = process.env.WEATHER_API_KEY || ''

function tanya(pertanyaan) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(pertanyaan, ans => { rl.close(); resolve(ans.trim()) }))
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
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

    const from = msg.key.remoteJid
    const isGroup = from.endsWith('@g.us')
    const sender = isGroup ? msg.key.participant : from

    console.log('[USER LID]', sender);
    // Catat user
    const senderNomor = sender ? sender.replace(/@(lid|s\.whatsapp\.net)$/, '') : '';
    saveUser(sender, senderNomor);

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

    // ================== AUTO IMAGE DETECT ==================
    const autoImg = await handleAutoImagine(sock, msg, body)
    if (autoImg) return

    // ================== AI CHAT REALISTIS (Tanpa Perlu .ai) ==================
    if (body && !body.startsWith(PREFIX)) {
      if (isGroup) return

      const today = new Date().toISOString().slice(0, 10)
      if (!chatHistory.has(sender)) chatHistory.set(sender, { messages: [], date: today, count: 0 })
      const userData = chatHistory.get(sender)

      if (userData.date !== today) {
        userData.messages = []
        userData.count = 0
        userData.date = today
      }

      const DAILY_LIMIT = 100
      if (userData.count >= DAILY_LIMIT) {
        await sendText('⚠️ Limit chat harian kamu sudah habis (100 pesan). Coba lagi besok ya! 😊')
        return
      }

      if (body.trim().toLowerCase() === '.reset' || body.trim().toLowerCase() === 'reset') {
        userData.messages = []
        userData.count = 0
        await sendText('🔄 Percakapan direset! Kita mulai dari awal ya 😊')
        return
      }

      await sendText('🤖 Sedang berpikir...')

      try {
        const OpenAI = (await import('openai')).default
        const groq = new OpenAI({
          apiKey: process.env.GROQ_API_KEY,
          baseURL: 'https://api.groq.com/openai/v1'
        })

        userData.messages.push({ role: 'user', content: body })
        userData.count++

        if (userData.messages.length > 100) userData.messages = userData.messages.slice(-100)

        const response = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'Kamu adalah teman yang asik, ramah, santai, dan sedikit humoris. Jawab pakai bahasa Indonesia se-natural mungkin seperti orang biasa ngobrol. Ingat konteks percakapan sebelumnya.'
            },
            ...userData.messages
          ],
          temperature: 0.85,
          max_tokens: 700
        })

        const aiReply = response.choices[0]?.message?.content || 'Maaf, aku lagi blank nih.'
        userData.messages.push({ role: 'assistant', content: aiReply })
        await sendText(aiReply)

      } catch (err) {
        console.error('[GROQ ERROR]', err.message)
        await sendText('❌ Lagi sibuk nih, coba beberapa saat lagi ya 😊')
      }
      return
    }
    // ================== END AI CHAT ==================


    if (!body.startsWith(PREFIX)) return

    const args = body.slice(PREFIX.length).trim().split(/\s+/)
    const command = args[0]?.toLowerCase()
    const text = args.slice(1).join(' ')
    console.log(`📩 [${isGroup ? 'Group' : 'Private'}] ${sender.split('@')[0]}: ${body}`)

    try {
      switch (command) {
        case 'menu':
        case 'help': {
          const { readFileSync: rfs } = await import('fs')
          const { existsSync, unlinkSync } = await import('fs')
          const vidPath = './assets/menu.mp4'
          const imgPath = './assets/menu.jpg'
          if (existsSync(vidPath)) {
            await sock.sendMessage(from, {
              video: rfs(vidPath),
              caption: getMenuText(sender),
              gifPlayback: false
            }, { quoted: msg })
          } else if (existsSync(imgPath)) {
            await sock.sendMessage(from, {
              image: rfs(imgPath),
              caption: getMenuText(sender)
            }, { quoted: msg })
          } else {
            await sendText(getMenuText(sender))
          }
          break
        }
        case 'ping': {
          const start = Date.now()
          await sendText(`🏓 *Pong!*\n⚡ Respon: ${Date.now() - start}ms`)
          break
        }
        case 'botinfo':
          await sendText(
            `◈━━━━━━━━━━━━━━━━━━━━━━━━◈\n` +
            `      ⚡ *YANZYAHA-BOT* ⚡\n` +
            `◈━━━━━━━━━━━━━━━━━━━━━━━━◈\n\n` +
            `╭────────────────────────╮\n` +
            `│ 📌 *Prefix  :* ${PREFIX}              │\n` +
            `│ 👤 *Owner   :* wa.me/${OWNER} │\n` +
            `│ ⚙️  *Library :* Baileys        │\n` +
            `│ 🤖 *Model   :* Llama 3.3 70B  │\n` +
            `│ 🟢 *Status  :* Online          │\n` +
            `│ 📦 *Versi   :* 2.1.0           │\n` +
            `╰────────────────────────╯\n\n` +
            `_Powered by YANZYAHA-BOT_ ⚡` +
            `_SUPPORT by CLAUDE AI FT GROQ AI_ ⚡`
          )
          break
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
case 'clip':
case 'dl':
case 'download':
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
        case 'imagine':
        case 'img':
        case 'generate':
        case 'gen':
          await handleImagine(sock, msg, body)
          break
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
                // ==================== AI GROQ (Gratis & Cepat) ====================
        case 'ai':
        case 'grok': {
          if (!text) {
            return sendText('⚠️ Masukkan pertanyaan!\nContoh: `.ai halo apa kabar?`');
          }

          await sendText('🤖 Groq sedang berpikir...');

          try {
            const OpenAI = (await import('openai')).default;
            const groq = new OpenAI({
              apiKey: process.env.GROQ_API_KEY,
              baseURL: "https://api.groq.com/openai/v1"
            });

            const response = await groq.chat.completions.create({
              model: "llama-3.3-70b-versatile",     // Model bagus & cepat
              // model: "mixtral-8x7b-32768",       // Alternatif
              messages: [
                { 
                  role: "system", 
                  content: "Kamu adalah asisten AI yang ramah, santai, lucu, dan super membantu. Jawab dalam bahasa Indonesia yang natural." 
                },
                { role: "user", content: text }
              ],
              temperature: 0.8,
              max_tokens: 800
            });

            const aiReply = response.choices[0]?.message?.content || "Maaf, aku bingung nih.";
            await sendText(aiReply);

          } catch (err) {
            console.error('[GROQ ERROR]', err.message);
            await sendText("❌ Groq lagi sibuk. Coba lagi bentar ya 😊");
          }
          break;
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
  })
}

console.log('\n🚀 Memulai WA Bot...\n')
startBot()
