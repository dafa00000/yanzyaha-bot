import { downloadMediaMessage, proto } from '@whiskeysockets/baileys'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { makeSticker, stickerToImage } from './src/features/sticker.js'
import { downloadYoutube } from './src/features/youtube.js'
import { downloadTiktok } from './src/features/tiktok.js'
import { getInfo } from './src/features/info.js'
import { checkMLProfile, formatMLProfile } from './src/features/mobilelegends.js'


const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEMP = path.join(__dirname, '../../temp')

/**
 * Ambil teks dari berbagai tipe pesan
 */
function getMessageText(msg) {
  const m = msg.message
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    m?.documentMessage?.caption ||
    ''
  ).trim()
}

/**
 * Cek apakah pesan berisi media
 */
function getMediaType(msg) {
  const m = msg.message
  if (m?.imageMessage) return 'image'
  if (m?.videoMessage) return 'video'
  if (m?.stickerMessage) return 'sticker'
  if (m?.audioMessage) return 'audio'
  if (m?.documentMessage) return 'document'
  return null
}

/**
 * Kirim reply teks
 */
async function reply(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
}

/**
 * Kirim react emoji
 */
async function react(sock, msg, emoji) {
  return sock.sendMessage(msg.key.remoteJid, {
    react: { text: emoji, key: msg.key }
  })
}

/**
 * Handler utama semua pesan masuk
 */
export async function handleMessage(sock, msg) {
  const jid = msg.key.remoteJid
  const text = getMessageText(msg)
  const mediaType = getMediaType(msg)
  const isGroup = jid.endsWith('@g.us')
  const pushName = msg.pushName || 'User'

  // Log pesan masuk
  console.log(chalk.gray(`[${new Date().toLocaleTimeString()}]`), chalk.blue(pushName), chalk.gray('→'), chalk.white(text || `[${mediaType}]`))

  // Prefix command
  const prefix = '.'
  if (!text.startsWith(prefix) && mediaType !== 'sticker') return

  const args = text.slice(prefix.length).trim().split(/\s+/)
  const command = args[0]?.toLowerCase()
 const param = args.slice(1).join(' ')

  try {
    switch (command) {

      // ==================== MENU ====================
      case 'menu':
      case 'help':
      case 'start': {
        const menuText = `╔══════════════════════╗
║     🤖 YANZYAHA-BOT    ║
╚══════════════════════╝

📌 *INFO & TOOLS*
• .menu — Tampilkan menu ini
• .ping — Cek status bot
• .info — Info bot
• .owner — Kontak owner

🖼️ *STIKER & GAMBAR*
• .sticker / .s — Buat stiker dari foto/video
• .toimg — Ubah stiker jadi foto
• .toimage — (sama dengan .toimg)

📥 *DOWNLOAD*
• .yt (link) — Download video YouTube
• .ytmp3 (link) — Download audio YouTube
• .tt (link) — Download video TikTok
- .clip [link] [mulai] [akhir] — ✂️ Potong/clip video

🎮 *MOBILE LEGENDS*
• .ml [ID] [Zone] — Cek profil & winrate ML
• .mlhelp — Cara cari ID dan Zone ML

📝 *LAINNYA*
• .teks (pesan) — Echo pesan kamu

_Prefix: titik (.)_
_Contoh: .ml 123456789 2107_`

        await reply(sock, msg, menuText)
        break
      }

      // ==================== PING ====================
      case 'ping': {
        const start = Date.now()
        const m = await reply(sock, msg, '🏓 Pong!')
        const end = Date.now()
        await reply(sock, msg, `🏓 *Pong!*\n⚡ Latensi: ${end - start}ms`)
        break
      }

      // ==================== INFO ====================
      case 'info': {
        const infoText = `*🤖 INFO BOT*

• Nama: YANZYAHA-BOT
• Versi: 1.0.0
• Library: @whiskeysockets/baileys
• Runtime: Node.js ${process.version}
• Uptime: ${formatUptime(process.uptime())}

_Bot ini open source!_`
        await reply(sock, msg, infoText)
        break
      }

      // ==================== OWNER ====================
      case 'owner': {
        await reply(sock, msg, '👤 *Owner Bot*\n\nHubungi owner melalui nomor yang tertera di README.')
        break
      }

      // ==================== STICKER ====================
      case 'sticker':
      case 's': {
        // Buat stiker dari gambar/video yang di-quote atau dikirim langsung
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
        const hasMedia = mediaType === 'image' || mediaType === 'video'
        const hasQuotedMedia = quoted?.imageMessage || quoted?.videoMessage

        if (!hasMedia && !hasQuotedMedia) {
          await reply(sock, msg, '⚠️ Kirim/reply foto atau video dengan caption *.sticker*')
          break
        }

        await react(sock, msg, '⏳')

        let buffer
        if (hasMedia) {
          buffer = await downloadMediaMessage(msg, 'buffer', {})
        } else {
          // Download dari quoted message
          const fakeMsg = { message: quoted, key: msg.key }
          buffer = await downloadMediaMessage(fakeMsg, 'buffer', {})
        }

        const stickerBuf = await makeSticker(buffer)
        await sock.sendMessage(jid, { sticker: stickerBuf }, { quoted: msg })
        await react(sock, msg, '✅')
        break
      }

      // ==================== STIKER → GAMBAR ====================
      case 'toimg':
      case 'toimage': {
        const quotedSticker = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage
        const isSticker = mediaType === 'sticker'

        if (!isSticker && !quotedSticker) {
          await reply(sock, msg, '⚠️ Kirim/reply stiker dengan caption *.toimg*')
          break
        }

        await react(sock, msg, '⏳')

        let buffer
        if (isSticker) {
          buffer = await downloadMediaMessage(msg, 'buffer', {})
        } else {
          const fakeMsg = {
            message: { stickerMessage: quotedSticker },
            key: msg.key
          }
          buffer = await downloadMediaMessage(fakeMsg, 'buffer', {})
        }

        const imgBuf = await stickerToImage(buffer)
        await sock.sendMessage(jid, {
          image: imgBuf,
          caption: '✅ Stiker berhasil dikonversi!'
        }, { quoted: msg })
        await react(sock, msg, '✅')
        break
      }

      // ==================== YOUTUBE VIDEO ====================
      case 'yt':
      case 'youtube': {
        if (!param) {
          await reply(sock, msg, '⚠️ Masukkan link YouTube!\nContoh: *.yt https://youtu.be/xxx*')
          break
        }
        await react(sock, msg, '⏳')
        await reply(sock, msg, '📥 Sedang mendownload video YouTube...')
        try {
          const result = await downloadYoutube(param, 'video')
          await sock.sendMessage(jid, {
            video: { url: result.path },
            caption: `✅ *${result.title}*\n⏱️ ${result.duration}`
          }, { quoted: msg })
          fs.unlinkSync(result.path)
          await react(sock, msg, '✅')
        } catch (e) {
          await react(sock, msg, '❌')
          await reply(sock, msg, `❌ Gagal download: ${e.message}`)
        }
        break
      }

      // ==================== YOUTUBE MP3 ====================
      case 'ytmp3':
      case 'mp3': {
        if (!param) {
          await reply(sock, msg, '⚠️ Masukkan link YouTube!\nContoh: *.ytmp3 https://youtu.be/xxx*')
          break
        }
        await react(sock, msg, '⏳')
        await reply(sock, msg, '🎵 Sedang mendownload audio YouTube...')
        try {
          const result = await downloadYoutube(param, 'audio')
          await sock.sendMessage(jid, {
            audio: { url: result.path },
            mimetype: 'audio/mpeg',
            fileName: `${result.title}.mp3`
          }, { quoted: msg })
          fs.unlinkSync(result.path)
          await react(sock, msg, '✅')
        } catch (e) {
          await react(sock, msg, '❌')
          await reply(sock, msg, `❌ Gagal download: ${e.message}`)
        }
        break
      }

      // ==================== TIKTOK ====================
      case 'tt':
      case 'tiktok': {
        if (!param) {
          await reply(sock, msg, '⚠️ Masukkan link TikTok!\nContoh: *.tt https://vt.tiktok.com/xxx*')
          break
        }
        await react(sock, msg, '⏳')
        await reply(sock, msg, '📥 Sedang mendownload video TikTok...')
        try {
          const result = await downloadTiktok(param)
          await sock.sendMessage(jid, {
            video: { url: result.url },
            caption: `✅ ${result.title || 'Video TikTok'}`
          }, { quoted: msg })
          await react(sock, msg, '✅')
        } catch (e) {
          await react(sock, msg, '❌')
          await reply(sock, msg, `❌ Gagal download: ${e.message}`)
        }
        break
      }

      
      // ==================== TWITTER/X ====================
      case 'twdl':
      case 'xdl': {
        if (!param) { await reply(sock, msg, '⚠️ Masukkan link Twitter/X!\nContoh: *.twdl https://x.com/user/status/xxx*'); break }
        await react(sock, msg, '⏳')
        await reply(sock, msg, '📥 Sedang mendownload dari Twitter/X...')
        try {
          const { execSync } = await import('child_process')
          const fp = `tmp/${Date.now()}.mp4`
          execSync(`yt-dlp -f "best[height<=720]" -o "${fp}" "${param}"`, { timeout: 120000 })
          await sock.sendMessage(jid, { video: fs.readFileSync(fp), caption: '🐦 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
          fs.unlinkSync(fp)
          await react(sock, msg, '✅')
        } catch (e) {
          await react(sock, msg, '❌')
          await reply(sock, msg, `⚠️ Gagal. Download manual:\n🔗 https://cobalt.tools\n\nPaste link ini:\n${param}`)
        }
        break
      }

      // ==================== PINTEREST ====================
      case 'pindl': {
        if (!param) { await reply(sock, msg, '⚠️ Masukkan link Pinterest!\nContoh: *.pindl https://pin.it/xxx*'); break }
        await react(sock, msg, '⏳')
        await reply(sock, msg, '📥 Sedang mendownload dari Pinterest...')
        try {
          const { execSync } = await import('child_process')
          const fp = `tmp/${Date.now()}.mp4`
          execSync(`yt-dlp -f "best[height<=720]" -o "${fp}" "${param}"`, { timeout: 120000 })
          await sock.sendMessage(jid, { video: fs.readFileSync(fp), caption: '📌 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
          fs.unlinkSync(fp)
          await react(sock, msg, '✅')
        } catch (e) {
          await react(sock, msg, '❌')
          await reply(sock, msg, `⚠️ Gagal. Download manual:\n🔗 https://cobalt.tools\n\nPaste link ini:\n${param}`)
        }
        break
      }

      // ==================== LINK UMUM ====================
      // ==================== CLIP VIDEO ====================
      case 'clip': {
        const cParts = param.trim().split(/\s+/)
        const cUrl   = cParts[0]
        const cStart = cParts[1]
        const cEnd   = cParts[2]

        if (!cUrl || !cStart || !cEnd) {
          await reply(sock, msg,
            '⚠️ *Format salah!*\n\n' +
            '*.clip [link] [mulai] [akhir]*\n\n' +
            '*Contoh:*\n' +
            '`.clip https://youtu.be/xxx 01:30 02:45`\n' +
            '`.clip https://youtu.be/xxx 1:30:00 1:32:00`\n\n' +
            '📝 Format waktu: `MM:SS` atau `HH:MM:SS`\n' +
            '⚠️ Maks durasi clip: 10 menit'
          )
          break
        }

        const startSec = timeToSec(cStart)
        const endSec   = timeToSec(cEnd)
        const clipDur  = endSec - startSec

        if (clipDur <= 0) {
          await reply(sock, msg, '❌ Waktu akhir harus lebih besar dari waktu mulai!')
          break
        }
        if (clipDur > 600) {
          await reply(sock, msg, '⚠️ Durasi clip maksimal 10 menit!\nPerkecil rentang waktumu.')
          break
        }

        await react(sock, msg, '⏳')
        await reply(sock, msg,
          `📥 *Langkah 1/2:* Mengunduh video...\n` +
          `⏱️ Target clip: ${cStart} → ${cEnd}`
        )

        try {
          const { exec: cpExec } = await import('child_process')
          const { promisify }    = await import('util')
          const execA = promisify(cpExec)

          const ts       = Date.now()
          const tmpFile  = `tmp/${ts}_full.mp4`
          const clipFile = `tmp/${ts}_clip.mp4`

          // Step 1: Download
          await execA(
            `yt-dlp -f "best[ext=mp4]/best" --merge-output-format mp4 --no-playlist -o "${tmpFile}" "${cUrl}"`,
            { timeout: 180000 }
          )

          // Step 2: Clip dengan ffmpeg
          await reply(sock, msg, `✂️ *Langkah 2/2:* Memotong ${cStart} → ${cEnd}...`)
          await execA(
            `ffmpeg -i "${tmpFile}" -ss ${cStart} -to ${cEnd} -c:v libx264 -c:a aac "${clipFile}" -y`,
            { timeout: 60000 }
          )

          const stats  = fs.statSync(clipFile)
          const sizeMB = (stats.size / 1024 / 1024).toFixed(1)

          if (stats.size > 67108864) {
            await reply(sock, msg, `❌ Clip terlalu besar (${sizeMB} MB).\nCoba perkecil rentang waktu.`)
          } else {
            await sock.sendMessage(jid, {
              video: fs.readFileSync(clipFile),
              caption: `✂️ *Clip Berhasil!*\n⏱️ ${cStart} → ${cEnd}\n📦 ${sizeMB} MB`,
              mimetype: 'video/mp4'
            }, { quoted: msg })
            await react(sock, msg, '✅')
          }

          try { fs.unlinkSync(tmpFile)  } catch {}
          try { fs.unlinkSync(clipFile) } catch {}

        } catch (clipErr) {
          await react(sock, msg, '❌')
          await reply(sock, msg,
            `❌ *Gagal clip video!*\n\n` +
            `${clipErr.message}\n\n` +
            `💡 Pastikan ffmpeg terinstall:\n\`pkg install ffmpeg\``
          )
          try { fs.unlinkSync(`tmp/${Date.now()}_full.mp4`)  } catch {}
          try { fs.unlinkSync(`tmp/${Date.now()}_clip.mp4`) } catch {}
        }
        break
      }
      case 'dl': {
        if (!param || !param.startsWith('http')) { await reply(sock, msg, '⚠️ Masukkan link valid!\nContoh: *.dl https://contoh.com/video*'); break }
        await react(sock, msg, '⏳')
        await reply(sock, msg, '📥 Mencoba mengunduh...')
        try {
          const { execSync } = await import('child_process')
          const fp = `tmp/${Date.now()}.mp4`
          execSync(`yt-dlp -f "best[height<=720]" -o "${fp}" "${param}"`, { timeout: 120000 })
          await sock.sendMessage(jid, { video: fs.readFileSync(fp), caption: '📥 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
          fs.unlinkSync(fp)
          await react(sock, msg, '✅')
        } catch (e) {
          await react(sock, msg, '❌')
          await reply(sock, msg, `⚠️ Gagal. Download manual:\n🔗 https://cobalt.tools\n\nPaste link ini:\n${param}`)
        }
        break
      }

      // ==================== TEKS ECHO ====================
      case 'teks': {
        if (!param) {
          await reply(sock, msg, '⚠️ Masukkan teks!\nContoh: *.teks halo dunia*')
          break
        }
        await reply(sock, msg, param)
        break
      }

      // ==================== AI GROK ====================
      case 'ai': {
        if (!param) {
          await reply(sock, msg, '⚠️ Ketik pertanyaan setelah .ai\nContoh: *.ai halo apa kabar?*');
          break;
        }

        try {
          await react(sock, msg, '🤖');
          await reply(sock, msg, '🤖 Grok sedang berpikir...');

          const response = await openai.chat.completions.create({
            model: "grok-4",
            messages: [
              { 
                role: "system", 
                content: "Kamu adalah asisten AI ramah, santai, dan lucu. Jawab pakai bahasa Indonesia yang natural." 
              },
              { role: "user", content: param }
            ],
            temperature: 0.85,
            max_tokens: 800
          });

          const aiReply = response.choices[0]?.message?.content || "Maaf, aku tidak bisa menjawab saat ini.";

          await reply(sock, msg, aiReply);
          await react(sock, msg, '✅');

        } catch (err) {
          console.error('[AI ERROR]', err.message);
          await reply(sock, msg, "❌ Grok sedang sibuk. Coba lagi nanti ya 😊");
        }
        break;
      }

      // ==================== MOBILE LEGENDS ====================
      case 'ml':
      case 'mobilelegend':
      case 'mlbb': {
        const parts = param.trim().split(/\s+/)
        const mlId   = parts[0]
        const mlZone = parts[1] || '2107'

        if (!mlId) {
          await reply(sock, msg, `⚠️ Format salah!\n\nCara pakai:\n*.ml [ID] [Zone]*\n\nContoh:\n*.ml 123456789 2107*\n\n_Zone Indonesia = 2107_\nKetik *.mlhelp* untuk panduan cari ID`)
          break
        }

        await react(sock, msg, '⏳')
        await reply(sock, msg, `🔍 Mencari profil ML...\nID: ${mlId} | Zone: ${mlZone}`)

        try {
          const data = await checkMLProfile(mlId, mlZone)
          const text = formatMLProfile(data)
          await reply(sock, msg, text)
          await react(sock, msg, '✅')
        } catch (e) {
          await react(sock, msg, '❌')
          await reply(sock, msg, `❌ ${e.message}`)
        }
        break
      }

      // ==================== ML HELP ====================
      case 'mlhelp': {
        const helpText = `📖 *CARA CEK PROFIL MOBILE LEGENDS*

*Langkah cari ID & Zone:*
1. Buka Mobile Legends
2. Tap foto profil kamu
3. Tap ikon *copy* di bawah nickname
4. ID dan Zone akan tersalin

*Format command:*
*.ml [ID] [Zone]*

*Contoh:*
• .ml 123456789 2107
• .ml 987654321 5109

*Zone umum Indonesia:*
• 2107, 5109, 5110, 5111, 5112

_Winrate yang ditampilkan adalah ranked season ini_`
        await reply(sock, msg, helpText)
        break
      }

      // ==================== COMMAND TIDAK DIKENAL ====================
      default: {
        if (command) {
          await reply(sock, msg, `❓ Command *.${command}* tidak dikenal.\nKetik *.menu* untuk daftar command.`)
        }
      }
    }
  } catch (err) {
    console.log(chalk.red('[ERROR]', err.message))
    await reply(sock, msg, `⚠️ Terjadi error: ${err.message}`)
  }
}

function timeToSec(t) {
  const p = t.split(':').map(Number)
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2]
  if (p.length === 2) return p[0] * 60 + p[1]
  return parseInt(t) || 0
}
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}j ${m}m ${s}d`
}
