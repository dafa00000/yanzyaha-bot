// tests/menu.test.mjs — verify menu rendering + .start redirect
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const TMP_HOME = mkdtempSync(path.join(tmpdir(), 'menu-test-'))
process.env.HERMES_HOME = TMP_HOME

// Import menu.js (ESM)
const menuMod = await import('../menu.js')
const { getMenuText, getStartRedirectText } = menuMod

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
function eq(a, b, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${msg || 'eq'} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}
function ok(c, m = 'expected truthy') { if (!c) throw new Error(m) }
function has(s, sub, msg = '') { if (!s.includes(sub)) throw new Error(`${msg || 'has'} — "${sub}" not in output`) }
function notHas(s, sub, msg = '') { if (s.includes(sub)) throw new Error(`${msg || 'notHas'} — "${sub}" should NOT be in output`) }

// ─── PRIVATE CHAT ───────────────────────────────────────────
console.log('\n── private chat ──')

await test('private: shows full menu', () => {
  const out = getMenuText({
    key: { remoteJid: '628xxx@s.whatsapp.net', participant: '628xxx@s.whatsapp.net' }
  })
  has(out, 'INFO')
  has(out, 'AI CHAT')
  has(out, 'DOWNLOAD')
  has(out, 'PASAR')
  has(out, 'SOSMED')
  has(out, 'KONFIG PRIBADI')
  has(out, 'KONFIG OWNER')
})

await test('private: shows correct user in header', () => {
  const out = getMenuText({
    key: { remoteJid: '628123456789@s.whatsapp.net', participant: '628123456789@s.whatsapp.net' }
  })
  has(out, '@628123456789')
  notHas(out, 'Group')  // not a group, no Group field
})

// ─── NON-RESTRICTED GROUP ────────────────────────────────────
console.log('\n── non-restricted group ──')

await test('non-restricted group: shows Group field', () => {
  const out = getMenuText({
    key: {
      remoteJid: '120363000000000@g.us',
      participant: '628999999999@s.whatsapp.net'
    }
  })
  has(out, 'Group')
  has(out, 'Kamu')
  has(out, '@628999999999')
})

await test('non-restricted group: hides KONFIG PRIBADI/OWNER', () => {
  const out = getMenuText({
    key: {
      remoteJid: '120363000000000@g.us',
      participant: '628999999999@s.whatsapp.net'
    }
  })
  // These are requiresPrivate → shouldn't show in group
  notHas(out, '⚙️ KONFIG PRIBADI')
  notHas(out, '👑 KONFIG OWNER')
})

await test('non-restricted group: shows DOWNLOAD section', () => {
  const out = getMenuText({
    key: {
      remoteJid: '120363000000000@g.us',
      participant: '628999999999@s.whatsapp.net'
    }
  })
  has(out, 'DOWNLOAD')
  has(out, '.ytdl')
})

// ─── RESTRICTED GROUP (Kahfii's group) ──────────────────────
console.log('\n── restricted group (120363405661184579@g.us) ──')

const RESTRICTED_JID = '120363405661184579@g.us'

await test('restricted: only shows allowed sections', () => {
  const out = getMenuText({
    key: {
      remoteJid: RESTRICTED_JID,
      participant: '628xxx@s.whatsapp.net'
    }
  })
  has(out, 'INFO')
  has(out, 'AI CHAT')
  has(out, 'PENCARIAN')
  // These should NOT be shown (not in allowed list)
  notHas(out, 'DOWNLOAD')
  notHas(out, 'PASAR')
  notHas(out, 'SOSMED')
  notHas(out, 'GAME')
  notHas(out, 'KONFIG PRIBADI')
})

await test('restricted: only shows allowed AI commands', () => {
  const out = getMenuText({
    key: {
      remoteJid: RESTRICTED_JID,
      participant: '628xxx@s.whatsapp.net'
    }
  })
  has(out, '.ai')
  has(out, '.reset')
  has(out, '.forget')
  // .menu itself shouldn't appear in command list (it's meta)
  notHas(out, '⌬ .menu')
})

await test('restricted: shows restricted footer message', () => {
  const out = getMenuText({
    key: {
      remoteJid: RESTRICTED_JID,
      participant: '628xxx@s.whatsapp.net'
    }
  })
  has(out, '🔒')
  has(out, 'restricted')
  has(out, 'Minta owner')
})

await test('restricted: shows Group header', () => {
  const out = getMenuText({
    key: {
      remoteJid: RESTRICTED_JID,
      participant: '628xxx@s.whatsapp.net'
    }
  })
  has(out, 'Group')
  has(out, 'Kamu')
  has(out, '@628xxx')
})

await test('restricted: uses sender JID for Kamu (not group JID)', () => {
  const out = getMenuText({
    key: {
      remoteJid: RESTRICTED_JID,
      participant: '628111222333@s.whatsapp.net'
    }
  })
  has(out, '@628111222333')  // sender's number
  // Make sure it doesn't show the GROUP number as Kamu
  ok(!out.includes('@12036340'), 'Kamu should not show group JID')
})

// ─── .start REDIRECT ─────────────────────────────────────────
console.log('\n── .start redirect ──')

await test('start redirect: returns text for restricted group', () => {
  const txt = getStartRedirectText(RESTRICTED_JID)
  ok(txt, 'should return non-null text')
  has(txt, 'Halo')
  has(txt, '.menu')
  has(txt, 'kak')
})

await test('start redirect: returns null for non-restricted', () => {
  const txt = getStartRedirectText('120363000000000@g.us')
  eq(txt, null)
})

await test('start redirect: returns null for private chat', () => {
  const txt = getStartRedirectText('628xxx@s.whatsapp.net')
  eq(txt, null)
})

// ─── ALIGNMENT CHECKS ────────────────────────────────────────
console.log('\n── alignment consistency ──')

await test('menu: all box lines have same width', () => {
  const out = getMenuText({
    key: {
      remoteJid: RESTRICTED_JID,
      participant: '628xxx@s.whatsapp.net'
    }
  })
  // Split into box sections and check each box has consistent width
  const boxes = out.split('\n').filter(l => l.startsWith('╭') || l.startsWith('│') || l.startsWith('╰'))
  // Group consecutive box lines
  const widths = []
  let curWidth = null
  for (const line of boxes) {
    if (line.startsWith('╭') || line.startsWith('╰')) {
      if (curWidth !== null) widths.push(curWidth)
      curWidth = line.length
    } else if (line.startsWith('│')) {
      ok(curWidth === null || curWidth === line.length, `box line width ${line.length} differs from ${curWidth}`)
      curWidth = line.length
    }
  }
  if (curWidth !== null) widths.push(curWidth)
  ok(widths.length > 0, 'should have at least one box')
  ok(widths.every(w => w === widths[0]), `boxes should have same width: ${JSON.stringify(widths)}`)
})

await test('menu: command names not truncated', () => {
  const out = getMenuText({
    key: { remoteJid: '628xxx@s.whatsapp.net', participant: '628xxx@s.whatsapp.net' }
  })
  // .autoclip (9 chars) should not become .autocli…
  has(out, '.autoclip')
  has(out, '.setapikey')
  has(out, '.resetmyconfig')
})

// ─── Summary ──────────────────────────────────────────────
console.log('\n────────────────────────────────────────')
console.log(`${pass}/${pass + fail} passed`)
if (fail > 0) {
  console.error('\nFailures:')
  for (const x of failures) console.error('  -', x.name, ':', x.err)
  rmSync(TMP_HOME, { recursive: true, force: true })
  process.exit(1)
}
rmSync(TMP_HOME, { recursive: true, force: true })
process.exit(0)
