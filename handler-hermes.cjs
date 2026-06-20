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

    if (opts.resume) args.push('--continue', opts.resume)
    if (opts.model || DEFAULT_MODEL) {
      args.push('-m', opts.model || DEFAULT_MODEL)
    }
    if (opts.toolsets && opts.toolsets.length) {
      args.push('-t', opts.toolsets.join(','))
    }
    if (opts.workdir) {
      args.push('--workdir', opts.workdir)
    }

    // Build env yang di-forward (only what we need)
    const env = { TERM: 'dumb', NO_COLOR: '1' }
    for (const k of FORWARD_ENV) {
      if (process.env[k]) env[k] = process.env[k]
    }

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

      if (code === 0 && out) {
        resolve(out)
      } else if (code === 0) {
        reject(new Error('Hermes returned no output'))
      } else {
        const tail = (err || out).slice(-400)
        reject(new Error(`exit ${code}: ${tail}`))
      }
    })
  })
}

// ─── WA SEND HELPER ──────────────────────────────────────────
async function replyWa(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
}

// ─── HANDLE: chat bebas (no prefix, private) ─────────────────
async function handleChat(sock, msg, body, sender) {
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

  await replyWa(sock, msg, '🤖 *Hermes thinking...*')

  try {
    const sessionId = senderToSession(sender)
    const ans = await runHermes(body, { resume: sessionId })
    await replyWa(sock, msg, ans.slice(0, MAX_OUTPUT))
  } catch (e) {
    console.error('[HERMES ERROR]', e.message)
    await replyWa(sock, msg, `❌ ${e.message}`)
  }
}

// ─── HANDLE: explicit .ai / .grok command ────────────────────
async function handleCommand(sock, msg, text) {
  if (!text || !text.trim()) {
    return replyWa(
      sock,
      msg,
      '⚠️ Masukkan pertanyaan!\nContoh: `.ai halo apa kabar?`'
    )
  }

  await replyWa(sock, msg, '🤖 *Hermes thinking...*')

  try {
    // .ai command = single-shot, no session (biar ga nyampur context)
    const ans = await runHermes(text.trim())
    await replyWa(sock, msg, ans.slice(0, MAX_OUTPUT))
  } catch (e) {
    console.error('[HERMES ERROR]', e.message)
    await replyWa(sock, msg, `❌ ${e.message}`)
  }
}

// ─── HANDLE: reset session user ──────────────────────────────
async function handleReset(sock, msg, sender) {
  // Hapus daily counter
  dailyCount.delete(sender)
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
  senderToSession,
}