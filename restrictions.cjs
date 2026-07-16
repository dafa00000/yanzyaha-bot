'use strict'
// ─── GROUP COMMAND RESTRICTIONS ────────────────────────────────────────────
// Per-group allowlist for commands. When a group JID is in RESTRICTED_GROUPS,
// ONLY the commands listed for that group are allowed (for non-owners).
// Other commands get rejected / silently ignored by the caller.
//
// Owner management commands are ALWAYS allowed even in restricted groups so
// the owner cannot lock themselves out of .unrestrictgroup / .addcmd / etc.
//
// Supports dynamic management via owner commands (.addcmd, .removecmd, etc.)
// Changes are persisted to $HERMES_HOME/restricted_groups.json

const fs = require('fs')
const path = require('path')

const HERMES_HOME = process.env.HERMES_HOME || '/opt/data'
const PERSIST_PATH = path.join(HERMES_HOME, 'restricted_groups.json')

// Commands every restricted group must keep available for group UX
const BASE_PUBLIC_COMMANDS = [
  'menu', 'help', 'start',
  'ping', 'botinfo', 'owner',
  'listcmd',
]

// Owner-only management — always allowed in restricted groups (cannot be stripped)
const OWNER_MGMT_COMMANDS = [
  'restrictgroup', 'unrestrictgroup',
  'addcmd', 'removecmd', 'listcmd',
  'addcmdall', 'removecmdall',
  'enablecmd', 'disablecmd',
  // menu management (global hide/show) — must stay reachable for owner
  'addcmdglobal', 'delcmdglobal', 'editcmddesc',
  'addsection', 'delsection', 'listmenucustom',
  'setmenu', 'hidemenu', 'showmenu',
]

function normalizeCmd(command) {
  return (command || '').toLowerCase().replace(/^\./, '').trim()
}

function uniqueCmds(list) {
  const seen = new Set()
  const out = []
  for (const raw of list || []) {
    const c = normalizeCmd(raw)
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

function defaultAllowlist() {
  return uniqueCmds([...BASE_PUBLIC_COMMANDS, ...OWNER_MGMT_COMMANDS])
}

function ensureOwnerMgmtInList(cmds) {
  const set = new Set(uniqueCmds(cmds))
  for (const c of OWNER_MGMT_COMMANDS) set.add(c)
  for (const c of BASE_PUBLIC_COMMANDS) set.add(c)
  return [...set]
}

// ─── GLOBAL ENABLED COMMANDS (for all users in private chat menu) ──────────
// Commands that appear in menu for ALL users.
// Owner can add/remove via .enablecmd / .disablecmd
let GLOBAL_ENABLED_COMMANDS = ['sticker', 'toimg']  // sticker always visible by default

const GLOBAL_ENABLED_PATH = path.join(HERMES_HOME, 'enabled_commands.json')

function loadGlobalEnabled() {
  try {
    if (!fs.existsSync(GLOBAL_ENABLED_PATH)) return
    const data = JSON.parse(fs.readFileSync(GLOBAL_ENABLED_PATH, 'utf8'))
    if (Array.isArray(data)) GLOBAL_ENABLED_COMMANDS = data
    console.log(`[RESTRICTIONS] Loaded ${GLOBAL_ENABLED_COMMANDS.length} global enabled commands`)
  } catch (e) {
    console.error('[RESTRICTIONS] load enabled error:', e.message)
  }
}

function saveGlobalEnabled() {
  try {
    fs.mkdirSync(path.dirname(GLOBAL_ENABLED_PATH), { recursive: true })
    fs.writeFileSync(GLOBAL_ENABLED_PATH, JSON.stringify(GLOBAL_ENABLED_COMMANDS, null, 2))
  } catch (e) {
    console.error('[RESTRICTIONS] save enabled error:', e.message)
  }
}

loadGlobalEnabled()

function getGlobalEnabledCommands() {
  return [...GLOBAL_ENABLED_COMMANDS]
}

function enableCommand(command) {
  const cmd = normalizeCmd(command)
  if (!cmd) return { ok: false, reason: 'Command kosong' }
  if (GLOBAL_ENABLED_COMMANDS.includes(cmd)) return { ok: false, reason: `.${cmd} sudah aktif` }
  GLOBAL_ENABLED_COMMANDS.push(cmd)
  saveGlobalEnabled()
  return { ok: true, cmd }
}

function disableCommand(command) {
  const cmd = normalizeCmd(command)
  if (!cmd) return { ok: false, reason: 'Command kosong' }
  const idx = GLOBAL_ENABLED_COMMANDS.indexOf(cmd)
  if (idx === -1) return { ok: false, reason: `.${cmd} tidak ada di daftar aktif` }
  GLOBAL_ENABLED_COMMANDS.splice(idx, 1)
  saveGlobalEnabled()
  return { ok: true, cmd }
}

// Default restricted groups (hardcoded fallback) — always include owner mgmt
const DEFAULT_RESTRICTED_GROUPS = {
  '120363405661184579@g.us': defaultAllowlist().concat([
    'ai', 'reset',
    'search',
    'forget',
    'memory',
    'vn',
    'convert',
    'setmodel',
    'models',
    'setapikey',
    'setbaseurl',
    'mykeys',
    'myconfig',
  ]),
}

// Runtime state (merged defaults + persisted)
let RESTRICTED_GROUPS = {}
for (const [jid, cmds] of Object.entries(DEFAULT_RESTRICTED_GROUPS)) {
  RESTRICTED_GROUPS[jid] = ensureOwnerMgmtInList(cmds)
}

// ─── PERSISTENCE ─────────────────────────────────────────────
function loadPersisted() {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return
    const data = JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf8'))
    let repaired = false
    // Merge: persisted overrides defaults; always re-inject owner mgmt
    for (const [jid, cmds] of Object.entries(data)) {
      const fixed = ensureOwnerMgmtInList(cmds)
      if (JSON.stringify(uniqueCmds(cmds)) !== JSON.stringify(fixed)) repaired = true
      RESTRICTED_GROUPS[jid] = fixed
    }
    console.log(`[RESTRICTIONS] Loaded ${Object.keys(data).length} persisted group(s) from ${PERSIST_PATH}`)
    if (repaired) {
      console.log('[RESTRICTIONS] Repaired missing owner/base commands in allowlists')
      savePersisted()
    }
  } catch (e) {
    console.error('[RESTRICTIONS] load error:', e.message)
  }
}

function savePersisted() {
  try {
    fs.mkdirSync(path.dirname(PERSIST_PATH), { recursive: true })
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(RESTRICTED_GROUPS, null, 2))
    console.log('[RESTRICTIONS] Saved to', PERSIST_PATH)
  } catch (e) {
    console.error('[RESTRICTIONS] save error:', e.message)
  }
}

// Load on startup
loadPersisted()

// ─── QUERY FUNCTIONS ─────────────────────────────────────────
function isRestrictedGroup(jid) {
  if (!jid) return false
  return Object.prototype.hasOwnProperty.call(RESTRICTED_GROUPS, jid)
}

function isOwnerMgmtCommand(command) {
  return OWNER_MGMT_COMMANDS.includes(normalizeCmd(command))
}

function isCommandAllowed(jid, command) {
  const cmd = normalizeCmd(command)
  // Owner management always allowed even if somehow missing from allowlist
  if (isOwnerMgmtCommand(cmd)) return true
  if (!isRestrictedGroup(jid)) return true  // not restricted = all allowed
  const allowed = RESTRICTED_GROUPS[jid]
  if (!allowed) return true
  return allowed.includes(cmd)
}

function getAllowedCommands(jid) {
  if (!isRestrictedGroup(jid)) return null  // null = all allowed
  return RESTRICTED_GROUPS[jid]
}

function listRestrictedGroups() {
  return Object.keys(RESTRICTED_GROUPS)
}

// ─── MANAGEMENT FUNCTIONS (owner only) ───────────────────────
function restrictGroup(jid) {
  if (!jid) return false
  if (isRestrictedGroup(jid)) return false // already restricted
  // Seed with public UX + owner management so .unrestrictgroup never dies
  RESTRICTED_GROUPS[jid] = defaultAllowlist()
  savePersisted()
  return true
}

function unrestrictGroup(jid) {
  if (!jid || !isRestrictedGroup(jid)) return false
  delete RESTRICTED_GROUPS[jid]
  savePersisted()
  return true
}

function addCommand(jid, command) {
  if (!jid || !command) return { ok: false, reason: 'JID atau command kosong' }
  if (!isRestrictedGroup(jid)) return { ok: false, reason: 'Grup ini tidak terfilter. Gunakan .restrictgroup dulu.' }
  const cmd = normalizeCmd(command)
  if (!cmd) return { ok: false, reason: 'Command kosong' }
  const cmds = RESTRICTED_GROUPS[jid]
  if (cmds.includes(cmd)) return { ok: false, reason: `Command .${cmd} sudah ada di grup ini.` }
  cmds.push(cmd)
  savePersisted()
  return { ok: true, cmd }
}

function addCommandAll(command) {
  const cmd = normalizeCmd(command)
  if (!cmd) return { ok: false, reason: 'Command kosong' }
  let count = 0
  for (const jid of Object.keys(RESTRICTED_GROUPS)) {
    if (!RESTRICTED_GROUPS[jid].includes(cmd)) {
      RESTRICTED_GROUPS[jid].push(cmd)
      count++
    }
  }
  if (count > 0) savePersisted()
  return { ok: true, cmd, count }
}

function removeCommandAll(command) {
  const cmd = normalizeCmd(command)
  if (!cmd) return { ok: false, reason: 'Command kosong' }
  if (isOwnerMgmtCommand(cmd) || BASE_PUBLIC_COMMANDS.includes(cmd)) {
    return {
      ok: false,
      reason: `Command .${cmd} dilindungi (owner/base). Tidak bisa dihapus dari allowlist grup.`,
    }
  }
  let count = 0
  for (const jid of Object.keys(RESTRICTED_GROUPS)) {
    const idx = RESTRICTED_GROUPS[jid].indexOf(cmd)
    if (idx !== -1) {
      RESTRICTED_GROUPS[jid].splice(idx, 1)
      count++
    }
  }
  if (count > 0) savePersisted()
  return { ok: true, cmd, count }
}

function removeCommand(jid, command) {
  if (!jid || !command) return { ok: false, reason: 'JID atau command kosong' }
  if (!isRestrictedGroup(jid)) return { ok: false, reason: 'Grup ini tidak terfilter.' }
  const cmd = normalizeCmd(command)
  if (isOwnerMgmtCommand(cmd) || BASE_PUBLIC_COMMANDS.includes(cmd)) {
    return {
      ok: false,
      reason: `Command .${cmd} dilindungi (owner/base). Tidak bisa dihapus dari allowlist grup.`,
    }
  }
  const cmds = RESTRICTED_GROUPS[jid]
  const idx = cmds.indexOf(cmd)
  if (idx === -1) return { ok: false, reason: `Command .${cmd} tidak ada di grup ini.` }
  cmds.splice(idx, 1)
  savePersisted()
  return { ok: true, cmd }
}

module.exports = {
  RESTRICTED_GROUPS,
  BASE_PUBLIC_COMMANDS,
  OWNER_MGMT_COMMANDS,
  isRestrictedGroup,
  isCommandAllowed,
  isOwnerMgmtCommand,
  getAllowedCommands,
  listRestrictedGroups,
  restrictGroup,
  unrestrictGroup,
  addCommand,
  addCommandAll,
  removeCommand,
  removeCommandAll,
  getGlobalEnabledCommands,
  enableCommand,
  disableCommand,
}
