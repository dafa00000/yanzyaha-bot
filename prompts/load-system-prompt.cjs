'use strict'
/**
 * Load system prompt for AI chat — applied to ALL models (Gemini/OpenRouter/etc).
 * Source: Anthropic/Claude-style principles (CL4R1T4S Anthropic corpus) + WA rules.
 *
 * Priority:
 *  1. process.env.WA_SYSTEM_PROMPT_FILE
 *  2. $HERMES_HOME/prompts/yanzyaha-system.txt
 *  3. ./prompts/yanzyaha-system.txt (relative to bot root)
 *  4. hardcoded fallback
 */

const fs = require('fs')
const path = require('path')

const HOME = process.env.HERMES_HOME || '/opt/data'
let _cache = null
let _mtime = 0
let _path = null

const FALLBACK = `You are YANZYAHA-BOT AI on WhatsApp. Be clear, accurate, and helpful.
Match the user's language. No filler openers. Prefer complete, practical answers.
For code: one complete best solution in a fenced code block.`

function candidatePaths() {
  const list = []
  if (process.env.WA_SYSTEM_PROMPT_FILE) list.push(process.env.WA_SYSTEM_PROMPT_FILE)
  list.push(path.join(HOME, 'prompts', 'yanzyaha-system.txt'))
  // bot package relative
  list.push(path.join(__dirname, 'prompts', 'yanzyaha-system.txt'))
  list.push(path.join(process.cwd(), 'prompts', 'yanzyaha-system.txt'))
  return list
}

function loadSystemPrompt({ force = false } = {}) {
  for (const p of candidatePaths()) {
    try {
      if (!p || !fs.existsSync(p)) continue
      const st = fs.statSync(p)
      if (!force && _cache && _path === p && st.mtimeMs === _mtime) return _cache
      const text = fs.readFileSync(p, 'utf8').trim()
      if (!text) continue
      _cache = text
      _mtime = st.mtimeMs
      _path = p
      console.log('[SYSTEM-PROMPT] loaded', p, 'chars=' + text.length)
      return _cache
    } catch (e) {
      console.error('[SYSTEM-PROMPT] load fail', p, e.message)
    }
  }
  if (!_cache) {
    _cache = FALLBACK
    _path = '(fallback)'
    console.log('[SYSTEM-PROMPT] using fallback')
  }
  return _cache
}

function getSystemPrompt() {
  return loadSystemPrompt()
}

function getGroupSystemPrompt() {
  const base = getSystemPrompt()
  return (
    base +
    `\n\n## Group chat mode\n` +
    `- You can see recent group messages as context. Use names when relevant.\n` +
    `- Prefer concise replies in groups (unless user asks for depth/code).\n` +
    `- If context is insufficient, ask one short clarifying question.\n`
  )
}

/** Ensure messages array starts with current system prompt (all models). */
function applySystemToMessages(messages, { group = false } = {}) {
  const content = group ? getGroupSystemPrompt() : getSystemPrompt()
  const out = Array.isArray(messages) ? messages.filter(m => m && m.role !== 'system') : []
  out.unshift({ role: 'system', content })
  return out
}

module.exports = {
  loadSystemPrompt,
  getSystemPrompt,
  getGroupSystemPrompt,
  applySystemToMessages,
  FALLBACK,
}
