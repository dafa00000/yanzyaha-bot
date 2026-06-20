import { uploadToTelegram } from './telegram-upload.js'

function timeToSec(t) {
  if (!t) return 0
  const parts = t.split(':').map(Number)
  if (parts.length >= 3) return parts[0]*3600 + parts[1]*60 + parts[2]
  if (parts.length === 2) return parts[0]*60 + parts[1]
  return parts[0]
}
function secToTime(s) {
  const h = Math.floor(s/3600).toString().padStart(2,'0')
  const m = Math.floor((s%3600)/60).toString().padStart(2,'0')
  const sec = Math.floor(s%60).toString().padStart(2,'0')
  return h+':'+m+':'+sec
}
function sanitizeTime(t) {
  if (!t) return '00:00:00'
  const parts = t.split(':').map(p => p.replace(/[^0-9]/g, '').padStart(2,'0'))
  if (parts.length >= 4) return parts.slice(0,3).join(':')
  if (parts.length === 3) return parts.join(':')
  if (parts.length === 2) return '00:' + parts.join(':')
  return '00:00:' + parts[0]
}
// Format detik ke "Xm Ys" untuk prompt AI agar tidak bingung dengan HH:MM:SS
function secToLabel(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m + 'm' + sec + 's'
}

import fs from 'fs'
import { promisify } from 'node:util'
import { exec } from 'node:child_process'
import { YoutubeTranscript } from 'youtube-transcript'
import { GoogleGenerativeAI } from '@google/generative-ai'

const execAsync = promisify(exec)
// TMP_DIR: use env override if set, else cross-platform default
//   - Termux (Android): /sdcard/wa-tmp (persistent storage)
//   - Linux/VPS/Railway/Docker: /tmp/wa-tmp (ephemeral, but OK for downloads)
const TMP_DIR = process.env.WA_TMP_DIR || (
  process.env.PREFIX?.includes('com.termux') ? '/sdcard/wa-tmp' : '/tmp/wa-tmp'
)
// Try multiple env var names for backward compat with Railway configs
// that use either GEMINI_API_KEY or GEMINI_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY || ''
if (!GEMINI_API_KEY) {
  console.warn('[AUTOCLIP] ⚠️  GEMINI_API_KEY / GEMINI_KEY belum di-set. Set di Railway Variables.')
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const TG_CHANNEL = 'https://t.me/yanzyahabotc'

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })
function cleanTmp(f) { try { fs.unlinkSync(f) } catch {} }

async function getVideoDuration(url) {
  try {
    const { stdout } = await execAsync('yt-dlp --js-runtimes deno --get-duration --no-playlist "' + url + '"', { timeout: 30000 })
    const raw = stdout.trim()
    const parts = raw.split(':').map(Number)
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2]
    if (parts.length === 2) return parts[0]*60 + parts[1]
    return parts[0]
  } catch { return null }
}

async function getTranscript(url) {
  try {
    let raw
    try { raw = await YoutubeTranscript.fetchTranscript(url, { lang: 'id' }) } catch {}
    if (!raw?.length) raw = await YoutubeTranscript.fetchTranscript(url, { lang: 'en' })
    if (!raw?.length) throw new Error('Tidak ada subtitle tersedia')
    return raw.map(s => ({
      time: new Date(s.offset * 1000).toISOString().slice(11, 19),
      sec: Math.floor(s.offset / 1000),
      text: s.text.replace(/\n/g, ' ').trim()
    }))
  } catch (e) {
    throw new Error('Gagal mengambil transkrip: ' + e.message)
  }
}

async function analyzeWithGemini(segments, maxSec) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

  // Kirim transkrip pakai format detik saja, bukan HH:MM:SS
  // Ini mencegah AI salah interpretasi format jam
  const transcript = segments
    .map(s => '[' + s.sec + 's] ' + s.text)
    .join('\n')
    .slice(0, 25000)

  const prompt = `Kamu adalah editor konten viral. Temukan 3-5 momen terbaik untuk dijadikan short video viral.

PENTING - Format timestamp di transkrip menggunakan DETIK (contoh: [143s] = detik ke-143).
Durasi total video: ${maxSec} detik (= ${secToLabel(maxSec)})

ATURAN:
1. Pilih nilai "start_sec" dan "end_sec" dalam DETIK, diambil dari angka yang ada di transkrip
2. start_sec dan end_sec WAJIB ada di transkrip (jangan karang sendiri)
3. end_sec - start_sec harus antara 30 sampai 60 detik
4. start_sec maksimal ${maxSec - 30} (agar masih ada sisa 30 detik)
5. end_sec maksimal ${maxSec}
6. Pilih momen dengan hook kuat, konflik, twist, atau puncak emosi

Transkrip:
${transcript}

Balas HANYA JSON ini tanpa teks lain:
{
  "segments": [
    {"start_sec": 143, "end_sec": 198, "reason": "alasan singkat", "score": 85}
  ]
}`

  const result = await model.generateContent(prompt)
  const text = result.response.text().replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(text)

  // Snap ke detik terdekat yang ada di transkrip, lalu konversi ke HH:MM:SS
  const snapSec = (targetSec) => {
    let closest = segments[0]
    let minDiff = Math.abs(segments[0].sec - targetSec)
    for (const s of segments) {
      const diff = Math.abs(s.sec - targetSec)
      if (diff < minDiff) { minDiff = diff; closest = s }
    }
    return closest.sec
  }

  return {
    segments: parsed.segments.map(s => {
      const startSec = snapSec(Number(s.start_sec))
      const endSec = snapSec(Number(s.end_sec))
      return {
        start: secToTime(startSec),
        end: secToTime(endSec),
        start_sec: startSec,
        end_sec: endSec,
        reason: s.reason,
        score: s.score
      }
    })
  }
}

export async function handleAutoClip(sock, msg, url) {
  const from = msg.key.remoteJid
  const sendText = async (t) => await sock.sendMessage(from, { text: t }, { quoted: msg })

  if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
    return sendText('⚠️ Format salah!\n\n.autoclip [link YouTube]')
  }

  await sendText('🔍 *Langkah 1/4:* Mengambil transkrip & durasi video...')

  let segments, videoDurSec
  try {
    [segments, videoDurSec] = await Promise.all([getTranscript(url), getVideoDuration(url)])
  } catch (e) {
    return sendText('❌ ' + e.message)
  }

  if (!segments?.length) return sendText('❌ Video tidak memiliki subtitle.')

  const maxSec = videoDurSec || segments[segments.length - 1].sec
  const maxTime = secToTime(maxSec)

  await sendText('📝 *Langkah 2/4:* Menganalisis ' + segments.length + ' segmen...\n⏱️ Durasi: ' + maxTime)

  let analysis
  try {
    analysis = await analyzeWithGemini(segments, maxSec)
  } catch (e) {
    return sendText('❌ Gagal analisis AI: ' + e.message)
  }

  const valid = analysis.segments.filter(s => {
    return s.start_sec >= 0 && s.start_sec < maxSec &&
           s.end_sec > s.start_sec && s.end_sec <= maxSec + 10 &&
           (s.end_sec - s.start_sec) >= 20
  })

  if (!valid.length) return sendText('❌ Tidak ada segmen valid. Coba video lain.')

  const top = valid.sort((a, b) => b.score - a.score).slice(0, 5)

  await sendText(
    '✅ *Langkah 3/4:* ' + top.length + ' segmen ditemukan:\n\n' +
    top.map((s, i) => '*' + (i+1) + '.* ' + s.start + ' → ' + s.end + '\n💡 ' + s.reason + '\n⭐ ' + s.score + '/100').join('\n\n') +
    '\n\n⏳ *Langkah 4/4:* Memotong clip...'
  )

  const ts = Date.now()
  const keepAlive = setInterval(async () => {
    try { await sock.sendPresenceUpdate('composing', from) } catch {}
  }, 20000)

  const rawFile = TMP_DIR + '/' + ts + '_raw.mp4'
  try {
    await sendText('⏳ Mengunduh video...')
    await execAsync(
      'yt-dlp --js-runtimes deno -f "bestvideo[vcodec^=avc1][height<=480]+bestaudio[ext=m4a]" --merge-output-format mp4 --no-playlist -o "' + rawFile + '" "' + url + '"',
      { timeout: 1800000 }
    )
    if (!fs.existsSync(rawFile)) throw new Error('File tidak ditemukan setelah download')
  } catch (e) {
    clearInterval(keepAlive)
    cleanTmp(rawFile)
    return sendText('❌ Gagal download: ' + e.message)
  }

  for (let i = 0; i < top.length; i++) {
    const seg = top[i]
    const startSec = seg.start_sec
    let endSec = seg.end_sec
    if (endSec > maxSec) endSec = maxSec
    const durSec = endSec - startSec
    if (durSec < 20) {
      await sendText('⚠️ Clip #' + (i+1) + ' terlalu pendek (' + durSec + 's). Skip.')
      continue
    }
    const endFinal = durSec > 60 ? startSec + 60 : endSec
    const startClean = secToTime(startSec)
    const endCleanFinal = secToTime(endFinal)
    const finalDur = endFinal - startSec
    const outFile = TMP_DIR + '/' + ts + '_clip' + (i+1) + '.mp4'

    try {
      await sendText('✂️ Clip #' + (i+1) + ': ' + startClean + ' → ' + endCleanFinal + ' (' + finalDur + 's)...')
      await execAsync(
        'ffmpeg -y -ss ' + startClean + ' -to ' + endCleanFinal + ' -i "' + rawFile + '" -c:v libx264 -c:a aac "' + outFile + '"',
        { timeout: 300000 }
      )
      if (!fs.existsSync(outFile)) throw new Error('File clip tidak terbuat')
      const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1)
      if (parseFloat(sizeMB) < 0.1) {
        await sendText('⚠️ Clip #' + (i+1) + ' kosong. Skip.')
        cleanTmp(outFile)
        continue
      }
      const tgCap = '🎬 Clip #' + (i+1) + '\n⏱️ ' + startClean + ' → ' + endCleanFinal + '\n⭐ ' + seg.score + '/100\n💡 ' + seg.reason
      const tgResult = await uploadToTelegram(outFile, tgCap)
      const msgId = tgResult?.result?.message_id
      const tgLink = msgId ? TG_CHANNEL + '/' + msgId : TG_CHANNEL
      await sendText('✅ Clip #' + (i+1) + ' berhasil! (' + sizeMB + 'MB)\n🔗 ' + tgLink)
      cleanTmp(outFile)
    } catch (e) {
      cleanTmp(outFile)
      await sendText('⚠️ Gagal clip #' + (i+1) + ': ' + e.message)
    }
  }

  cleanTmp(rawFile)
  clearInterval(keepAlive)
  await sendText('✅ *Selesai!* Cek clip di ' + TG_CHANNEL)
}
