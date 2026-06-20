import { uploadToTelegram } from './telegram-upload.js'
import OpenAI from 'openai'

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
import path from 'node:path'
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

async function getTranscript(url, rawFile) {
  // Try YouTube's auto-generated transcript first (fast, free)
  try {
    let raw
    try { raw = await YoutubeTranscript.fetchTranscript(url, { lang: 'id' }) } catch {}
    if (!raw?.length) raw = await YoutubeTranscript.fetchTranscript(url, { lang: 'en' })
    if (raw?.length) {
      return raw.map(s => ({
        time: new Date(s.offset * 1000).toISOString().slice(11, 19),
        sec: Math.floor(s.offset / 1000),
        text: s.text.replace(/\n/g, ' ').trim(),
        source: 'youtube',
      }))
    }
  } catch (e) {
    console.log('[AUTOCLIP] YouTube transcript missing/error:', e.message)
  }

  // Fallback: Whisper (accurate, but slower — needs rawFile already downloaded)
  if (rawFile && fs.existsSync(rawFile)) {
    console.log('[AUTOCLIP] Falling back to Whisper transcription...')
    return transcribeWithWhisper(rawFile)
  }
  throw new Error('Tidak ada subtitle YouTube & video belum di-download (Whisper butuh file lokal)')
}

// ─── WHISPER FALLBACK (faster-whisper via Python subprocess) ────────────────
// Output: array of { time, sec, text, source: 'whisper', words?: [{word, start, end}] }
async function transcribeWithWhisper(videoPath) {
  const scriptPath = path.join(process.cwd(), 'scripts', 'whisper-transcribe.py')
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Whisper script tidak ada: ' + scriptPath)
  }
  const model = process.env.WHISPER_MODEL || 'small'  // tiny/base/small/medium/large-v3
  const lang = process.env.WHISPER_LANG || 'id'
  console.log('[WHISPER] Transcribing ' + videoPath + ' (model=' + model + ', lang=' + lang + ')')

  const { stdout, stderr } = await execAsync(
    'python3 "' + scriptPath + '" "' + videoPath + '" --model ' + model + ' --lang ' + lang,
    { timeout: 1800000, maxBuffer: 50 * 1024 * 1024 }  // 30 min, 50MB buffer
  )
  if (stderr) console.log('[WHISPER stderr]', stderr.slice(0, 500))
  const data = JSON.parse(stdout)
  if (data.error) throw new Error('Whisper error: ' + data.error)
  if (!Array.isArray(data?.segments)) {
    throw new Error('Whisper output invalid: ' + stdout.slice(0, 200))
  }
  console.log('[WHISPER] Got ' + data.segments.length + ' segments, lang=' + data.language)
  return data.segments.map(s => ({
    time: secToTime(Math.floor(s.start)),
    sec: Math.floor(s.start),
    text: (s.text || '').replace(/\n/g, ' ').trim(),
    source: 'whisper',
    // Word-level timestamps (relative to video start, in seconds)
    words: Array.isArray(s.words) ? s.words : [],
  }))
}

async function analyzeWithGemini(segments, maxSec) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  const prompt = buildViralPrompt(segments, maxSec, 'gemini')

  const result = await model.generateContent(prompt)
  const text = result.response.text().replace(/```json|```/g, '').trim()
  return parseAndSnapSegments(text, segments, maxSec)
}

// ─── CLAUDE (Anthropic native API) ──────────────────────────────────────────
async function analyzeWithClaude(segments, maxSec) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY belum di-set')

  const model = process.env.AUTOCLIP_CLAUDE_MODEL || 'claude-sonnet-4-5'
  const prompt = buildViralPrompt(segments, maxSec, 'claude')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error('Claude HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200))
  const data = await res.json()
  const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim()
  return parseAndSnapSegments(text, segments, maxSec)
}

// ─── OPENAI (GPT-4o / GPT-4o-mini via OpenAI SDK) ───────────────────────────
async function analyzeWithOpenAI(segments, maxSec) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY belum di-set')

  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const model = process.env.AUTOCLIP_OPENAI_MODEL || 'gpt-4o-mini'

  const client = new OpenAI({ apiKey, baseURL })
  const prompt = buildViralPrompt(segments, maxSec, 'openai')

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'Kamu adalah editor konten viral Indonesia. Output HANYA JSON valid.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  })
  const text = (completion.choices[0]?.message?.content || '').replace(/```json|```/g, '').trim()
  return parseAndSnapSegments(text, segments, maxSec)
}

// ─── DISPATCHER: pilih LLM terbaik yang available ──────────────────────────
// Priority: ANTHROPIC > OPENAI > GEMINI (Claude paling jago creative judgment)
async function analyzeWithLLM(segments, maxSec) {
  const used = []
  if (process.env.ANTHROPIC_API_KEY) {
    try { const r = await analyzeWithClaude(segments, maxSec); used.push('claude'); return { ...r, provider: 'claude' } }
    catch (e) { console.error('[AUTOCLIP] Claude fail:', e.message) }
  }
  if (process.env.OPENAI_API_KEY) {
    try { const r = await analyzeWithOpenAI(segments, maxSec); used.push('openai'); return { ...r, provider: 'openai' } }
    catch (e) { console.error('[AUTOCLIP] OpenAI fail:', e.message) }
  }
  if (GEMINI_API_KEY) {
    try { const r = await analyzeWithGemini(segments, maxSec); used.push('gemini'); return { ...r, provider: 'gemini' } }
    catch (e) { console.error('[AUTOCLIP] Gemini fail:', e.message) }
  }
  throw new Error('Tidak ada API key AI yang available. Set salah satu: ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_KEY di Railway.')
}

// ─── PROMPT BUILDER (shared across providers) ───────────────────────────────
function buildViralPrompt(segments, maxSec, provider) {
  const transcript = segments
    .map(s => '[' + s.sec + 's] ' + s.text)
    .join('\n')
    .slice(0, 25000)

  return `Kamu adalah editor konten viral TikTok/Reels/Shorts Indonesia yang sudah menghasilkan ratusan juta views.

TUGAS: Temukan 3-5 momen PALING VIRAL dari transkrip video ini untuk dijadikan short video 30-60 detik.

KRITERIA MOMEN VIRAL (urutan prioritas):
1. **Hook kuat di detik pertama** — kalimat pembuka yang bikin orang berhenti scroll (pertanyaan provokatif, fakta mengejutkan, statement kontroversial)
2. **Konflik / drama** — ada masalah yang diungkap, debat, atau pertentangan
3. **Twist / reveal** — informasi tersembunyi yang baru dibuka
4. **Puncak emosi** — tawa, teriakan, tangisan, momen mengharukan
5. **Value bomb** — insight / tips / data yang bikin orang save & share
6. **Quotable line** — kalimat yang bisa jadi caption / quote sendiri

FORMAT TIMESTAMP: Pakai DETIK (contoh: [143s] = detik ke-143). JANGAN pakai format lain.

DURASI VIDEO: ${maxSec} detik (${secToLabel(maxSec)})

ATURAN KERAS:
1. "start_sec" dan "end_sec" HARUS ada persis di transkrip (jangan karang timestamp sendiri)
2. "end_sec" - "start_sec" harus antara 30 sampai 60 detik
3. "start_sec" tidak boleh kurang dari 0
4. "end_sec" tidak boleh lebih dari ${maxSec}
5. Score 0-100 berdasarkan potensi viral (100 = hampir pasti viral, 70+ layak clip, di bawah 60 skip)
6. Hanya return momen dengan score >= 70
7. Bahasa: Indonesia casual, hook-driven, to-the-point

CONTOH OUTPUT YANG BENER:
{
  "segments": [
    {"start_sec": 143, "end_sec": 198, "reason": "Hook: 'gw baru sadar...' + plot twist besar di detik 167", "score": 92}
  ]
}

TRANSKRIP:
${transcript}

Balas HANYA JSON valid, tanpa teks lain, tanpa markdown.`
}

// ─── PARSER: snap timestamp ke transkrip + format HH:MM:SS ──────────────────
function parseAndSnapSegments(text, segments, maxSec) {
  // Extract JSON object from text (in case model adds prose)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI tidak return JSON. Raw: ' + text.slice(0, 200))
  const parsed = JSON.parse(jsonMatch[0])
  if (!Array.isArray(parsed.segments)) throw new Error('JSON tidak ada "segments" array')

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
        reason: s.reason || 'no reason',
        score: Number(s.score) || 50,
      }
    }),
  }
}

export async function handleAutoClip(sock, msg, url) {
  const from = msg.key.remoteJid
  const sendText = async (t) => await sock.sendMessage(from, { text: t }, { quoted: msg })

  if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
    return sendText('⚠️ Format salah!\n\n.autoclip [link YouTube]')
  }

  await sendText('🔍 *Langkah 1/5:* Mengambil durasi & transkrip...')

  // Get duration (always needed)
  const videoDurSec = await getVideoDuration(url)
  if (!videoDurSec) {
    return sendText('❌ Gagal deteksi durasi video. Pastikan link valid & publik.')
  }

  // Try YouTube transcript first
  let segments = []
  let transcriptSource = 'youtube'
  try {
    segments = await getTranscript(url, null)
  } catch (e) {
    console.log('[AUTOCLIP] YouTube transcript unavailable:', e.message)
  }

  // If YouTube transcript empty/missing → download + Whisper
  let rawFile = null
  if (!segments || segments.length < 10) {
    // Too few segments = likely YouTube auto-subs are bad/missing
    // Download video first, then Whisper
    const ts0 = Date.now()
    rawFile = TMP_DIR + '/' + ts0 + '_whisper_raw.mp4'
    try {
      await sendText('📥 YouTube subtitle kurang/ga ada. Download + Whisper fallback...')
      await execAsync(
        'yt-dlp --js-runtimes deno -f "bestvideo[vcodec^=avc1][height<=360]+bestaudio[ext=m4a]/best" --merge-output-format mp4 --no-playlist -o "' + rawFile + '" "' + url + '"',
        { timeout: 1800000 }
      )
      if (!fs.existsSync(rawFile)) throw new Error('Download Whisper source gagal')
      await sendText('🎙️ Whisper transkrip audio (model: ' + (process.env.WHISPER_MODEL || 'small') + ')...')
      segments = await transcribeWithWhisper(rawFile)
      transcriptSource = 'whisper'
    } catch (e) {
      cleanTmp(rawFile)
      return sendText('❌ Gagal Whisper: ' + e.message)
    }
  }

  if (!segments?.length) return sendText('❌ Transkrip kosong setelah semua fallback.')

  const maxSec = videoDurSec || segments[segments.length - 1].sec
  const maxTime = secToTime(maxSec)
  await sendText(
    '📝 *Langkah 2/5:* Menganalisis ' + segments.length + ' segmen (' + transcriptSource + ')...\n' +
    '⏱️ Durasi: ' + maxTime
  )

  let analysis
  try {
    analysis = await analyzeWithLLM(segments, maxSec)
  } catch (e) {
    if (rawFile) cleanTmp(rawFile)
    return sendText('❌ Gagal analisis AI: ' + e.message)
  }
  console.log('[AUTOCLIP] LLM=' + analysis.provider + ' returned ' + analysis.segments.length + ' candidates')

  const valid = analysis.segments.filter(s => {
    return s.start_sec >= 0 && s.start_sec < maxSec &&
           s.end_sec > s.start_sec && s.end_sec <= maxSec + 10 &&
           (s.end_sec - s.start_sec) >= 20
  })
  if (!valid.length) {
    if (rawFile) cleanTmp(rawFile)
    return sendText('❌ Tidak ada momen viral (semua score < 70). Coba video lain.')
  }

  const top = valid.sort((a, b) => b.score - a.score).slice(0, 5)

  await sendText(
    '✅ *Langkah 3/5:* ' + top.length + ' momen viral (' + analysis.provider + '):\n\n' +
    top.map((s, i) => '*' + (i+1) + '.* ' + s.start + ' → ' + s.end + '\n💡 ' + s.reason + '\n⭐ ' + s.score + '/100').join('\n\n') +
    '\n\n⏳ *Langkah 4/5:* Download video...'
  )

  const ts = Date.now()
  const keepAlive = setInterval(async () => {
    try { await sock.sendPresenceUpdate('composing', from) } catch {}
  }, 20000)

  // If we don't have rawFile yet (used YouTube transcript), download now
  if (!rawFile) {
    rawFile = TMP_DIR + '/' + ts + '_raw.mp4'
    try {
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
  }

  await sendText('✂️ *Langkah 5/5:* Memotong ' + top.length + ' clip (9:16 + subtitle)...')

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
      // 9:16 vertical crop + subtitle burn-in
      await cutClipWithSubtitles(rawFile, outFile, startClean, endCleanFinal, segments, startSec, endFinal)
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
      await sendText('✅ Clip #' + (i+1) + ' berhasil! (' + sizeMB + 'MB, 9:16)\n🔗 ' + tgLink)
      cleanTmp(outFile)
    } catch (e) {
      cleanTmp(outFile)
      await sendText('⚠️ Gagal clip #' + (i+1) + ': ' + e.message)
    }
  }

  cleanTmp(rawFile)
  clearInterval(keepAlive)
}

// ─── CUT CLIP: 9:16 vertical + subtitle burn-in ─────────────────────────────
// Input: rawFile (landscape mp4), output, time range, transcript segments
// Output: vertical 9:16 mp4 with hardcoded subtitles
async function cutClipWithSubtitles(rawFile, outFile, startTime, endTime, transcript, segStart, segEnd) {
  // Build SRT subtitle file for this clip
  const srtPath = outFile.replace('.mp4', '.srt')
  const srtContent = buildSRT(transcript, segStart, segEnd)
  fs.writeFileSync(srtPath, srtContent, 'utf8')

  // ffmpeg with: crop to 9:16 (smart center crop) + burn subtitles
  // Filter explanation:
  //   crop=ih*9/16:i   → vertical 9:16 from landscape (center crop)
  //   scale=1080:1920  → upscale to TikTok resolution
  //   subtitles=...    → burn SRT into video
  const ffmpegCmd = [
    'ffmpeg -y',
    '-ss ' + startTime,
    '-to ' + endTime,
    '-i "' + rawFile + '"',
    // crop=ih*9/16:i → vertical 9:16 from landscape (center crop)
    // scale=1080:1920  → upscale to TikTok resolution
    // subtitles=...    → burn SRT into video
    // Style optimized for short-form: larger font, white text with black outline,
    // positioned upper-third (not bottom) so it doesn't get covered by UI overlay
    '-vf "crop=ih*9/16:i,scale=1080:1920,subtitles=' + srtPath + ':force_style=\'FontName=Arial Black,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=3,Outline=3,Shadow=1,Alignment=2,MarginV=120,Bold=1\'"',
    '-c:v libx264 -preset fast -crf 23',
    '-c:a aac -b:a 128k',
    '-movflags +faststart',
    '"' + outFile + '"'
  ].join(' ')

  await execAsync(ffmpegCmd, { timeout: 300000 })
  try { fs.unlinkSync(srtPath) } catch {}
}

// Build SRT file content for the clip time range.
// Strategy:
//   1. If we have word-level timestamps (Whisper) → group into ~5-word lines
//      following actual speech timing. MOST ACCURATE.
//   2. Else (YouTube transcript) → group 2-3 segments per subtitle line,
//      ~3-4 sec duration. Best-effort.
function buildSRT(transcript, rangeStart, rangeEnd) {
  // Find all words within the clip range (from Whisper data)
  const allWords = []
  for (const seg of transcript) {
    if (seg.words && seg.words.length) {
      for (const w of seg.words) {
        if (w.start >= rangeStart && w.end <= rangeEnd + 0.5) {
          allWords.push({ word: w.word, start: w.start, end: w.end })
        }
      }
    }
  }
  // Sort by start time (in case multiple segments overlap)
  allWords.sort((a, b) => a.start - b.start)

  if (allWords.length > 0) {
    return buildSRTFromWords(allWords, rangeStart, rangeEnd)
  }
  // Fallback: segment-level
  return buildSRTFromSegments(transcript, rangeStart, rangeEnd)
}

// Group words into subtitle lines, max 7 words per line, respecting word timing.
// Output SRT times are RELATIVE to rangeStart (0 = clip start).
function buildSRTFromWords(words, rangeStart, rangeEnd) {
  const maxWords = 7
  const minDur = 1.0    // min subtitle duration (sec)
  const maxDur = 4.5    // max subtitle duration (sec)
  const lines = []      // [{start, end, text}]
  let cur = []
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i])
    const last = words[i]
    const first = cur[0]
    const dur = last.end - first.start
    if (cur.length >= maxWords || dur >= maxDur || i === words.length - 1) {
      // flush
      const startRel = Math.max(0, first.start - rangeStart)
      const endRel = Math.min(rangeEnd - rangeStart, last.end - rangeStart)
      if (endRel > startRel) {
        lines.push({
          start: Math.max(startRel, endRel - maxDur),  // don't exceed max
          end: endRel,
          text: cur.map(w => w.word).join(' ').trim(),
        })
      }
      cur = []
    }
  }

  // Re-balance: if a line is too short (< minDur), merge with next
  for (let i = 0; i < lines.length - 1; i++) {
    const dur = lines[i].end - lines[i].start
    if (dur < minDur && i + 1 < lines.length) {
      const next = lines[i + 1]
      lines[i] = {
        start: lines[i].start,
        end: next.end,
        text: lines[i].text + ' ' + next.text,
      }
      lines.splice(i + 1, 1)
      i--  // re-check
    }
  }

  return toSRT(lines)
}

// Fallback: group 2-3 YouTube transcript segments per line
function buildSRTFromSegments(transcript, rangeStart, rangeEnd) {
  const inRange = transcript.filter(s => s.sec >= rangeStart && s.sec <= rangeEnd)
  if (!inRange.length) return ''

  const lines = []
  let cur = []
  for (const seg of inRange) {
    cur.push(seg)
    if (cur.length >= 2) {
      const first = cur[0]
      const last = cur[cur.length - 1]
      const dur = (last.sec - first.sec) + 3
      lines.push({
        start: Math.max(0, first.sec - rangeStart),
        end: Math.min(rangeEnd - rangeStart, first.sec - rangeStart + dur),
        text: cur.map(s => s.text).join(' ').trim(),
      })
      cur = []
    }
  }
  if (cur.length) {
    const first = cur[0]
    lines.push({
      start: Math.max(0, first.sec - rangeStart),
      end: Math.min(rangeEnd - rangeStart, first.sec - rangeStart + 3),
      text: cur.map(s => s.text).join(' ').trim(),
    })
  }
  return toSRT(lines)
}

function toSRT(lines) {
  let srt = ''
  let idx = 1
  for (const l of lines) {
    if (!l.text) continue
    srt += idx++ + '\n'
    srt += srtTime(l.start) + ' --> ' + srtTime(l.end) + '\n'
    srt += l.text + '\n\n'
  }
  return srt
}

function srtTime(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0')
  const s = (sec % 60).toFixed(3).padStart(6, '0')
  return h.toString().padStart(2, '0') + ':' + m + ':' + s
}

export default { handleAutoClip }
