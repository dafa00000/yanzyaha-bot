'use strict'
/**
 * handler-config.cjs
 * Owner-only menu buat manage config Hermes Agent via WhatsApp.
 *
 * Commands:
 *   .setapikey <key>     → set OPENAI_API_KEY (sekaligus OPENAI_API_KEYS)
 *   .setbaseurl <url>    → set OPENAI_BASE_URL
 *   .setmodel <model>    → set HERMES_MODEL
 *   .settimeout <ms>     → set HERMES_TIMEOUT_MS
 *   .setlimit <n>        → set WA_AI_DAILY_LIMIT (0 = unlimited)
 *   .showconfig          → show config (API key di-mask)
 *   .resetconfig         → hapus file config.json (balik ke env var Railway)
 *
 * Storage: $HERMES_HOME/config.json
 * Hot-reload: mutate process.env langsung → handler-hermes.cjs auto baca
 */

const fs = require('fs')
const path = require('path')

// ─── CONFIG ───────────────────────────────────────────────────
const HERMES_HOME = process.env.HERMES_HOME || '/opt/data'
const CONFIG_PATH = path.join(HERMES_HOME, 'config.json')

// Whitelist env vars yang boleh di-set dari WA (anti abuse)
const ALLOWED_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_API_KEYS',
  'OPENAI_BASE_URL',
  'HERMES_MODEL',
  'HERMES_TIMEOUT_MS',
  'WA_AI_DAILY_LIMIT',
  'HERMES_BIN',
]

// Owner check (imported dari config.cjs di runtime)
let OWNER_LIDS = []
try {
  const botConfig = require('./config.cjs')
  OWNER_LIDS = [
    (botConfig.ownerNumber || '').replace(/\D/g, ''),
    ...(botConfig.ownerLids || []).map(l => String(l).replace(/\D/g, '')),
  ].filter(Boolean)
} catch (e) {
  console.error('[CONFIG] failed to load config.cjs:', e.message)
}

// ─── LOAD on startup ────────────────────────────────────────
function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    let count = 0
    for (const [k, v] of Object.entries(cfg)) {
      if (ALLOWED_KEYS.includes(k) && v != null && v !== '') {
        process.env[k] = String(v)
        count++
      }
    }
    if (count > 0) {
      console.log(`[CONFIG] Loaded ${count} runtime override(s) from ${CONFIG_PATH}`)
    }
  } catch (e) {
    console.error('[CONFIG] load error:', e.message)
  }
}

// ─── SAVE ─────────────────────────────────────────────────────
function saveConfig(updates) {
  let cfg = {}
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    }
  } catch (e) {
    console.error('[CONFIG] read existing failed:', e.message)
  }

  for (const [k, v] of Object.entries(updates)) {
    if (ALLOWED_KEYS.includes(k) && v != null && v !== '') {
      cfg[k] = String(v)
      process.env[k] = String(v)
    }
  }

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
  return cfg
}

// ─── RESET ────────────────────────────────────────────────────
function resetConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      fs.unlinkSync(CONFIG_PATH)
    }
    // process.env ga di-reset (env Railway tetep ada)
    // next subprocess call akan baca dari process.env yg ada
    return true
  } catch (e) {
    console.error('[CONFIG] reset error:', e.message)
    return false
  }
}

// ─── HELPERS ──────────────────────────────────────────────────
function maskKey(k) {
  if (!k) return '_(unset)_'
  if (k.length <= 8) return '*'.repeat(k.length)
  return k.slice(0, 4) + '****' + k.slice(-4)
}

function isOwner(sender) {
  const num = sender.split('@')[0].split(':')[0].replace(/\D/g, '')
  if (!num) return false
  return OWNER_LIDS.includes(num)
}

// ─── HANDLE ───────────────────────────────────────────────────
async function handle(sock, msg, body, sender) {
  const jid = msg.key.remoteJid

  if (!isOwner(sender)) {
    return sock.sendMessage(jid, {
      text: '❌ Config commands cuma bisa dipake owner.',
    }, { quoted: msg })
  }

  const trimmed = body.trim()
  // Strip leading prefix kalau ada
  const stripped = trimmed.replace(/^[.!]\s*/, '')
  const args = stripped.split(/\s+/)
  const cmd = args[0]?.toLowerCase()
  const value = args.slice(1).join(' ').trim()

  switch (cmd) {
    case 'setapikey':
    case 'setkey': {
      if (!value) {
        return sock.sendMessage(jid, {
          text: '⚠️ Contoh: `.setapikey sk-abc123...`',
        }, { quoted: msg })
      }
      saveConfig({
        OPENAI_API_KEY: value,
        OPENAI_API_KEYS: value,
      })
      return sock.sendMessage(jid, {
        text: `✅ API key disimpan.\nMasked: \`${maskKey(value)}\`\nHot-reload aktif — langsung dipake.`,
      }, { quoted: msg })
    }

    case 'setbaseurl':
    case 'seturl': {
      if (!value || !value.match(/^https?:\/\//)) {
        return sock.sendMessage(jid, {
          text: '⚠️ Contoh: `.setbaseurl https://api.tokenrouter.com/v1`',
        }, { quoted: msg })
      }
      saveConfig({ OPENAI_BASE_URL: value })
      return sock.sendMessage(jid, {
        text: `✅ Base URL disimpan: \`${value}\`\nHot-reload aktif.`,
      }, { quoted: msg })
    }

    case 'setmodel': {
      if (!value) {
        return sock.sendMessage(jid, {
          text: '⚠️ Contoh: `.setmodel anthropic/claude-sonnet-4`',
        }, { quoted: msg })
      }
      saveConfig({ HERMES_MODEL: value })
      return sock.sendMessage(jid, {
        text: `✅ Model disimpan: \`${value}\``,
      }, { quoted: msg })
    }

    case 'settimeout': {
      const ms = parseInt(value, 10)
      if (!ms || ms < 5000 || ms > 600000) {
        return sock.sendMessage(jid, {
          text: '⚠️ Timeout harus 5000-600000 ms.\nContoh: `.settimeout 120000`',
        }, { quoted: msg })
      }
      saveConfig({ HERMES_TIMEOUT_MS: String(ms) })
      return sock.sendMessage(jid, {
        text: `✅ Timeout disimpan: ${ms}ms (${(ms / 1000).toFixed(0)}s)`,
      }, { quoted: msg })
    }

    case 'setlimit':
    case 'setdaily': {
      const n = parseInt(value, 10)
      if (isNaN(n) || n < 0 || n > 10000) {
        return sock.sendMessage(jid, {
          text: '⚠️ Limit harus 0-10000. 0 = unlimited.\nContoh: `.setlimit 50`',
        }, { quoted: msg })
      }
      saveConfig({ WA_AI_DAILY_LIMIT: String(n) })
      return sock.sendMessage(jid, {
        text: `✅ Daily limit disimpan: ${n === 0 ? 'unlimited' : n + ' pesan/hari'}`,
      }, { quoted: msg })
    }

    case 'showconfig':
    case 'cfg': {
      const cfg = (() => {
        try {
          return fs.existsSync(CONFIG_PATH)
            ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
            : {}
        } catch { return {} }
      })()
      const lines = [
        '⚙️ *Current Config*',
        '',
        '`OPENAI_API_KEY`    : ' + maskKey(process.env.OPENAI_API_KEY),
        '`OPENAI_BASE_URL`   : ' + (process.env.OPENAI_BASE_URL || '_(unset)_'),
        '`HERMES_MODEL`      : ' + (process.env.HERMES_MODEL || '_(unset)_'),
        '`HERMES_TIMEOUT_MS` : ' + (process.env.HERMES_TIMEOUT_MS || '90000'),
        '`WA_AI_DAILY_LIMIT` : ' + (process.env.WA_AI_DAILY_LIMIT || '0'),
        '`HERMES_HOME`       : ' + (process.env.HERMES_HOME || '/opt/data'),
        '',
        `📁 Config file: \`${CONFIG_PATH}\``,
        fs.existsSync(CONFIG_PATH) ? '✅ Loaded dari file' : 'ℹ️ Belum ada file (pakai env Railway)',
      ]
      return sock.sendMessage(jid, {
        text: lines.join('\n'),
      }, { quoted: msg })
    }

    case 'resetconfig':
    case 'cfgreset': {
      const ok = resetConfig()
      return sock.sendMessage(jid, {
        text: ok
          ? '✅ Config di-reset. Bot sekarang pake env var Railway.\nRestart untuk efek penuh.'
          : '❌ Reset gagal, cek logs.',
      }, { quoted: msg })
    }

    default:
      return sock.sendMessage(jid, {
        text:
          '⚙️ *Config Commands* (owner only)\n\n' +
          '• `.setapikey <key>`\n' +
          '• `.setbaseurl <url>`\n' +
          '• `.setmodel <model>`\n' +
          '• `.settimeout <ms>` (5000-600000)\n' +
          '• `.setlimit <n>` (0 = unlimited)\n' +
          '• `.showconfig`\n' +
          '• `.resetconfig`\n\n' +
          '💡 Hot-reload: ga perlu restart, langsung dipake.',
      }, { quoted: msg })
  }
}

module.exports = {
  handle,
  loadConfig,
  saveConfig,
  resetConfig,
  ALLOWED_KEYS,
}