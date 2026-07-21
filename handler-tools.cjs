'use strict'
/**
 * handler-tools.cjs
 * Utility tools: Translate, Calculator, Voice Note
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// ─── TRANSLATE (Google Translate API - free) ──────────────────
// Auto-detect bahasa + translate ke target
async function translate(text, targetLang = 'id') {
  try {
    // Pakai Google Translate free API
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`
    
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    })
    
    if (!res.ok) throw new Error('Translate API error')
    
    const data = await res.json()
    
    // Extract result
    const translated = data[0].map(item => item[0]).join('')
    const detectedLang = data[2] || 'auto'
    
    return {
      success: true,
      original: text,
      translated: translated,
      from: detectedLang,
      to: targetLang,
      message: `🌐 *TRANSLATE*\n\n` +
        `📝 Original (${detectedLang}): ${text}\n` +
        `✅ Result (${targetLang}): ${translated}`
    }
  } catch (err) {
    return {
      success: false,
      message: `❌ Gagal translate: ${err.message}`
    }
  }
}

// Detect bahasa
async function detectLanguage(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    })
    const data = await res.json()
    return data[2] || 'unknown'
  } catch {
    return 'unknown'
  }
}

// Daftar bahasa yang didukung
const LANGUAGES = {
  'id': 'Indonesia', 'en': 'English', 'ja': '日本語', 'ko': '한국어',
  'zh': '中文', 'ar': 'العربية', 'hi': 'हिन्दी', 'th': 'ไทย',
  'vi': 'Tiếng Việt', 'ms': 'Bahasa Melayu', 'tl': 'Filipino',
  'es': 'Español', 'fr': 'Français', 'de': 'Deutsch', 'it': 'Italiano',
  'pt': 'Português', 'ru': 'Русский', 'tr': 'Türkçe', 'nl': 'Nederlands',
  'pl': 'Polski', 'sv': 'Svenska', 'da': 'Dansk', 'fi': 'Suomi',
  'no': 'Norsk', 'cs': 'Čeština', 'el': 'Ελληνικά', 'he': 'עברית',
  'hu': 'Magyar', 'ro': 'Română', 'uk': 'Українська', 'bg': 'Български',
  'hr': 'Hrvatski', 'sk': 'Slovenčina', 'sl': 'Slovenščina', 'et': 'Eesti',
  'lv': 'Latviešu', 'lt': 'Lietuvių', 'fa': 'فارسی', 'ur': 'اردو',
  'bn': 'বাংলা', 'ta': 'தமிழ்', 'te': 'తెలుగు', 'mr': 'मराठी',
  'gu': 'ગુજરાતી', 'kn': 'ಕನ್ನಡ', 'ml': 'മലയാളം', 'pa': 'ਪੰਜਾਬੀ',
  'si': 'සිංහල', 'my': 'မြန်မာ', 'km': 'ខ្មែរ', 'lo': 'ລາວ',
  'am': 'አማርኛ', 'sw': 'Kiswahili', 'yo': 'Yorùbá', 'ig': 'Igbo',
  'ha': 'Hausa', 'zu': 'isiZulu', 'xh': 'isiXhosa', 'af': 'Afrikaans',
  'sq': 'Shqip', 'az': 'Azərbaycan', 'be': 'Беларуская', 'bs': 'Bosanski',
  'ca': 'Català', 'cy': 'Cymraeg', 'eo': 'Esperanto', 'eu': 'Euskara',
  'ga': 'Gaeilge', 'gl': 'Galego', 'hy': 'Հայերեն', 'is': 'Íslenska',
  'ka': 'ქართული', 'kk': 'Қазақ', 'ky': 'Кыргыз', 'mk': 'Македонски',
  'mn': 'Монгол', 'ne': 'नेपाली', 'ps': 'پښتو', 'so': 'Soomaali',
  'su': 'Basa Sunda', 'mg': 'Malagasy', 'mi': 'Māori', 'mt': 'Malti',
}

// ─── CALCULATOR ───────────────────────────────────────────────
function calculate(expression) {
  try {
    // Sanitize input - only allow numbers, operators, parentheses, functions
    const sanitized = expression
      .replace(/[^0-9+\-*/().%^sqrt|sin|cos|tan|log|ln|pi|e|abs|round|floor|ceil|pow|sqrt|cbrt|exp| ]/gi, '')
      .replace(/\^/g, '**') // Support ^ as power
      .replace(/sqrt/gi, 'Math.sqrt')
      .replace(/sin/gi, 'Math.sin')
      .replace(/cos/gi, 'Math.cos')
      .replace(/tan/gi, 'Math.tan')
      .replace(/log/gi, 'Math.log10')
      .replace(/ln/gi, 'Math.log')
      .replace(/abs/gi, 'Math.abs')
      .replace(/round/gi, 'Math.round')
      .replace(/floor/gi, 'Math.floor')
      .replace(/ceil/gi, 'Math.ceil')
      .replace(/pi/gi, 'Math.PI')
      .replace(/(?<![a-zA-Z])e(?![a-zA-Z])/gi, 'Math.E')
      .replace(/pow/gi, 'Math.pow')
      .replace(/cbrt/gi, 'Math.cbrt')
      .replace(/exp/gi, 'Math.exp')
    
    // Evaluate
    const result = Function('"use strict"; return (' + sanitized + ')')()
    
    if (typeof result !== 'number' || isNaN(result)) {
      throw new Error('Invalid result')
    }
    
    // Format result
    let formatted
    if (Number.isInteger(result)) {
      formatted = result.toLocaleString('id-ID')
    } else {
      formatted = result.toFixed(8).replace(/\.?0+$/, '')
    }
    
    return {
      success: true,
      expression: expression,
      result: formatted,
      message: `🧮 *CALCULATOR*\n\n` +
        `📝 ${expression}\n` +
        `= *${formatted}*`
    }
  } catch (err) {
    return {
      success: false,
      message: `❌ Error: Ekspresi ga valid!\n\n` +
        `Contoh: .calc 2+2*3\n` +
        `Fungsi: sqrt, sin, cos, tan, log, pow\n` +
        `Konstanta: pi, e`
    }
  }
}

// ─── VOICE NOTE ───────────────────────────────────────────────
// Pakai edge-tts (Microsoft) dengan suara imut
// Convert MP3 → OGG/Opus biar WhatsApp detect sebagai voice note

function resolveEdgeTtsBin() {
  const candidates = [
    process.env.EDGE_TTS_BIN,
    process.env.EDGE_TTS_PATH,
    path.join(process.env.HERMES_HOME || '/opt/data', 'bin', 'edge-tts'),
    path.join(process.env.HERMES_HOME || '/opt/data', 'venvs', 'wa-tools', 'bin', 'edge-tts'),
    '/opt/data/bin/edge-tts',
    '/opt/data/venvs/wa-tools/bin/edge-tts',
    '/usr/local/bin/edge-tts',
    'edge-tts',
  ].filter(Boolean)
  for (const bin of candidates) {
    if (bin === 'edge-tts') return bin
    try {
      if (fs.existsSync(bin)) return bin
    } catch {}
  }
  return 'edge-tts'
}

async function textToVoice(text, voice = 'en-US-AnaNeural') {
  try {
    const tmpDir = path.join(process.env.HERMES_HOME || '/opt/data', 'tmp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    
    const ts = Date.now()
    const mp3File = path.join(tmpDir, `vn_${ts}.mp3`)
    const oggFile = path.join(tmpDir, `vn_${ts}.ogg`)
    
    // Sanitize text - remove special chars that might break command
    const safeText = text.replace(/["'`\\]/g, '').replace(/\n/g, ' ')
    
    // Step 1: Generate MP3 with edge-tts
    const { spawn } = require('child_process')
    const edgeTtsBin = resolveEdgeTtsBin()
    
    await new Promise((resolve, reject) => {
      const proc = spawn(edgeTtsBin, [
        '--voice', voice,
        '--text', safeText,
        '--write-media', mp3File
      ], {
        timeout: 60000,
        env: {
          ...process.env,
          PATH: `/opt/data/bin:/opt/data/venvs/wa-tools/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
        },
      })
      
      let stderr = ''
      proc.stderr.on('data', d => stderr += d.toString())
      
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(mp3File)) {
          resolve()
        } else {
          reject(new Error(`edge-tts exit code ${code}: ${stderr}`))
        }
      })
      
      proc.on('error', (err) => {
        reject(new Error(`edge-tts error: ${err.message} (bin=${edgeTtsBin})`))
      })
    })

    // Step 2: Convert MP3 → OGG/Opus (WhatsApp voice note format)
    await new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-y',                    // overwrite
        '-i', mp3File,           // input
        '-c:a', 'libopus',       // Opus codec
        '-b:a', '128k',          // bitrate
        '-vn',                   // no video
        '-ar', '48000',          // sample rate
        '-ac', '1',              // mono
        '-application', 'voip',  // optimized for voice
        oggFile
      ], { timeout: 30000 })

      let stderr = ''
      proc.stderr.on('data', d => stderr += d.toString())

      proc.on('close', (code) => {
        // Cleanup MP3
        try { fs.unlinkSync(mp3File) } catch {}
        if (code === 0 && fs.existsSync(oggFile)) {
          resolve()
        } else {
          reject(new Error(`ffmpeg exit code ${code}: ${stderr.slice(-200)}`))
        }
      })

      proc.on('error', (err) => {
        try { fs.unlinkSync(mp3File) } catch {}
        reject(new Error(`ffmpeg error: ${err.message}`))
      })
    })

    return {
      success: true,
      path: oggFile,
      voice: voice,
      message: '🎤 Voice note berhasil dibuat!'
    }
  } catch (err) {
    return {
      success: false,
      message: `❌ Gagal bikin voice note: ${err.message}\n\nPastikan edge-tts & ffmpeg terinstall:\npython3 -m venv /opt/data/venvs/wa-tools && /opt/data/venvs/wa-tools/bin/pip install edge-tts\napt install ffmpeg`
    }
  }
}

// Daftar suara imut
const CUTE_VOICES = {
  'en': { name: 'en-US-AnaNeural', desc: '🇺🇸 Ana (Cute Girl)' },
  'en-m': { name: 'en-US-GuyNeural', desc: '🇺🇸 Guy (Male)' },
  'en-uk': { name: 'en-GB-SoniaNeural', desc: '🇬🇧 Sonia (British)' },
  'ja': { name: 'ja-JP-NanamiNeural', desc: '🇯🇵 Nanami (Anime Girl)' },
  'ko': { name: 'ko-KR-SunHiNeural', desc: '🇰🇷 SunHi (Korean Girl)' },
  'zh': { name: 'zh-CN-XiaoxiaoNeural', desc: '🇨🇳 Xiaoxiao (Chinese Girl)' },
  'id': { name: 'id-ID-GadisNeural', desc: '🇮🇩 Gadis (Indonesia)' },
  'id-m': { name: 'id-ID-ArdiNeural', desc: '🇮🇩 Ardi (Cowok)' },
  'es': { name: 'es-ES-ElviraNeural', desc: '🇪🇸 Elvira (Spanish)' },
  'fr': { name: 'fr-FR-DeniseNeural', desc: '🇫🇷 Denise (French)' },
  'de': { name: 'de-DE-KatjaNeural', desc: '🇩🇪 Katja (German)' },
  'pt': { name: 'pt-BR-FranciscaNeural', desc: '🇧🇷 Francisca (Brazilian)' },
  'ar': { name: 'ar-SA-ZariyahNeural', desc: '🇸🇦 Zariyah (Arabic)' },
  'th': { name: 'th-TH-PremwadeeNeural', desc: '🇹🇭 Premwadee (Thai)' },
  'vi': { name: 'vi-VN-HoaiMyNeural', desc: '🇻🇳 HoaiMy (Vietnamese)' },
  'ms': { name: 'ms-MY-YasminNeural', desc: '🇲🇾 Yasmin (Malay)' },
  'ru': { name: 'ru-RU-SvetlanaNeural', desc: '🇷🇺 Svetlana (Russian)' },
  'it': { name: 'it-IT-ElsaNeural', desc: '🇮🇹 Elsa (Italian)' },
  'tr': { name: 'tr-TR-EmelNeural', desc: '🇹🇷 Emel (Turkish)' },
  'hi': { name: 'hi-IN-SwaraNeural', desc: '🇮🇳 Swara (Hindi)' },
}

// ─── EXPORTS ──────────────────────────────────────────────────
module.exports = {
  translate,
  detectLanguage,
  LANGUAGES,
  calculate,
  textToVoice,
  CUTE_VOICES,
}
