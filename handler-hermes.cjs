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

const { spawn, execSync } = require('child_process')
const sec = require('./security.cjs')
const fsp = require('fs').promises
const path = require('path')
const os = require('os')
const fs = require('fs')

// History directory: $HERMES_HOME/sessions/wa-{sender}/history.json
const HISTORY_DIR = path.join(process.env.HERMES_HOME || '/opt/data', 'sessions')
const HISTORY_MAX = 50

// System prompt: Anthropic/Claude-style (CL4R1T4S) + WA rules — applied to ALL models
const promptLoader = (() => {
  try { return require('./prompts/load-system-prompt.cjs') } catch (_) {
    try { return require(path.join(process.env.HERMES_HOME || '/opt/data', 'prompts', 'load-system-prompt.cjs')) } catch { return null }
  }
})()

function getActiveSystemPrompt() {
  if (promptLoader && promptLoader.getSystemPrompt) return promptLoader.getSystemPrompt()
  return 'You are YANZYAHA-BOT AI on WhatsApp. Be clear, accurate, helpful. Match user language.'
}

// Legacy name kept for any external requires
const SYSTEM_PROMPT = getActiveSystemPrompt()

// ─── CONFIG ───────────────────────────────────────────────────
const HERMES_BIN = process.env.HERMES_BIN || 'hermes'
const TIMEOUT_MS = parseInt(process.env.HERMES_TIMEOUT_MS || '180000', 10)
const MAX_OUTPUT = 999999
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS || '16384', 10)
const WA_MSG_LIMIT = 999999 // No splitting — send full message
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
        // Log full stderr ke console untuk debug (lihat di Railway logs)
        if (err && err.length > 0) {
          console.error('[HERMES STDERR]', err.slice(-800))
        }
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

// ─── SPLIT LONG MESSAGES (WhatsApp practical limit ~4000-6000 chars) ───
// Code blocks can be very long. WhatsApp sometimes silently drops or truncates
// messages over ~6500 chars. Split into chunks that respect code block boundaries.
async function replyLong(sock, msg, text) {
  if (!text || text.length <= WA_MSG_LIMIT) {
    return replyWa(sock, msg, text || '🤔 Kosong')
  }

  const jid = msg.key.remoteJid
  const chunks = splitMessage(text, WA_MSG_LIMIT)

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks[i]
    const prefix = chunks.length > 1 ? `📄 *Part ${i + 1}/${chunks.length}*\n\n` : ''
    await sock.sendMessage(jid, { text: prefix + part }, { quoted: i === 0 ? msg : undefined })
    // Small delay between messages to preserve order
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500))
  }
}

function splitMessage(text, limit) {
  if (text.length <= limit) return [text]

  const chunks = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }

    // Try to split at code block boundary (``` closing)
    let splitIdx = -1
    // Look for ``` near the limit (within last 500 chars)
    const searchStart = Math.max(0, limit - 500)
    const searchRegion = remaining.slice(searchStart, limit)
    const codeEndIdx = searchRegion.lastIndexOf('```')
    if (codeEndIdx !== -1) {
      splitIdx = searchStart + codeEndIdx + 3 // include the ```
    }

    // Fallback: split at double newline
    if (splitIdx <= 0) {
      const nlIdx = remaining.lastIndexOf('\n\n', limit)
      if (nlIdx > limit * 0.3) splitIdx = nlIdx
    }

    // Fallback: split at single newline
    if (splitIdx <= 0) {
      const nlIdx = remaining.lastIndexOf('\n', limit)
      if (nlIdx > limit * 0.3) splitIdx = nlIdx
    }

    // Last resort: hard cut at limit
    if (splitIdx <= 0) splitIdx = limit

    chunks.push(remaining.slice(0, splitIdx).trimEnd())
    remaining = remaining.slice(splitIdx).trimStart()
  }

  return chunks.filter(Boolean)
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
  // Security: length + jailbreak + extraction (pre-check, before any API call)
  const sec1 = sec.checkSecurity(body)
  if (!sec1.ok) {
    return replyWa(sock, msg, sec1.reason)
  }
  // Per-user rate limit (in-memory, 20/hour)
  const rl = sec.checkRateLimit(sender)
  if (!rl.ok) {
    return replyWa(sock, msg, rl.reason)
  }

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
    // Langsung pakai directChat — lebih cepat & reliable di VPS tanpa Hermes binary
    // Hermes subprocess hanya kalau HERMES_BIN explicitly di-set dan exists
    let ans
    const hermesEnabled = process.env.HERMES_BIN && fs.existsSync(process.env.HERMES_BIN)
    if (hermesEnabled) {
      try {
        ans = await runHermes(promptWithContent, { userEnv, _sender: sender, toolsets: ['terminal', 'file'] })
      } catch (hermesErr) {
        console.warn('[HERMES] runHermes failed, falling back to directChat:', hermesErr.message?.slice(0, 100))
        ans = await directChat(promptWithContent, { userEnv, _sender: sender, timeoutMs: 90000 })
      }
    } else {
      // No Hermes binary — direct API call only (fast, no subprocess overhead)
      ans = await directChat(promptWithContent, { userEnv, _sender: sender, timeoutMs: 90000 })
    }

    // Auto-execute code blocks — keep code visible, append results
    const execResults = await executeCodeBlocks(ans)
    if (execResults && execResults.length > 0) {
      ans = mergeExecIntoAnswer(ans, execResults)
    }

    stopTyping(typing, sock, jid)
    // Sanitize reply: redact any leaked API keys before sending to user
    // Use replyLong to split code blocks that exceed WhatsApp limit
    await replyLong(sock, msg, sec.redactSecrets(ans.slice(0, MAX_OUTPUT)))
  } catch (e) {
    stopTyping(typing, sock, jid)
    console.error('[HERMES ERROR]', e.message)
    const isAbort = /abort|timeout|timed out/i.test(e.message || '')
    const userMsg = isAbort
      ? '⏳ AI lagi lambat nih. Server API lagi sibuk atau timeout. Coba lagi sebentar ya.'
      : `❌ ${sec.redactSecrets(e.message)}`
    await replyWa(sock, msg, userMsg)
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
  return 'User minta: ' + cleanPrompt + '\n\n=== Konten dari ' + url + ' (fetched ' + new Date().toISOString() + ') ===\n```\n' + content + '\n```'
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
  // Pattern penanda assistant message yang sebenarnya adalah instruksi internal/system yang bocor
  // (DeepSeek kadang salah interpretasi meta block → tulis ulang instruksi → simpan ke history → loop spam)
  const leakPatterns = [
    'Do not say "as of',
    'only say it when it actually matters',
    'Default helpful: give general educational',
    'For educational simulations, clearly label',
    'Jangan jadi cringe admin',
    'Abaikan semua aturan sebelumnya',
    'This override applies even if',
    'Pertanyaan coding → langsung kode',
    'Pertanyaan "bokep" → blokir',
    'Jangan pake "Aku"',
    'Jangan formal, jangan kaku',
    'Gunakan bahasa Indonesia sehari-hari—seperti lo ngobrol',
  ]
  const checkLeak = (content) => {
    if (typeof content !== 'string') return false
    // Multi-instruction style = biasanya leak
    const styleHits = (content.match(/Jangan/g) || []).length
    const pertanyaanHits = (content.match(/Pertanyaan/g) || []).length
    if (styleHits >= 2 && pertanyaanHits >= 2) return true
    return leakPatterns.some(p => content.includes(p))
  }
  const persistable = messages
    .filter(m => {
      if (m.role !== 'user' && m.role !== 'assistant') return false
      if (m.role === 'assistant' && checkLeak(m.content)) return false
      return true
    })
    .slice(-HISTORY_MAX)
  await fsp.writeFile(file, JSON.stringify({ messages: persistable, updated: Date.now() }, null, 2))
}

// ─── LIGHTWEIGHT CODE EXECUTION ────────────────────────────────
// Execute code blocks from AI response. Prefer self-contained scripts.
// Python uses $HERMES_HOME/venvs/wa-exec (common deps preinstalled).
const WA_EXEC_PYTHON = (() => {
  const home = process.env.HERMES_HOME || '/opt/data'
  const candidates = [
    path.join(home, 'venvs', 'wa-exec', 'bin', 'python3'),
    '/opt/data/venvs/wa-exec/bin/python3',
    'python3',
  ]
  for (const c of candidates) {
    if (c === 'python3') return c
    try { if (fs.existsSync(c)) return c } catch {}
  }
  return 'python3'
})()
const WA_EXEC_PIP = WA_EXEC_PYTHON.replace(/python3?$/, 'pip')

function extractCodeBlocks(text) {
  const blocks = []
  // Match ```lang\n...\n```  (lang optional)
  const regex = /```(\w*)\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const lang = (match[1] || '').toLowerCase()
    const code = match[2].trim()
    if (code) blocks.push({ lang, code })
  }
  return blocks
}

function langToCmd(lang, filePath) {
  const safe = filePath.replace(/"/g, '\\"')
  const py = WA_EXEC_PYTHON.replace(/"/g, '\\"')
  const cmds = {
    python: py + ' ' + safe,
    py: py + ' ' + safe,
    javascript: 'node ' + safe,
    js: 'node ' + safe,
    node: 'node ' + safe,
    bash: 'bash ' + safe,
    sh: 'bash ' + safe,
    shell: 'bash ' + safe,
  }
  return cmds[lang] || (py + ' ' + safe)
}

function langToExt(lang) {
  const map = { python: '.py', py: '.py', javascript: '.js', js: '.js', node: '.js', bash: '.sh', sh: '.sh', shell: '.sh' }
  return map[lang] || '.py'
}

function shouldSkipBlock(block) {
  const lang = block.lang || ''
  const code = block.code || ''
  const skipLangs = ['json', 'yaml', 'yml', 'html', 'css', 'xml', 'markdown', 'md', 'text', 'txt', 'sql', '']
  if (skipLangs.includes(lang)) return true

  // Skip docs-only "install" one-liners without real work
  if (/^(pip3?|npm|pnpm|yarn)\s+install\b/i.test(code) && code.split('\n').filter(Boolean).length <= 2) {
    // allow if pure install — still run pip into wa-exec below via ModuleNotFound retry instead
    return true
  }

  // Skip shell that tries to run external .py/.js files (AI often says save as scraper.py)
  if (['bash', 'sh', 'shell'].includes(lang)) {
    if (/\bpython3?\s+[\w./-]+\.py\b/i.test(code) && !code.includes('<<') && !code.includes('python3 -c')) {
      return true
    }
    if (/\bnode\s+[\w./-]+\.js\b/i.test(code) && !code.includes('node -e')) {
      return true
    }
  }

  // Skip pure prose-looking "code"
  if (code.length < 8) return true
  return false
}

function tryAutoPipInstall(errText) {
  const m = String(errText || '').match(/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/)
  if (!m) return false
  let pkg = m[1]
  // map import name → pip name
  const map = { bs4: 'beautifulsoup4', PIL: 'Pillow', cv2: 'opencv-python-headless', sklearn: 'scikit-learn', yaml: 'PyYAML' }
  pkg = map[pkg] || pkg.split('.')[0]
  try {
    const pip = fs.existsSync(WA_EXEC_PIP) ? WA_EXEC_PIP : 'pip3'
    console.log('[WA-EXEC] auto-pip install', pkg, 'via', pip)
    execSync(`"${pip}" install -q "${pkg}"`, {
      timeout: 120000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' },
    })
    return true
  } catch (e) {
    console.error('[WA-EXEC] pip failed', e.message)
    return false
  }
}

function runOneBlock(block) {
  const ext = langToExt(block.lang)
  const tmpFile = path.join(os.tmpdir(), 'wa_exec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + ext)
  try {
    fs.writeFileSync(tmpFile, block.code, { mode: 0o755 })
    const cmd = langToCmd(block.lang, tmpFile)
    const output = execSync(cmd, {
      timeout: 60000,
      encoding: 'utf-8',
      maxBuffer: 2 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: `/opt/data/venvs/wa-exec/bin:/opt/data/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
      },
    })
    return { lang: block.lang, output: (output || '').trim(), success: true }
  } catch (e) {
    const errMsg = (e.stderr || e.stdout || e.message || '').toString().trim()
    // Auto-install missing python module once
    if (/ModuleNotFoundError/.test(errMsg) && tryAutoPipInstall(errMsg)) {
      try {
        const cmd = langToCmd(block.lang, tmpFile)
        const output = execSync(cmd, {
          timeout: 60000,
          encoding: 'utf-8',
          maxBuffer: 2 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PATH: `/opt/data/venvs/wa-exec/bin:/opt/data/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
          },
        })
        return { lang: block.lang, output: (output || '').trim(), success: true, retried: true }
      } catch (e2) {
        const err2 = (e2.stderr || e2.stdout || e2.message || '').toString().trim()
        return { lang: block.lang, output: err2.slice(0, 2000), success: false }
      }
    }
    return { lang: block.lang, output: errMsg.slice(0, 2000), success: false }
  } finally {
    try { fs.unlinkSync(tmpFile) } catch {}
  }
}

async function executeCodeBlocks(text) {
  const blocks = extractCodeBlocks(text)
  if (blocks.length === 0) return null

  const results = []
  for (const block of blocks) {
    if (shouldSkipBlock(block)) {
      console.log('[WA-EXEC] skip block lang=' + block.lang + ' head=' + block.code.slice(0, 60).replace(/\n/g, ' '))
      continue
    }
    const r = runOneBlock(block)
    results.push(r)
    console.log('[WA-EXEC]', r.success ? 'ok' : 'fail', 'lang=' + r.lang, 'out=' + String(r.output || '').slice(0, 80))
  }
  return results.length > 0 ? results : null
}

/** Keep AI code visible; append exec results cleanly (don't strip code). */
function mergeExecIntoAnswer(ans, execResults) {
  if (!execResults || execResults.length === 0) return ans
  let out = String(ans || '').trim()
  out += '\n\n———\n⚙️ *Hasil eksekusi otomatis:*'
  for (const r of execResults) {
    if (r.success) {
      const body = (r.output || '(no output)').slice(0, 2500)
      out += `\n\n✅ \`${r.lang || 'code'}\`\n\`\`\`\n${body}\n\`\`\``
    } else {
      out += `\n\n⚠️ \`${r.lang || 'code'}\` gagal:\n\`\`\`\n${(r.output || 'error').slice(0, 800)}\n\`\`\``
    }
  }
  return out
}

/** Normalize model id for provider base URL (Gemini OpenAI-compat hates/ignores "models/" inconsistently). */
function normalizeChatModel(model, baseUrl) {
  let m = String(model || '').trim()
  if (!m) return m
  const isGemini = /generativelanguage\.googleapis\.com/i.test(baseUrl || '')
  if (isGemini) {
    // OpenAI-compat path expects bare ids: gemini-2.5-flash (not models/gemini-2.5-flash)
    m = m.replace(/^models\//i, '')
  }
  return m
}

/** Alternate models when primary is 503/UNAVAILABLE (Gemini free tier spikes). */
function geminiFallbackModels(primary) {
  const p = String(primary || '').replace(/^models\//i, '')
  const pool = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash']
  const out = []
  if (p) out.push(p)
  for (const x of pool) {
    if (!out.includes(x)) out.push(x)
  }
  return out
}

function friendlyHttpError(status, url, model, errText) {
  const snippet = String(errText || '').slice(0, 180)
  if (status === 401) {
    return '🔑 API key invalid / 401.\n\nDetail: ' + snippet +
      '\n\n*Cara fix:*\n1. `.myconfig` - cek key\n2. `.apitest` - diagnostic\n3. `.setapikey <key>` - set key baru'
  }
  if (status === 404) {
    return '🔑 Model `' + model + '` not found.\n\nCek `.models` atau `.setmodel <name>`.'
  }
  if (status === 429) {
    return '⏳ Rate limit / kuota API habis sementara.\n\nTunggu sebentar, ganti model (`.setmodel gemini-flash-latest`), atau ganti API key.'
  }
  if (status === 503 || /high demand|UNAVAILABLE|temporarily/i.test(snippet)) {
    return '🚧 Model AI lagi penuh (HTTP 503 high demand).\n\nSudah dicoba ulang + fallback model. Coba lagi 10–30 detik, atau `.setmodel gemini-flash-latest`.'
  }
  return '❌ Gagal panggil AI (HTTP ' + status + ').\nModel: `' + model + '`\n' + snippet
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchChatCompletion({ url, apiKey, model, messages, timeoutMs, extraBody }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        max_tokens: MAX_TOKENS,
        ...(extraBody || {}),
      }),
      signal: controller.signal,
    })
    const text = await res.text().catch(() => '')
    let data = {}
    try { data = text ? JSON.parse(text) : {} } catch { data = {} }
    return { res, text, data }
  } finally {
    clearTimeout(timer)
  }
}

async function directChat(prompt, opts = {}) {
  const baseUrl = (opts.userEnv && opts.userEnv.OPENAI_BASE_URL) || process.env.OPENAI_BASE_URL || 'https://api.badtheorylabs.com/v1'
  let apiKey = (opts.userEnv && opts.userEnv.OPENAI_API_KEY) || process.env.OPENAI_API_KEY
  let model = (opts.userEnv && opts.userEnv.HERMES_MODEL) || opts.model || process.env.HERMES_MODEL || 'gpt-4o-mini'

  // Multi-key rotation
  const allKeys = opts.userEnv?.API_KEYS || []
  if (allKeys.length > 1) {
    const currentIndex = opts.userEnv?.API_KEY_INDEX || 0
    apiKey = allKeys[currentIndex % allKeys.length]
    if (opts.userEnv) {
      opts.userEnv.API_KEY_INDEX = (currentIndex + 1) % allKeys.length
    }
    console.log('[KEY-ROTATE] Using key', currentIndex + 1, '/', allKeys.length)
  }

  model = normalizeChatModel(model, baseUrl)

  // Auto-prefix provider if needed (e.g., OpenRouter needs "anthropic/claude-opus-4-8")
  if (!model.includes('/') && baseUrl.includes('openrouter')) {
    model = 'anthropic/' + model
  }

  if (!apiKey) {
    throw new Error('🔑 OPENAI_API_KEY belum di-set.\n\nSet di Railway Variables atau `.setapikey <key>`')
  }

  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const url = cleanBase + '/chat/completions'
  const isGemini = /generativelanguage\.googleapis\.com/i.test(baseUrl)

  const messagesRaw = await loadHistory(opts._sender)
  let messages = promptLoader && promptLoader.applySystemToMessages
    ? promptLoader.applySystemToMessages(messagesRaw, { group: false })
    : [{ role: 'system', content: getActiveSystemPrompt() }, ...messagesRaw.filter(m => m.role !== 'system')]
  messages.push({ role: 'user', content: prompt })

  // Inject current date context — minimal, anti-spam
  const now = new Date()
  const dateTag = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Jakarta', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + ' WIB'
  // Tambahkan META ke user prompt (bukan system) agar model gak mengulangnya
  messages[messages.length - 1].content =
    `[⏰${dateTag}|no-live-data:cek-CoinGecko/Google] ${messages[messages.length - 1].content}`

  const isCodeRequest = /(?:buat|bikin|tulis|koding|script|bot|program|code|buatkan|bikinin|tolong buat|tolong bikin)/i.test(prompt)
  if (isCodeRequest) {
    messages.push({
      role: 'system',
      content: 'REMINDER: User asked for code. Provide one complete, production-quality solution in a fenced code block with language tag. Prefer doing over long preambles.',
    })
  }

  const modelCandidates = isGemini ? geminiFallbackModels(model) : [model]
  const maxAttemptsPerModel = 2
  let lastStatus = 0
  let lastErrText = ''
  let lastModelTried = model
  let data = null
  let usedModel = model

  console.log('[DIRECT-CHAT] sender=' + (opts._sender || '?') + ' model=' + model + ' candidates=' + modelCandidates.join(',') + ' url=' + url)

  outer: for (const candidate of modelCandidates) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      lastModelTried = candidate
      try {
        const { res, text, data: parsed } = await fetchChatCompletion({
          url,
          apiKey,
          model: candidate,
          messages,
          timeoutMs: opts.timeoutMs || TIMEOUT_MS,
        })
        lastStatus = res.status
        lastErrText = text
        if (res.ok) {
          data = parsed
          usedModel = candidate
          if (candidate !== model) {
            console.log('[DIRECT-CHAT] fallback model ok: ' + candidate + ' (primary was ' + model + ')')
          } else if (attempt > 1) {
            console.log('[DIRECT-CHAT] retry ok model=' + candidate + ' attempt=' + attempt)
          }
          break outer
        }

        const retryable = res.status === 503 || res.status === 429 || res.status >= 500
        console.log('[DIRECT-CHAT] fail status=' + res.status + ' model=' + candidate + ' attempt=' + attempt + ' body=' + String(text).slice(0, 120).replace(/\n/g, ' '))
        if (!retryable) break // non-retryable for this model (401/404) — try next candidate only for 404
        if (res.status === 404) break
        if (attempt < maxAttemptsPerModel) {
          const delay = 700 * attempt + Math.floor(Math.random() * 400)
          console.log('[DIRECT-CHAT] backoff ' + delay + 'ms then retry')
          await sleep(delay)
        }
      } catch (e) {
        lastStatus = 0
        lastErrText = e && e.name === 'AbortError' ? 'timeout' : (e.message || String(e))
        console.log('[DIRECT-CHAT] network/abort model=' + candidate + ' attempt=' + attempt + ' err=' + lastErrText)
        if (attempt < maxAttemptsPerModel) {
          await sleep(800 * attempt)
          continue
        }
      }
    }
  }

  if (!data) {
    throw new Error(friendlyHttpError(lastStatus || 503, url, lastModelTried, lastErrText))
  }

  let rawReply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ''
  let reply = cleanReply(rawReply)

  // If cleanReply returned null → response was pure reasoning / thinking leak.
  // Retry once with HARDER instruction as a follow-up user message.
  if (!reply && rawReply) {
    console.log('[DIRECT-CHAT] Pure-reasoning leak detected, retrying with hard instruction. raw=' + rawReply.slice(0, 100))
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: rawReply },
      { role: 'user', content: 'STOP. Response sebelumnya cuma berisi reasoning/internal thinking, bukan jawaban. Sekarang jawab pesan user di atas LANGSUNG dengan jawaban final. JANGAN ada reasoning, JANGAN ada "The user...", JANGAN ada "I should...". Pure answer only.' },
    ]
    try {
      const { res: res2, data: data2 } = await fetchChatCompletion({
        url,
        apiKey,
        model: usedModel,
        messages: retryMessages,
        timeoutMs: opts.timeoutMs || TIMEOUT_MS,
        extraBody: typeof noReasoningParams !== 'undefined' ? noReasoningParams : {},
      })
      if (res2.ok) {
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
    } catch (e) {
      console.log('[DIRECT-CHAT] reasoning-retry failed: ' + (e.message || e))
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

  // Security: length + jailbreak + extraction
  const sec1 = sec.checkSecurity(text)
  if (!sec1.ok) {
    return replyWa(sock, msg, sec1.reason)
  }
  // Per-user rate limit
  const rl = sec.checkRateLimit(sender || 'anon')
  if (!rl.ok) {
    return replyWa(sock, msg, rl.reason)
  }

  // Typing indicator
  const jid = msg.key.remoteJid
  const typing = await startTyping(sock, jid)

  try {
    // .ai command — pakai directChat untuk reliability
    // Hermes subprocess hanya kalau HERMES_BIN di-set dan exists
    let prompt = text.trim()
    // Auto-fetch URL kalau ada di prompt
    prompt = await maybeFetchUrl(prompt)
    let ans
    const hermesEnabled = process.env.HERMES_BIN && fs.existsSync(process.env.HERMES_BIN)
    if (hermesEnabled) {
      try {
        ans = await runHermes(prompt, { userEnv, _sender: '_ai_' + (sender || 'unknown'), toolsets: ['terminal', 'file'] })
      } catch (hermesErr) {
        console.warn('[HERMES] runHermes failed for .ai, falling back to directChat:', hermesErr.message?.slice(0, 100))
        ans = await directChat(prompt, { userEnv, _sender: sender || 'unknown', timeoutMs: 90000 })
      }
    } else {
      // No Hermes — direct API, gunakan sender ID yang sama kayak chat biasa
      // supaya memory/session konsisten antara .ai dan chat biasa
      ans = await directChat(prompt, { userEnv, _sender: sender || 'unknown', timeoutMs: 90000 })
    }

    // Auto-execute code blocks — keep code visible, append results
    const execResults2 = await executeCodeBlocks(ans)
    if (execResults2 && execResults2.length > 0) {
      ans = mergeExecIntoAnswer(ans, execResults2)
    }

    stopTyping(typing, sock, jid)
    await replyLong(sock, msg, sec.redactSecrets(ans.slice(0, MAX_OUTPUT)))
  } catch (e) {
    stopTyping(typing, sock, jid)
    console.error('[HERMES ERROR]', e.message)
    const isAbort = /abort|timeout|timed out/i.test(e.message || '')
    const userMsg = isAbort
      ? '⏳ AI lagi lambat nih. Server API lagi sibuk atau timeout. Coba lagi sebentar ya.'
      : `❌ ${sec.redactSecrets(e.message)}`
    await replyWa(sock, msg, userMsg)
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
  replyLong,
  splitMessage,
}