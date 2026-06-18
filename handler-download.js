import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const TIMEOUT = 30000
const TMP_DIR = '/tmp/wa-tmp'
const MAX_DURATION = 6600
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

function cleanTmp(filePath) { try { fs.unlinkSync(filePath) } catch {} }
function isYouTubeUrl(url) { return /youtube\.com|youtu\.be/.test(url) }
function isTikTokUrl(url) { return /tiktok\.com|vm\.tiktok\.com/.test(url) }
function isTwitterUrl(url) { return /twitter\.com|x\.com/.test(url) }
function isPinterestUrl(url) { return /pinterest\.com|pin\.it/.test(url) }
function isInstagramUrl(url) { return /instagram\.com/.test(url) }
function cleanUrl(url) { return url.split('?')[0] }

async function isYtdlpSupported(url) {
  try {
    await execAsync(`yt-dlp --simulate --quiet "${url}"`, { timeout: 20000 })
    return true
  } catch {
    return false
  }
}

async function getVideoDuration(url) {
  try {
    const { stdout } = await execAsync(`yt-dlp --print duration "${cleanUrl(url)}"`, { timeout: 60000 })
    return parseInt(stdout.trim()) || 0
  } catch {
    return 0
  }
}

async function downloadWithYtdlp(url, audioOnly = false) {
  const ext = audioOnly ? 'mp3' : 'mp4'
  const filePath = path.join(TMP_DIR, `${Date.now()}.${ext}`)
  const format = audioOnly ? `-x --audio-format mp3` : `-f "best[height<=720]"`
  await execAsync(`yt-dlp ${format} -o "${filePath}" "${url}"`, { timeout: 120000 })
  return filePath
}

async function downloadTikTok(url) {
  const res = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { timeout: TIMEOUT })
  if (!res.data || res.data.code !== 0) throw new Error('Gagal mengambil video TikTok.')
  const videoUrl = res.data.data?.hdplay || res.data.data?.play
  if (!videoUrl) throw new Error('Link video tidak ditemukan.')
  const title = res.data.data?.title?.slice(0, 50) || 'tiktok'
  const filePath = path.join(TMP_DIR, Date.now() + '.mp4')
  const videoRes = await axios.get(videoUrl, { responseType: 'stream', timeout: TIMEOUT })
  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath)
    videoRes.data.pipe(writer)
    writer.on('finish', () => resolve({ filePath, title }))
    writer.on('error', reject)
  })
}

function cobaltFallback(url) {
  return `⚠️ Tidak dapat mendownload otomatis.\n\n` +
    `Silakan download manual:\n` +
    `🔗 https://cobalt.tools\n\n` +
    `Paste link ini:\n${url}`
}

export async function handleDownload(sock, msg, text, command) {
  const from = msg.key.remoteJid
  const sendText = async (t) => await sock.sendMessage(from, { text: t }, { quoted: msg })
  const url = text.trim()


  if (command === 'clip') {
    const parts = text.trim().split(/\s+/)
    const cUrl   = parts[0]
    const cStart = parts[1]
    const cEnd   = parts[2]

    if (!cUrl || !cStart || !cEnd) {
      return sendText('⚠️ *Format salah!*\n\n*.clip [link] [mulai] [akhir]*\n\nContoh:\n.clip https://youtu.be/xxx 01:30 02:45\n.clip https://youtu.be/xxx 1:30:00 1:32:00\n\n📝 Format waktu: MM:SS atau HH:MM:SS\n⚠️ Maks durasi: 10 menit')
    }

    const toSec = t => {
      const p = t.split(':').map(Number)
      return p.length === 3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1]
    }
    const durasi = toSec(cEnd) - toSec(cStart)

    if (durasi <= 0) return sendText('❌ Waktu akhir harus lebih besar dari waktu mulai!')
    if (durasi > 600) return sendText('⚠️ Durasi clip maksimal 10 menit!\nPerkecil rentang waktumu.')

    await sendText(`⏳ Mengunduh video...\n⏱️ Target clip: ${cStart} → ${cEnd}`)

    let tmpFull = null, tmpClip = null
    try {
      const ts = Date.now()
      tmpFull = `${TMP_DIR}/${ts}_full.mp4`
      tmpClip = `${TMP_DIR}/${ts}_clip.mp4`

      await execAsync(
        `yt-dlp -f "best[ext=mp4]/best" --merge-output-format mp4 --no-playlist -o "${tmpFull}" "${cUrl}"`,
        { timeout: 180000 }
      )

      await sendText(`✂️ Memotong ${cStart} → ${cEnd}...`)

      await execAsync(
        `ffmpeg -i "${tmpFull}" -ss ${cStart} -to ${cEnd} -c:v libx264 -c:a aac "${tmpClip}" -y`,
        { timeout: 60000 }
      )

      const sizeMB = (fs.statSync(tmpClip).size / 1024 / 1024).toFixed(1)
      if (parseFloat(sizeMB) > 64) {
        return sendText(`❌ Clip terlalu besar (${sizeMB} MB).\nCoba perkecil rentang waktu.`)
      }

      await sock.sendMessage(from, {
        video    : fs.readFileSync(tmpClip),
        caption  : `✂️ *Clip Berhasil!*\n⏱️ ${cStart} → ${cEnd}\n📦 ${sizeMB} MB`,
        mimetype : 'video/mp4'
      }, { quoted: msg })
    } catch (err) {
      await sendText(`❌ Gagal clip video!\n${err.message}\n\n💡 Pastikan ffmpeg terinstall:\n\`pkg install ffmpeg\``)
    } finally {
      if (tmpFull) cleanTmp(tmpFull)
      if (tmpClip) cleanTmp(tmpClip)
    }
    return
  }

  if (command === 'ytdl' || command === 'ytmp3') {
    if (!url || !isYouTubeUrl(url)) return sendText(`❌ Format salah!\nContoh: .${command} https://youtu.be/xxxxx`)
    await sendText('⏳ Mengecek durasi video...')
    const duration = await getVideoDuration(url)
    if (duration > MAX_DURATION) {
      const menit = Math.floor(duration / 60)
      return sendText(`⚠️ Video terlalu panjang (*${menit} menit*).\n\nSilakan download manual:\n🔗 https://cobalt.tools\n\nPaste link ini di cobalt.tools:\n${url}`)
    }
    await sendText('⏳ Sedang mengunduh dari YouTube...')
    let filePath = null
    try {
      const audioOnly = command === 'ytmp3'
      filePath = await downloadWithYtdlp(url, audioOnly)
      if (audioOnly) {
        await sock.sendMessage(from, { audio: fs.readFileSync(filePath), mimetype: 'audio/mpeg', ptt: false }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: '🎬 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
      }
    } catch (err) {
      await sendText(`❌ Gagal download YouTube: ${err.message}`)
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  if (command === 'ttdl') {
    if (!url || !isTikTokUrl(url)) return sendText('❌ Format salah!\nContoh: .ttdl https://vm.tiktok.com/xxxxx')
    await sendText('⏳ Sedang mengunduh video TikTok...')
    let filePath = null
    try {
      const result = await downloadTikTok(url)
      filePath = result.filePath
      await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: `🎵 *${result.title}*\n\n_Download by WA Bot_`, mimetype: 'video/mp4' }, { quoted: msg })
    } catch (err) {
      await sendText(`❌ Gagal download TikTok: ${err.message}`)
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  if (command === 'twdl' || command === 'xdl') {
    if (!url || !isTwitterUrl(url)) return sendText(`❌ Format salah!\nContoh: .${command} https://x.com/user/status/xxxxx`)
    await sendText('⏳ Sedang mengunduh dari Twitter/X...')
    let filePath = null
    try {
      filePath = await downloadWithYtdlp(url)
      await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: '🐦 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
    } catch (err) {
      await sendText(cobaltFallback(url))
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  if (command === 'pindl') {
    if (!url || !isPinterestUrl(url)) return sendText('❌ Format salah! Contoh: .pindl https://pin.it/xxxxx')
    await sendText('⏳ Sedang mengunduh dari Pinterest...')
    let filePath = null
    try {
      filePath = await downloadWithYtdlp(url)
      await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: '📌 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
    } catch (err) {
      await sendText(cobaltFallback(url))
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  if (command === 'igdl') {
    if (!url || !isInstagramUrl(url)) return sendText('❌ Format salah! Contoh: .igdl https://www.instagram.com/reel/xxxxx')
    await sendText('⏳ Sedang mengunduh dari Instagram...')
    let filePath = null
    try {
      // Ambil metadata dulu (title, uploader) buat caption
      let caption = '📸 Downloaded by WA Bot'
      try {
        const { stdout: meta } = await execAsync(
          `yt-dlp --print title --print uploader --print duration --no-playlist "${url}"`,
          { timeout: 30000 }
        )
        const [title, uploader, duration] = meta.trim().split('\n').map(s => s.trim())
        const dur = duration ? Math.round(parseInt(duration) || 0) : 0
        const durStr = dur > 0 ? ` (${dur}s)` : ''
        if (title || uploader) {
          caption = `📸 *Instagram${title ? `* — ${title}` : ''}*${durStr}\n👤 @${uploader || 'unknown'}\n\n_Downloaded by WA Bot_`
        }
      } catch {
        // Metadata fetch failed — proceed with default caption
      }

      filePath = await downloadWithYtdlp(url)

      // Size check (WA limit ~64MB)
      const sizeMB = fs.statSync(filePath).size / 1024 / 1024
      if (sizeMB > 64) {
        cleanTmp(filePath)
        return sendText(`⚠️ Video terlalu besar (*${sizeMB.toFixed(1)} MB*). Instagram limit download.\n\nCoba:\n🔗 https://saveig.app\nPaste: ${url}`)
      }

      await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption, mimetype: 'video/mp4' }, { quoted: msg })
    } catch (err) {
      await sendText(
        `❌ Gagal download Instagram.\n\n` +
        `Coba alternatif:\n` +
        `🔗 https://saveig.app\n` +
        `🔗 https://snapinsta.app\n\n` +
        `Paste: ${url}`
      )
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  if (command === 'dl' || command === 'download') {
    if (!url || !url.startsWith('http')) return sendText('❌ Format salah!\nContoh: .dl https://contoh.com/video')
    await sendText('⏳ Mencoba mengunduh...')
    let filePath = null
    try {
const supported = await isYtdlpSupported(url)
if (!supported) return sendText(cobaltFallback(url))
      const duration = await getVideoDuration(url)
      if (duration > MAX_DURATION) {
        const menit = Math.floor(duration / 60)
        return sendText(`⚠️ Video terlalu panjang (*${menit} menit*).\n\nSilakan download manual:\n🔗 https://cobalt.tools\n\nPaste link ini:\n${url}`)
      }
      filePath = await downloadWithYtdlp(url)
      await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: '📥 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
    } catch (err) {
      await sendText(cobaltFallback(url))
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }
}
