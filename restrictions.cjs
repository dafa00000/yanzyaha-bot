'use strict'
// ─── GROUP COMMAND RESTRICTIONS ────────────────────────────────────────────
// Per-group allowlist for commands. When a group JID is in RESTRICTED_GROUPS,
// ONLY the commands listed for that group are allowed. Other commands get
// rejected with "Command ini tidak tersedia di grup ini".
//
// Add new restricted groups by adding a JID → [commands] entry.

const RESTRICTED_GROUPS = {
  // Group: "Yanz Chat" (default restricted)
  // Only basic info + AI + search + memory management allowed.
  // No download, no games, no config.
  '120363405661184579@g.us': [
    'menu', 'help', 'start',
    'ping', 'botinfo', 'owner',
    'ai', 'reset',
    'search',
    'forget',  // hapus memory grup (.forget)
    'memory',  // lihat memory grup (owner-only, .memory)
  ],
  // To add more groups, copy the line above with the new JID:
  // '120363999999999@g.us': ['menu', 'ping', 'ai', 'search'],
}

function isRestrictedGroup(jid) {
  if (!jid) return false
  return Object.prototype.hasOwnProperty.call(RESTRICTED_GROUPS, jid)
}

function isCommandAllowed(jid, command) {
  if (!isRestrictedGroup(jid)) return true  // not restricted = all allowed
  const allowed = RESTRICTED_GROUPS[jid]
  if (!allowed) return true
  return allowed.includes((command || '').toLowerCase())
}

function getAllowedCommands(jid) {
  if (!isRestrictedGroup(jid)) return null  // null = all allowed
  return RESTRICTED_GROUPS[jid]
}

function listRestrictedGroups() {
  return Object.keys(RESTRICTED_GROUPS)
}

module.exports = {
  RESTRICTED_GROUPS,
  isRestrictedGroup,
  isCommandAllowed,
  getAllowedCommands,
  listRestrictedGroups,
}
