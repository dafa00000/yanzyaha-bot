'use strict'
/**
 * handler-config.cjs
 * Config management — global (owner) + per-user.
 *
 * GLOBAL (owner only) — saved to $HERMES_HOME/config.json:
 *   .showconfig   → show global config
 *   .resetconfig  → hapus config.json, balik ke env Railway
 *
 * PER-USER (semua user) — saved to $HERMES_HOME/user_configs.json:
 *   .setapikey <key>   → set OPENAI_API_KEY buat user ini
 *   .setbaseurl <url>  → set OPENAI_BASE_URL
 *   .setmodel <model>  → set HERMES_MODEL
 *   .models            → fetch list model dari effective base_url
 *   .myconfig          → show effective config user ini (masked)
 *
 * Priority per-user: per-user > global env (Railway) > fallback
 */

const fs = require('fs')
const path = require('path')

// ─── CONFIG ───────────────────────────────────────────────────
const HERMES_HOME = process.env.HERMES_HOME || '/opt/data'
const CONFIG_PATH = path.join(HERMES_HOME, 'config.json')
const USER_CONFIG_PATH = path.join(HERMES_HOME, 'user_configs.json')

// Env vars yang boleh di-set per-user
const USER_KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'HERMES_MODEL', 'API_KEYS', 'API_KEY_INDEX']

// Whitelist env vars yang boleh di-set GLOBAL (owner only)
const ALLOWED_KEYS = [
  ...USER_KEYS,
  'OPENAI_API_KEYS',
  'HERMES_TIMEOUT_MS',
  'WA_AI_DAILY_LIMIT',
  'HERMES_BIN',
]

// Owner check
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

// ─── GLOBAL CONFIG ────────────────────────────────────────────
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
      console.log(`[CONFIG] Loaded ${count} global override(s) from ${CONFIG_PATH}`)
    }
  } catch (e) {
    console.error('[CONFIG] global load error:', e.message)
  }
}

function saveConfig(updates) {
  let cfg = {}
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    }
  } catch (e) {
    console.error('[CONFIG] read global failed:', e.message)
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

function resetConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH)
    return true
  } catch (e) {
    return false
  }
}

// ─── PER-USER CONFIG ──────────────────────────────────────────
let userConfigs = new Map() // senderJid -> { OPENAI_API_KEY, OPENAI_BASE_URL, HERMES_MODEL }

function loadUserConfigs() {
  try {
    if (!fs.existsSync(USER_CONFIG_PATH)) {
      console.log('[CONFIG] No user_configs.json at ' + USER_CONFIG_PATH)
      return
    }
    const data = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf8'))
    userConfigs = new Map(Object.entries(data))
    console.log('[CONFIG] Loaded ' + userConfigs.size + ' user config(s) from ' + USER_CONFIG_PATH)
    // Log each sender's config (masked) for debugging
    let i = 0
    for (const [sender, cfg] of userConfigs) {
      const dbg = {}
      for (const [k, v] of Object.entries(cfg)) {
        dbg[k] = /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v ? maskKey(v) : v
      }
      console.log('[CONFIG]   ' + sender + ': ' + JSON.stringify(dbg))
      i++
    }
  } catch (e) {
    console.error('[CONFIG] user configs load error:', e.message)
  }
}

function saveUserConfigs() {
  try {
    const obj = Object.fromEntries(userConfigs)
    fs.mkdirSync(path.dirname(USER_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(obj, null, 2))
    console.log('[CONFIG] Saved ' + userConfigs.size + ' user config(s) to ' + USER_CONFIG_PATH)
  } catch (e) {
    console.error('[CONFIG] user configs save error:', e.message)
  }
}

function getUserConfig(sender) {
  return userConfigs.get(sender) || {}
}

function setUserConfig(sender, updates) {
  const cur = getUserConfig(sender)
  const updated = { ...cur }
  for (const [k, v] of Object.entries(updates)) {
    if (!USER_KEYS.includes(k)) continue
    if (v != null && v !== '') {
      // Preserve arrays, convert everything else to string
      updated[k] = Array.isArray(v) ? v : String(v)
    } else {
      delete updated[k] // unset kalo empty
    }
  }
  if (Object.keys(updated).length === 0) {
    userConfigs.delete(sender)
  } else {
    userConfigs.set(sender, updated)
  }
  saveUserConfigs()
  // DEBUG: log what was saved (mask secrets)
  const dbg = {}
  for (const [k, v] of Object.entries(updated)) {
    dbg[k] = /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && v ? maskKey(v) : v
  }
  console.log('[CONFIG] setUserConfig(' + sender + ') ->', JSON.stringify(dbg))
  return updated
}

function clearUserConfig(sender) {
  userConfigs.delete(sender)
  saveUserConfigs()
}

// Merge: per-user > global env > no value
function getEffectiveEnv(sender) {
  const env = {}
  // Start with Railway env (loaded into process.env by loadConfig already)
  for (const k of USER_KEYS) {
    if (process.env[k]) env[k] = process.env[k]
  }
  // Override with per-user
  const userCfg = getUserConfig(sender)
  for (const [k, v] of Object.entries(userCfg)) {
    if (v != null && v !== '') {
      // Preserve arrays, convert everything else to string
      env[k] = Array.isArray(v) ? v : String(v)
    }
  }
  return env
}

// ─── MODEL FETCHER ────────────────────────────────────────────
const modelsCache = new Map()
const MODELS_CACHE_TTL = 60 * 60 * 1000 // 1 jam

async function fetchModels(baseUrl, apiKey) {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const headers = { 'Accept': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} dari ${url}\n${text.slice(0, 200)}`)
  }
  const data = await res.json()
  // OpenAI format: { data: [{id, ...}, ...] }
  // Beberapa provider balikin array langsung, handle dua-duanya
  const models = Array.isArray(data) ? data : (data.data || [])
  return models
    .map(m => typeof m === 'string' ? m : (m.id || m.name || m.model))
    .filter(Boolean)
    .sort()
}

async function getModelsCached(baseUrl, apiKey) {
  const cacheKey = `${baseUrl}|${(apiKey || '').slice(0, 8)}`
  const cached = modelsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < MODELS_CACHE_TTL) {
    return { models: cached.models, cached: true }
  }
  const models = await fetchModels(baseUrl, apiKey)
  modelsCache.set(cacheKey, { models, at: Date.now() })
  return { models, cached: false }
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

function senderId(sender) {
  // normalize: 628xxx@s.whatsapp.net → 628xxx
  return sender.split('@')[0].split(':')[0]
}

async function replyWa(sock, jid, text, quoted) {
  return sock.sendMessage(jid, { text }, quoted ? { quoted } : {})
}

// ─── MAIN HANDLER ─────────────────────────────────────────────
async function handle(sock, msg, body, sender) {
  const jid = msg.key.remoteJid
  const trimmed = body.trim()
  const stripped = trimmed.replace(/^[.!]\s*/, '') // accept . or / prefix
  const args = stripped.split(/\s+/)
  const cmd = args[0]?.toLowerCase()
  const value = args.slice(1).join(' ').trim()

  // ═══ GLOBAL (owner only) ═══
  if (cmd === 'showconfig' || cmd === 'cfg') {
    if (!isOwner(sender)) {
      return replyWa(sock, jid, '❌ Owner only.', msg)
    }
    return showGlobalConfig(sock, jid, msg)
  }

  if (cmd === 'resetconfig' || cmd === 'cfgreset') {
    if (!isOwner(sender)) {
      return replyWa(sock, jid, '❌ Owner only.', msg)
    }
    const ok = resetConfig()
    return replyWa(sock, jid,
      ok
        ? '✅ Global config di-reset. Bot sekarang pake env var Railway.\n*Restart service untuk efek penuh.*'
        : '❌ Reset gagal.',
      msg
    )
  }

  // ═══ GLOBAL CONFIG SETTERS (owner only, instant effect) ═══
  if (cmd === 'setglobalkey' || cmd === 'setglobalapikey') {
    if (!isOwner(sender)) return replyWa(sock, jid, '❌ Owner only.', msg)
    if (!value) {
      return replyWa(sock, jid,
        '⚠️ Contoh: `.setglobalkey sk-abc123...`\n\n' +
        'Set API key *global* (default buat semua user).\n' +
        'Efek langsung, GA PERLU redeploy Railway!\n\n' +
        'Per-user override tetap jalan (`.setapikey`).',
        msg
      )
    }
    saveConfig({ OPENAI_API_KEY: value })
    return replyWa(sock, jid,
      `✅ *Global API Key* di-update!\n\n` +
      `🔑 Key: \`${maskKey(value)}\`\n` +
      `⚡ Efek: LANGSUNG (ga perlu restart)\n` +
      `📌 Semua user default pake key ini\n` +
      `💡 User bisa override dengan \`.setapikey\``,
      msg
    )
  }

  if (cmd === 'setglobalurl' || cmd === 'setglobalbaseurl') {
    if (!isOwner(sender)) return replyWa(sock, jid, '❌ Owner only.', msg)
    if (!value || !value.match(/^https?:\/\//)) {
      return replyWa(sock, jid,
        '⚠️ Contoh: `.setglobalurl https://api.openrouter.ai/api/v1`\n\n' +
        'Set base URL *global* (default buat semua user).\n' +
        'Efek langsung, GA PERLU redeploy Railway!',
        msg
      )
    }
    saveConfig({ OPENAI_BASE_URL: value })
    // Clear models cache since base URL changed
    modelsCache.clear()
    return replyWa(sock, jid,
      `✅ *Global Base URL* di-update!\n\n` +
      `🌐 URL: \`${value}\`\n` +
      `⚡ Efek: LANGSUNG (ga perlu restart)\n` +
      `📌 Semua user default pake URL ini\n` +
      `💡 User bisa override dengan \`.setbaseurl\``,
      msg
    )
  }

  if (cmd === 'setglobalmodel' || cmd === 'setglobalhermesmodel') {
    if (!isOwner(sender)) return replyWa(sock, jid, '❌ Owner only.', msg)
    if (!value) {
      return replyWa(sock, jid,
        '⚠️ Contoh: `.setglobalmodel anthropic/claude-sonnet-4`\n\n' +
        'Set model AI *global* (default buat semua user).\n' +
        'Efek langsung, GA PERLU redeploy Railway!\n\n' +
        'Cek `.models` buat liat daftar model.',
        msg
      )
    }
    saveConfig({ HERMES_MODEL: value })
    return replyWa(sock, jid,
      `✅ *Global Model* di-update!\n\n` +
      `🤖 Model: \`${value}\`\n` +
      `⚡ Efek: LANGSUNG (ga perlu restart)\n` +
      `📌 Semua user default pake model ini\n` +
      `💡 User bisa override dengan \`.setmodel\``,
      msg
    )
  }

  if (cmd === 'showglobalconfig' || cmd === 'globalconfig' || cmd === 'globalcfg') {
    if (!isOwner(sender)) return replyWa(sock, jid, '❌ Owner only.', msg)
    return showGlobalConfig(sock, jid, msg)
  }

  // ═══ PER-USER (semua user) ═══
  switch (cmd) {
    case 'setapikey':
    case 'myapikey': {
      if (!value) {
        return replyWa(sock, jid,
          '⚠️ Contoh: `.setapikey sk-abc123...`\n\n' +
          'Set API key *pribadi* lo. Billing ke akun lo sendiri.\n' +
          'Kalo ga set, pake API key default dari Railway.\n\n' +
          '🔥 *Multi Key:* Pisahin dengan koma atau enter\n' +
          'Contoh: `.setapikey key1,key2,key3`\n' +
          'Bot otomatis rotate tiap request!',
          msg
        )
      }
      
      // Support multiple keys (comma or newline separated)
      const keys = value.split(/[,\n]+/).map(k => k.trim()).filter(k => k.length > 0)
      
      if (keys.length === 0) {
        return replyWa(sock, jid, '❌ API key ga boleh kosong!', msg)
      }
      
      if (keys.length === 1) {
        // Single key
        setUserConfig(sender, { OPENAI_API_KEY: keys[0] })
        return replyWa(sock, jid,
          `✅ API key lo disimpan.\n` +
          `Masked: \`${maskKey(keys[0])}\`\n\n` +
          'Sekarang lo bisa pake model apapun sesuai billing lo sendiri.',
          msg
        )
      }
      
      // Multiple keys - store as array
      setUserConfig(sender, { 
        OPENAI_API_KEY: keys[0], // Primary key
        API_KEYS: keys, // All keys for rotation
        API_KEY_INDEX: 0 // Current rotation index
      })
      
      return replyWa(sock, jid,
        `✅ *${keys.length} API key* disimpan!\n\n` +
        `🔑 Key 1: \`${maskKey(keys[0])}\`\n` +
        `🔑 Key 2: \`${maskKey(keys[1])}\`\n` +
        (keys.length > 2 ? `🔑 ...dan ${keys.length - 2} key lainnya\n` : '') +
        `\n⚡ Bot otomatis rotate key tiap request!\n` +
        `📊 Total: ${keys.length} key siap dipake`,
        msg
      )
    }
    
    case 'mykeys': {
      const userConf = getUserConfig(sender)
      const keys = userConf?.API_KEYS || []
      if (keys.length === 0) {
        return replyWa(sock, jid,
          '🔑 *Belum ada API key tersimpan*\n\n' +
          'Set dengan: `.setapikey key1,key2,key3`\n' +
          'Bisa set banyak key sekaligus!',
          msg
        )
      }
      
      let keyList = keys.map((k, i) => `${i+1}. \`${maskKey(k)}\``).join('\n')
      return replyWa(sock, jid,
        `🔑 *API Keys Lo*\n\n` +
        `${keyList}\n\n` +
        `📊 Total: ${keys.length} key\n` +
        `⚡ Rotating setiap request`,
        msg
      )
    }

    case 'setbaseurl':
    case 'mybaseurl': {
      if (!value || !value.match(/^https?:\/\//)) {
        return replyWa(sock, jid,
          '⚠️ Contoh: `.setbaseurl https://api.openrouter.ai/api/v1`\n\n' +
          'Default: base_url dari Railway env.',
          msg
        )
      }
      setUserConfig(sender, { OPENAI_BASE_URL: value })
      return replyWa(sock, jid, `✅ Base URL lo: \`${value}\``, msg)
    }

    case 'setmodel':
    case 'mymodel': {
      if (!value) {
        return replyWa(sock, jid,
          '⚠️ Contoh: `.setmodel gemini-2.5-flash`\n\n' +
          'Atau `.models` dulu buat liat daftar model.\n' +
          'Untuk Gemini OpenAI-compat: jangan pakai prefix `models/`.',
          msg
        )
      }
      // Gemini OpenAI-compat: strip models/ prefix so ids match chat/completions
      let modelValue = value.trim()
      const effBase = (getEffectiveEnv(sender).OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || '')
      if (/generativelanguage\.googleapis\.com/i.test(effBase)) {
        modelValue = modelValue.replace(/^models\//i, '')
      }
      setUserConfig(sender, { HERMES_MODEL: modelValue })
      return replyWa(sock, jid, `✅ Model lo: \`${modelValue}\``, msg)
    }

    case 'models': {
      return handleModels(sock, jid, msg, sender)
    }

    case 'apitest':
    case 'testapikey':
    case 'checkapi': {
      return handleApiTest(sock, jid, msg, sender)
    }

    case 'hermesmodel':
    case 'hermesproviders':
    case 'hermescheck': {
      return handleHermesModel(sock, jid, msg)
    }

    case 'myconfig':
    case 'mycfg': {
      return showUserConfig(sock, jid, msg, sender)
    }

    case 'resetmyconfig':
    case 'clearmyconfig': {
      clearUserConfig(sender)
      return replyWa(sock, jid,
        '✅ Config lo di-reset. Sekarang pake default dari Railway.',
        msg
      )
    }

    default:
      // ga ada command yg match
      return null // signal ke caller: bukan config command
  }
}

// ─── .models handler ─────────────────────────────────────────
async function handleModels(sock, jid, msg, sender) {
  const cfg = getEffectiveEnv(sender)
  const baseUrl = cfg.OPENAI_BASE_URL
  const apiKey = cfg.OPENAI_API_KEY

  if (!baseUrl) {
    return replyWa(sock, jid,
      '⚠️ Base URL belum di-set.\n\n' +
      'Set dulu via:\n' +
      '• `.setbaseurl https://api.example.com/v1` (pribadi)\n' +
      '• atau set `OPENAI_BASE_URL` di Railway env (default)\n\n' +
      'Default tokenrouter: `https://api.tokenrouter.com/v1`',
      msg
    )
  }

  await replyWa(sock, jid, '🔄 Fetching models...', msg)

  try {
    const { models, cached } = await getModelsCached(baseUrl, apiKey)
    const userCfg = getUserConfig(sender)
    const userModel = userCfg.HERMES_MODEL || process.env.HERMES_MODEL || ''

    // Group by provider (prefix sebelum /)
    const groups = {}
    for (const m of models) {
      const slashIdx = m.indexOf('/')
      const provider = slashIdx > 0 ? m.slice(0, slashIdx) : 'other'
      const providerName = provider.charAt(0).toUpperCase() + provider.slice(1)
      if (!groups[providerName]) groups[providerName] = []
      groups[providerName].push(m)
    }

    const lines = []
    for (const [provider, list] of Object.entries(groups)) {
      lines.push(`*${provider}* (${list.length})`)
      for (const m of list.slice(0, 30)) {
        const marker = m === userModel ? ' ← aktif' : ''
        lines.push(`  • \`${m}\`${marker}`)
      }
      if (list.length > 30) lines.push(`  _... +${list.length - 30} more_`)
      lines.push('')
    }

    const source = userCfg.OPENAI_BASE_URL
      ? 'base_url lo'
      : 'base_url Railway (default)'

    const cachedNote = cached ? ' (cached)' : ''

    lines.push('━━━━━━━━━━━━━━━━━')
    lines.push(`Total: *${models.length}* model${cachedNote}`)
    lines.push(`Source: ${source}`)
    lines.push('')
    lines.push('Set model: `.setmodel <name>`')

    return replyWa(sock, jid, '🤖 *Available Models*\n\n' + lines.join('\n'), msg)
  } catch (e) {
    return replyWa(sock, jid,
      `❌ Gagal fetch models dari \`${baseUrl}\`\n\n` +
      `Error: ${e.message}\n\n` +
      'Cek:\n' +
      '• Base URL valid?\n' +
      '• API key punya akses?\n' +
      '• Provider support `/models` endpoint?',
      msg
    )
  }
}

// ─── show helpers ────────────────────────────────────────────
async function showUserConfig(sock, jid, msg, sender) {
  const userCfg = getUserConfig(sender)
  const effective = getEffectiveEnv(sender)

  const lines = [
    '⚙️ *Config Lo*',
    '',
    '`API_KEY`   : ' + maskKey(effective.OPENAI_API_KEY) +
      (userCfg.OPENAI_API_KEY ? ' _[custom]_' : ' _[Railway]_'),
    '`BASE_URL`  : ' + (effective.OPENAI_BASE_URL || '_(unset)_') +
      (userCfg.OPENAI_BASE_URL ? ' _[custom]_' : ' _[Railway]_'),
    '`MODEL`     : ' + (effective.HERMES_MODEL || '_(unset)_') +
      (userCfg.HERMES_MODEL ? ' _[custom]_' : ' _[Railway]_'),
    '',
    'Commands:',
    '• `.setapikey <key>`',
    '• `.setbaseurl <url>`',
    '• `.setmodel <model>`',
    '• `.models` — list semua model',
    '• `.resetmyconfig` — hapus custom lo',
  ]
  return replyWa(sock, jid, lines.join('\n'), msg)
}

async function showGlobalConfig(sock, jid, msg) {
  const cfg = (() => {
    try {
      return fs.existsSync(CONFIG_PATH)
        ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
        : {}
    } catch { return {} }
  })()
  const lines = [
    '⚙️ *Global Config (Owner)*',
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
  return replyWa(sock, jid, lines.join('\n'), msg)
}

// ─── .apitest handler (debug: verify API key + list model) ───
async function handleApiTest(sock, jid, msg, sender) {
  const userCfg = getUserConfig(sender)
  const effective = getEffectiveEnv(sender)
  const apiKey = effective.OPENAI_API_KEY
  const baseUrl = effective.OPENAI_BASE_URL
  const model = effective.HERMES_MODEL || '(unset)'

  const lines = [
    '🔬 *API Diagnostic*',
    '',
    '`BASE_URL`  : ' + (baseUrl || '_(unset)_') +
      (userCfg.OPENAI_BASE_URL ? ' _[custom]_' : ' _[Railway]_'),
    '`API_KEY`   : ' + maskKey(apiKey) +
      (userCfg.OPENAI_API_KEY ? ' _[custom]_' : ' _[Railway]_'),
    '`MODEL`     : ' + model +
      (userCfg.HERMES_MODEL ? ' _[custom]_' : ' _[Railway]_'),
    '',
  ]

  if (!baseUrl || !apiKey) {
    lines.push('❌ Base URL atau API key belum di-set.')
    return replyWa(sock, jid, lines.join('\n'), msg)
  }

  await replyWa(sock, jid, lines.join('\n') + '\n⏳ Testing...', msg)

  // Test 1: hit /models endpoint
  try {
    const url = baseUrl.replace(/\/+$/, '') + '/models'
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      lines.push('━━━━━━━━━━━━━━━━━')
      lines.push('❌ *Gagal hit `/models`*')
      lines.push('Status: *' + res.status + '* ' + res.statusText)
      lines.push('Response:')
      lines.push('```')
      lines.push(errText.slice(0, 500))
      lines.push('```')
      if (res.status === 401 || res.status === 403) {
        lines.push('')
        lines.push('💡 API key *invalid atau expired*.')
        lines.push('Cek di ' + (baseUrl.includes('tokenrouter') ? 'https://tokenrouter.com' : 'dashboard provider lo'))
      } else if (res.status === 404) {
        lines.push('')
        lines.push('💡 Endpoint `/models` ga ada di provider ini.')
        lines.push('Provider ga support listing model.')
      }
      return replyWa(sock, jid, lines.join('\n'), msg)
    }

    const data = await res.json()
    const models = Array.isArray(data) ? data : (data.data || [])
    const modelIds = models.map(m => typeof m === 'string' ? m : (m.id || m.name || m.model)).filter(Boolean)

    lines.push('━━━━━━━━━━━━━━━━━')
    lines.push('✅ *Koneksi OK*')
    lines.push('Total model: *' + modelIds.length + '*')
    lines.push('')

    // Test 2: cek model yang lagi dipake ada ga
    const curModel = userCfg.HERMES_MODEL || process.env.HERMES_MODEL
    if (curModel) {
      const exists = modelIds.includes(curModel)
      if (exists) {
        lines.push('✅ Model `' + curModel + '` *tersedia* di provider')
      } else {
        lines.push('❌ Model `' + curModel + '` *TIDAK ADA* di provider!')
        lines.push('')
        lines.push('Beberapa model yang mirip:')
        const similar = modelIds.filter(m => {
          const lc = m.toLowerCase()
          const lc2 = curModel.toLowerCase()
          return lc.includes(lc2.split('/').pop().split('-')[0]) ||
                 lc2.includes(lc.split('/').pop().split('-')[0])
        }).slice(0, 5)
        if (similar.length) {
          for (const m of similar) lines.push('  • `' + m + '`')
        } else {
          lines.push('  (ga ada yang mirip)')
          lines.push('')
          lines.push('Liat semua: `.models`')
        }
      }
    } else {
      lines.push('⚠️ Model belum di-set. Coba `.models` dulu.')
    }

    return replyWa(sock, jid, lines.join('\n'), msg)
  } catch (e) {
    lines.push('━━━━━━━━━━━━━━━━━')
    lines.push('❌ *Error fetch*')
    lines.push('```')
    lines.push(e.message.slice(0, 500))
    lines.push('```')
    return replyWa(sock, jid, lines.join('\n'), msg)
  }
}

// ─── PUBLIC ───────────────────────────────────────────────────
// ---- .hermesmodel handler (debug: list Hermes providers) ----
async function handleHermesModel(sock, jid, msg) {
  const { spawn } = require('child_process')
  const hermesBin = process.env.HERMES_BIN || 'hermes'
  await replyWa(sock, jid, 'ð Running `hermes model` ...', msg)
  return new Promise(resolve => {
    const proc = spawn(hermesBin, ['model'], {
      env: Object.assign({}, process.env, { NO_COLOR: '1' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = '', err = ''
    proc.stdout.on('data', d => out += d.toString())
    proc.stderr.on('data', d => err += d.toString())
    const timer = setTimeout(() => { try { proc.kill() } catch (_) {} }, 15000)
    proc.on('close', async code => {
      clearTimeout(timer)
      const stripAnsi = s => String(s).replace(/\[[0-9;?]*[ -/]*[@-~]/g, '')
      const cleanOut = stripAnsi(out).trim()
      const cleanErr = stripAnsi(err).trim()
      const lines = [
        'ð *Hermes Providers*',
        '',
        '```',
        cleanOut.slice(0, 1500) || '(no stdout)',
        '```',
      ]
      if (cleanErr) {
        lines.push(''); lines.push('stderr:')
        lines.push('```'); lines.push(cleanErr.slice(0, 500)); lines.push('```')
      }
      lines.push('')
      lines.push('Exit code: ' + code)
      await replyWa(sock, jid, lines.join('\\n'), msg)
      resolve()
    })
    proc.on('error', async e => {
      clearTimeout(timer)
      await replyWa(sock, jid, 'â Error: ' + e.message, msg)
      resolve()
    })
  })
}

module.exports = {
  // Global (owner) — backward compat
  loadConfig,
  saveConfig,
  resetConfig,
  ALLOWED_KEYS,

  // Per-user
  loadUserConfigs,
  saveUserConfigs,
  getUserConfig,
  setUserConfig,
  clearUserConfig,
  getEffectiveEnv,

  // Models
  fetchModels,
  getModelsCached,

  // Main dispatcher (returns null if not a config command)
  handle,
}