import { checkRobloxProfile, formatRobloxProfile } from './roblox.js'
import { checkYouTubeChannel, formatYouTubeChannel } from './youtube.js'
import { checkInstagramProfile, formatInstagramProfile } from './instagram.js'
import { checkTikTokProfile, formatTikTokProfile } from './tiktok.js'
import { checkGitHubProfile, formatGitHubProfile } from './github.js'
import fs from 'fs'

const YT_API_KEY = 'ISI_API_KEY_YOUTUBE_KAMU'

export async function handleSosmed(sock, msg, text, command) {
  const from = msg.key.remoteJid

  const sendText = async (t) =>
    sock.sendMessage(from, { text: t }, { quoted: msg })

  const sendLoading = async () =>
    sock.sendMessage(from, { text: '⏳ Sedang mencari data...' }, { quoted: msg })

  const sendProfile = async (avatarUrl, caption) => {
    if (avatarUrl) {
      try {
        await sock.sendMessage(from, {
          image: { url: avatarUrl },
          caption
        }, { quoted: msg })
        return
      } catch {}
    }
    await sendText(caption)
  }

  /** Prefer animated avatar video, fallback image */
  const sendRobloxProfile = async (data) => {
    const caption = formatRobloxProfile(data)
    if (data.videoPath && fs.existsSync(data.videoPath)) {
      try {
        await sock.sendMessage(from, {
          video: fs.readFileSync(data.videoPath),
          mimetype: 'video/mp4',
          caption,
          gifPlayback: true
        }, { quoted: msg })
        return
      } catch (e) {
        console.error('[ROBLOX] send video fail:', e.message)
      }
    }
    await sendProfile(data.avatarUrl || data.headUrl, caption)
  }

  switch (command) {
    case 'roblox': {
      if (!text.trim()) {
        return sendText(
          '❌ Format salah!\n' +
          'Contoh: `.roblox builderman`\n' +
          'Atau: `.roblox @yanzyahapart2`\n\n' +
          '_Berlaku untuk SEMUA username Roblox — bot render video animasi avanya._'
        )
      }
      await sock.sendMessage(from, {
        text: '⏳ Ambil profil + render animasi avatar...'
      }, { quoted: msg })
      try {
        const data = await checkRobloxProfile(text.trim())
        await sendRobloxProfile(data)
      } catch (err) { await sendText(`❌ ${err.message}`) }
      break
    }
    case 'yt': {
      if (!text.trim()) return sendText('❌ Format salah!\nContoh: .yt Pewdiepie')
      await sendLoading()
      try {
        const data = await checkYouTubeChannel(text.trim(), YT_API_KEY)
        await sendProfile(data.thumbnailUrl, formatYouTubeChannel(data))
      } catch (err) { await sendText(`❌ ${err.message}`) }
      break
    }
    case 'ig': {
      if (!text.trim()) return sendText('❌ Format salah!\nContoh: .ig cristiano')
      await sendLoading()
      try {
        const data = await checkInstagramProfile(text.trim())
        await sendProfile(data.avatarUrl, formatInstagramProfile(data))
      } catch (err) { await sendText(`❌ ${err.message}`) }
      break
    }
    case 'tt': {
      if (!text.trim()) return sendText('❌ Format salah!\nContoh: .tt charlidamelio')
      await sendLoading()
      try {
        const data = await checkTikTokProfile(text.trim())
        await sendProfile(data.avatarUrl, formatTikTokProfile(data))
      } catch (err) { await sendText(`❌ ${err.message}`) }
      break
    }
    case 'gh': {
      if (!text.trim()) return sendText('❌ Format salah!\nContoh: .gh torvalds')
      await sendLoading()
      try {
        const data = await checkGitHubProfile(text.trim())
        await sendProfile(data.avatarUrl, formatGitHubProfile(data))
      } catch (err) { await sendText(`❌ ${err.message}`) }
      break
    }
  }
}
