'use strict'
/**
 * handler-hermes.cjs
 * Hermes Agent wrapper untuk yanzyaha-bot.
 *
 * Setiap pesan non-prefix (di private chat) atau command `.ai`/`.grok`
 * → spawn `hermes chat -q "..."` subprocess.
 *
 * Memory per-user via --resume <sender-id>:
 *   - Hermes nyimpen session di $HERMES_HOME/sessions/
 *   - Tiap sender dapet session sendiri, memory persistent across messages
 *   - ⚠️ Railway ephemeral FS = session ilang tiap redeploy (kecuali pake Volume)
 */

const { spawn } = require('child_process')
const fsp = require('fs').promises
const path = require('path')

// History directory: $HERMES_HOME/sessions/wa-{sender}/history.json
const HISTORY_DIR = path.join(process.env.HERMES_HOME || '/opt/data', 'sessions')
const HISTORY_MAX = 50

// System prompt — bikin AI jawab langsung tanpa basa-basi
const SYSTEM_PROMPT = `Kamu adalah asisten WhatsApp casual. Jawab LANGSUNG tanpa basa-basi.

ATURAN KETAT (WAJIB):
- JANGAN mulai dengan Halo, Hai, Tentu, Baik, Oke, Selamat
- JANGAN perkenalkan diri
- JANGAN ulangi pertanyaan user
- JANGAN PERNAH output reasoning, thinking, atau meta-commentary
- JANGAN mulai dengan "The user...", "I should...", "Let me...", "I need to..."
- User HANYA lihat response final kamu — bukan proses berpikir
- Kalau ga tau, bilang 'ga tau' aja
- Langsung ke jawaban/aksi
- Maks 800 karakter kecuali user minta detail
- Pakai markdown kalau perlu (bold, list, code)
- Bahasa: casual Indo/Eng mix, sama seperti user

Contoh BENER:
User: cara install node?
Kamu: bash  brew install node  atau download dari nodejs.org

Contoh SALAH (JANGAN kayak gini):
User: cara install node?
Kamu: Halo! Tentu, saya akan bantu install Node.js ya. Berikut langkah-langkahnya...

Contoh SALAH (JANGAN kayak gini):
User: halo
Kamu: The user is greeting me. I should respond casually and stay in character as a WhatsApp assistant. Hai juga!

Contoh BENER (yang kayak gini):
User: halo
Kamu: hai, ada yang bisa dibantu?`

// ─── CONFIG ───────────────────────────────────────────────────
const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
const TIMEOUT_MS = parseInt(process.env.HERMES_TIMEOUT_MS || '120000', 10)
const MAX_OUTPUT = 4000
const DEFAULT_MODEL = process.env.HERMES_MODEL || ''
const DAILY_LIMIT = parseInt(process.env.WA_AI_DAILY_LIMIT || '0', 10) // 0 = unlimited
const SOURCE_TAG = 'wa-bot'

// Env vars yang di-forward ke subprocess hermes
const FORWARD_ENV = [
  'HERMES_HOME',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_API_KEYS',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'DEEPSEEK_API_KEY',
  'MINIMAX_API_KEY',
  'HF_TOKEN',
  'NOUS_API_KEY',
  'PATH', 'HOME', 'LANG', 'TZ', 'USER',
]

// ─── ANSI STRIP ───────────────────────────────────────────────
function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

// ─── SANITIZE SENDER jadi session ID aman ────────────────────
function senderToSession(sender) {
  // sender bisa: 62895618805248@s.whatsapp.net atau 110857451221063@lid
  // ambil numeric part aja
  const num = sender.split('@')[0].replace(/[^0-9]/g, '')
  return 'wa-' + (num || sender.replace(/[^a-zA-Z0-9_-]/g, '_'))
}

// ─── DAILY COUNTER (in-memory, hilang tiap redeploy) ─────────
const dailyCount = new Map()
function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}
function checkDailyLimit(sender) {
  if (DAILY_LIMIT <= 0) return { ok: true, count: 0, limit: 0 }
  const key = getTodayKey()
  const cur = dailyCount.get(sender)
  if (!cur || cur.date !== key) {
    dailyCount.set(sender, { date: key, count: 0 })
  }
  const data = dailyCount.get(sender)
  if (data.count >= DAILY_LIMIT) {
    return { ok: false, count: data.count, limit: DAILY_LIMIT }
  }
  data.count++
  return { ok: true, count: data.count, limit: DAILY_LIMIT }
}

// ─── CORE: run hermes subprocess ─────────────────────────────
function runHermes(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = ['chat', '-q', prompt, '-Q', '--source', SOURCE_TAG]

    // Force Hermes to use env vars, not cached config.yaml
    // Without these, Hermes uses $HERMES_HOME/config.yaml from startup,
    // which has Railway's OLD (possibly invalid) API key.
    args.push('--ignore-user-config')
    args.push('--ignore-rules')
    // NOTE: --provider flag rejected by Hermes ("Unknown provider 'openai'").
    // Hermes auto-detects provider from env var prefixes (OPENAI_*, ANTHROPIC_*, etc).
    // If Hermes can't auto-detect for tokenrouter, we'll need to bypass Hermes
    // entirely and call the API directly.

    if (opts.resume) args.push('--continue', opts.resume)
    // Resolve model: opts.model > userEnv.HERMES_MODEL > DEFAULT_MODEL (Railway)
    const userModel = (opts.userEnv && opts.userEnv.HERMES_MODEL) || ''
    const effectiveModel = opts.model || userModel || DEFAULT_MODEL
    if (effectiveModel) {
      args.push('-m', effectiveModel)
    }
    if (opts.toolsets && opts.toolsets.length) {
      args.push('-t', opts.toolsets.join(','))
    }
    if (opts.workdir) {
      args.push('--workdir', opts.workdir)
    }

    // Build env yang di-forward (only what we need)
    // Start with parent env (filtered), then override with user-specific env if provided
    const env = { TERM: 'dumb', NO_COLOR: '1' }
    for (const k of FORWARD_ENV) {
      if (process.env[k]) env[k] = process.env[k]
    }
    // Per-user override (from getEffectiveEnv(sender))
    if (opts.userEnv && typeof opts.userEnv === 'object') {
      for (const [k, v] of Object.entries(opts.userEnv)) {
        if (v != null && v !== '') env[k] = String(v)
      }
    }
    // Provide OPENAI_API_KEYS (plural, comma-sep) as fallback
    if (env.OPENAI_API_KEY && !env.OPENAI_API_KEYS) {
      env.OPENAI_API_KEYS = env.OPENAI_API_KEY
    }
    // If model starts with minimax/, also alias key as MINIMAX_API_KEY
    // (in case Hermes routes via Minimax direct provider instead of OpenAI-compatible)
    const modelUsed = (opts.userEnv && opts.userEnv.HERMES_MODEL) || opts.model || DEFAULT_MODEL
    if (modelUsed && /^minimax\//i.test(modelUsed) && env.OPENAI_API_KEY && !env.MINIMAX_API_KEY) {
      env.MINIMAX_API_KEY = env.OPENAI_API_KEY
    }

    // DEBUG: log effective env (masked) and args
    const envLog = {}
    for (const [k, v] of Object.entries(env)) {
      const isSecret = /KEY|TOKEN|SECRET|PASSWORD/i.test(k)
      envLog[k] = (isSecret && v) ? (v.length <= 8 ? '***' : v.slice(0,4) + '****' + v.slice(-4)) : v
    }
    console.log('[HERMES] sender=' + (opts._sender || '?') + ' env=' + JSON.stringify(envLog))
    console.log('[HERMES] args=' + JSON.stringify(args))

    let proc
    try {
      proc = spawn(HERMES_BIN, args, {
        env,
        cwd: opts.workdir || process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      return reject(new Error(`spawn failed: ${e.message}`))
    }

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => (stdout += d.toString()))
    proc.stderr.on('data', d => (stderr += d.toString()))

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM') } catch (_) {}
      setTimeout(() => { try { proc.kill('SIGKILL') } catch (_) {} }, 2000)
      reject(new Error(`Hermes timeout ${TIMEOUT_MS / 1000}s`))
    }, TIMEOUT_MS)

    proc.on('error', e => {
      clearTimeout(timer)
      if (e.code === 'ENOENT') {
        reject(new Error(
          '❌ Hermes binary tidak ditemukan.\n' +
          'Pastikan Dockerfile pake base `nousresearch/hermes-agent:latest` ' +
          'atau install manual di container.'
        ))
      } else {
        reject(new Error(`spawn error: ${e.message}`))
      }
    })

    proc.on('close', code => {
      clearTimeout(timer)
      const out = stripAnsi(stdout).trim()
      const err = stripAnsi(stderr).trim()
      const combined = (out + '\n' + err).trim()

      if (code === 0 && out) {
        resolve(cleanReply(out))
      } else if (code === 0) {
        reject(new Error('Hermes returned no output'))
      } else if (/No session found/i.test(combined) && opts.resume && !opts._retried) {
        // First message from this user — session doesn't exist yet.
        // Retry without --continue so Hermes creates fresh session.
        const retryOpts = Object.assign({}, opts, { resume: null, _retried: true })
        runHermes(prompt, retryOpts).then(resolve, reject)
      // Log full stderr ke console untuk debug (lihat di Railway logs)
      if (err && err.length > 0) {
        console.error('[HERMES STDERR]', err.slice(-800))
      }

      } else if (/401|Authentication|api[_-]?key|invalid[_ ]?api[_ ]?key|missing.*auth/i.test(combined)) {
        // API key missing or invalid — extract detail dari stderr
        const modelMatch = combined.match(/model["'\': ]+([\w\-\/]+)/i)
        const modelInfo = modelMatch ? '\nModel yg diminta: `' + modelMatch[1] + '`' : ''
        const errMatch = combined.match(/(?:error|message)["'\': ]+([^"'\n]+)/i)
        const errDetail = errMatch ? '\nDetail: ' + errMatch[1].slice(0, 150) : ''

        reject(new Error(
          '🔑 API key invalid / model ditolak provider.\n\n' +
          (modelInfo || errDetail || 'Cek Railway Variables atau .myconfig') +
          '\n\n*Cara fix:*\n' +
          '1. Cek API key di dashboard provider\n' +
          '2. Cek model name sesuai format provider\n' +
          '3. `.apitest` buat diagnostic lengkap\n' +
          '4. `.models` buat liat model yang tersedia'
        ))
      } else {
        const tail = combined.slice(-500)
        reject(new Error(`exit ${code}: ${tail}`))
      }
    })
  })
}

// ─── WA SEND HELPER ──────────────────────────────────────────
async function replyWa(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
}

// Typing indicator helper - show "sedang mengetik..." during AI processing.
// Re-send composing every 3s because WA drops the indicator otherwise.
async function startTyping(sock, jid) {
  try { await sock.sendPresenceUpdate('composing', jid) } catch (_) {}
  const interval = setInterval(() => {
    sock.sendPresenceUpdate('composing', jid).catch(() => {})
  }, 3000)
  return interval
}

function stopTyping(interval, sock, jid) {
  if (interval) clearInterval(interval)
  try { sock.sendPresenceUpdate('paused', jid) } catch (_) {}
}

// ─── HANDLE: chat bebas (no prefix, private) ─────────────────
async function handleChat(sock, msg, body, sender, userEnv = null) {
  // Optional daily limit (per-user)
  const limit = checkDailyLimit(sender)
  if (!limit.ok) {
    return replyWa(
      sock,
      msg,
      `⚠️ Limit harian kamu sudah habis (${limit.count}/${limit.limit} pesan). ` +
      `Coba lagi besok ya! 😊`
    )
  }

  // .reset / reset → reset session Hermes user ini
  const trimmed = body.trim().toLowerCase()
  if (trimmed === '.reset' || trimmed === 'reset') {
    return handleReset(sock, msg, sender)
  }

  // Show typing indicator (re-send every 3s to keep alive)
  const jid = msg.key.remoteJid
  const typing = await startTyping(sock, jid)

  try {
    // Auto-fetch URL kalau ada di body
    const promptWithContent = await maybeFetchUrl(body)
    const ans = await directChat(promptWithContent, { userEnv, _sender: sender })
    stopTyping(typing, sock, jid)
    await replyWa(sock, msg, ans.slice(0, MAX_OUTPUT))
  } catch (e) {
    stopTyping(typing, sock, jid)
    console.error('[HERMES ERROR]', e.message)
    await replyWa(sock, msg, `\u274c ${e.message}`)
  }
}

// ---- DIRECT API CHAT (OpenAI-compatible) ----
// Bypasses Hermes CLI - works reliably with per-user config.
// .ai command still uses Hermes CLI for full tools/skills.

// Reasoning-as-answer patterns. Models leak these as plain text (no think tags)
// when reasoning is enabled at API level or system prompt is ignored.
// Each alternative ends with \b so it matches at end of string too, not just before space.
// Covers: meta-instruction ("The user is X", "I should...", "Let me think..."),
//          tone directives ("Keep it casual", "Be brief", "Stay in character"),
//          meta-narration ("My response is...", "OK so...").
const REASONING_START_RE = /^\s*(?:The user (?:is|asked|wants|seems|appears|might|probably|greeted|says|said|told|pinged|just|replied|wrote)\b|I (?:should|need to|will|am going|must|have to|'ll)\b|Let me (?:think|consider|figure|start|write|respond|give|try|analyze|check)\b|My (?:response|answer|task|goal) is\b|I'll (?:need|start|write|generate|provide|create|respond|give|help)\b|OK,? so\b|Alright,? so\b|First,? I\b|Since the user\b|Given that\b|Looking at (?:the|this)\b|Based on (?:the|this)\b|I(?:'m| am) (?:going to|about to)\b|Keep it (?:light|casual|brief|friendly|short|simple|engaging|positive|professional|short and|safe|fresh|natural|warm)\b|Stay in character\b|Be (?:friendly|casual|brief|concise|short|professional|warm|positive|natural|helpful)\b)/i

function isReasoningText(s) {
  return REASONING_START_RE.test(s)
}

function cleanReply(text) {
  if (!text) return null
  let s = String(text).trim()
  if (!s) return null

  // 1. Strip complete think blocks (greedy multiline)
  const thinkRe = /<\/?think(?:ing)?>/gi
  s = s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim()

  // 2. Strip orphan think tags
  s = s.replace(thinkRe, '').trim()
  if (!s) return null

  // 3. Detect reasoning-as-answer (no tags, just meta-commentary as response)
  if (isReasoningText(s)) {
    // 3a. Try splitting by blank line and keeping non-reasoning paragraphs
    const paras = s.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    const cleanParas = paras.filter(p => !isReasoningText(p))
    if (cleanParas.length) {
      s = cleanParas.join('\n\n').trim()
    } else {
      // 3b. Try sentence-level extraction — keep sentences that aren't reasoning
      const sentences = s.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean)
      const cleanSentences = sentences.filter(x => !isReasoningText(x))
      if (cleanSentences.length) {
        s = cleanSentences.slice(-2).join(' ').trim()
      } else {
        // 3c. Pure reasoning, no detectable answer — signal failure
        s = ''
      }
    }
  }

  return s || null
}

// ---- URL FETCHER ----
// Detect URL di prompt, fetch contentnya, dan inject ke prompt.
// Khususnya untuk GitHub: convert blob URL ke raw URL biar dapet raw text.
async function fetchUrlContent(url) {
  try {
    // Transform GitHub blob URL ke raw
    let fetchUrl = url
    const ghMatch = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/(.+)$/i)
    if (ghMatch) {
      fetchUrl = 'https://raw.githubusercontent.com/' + ghMatch[1] + '/' + ghMatch[2] + '/' + ghMatch[3]
    }

    const res = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WA-Bot/1.0)' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || ''
    let text = await res.text()

    // Kalau HTML, strip tags
    if (contentType.includes('html') || text.trim().startsWith('<')) {
      text = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
    }
    return text.slice(0, 8000) // hard limit
  } catch (e) {
    console.error('[URL-FETCH]', url, e.message)
    return null
  }
}

// Strip internal reasoning blocks (think, thinking, etc) that some models leak


async function maybeFetchUrl(prompt) {
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/i)
  if (!urlMatch) return prompt
  const url = urlMatch[0].replace(/[)\]}>.,;]+$/, '') // trim trailing punctuation
  console.log('[URL-FETCH] detected:', url)
  const content = await fetchUrlContent(url)
  if (!content) {
    return prompt + '\n\n(Catatan: Bot gagal fetch konten dari ' + url + ')'
  }
  // Remove URL from prompt, prepend fetched content
  const cleanPrompt = prompt.replace(url, '').trim() || 'Jelasin file ini'
  return 'User minta: ' + cleanPrompt + '\n\n=== Konten dari ' + url + ' (fetched ' + new Date().toISOString() + ') ===\n\`\`\`\n' + content + '\n\`\`\`'
}

async function loadHistory(sender) {
  const sessionId = senderToSession(sender)
  const file = path.join(HISTORY_DIR, sessionId, 'history.json')
  try {
    const raw = await fsp.readFile(file, 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data.messages) ? data.messages : []
  } catch {
    return []
  }
}

async function saveHistory(sender, messages) {
  const sessionId = senderToSession(sender)
  const file = path.join(HISTORY_DIR, sessionId, 'history.json')
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const trimmed = messages.slice(-HISTORY_MAX)
  await fsp.writeFile(file, JSON.stringify({ messages: trimmed, updated: Date.now() }, null, 2))
}

async function directChat(prompt, opts = {}) {
  const baseUrl = (opts.userEnv && opts.userEnv.OPENAI_BASE_URL) || process.env.OPENAI_BASE_URL || 'https://api.tokenrouter.com/v1'
  const apiKey = (opts.userEnv && opts.userEnv.OPENAI_API_KEY) || process.env.OPENAI_API_KEY
  const model = (opts.userEnv && opts.userEnv.HERMES_MODEL) || opts.model || process.env.HERMES_MODEL || 'MiniMax-M3'

  if (!apiKey) {
    throw new Error('🔑 OPENAI_API_KEY belum di-set.\\n\\nSet di Railway Variables atau `.setapikey <key>`')
  }

  // Strip trailing slash, append /chat/completions (no regex hell)
  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const url = cleanBase + '/chat/completions'

  const messages = await loadHistory(opts._sender)
  // Inject system prompt di awal (sekali per session)
  if (!messages.find(m => m.role === 'system')) {
    messages.unshift({ role: 'system', content: SYSTEM_PROMPT })
  }
  messages.push({ role: 'user', content: prompt })

  console.log('[DIRECT-CHAT] sender=' + (opts._sender || '?') + ' model=' + model + ' url=' + url)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || TIMEOUT_MS)

  // Pass multiple "disable reasoning" params — provider picks what it supports
  // - enable_thinking: Qwen-style + tokenrouter passthrough
  // - reasoning: false: OpenAI o-series
  // - thinking: {type: disabled}: Anthropic
  const noReasoningParams = {
    enable_thinking: false,
    reasoning: false,
    thinking: { type: 'disabled' },
    chat_template_kwargs: { enable_thinking: false },
  }

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: model, messages: messages, stream: false, ...noReasoningParams }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    let msg = 'HTTP ' + res.status + ' dari ' + url + '\\n' + errText.slice(0, 300)
    if (res.status === 401) {
      msg = '🔑 API key invalid / 401.\\n\\nDetail: ' + errText.slice(0, 200) + '\\n\\n*Cara fix:*\\n' +
            '1. `.myconfig` - cek key\\n' +
            '2. `.apitest` - diagnostic\\n' +
            '3. `.setapikey <key>` - set key baru'
    } else if (res.status === 404) {
      msg = '🔑 Model `' + model + '` not found.\\n\\nCek `.models` atau `.setmodel <name>`.'
    } else if (res.status === 429) {
      msg = '⏳ Rate limit.\\n\\nTunggu atau ganti API key.'
    }
    throw new Error(msg)
  }

  const data = await res.json().catch(() => ({}))
  let rawReply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''
  let reply = cleanReply(rawReply)

  // If cleanReply returned null → response was pure reasoning / thinking leak.
  // Retry once with HARDER instruction as a follow-up user message.
  if (!reply && rawReply) {
    console.log('[DIRECT-CHAT] Pure-reasoning leak detected, retrying with hard instruction. raw=' + rawReply.slice(0, 100))
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: rawReply },
      { role: 'user', content: 'STOP. Response sebelumnya cuma berisi reasoning/internal thinking, bukan jawaban. Sekarang jawab pesan user di atas LANGSUNG dengan jawaban final. JANGAN ada reasoning, JANGAN ada "The user...", JANGAN ada "I should...". Pure answer only.' }
    ]
    const controller2 = new AbortController()
    const timer2 = setTimeout(() => controller2.abort(), opts.timeoutMs || TIMEOUT_MS)
    let res2
    try {
      res2 = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: retryMessages, stream: false, temperature: 0.3, ...noReasoningParams }),
        signal: controller2.signal,
      })
    } finally {
      clearTimeout(timer2)
    }
    if (res2.ok) {
      const data2 = await res2.json().catch(() => ({}))
      const raw2 = (data2.choices && data2.choices[0] && data2.choices[0].message && data2.choices[0].message.content) || ''
      const cleaned2 = cleanReply(raw2)
      if (cleaned2) {
        reply = cleaned2
        rawReply = raw2
        console.log('[DIRECT-CHAT] Retry succeeded.')
      } else {
        console.log('[DIRECT-CHAT] Retry still leaked. Using fallback.')
        reply = null
      }
    }
  }

  // Final fallback — kalau tetep ga bisa bersih
  if (!reply) {
    reply = '🤔 Lagi mikir keras nih, coba tanya lagi dengan cara lain ya.'
  }

  messages.push({ role: 'assistant', content: reply })
  await saveHistory(opts._sender, messages)

  return reply
}
// ─── HANDLE: explicit .ai / .grok command ────────────────────
async function handleCommand(sock, msg, text, sender = null, userEnv = null) {
  if (!text || !text.trim()) {
    return replyWa(
      sock,
      msg,
      '⚠️ Masukkan pertanyaan!\nContoh: `.ai halo apa kabar?`'
    )
  }

  // Typing indicator
  const jid = msg.key.remoteJid
  const typing = await startTyping(sock, jid)

  try {
    // .ai command juga pake direct API (Hermes CLI ga reliable buat per-user config)
    let prompt = text.trim()
    // Auto-fetch URL kalau ada di prompt
    prompt = await maybeFetchUrl(prompt)
    const ans = await directChat(prompt, { userEnv, _sender: '_ai_' + (sender || 'unknown') })
    stopTyping(typing, sock, jid)
    await replyWa(sock, msg, ans.slice(0, MAX_OUTPUT))
  } catch (e) {
    stopTyping(typing, sock, jid)
    console.error('[HERMES ERROR]', e.message)
    await replyWa(sock, msg, `❌ ${e.message}`)
  }
}

// ─── HANDLE: reset session user ──────────────────────────────
async function handleReset(sock, msg, sender) {
  // Hapus daily counter
  dailyCount.delete(sender)
  // Hapus history file (directChat memory)
  const sessionId = senderToSession(sender)
  const historyFile = path.join(HISTORY_DIR, sessionId, 'history.json')
  try { await fsp.unlink(historyFile) } catch (_) {}
  await replyWa(
    sock,
    msg,
    '🔄 Session direset! Memory chat kamu dengan bot udah dihapus.\n' +
    'Pesan berikutnya akan mulai context baru.'
  )
}

module.exports = {
  handleChat,
  handleCommand,
  handleReset,
  runHermes, // exported for testing
  directChat, // exported for testing
  fetchUrlContent, // exported for testing
  cleanReply, // exported for testing
  maybeFetchUrl, // exported for testing
  senderToSession,
}