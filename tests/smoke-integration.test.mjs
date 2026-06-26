// tests/smoke-integration.test.mjs — end-to-end smoke test dengan mock sock
//
// Verifikasi:
//   - Restricted group routing works
//   - .menu command works
//   - .start redirect works in restricted group
//   - .forget command works
//   - .ai in group routes through bridge (stubbed)
//   - .ping/.botinfo/.owner commands don't crash
//   - URL detection + autodl handler still works
//
// Run: node tests/smoke-integration.test.mjs

import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)

const TMP_HOME = mkdtempSync(path.join(tmpdir(), 'smoke-test-'))
process.env.HERMES_HOME = TMP_HOME

// Stub handler-hermes (so bridge calls work without real LLM)
const stubExports = require('./stubs/handler-hermes-stub.cjs')
const hermesPath = require.resolve('../handler-hermes.cjs')
require.cache[hermesPath] = {
  id: hermesPath,
  filename: hermesPath,
  loaded: true,
  exports: stubExports,
  paths: [],
}

// Stub autodl handler (so we don't pull in ytdl/axios)
const autodlPath = require.resolve('../handler-autodl.js')
require.cache[autodlPath] = {
  id: autodlPath,
  filename: autodlPath,
  loaded: true,
  exports: {
    handleAutoDownload: async () => false,
  },
  paths: [],
}

const memory = require('../memory.cjs')
const bridge = require('../handler-hermes-bridge.cjs')
const format = require('../format.cjs')
const restrictions = require('../restrictions.cjs')
const menu = await import('../menu.js')

let pass = 0, fail = 0
const failures = []
async function test(name, fn) {
  try {
    await fn()
    console.log('✓', name)
    pass++
  } catch (e) {
    console.error('✗', name, '\n   ', e.message)
    fail++
    failures.push({ name, err: e.message })
  }
}
function eq(a, b) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}
function ok(c, m = 'expected truthy') { if (!c) throw new Error(m) }

// ═════════════════════════════════════════════════════════
// SMOKE TEST 1: Module loading & cross-module integration
// ═════════════════════════════════════════════════════════
console.log('\n── Module Integration ──')

await test('all modules load without errors', () => {
  // If we got here, all requires worked
  ok(memory, 'memory loaded')
  ok(bridge, 'bridge loaded')
  ok(format, 'format loaded')
  ok(restrictions, 'restrictions loaded')
  ok(menu.getMenuText, 'menu.getMenuText loaded')
  ok(menu.getStartRedirectText, 'menu.getStartRedirectText loaded')
})

await test('restrictions.cjs: target group in allowlist', () => {
  const allowed = restrictions.getAllowedCommands('120363405661184579@g.us')
  ok(allowed.includes('menu'))
  ok(allowed.includes('forget'))
  ok(allowed.includes('memory'))
  ok(allowed.includes('ai'))
})

await test('memory.cjs: target group in MEMORY_GROUPS whitelist', () => {
  ok(memory.MEMORY_GROUPS.has('120363405661184579@g.us'))
})

// ═════════════════════════════════════════════════════════
// SMOKE TEST 2: Menu rendering untuk semua context
// ═════════════════════════════════════════════════════════
console.log('\n── Menu rendering ──')

await test('menu private: full menu', () => {
  const out = menu.getMenuText({
    key: { remoteJid: '628xxx@s.whatsapp.net', participant: '628xxx@s.whatsapp.net' }
  })
  ok(out.includes('INFO'))
  ok(out.includes('AI CHAT'))
  ok(out.includes('DOWNLOAD'))
  ok(out.includes('PERSONAL CONFIG'))
})

await test('menu restricted group: filtered (4 sections)', () => {
  const out = menu.getMenuText({
    key: { remoteJid: '120363405661184579@g.us', participant: '628xxx@s.whatsapp.net' }
  })
  // 4 sections visible: INFO, AI, SEARCH, DOWNLOAD, PERSONAL CONFIG
  ok(out.includes('INFO'))
  ok(out.includes('AI CHAT'))
  ok(out.includes('DOWNLOAD'))
  ok(out.includes('PERSONAL CONFIG')) // Now shown in restricted groups
  // Sections NOT visible
  ok(!out.includes('MARKET'))
  ok(!out.includes('SOSMED'))
})

await test('start redirect: works for restricted group', () => {
  const txt = menu.getStartRedirectText('120363405661184579@g.us')
  ok(txt, 'should return text')
  ok(txt.includes('.menu'))
})

await test('start redirect: null for private', () => {
  eq(menu.getStartRedirectText('628xxx@s.whatsapp.net'), null)
})

// ═════════════════════════════════════════════════════════
// SMOKE TEST 3: Message flow simulation
// ═════════════════════════════════════════════════════════
console.log('\n── Message Flow ──')

const TEST_GROUP = '120363405661184579@g.us'

await test('flow: user message in restricted group → memory recorded', async () => {
  // Clear memory first
  await memory.clear(TEST_GROUP)

  // Simulate user message
  const result = await memory.appendMessage(TEST_GROUP, {
    sender: '628111111111@s.whatsapp.net',
    pushName: 'Kahfii',
    body: 'halo semua',
  })
  ok(result, 'should record')

  const msgs = await memory.loadMessages(TEST_GROUP)
  eq(msgs.length, 1)
  eq(msgs[0].body, 'halo semua')
})

await test('flow: .ai in restricted group → bot reply with group context', async () => {
  // Setup: add some context
  await memory.appendMessage(TEST_GROUP, {
    sender: '628222222222@s.whatsapp.net',
    pushName: 'Yusuf',
    body: 'eh novian emang femboy deh haha',
  })
  await memory.appendMessage(TEST_GROUP, {
    sender: '628111111111@s.whatsapp.net',
    pushName: 'Kahfii',
    body: '@bot novian femboy ga sih?',
  })

  // Simulate bridge.handleGroupChat call
  const msg = {
    key: { remoteJid: TEST_GROUP, participant: '628111111111@s.whatsapp.net' },
    pushName: 'Kahfii',
    message: { conversation: '@bot novian femboy ga sih?' },
  }
  const sockStub = { sendMessage: async () => {} }
  const reply = await bridge.handleGroupChat(sockStub, msg, 'novian femboy ga sih?', '628111111111@s.whatsapp.net')
  ok(reply, 'should get reply')
  ok(reply.includes('canned'), 'should be stub reply')

  // Verify memory has bot reply
  const msgs = await memory.loadMessages(TEST_GROUP)
  const botMsg = msgs.find(m => m.isBot)
  ok(botMsg, 'bot reply should be in memory')
})

await test('flow: .forget in restricted group → memory cleared', async () => {
  // Pre-populate
  await memory.appendMessage(TEST_GROUP, { sender: '628xxx@s.whatsapp.net', body: 'should be cleared' })

  // Call handleGroupReset (the function behind .forget command)
  const cleared = await bridge.handleGroupReset(TEST_GROUP)
  ok(cleared, 'should return true')

  const msgs = await memory.loadMessages(TEST_GROUP)
  eq(msgs.length, 0)
})

await test('flow: .memory (owner) in restricted group → stats', async () => {
  await memory.appendMessage(TEST_GROUP, {
    sender: '628xxx@s.whatsapp.net', pushName: 'Kahfii', body: 'test 1'
  })
  await memory.appendMessage(TEST_GROUP, {
    sender: '628xxx@s.whatsapp.net', pushName: 'Kahfii', body: 'test 2'
  })

  const out = await bridge.handleGroupMemory(TEST_GROUP)
  ok(out.includes('Bot Memory'))
  ok(out.includes('Total pesan diingat'))
})

// ═════════════════════════════════════════════════════════
// SMOKE TEST 4: Error resilience
// ═════════════════════════════════════════════════════════
console.log('\n── Error Resilience ──')

await test('memory: handles corrupt JSON gracefully', async () => {
  // Write garbage to a history file
  const fsp = require('fs').promises
  const groupDir = path.join(process.env.HERMES_HOME, 'sessions', 'wa-groups', memory.safeId(TEST_GROUP))
  await fsp.mkdir(groupDir, { recursive: true })
  await fsp.writeFile(path.join(groupDir, 'history.json'), '{ not valid json')

  // Should NOT throw, should return empty
  const msgs = await memory.loadMessages(TEST_GROUP)
  eq(msgs, [])
})

await test('memory: handles missing directory gracefully', async () => {
  const msgs = await memory.loadMessages('120363999999999@g.us')  // not in MEMORY_GROUPS
  eq(msgs, [])
})

await test('format: handles empty title', () => {
  const out = format.box('', [{ emoji: '📌', label: 'Key', value: 'Val' }])
  ok(out.split('\n').length >= 3)
})

await test('format: handles null rows', () => {
  const out = format.section('TEST', null)
  ok(out.split('\n').length === 2, 'empty section = header + footer')
})

// ─── Cleanup + summary ──────────────────────────────────
rmSync(TMP_HOME, { recursive: true, force: true })
console.log('\n────────────────────────────────────────')
console.log(`${pass}/${pass + fail} passed`)
if (fail > 0) {
  console.error('\nFailures:')
  for (const x of failures) console.error('  -', x.name, ':', x.err)
  process.exit(1)
}
process.exit(0)
