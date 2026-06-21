'use strict'
// Stub handler-hermes.cjs untuk bridge.test.mjs
// Tidak panggil LLM beneran — return canned response + simulated secret leak
// untuk test redaction.

const CANNED_REPLY = 'Ini canned reply dari stub LLM sk-abc1234567890abcdef1234'

async function directChat(prompt, opts = {}) {
  console.log('[STUB] directChat called with prompt:', String(prompt).slice(0, 60))
  return CANNED_REPLY
}

async function handleChat(sock, msg, body, sender, userEnv = null) {
  return CANNED_REPLY
}

async function handleCommand(sock, msg, text, sender = null, userEnv = null) {
  return CANNED_REPLY
}

async function handleReset(sock, msg, sender) {
  return true
}

module.exports = {
  directChat,
  handleChat,
  handleCommand,
  handleReset,
  // Marker so tests can confirm stub is loaded
  __isStub: true,
}
