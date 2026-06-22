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

await test('private: shows full menu (non-owner)', () => {
  const out = getMenuText({
    key: { remoteJid: '628xxx@s.whatsapp.net', participant: '628xxx@s.whatsapp.net' }
  }, { isOwner: false })
  has(out, 'INFO')
  has(out, 'AI CHAT')
  has(out, 'DOWNLOAD')
  has(out, 'MARKET')
  has(out, 'SOSMED')
  has(out, 'PERSONAL CONFIG')
  // OWNER CONFIG should NOT show for non-owner
  notHas(out, 'OWNER CONFIG')
})

await test('private: owner sees owner config', () => {
  const out = getMenuText({
    key: { remoteJid: '62895618805248@s.whatsapp.net', participant: '62895618805248@s.whatsapp.net' }
  }, { isOwner: true })
  has(out, 'OWNER CONFIG')
  has(out, 'OWNER ONLY')  // owner extra sections
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
  has(out, 'SEARCH')
  // These should NOT be shown (not in allowed list)
  notHas(out, 'MARKET')
  notHas(out, 'SOSMED')
  notHas(out, 'GAME')
  notHas(out, 'PERSONAL CONFIG')
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
console.log('\n── alignment consistency (open box style) ──')

await test('menu: every section has header (╭), body (│), footer (╰)', () => {
  const out = getMenuText({
    key: {
      remoteJid: RESTRICTED_JID,
      participant: '628xxx@s.whatsapp.net'
    }
  })
  const lines = out.split('\n')
  let inSection = false
  let sectionIdx = 0
  let hasBody = false
  for (const line of lines) {
    if (line.startsWith('╭─')) {
      ok(!inSection, `section ${sectionIdx}: previous didn't close`)
      inSection = true
      hasBody = false
    } else if (line.startsWith('│')) {
      hasBody = true
    } else if (line.startsWith('╰')) {
      ok(inSection, `footer before header in section ${sectionIdx}`)
      ok(hasBody, `section ${sectionIdx}: should have at least one body line`)
      inSection = false
      sectionIdx++
    }
  }
})

await test('menu: all footers use consistent 16-dash style', () => {
  const out = getMenuText({
    key: {
      remoteJid: RESTRICTED_JID,
      participant: '628xxx@s.whatsapp.net'
    }
  })
  const lines = out.split('\n')
  const footers = lines.filter(l => l.startsWith('╰'))
  ok(footers.length >= 3, `should have multiple footers (header + sections), got ${footers.length}`)
  const expected = '╰' + '─'.repeat(16)
  for (const f of footers) {
    eq(f, expected, `footer mismatch`)
  }
})

await test('menu: ⌬ command » separator aligned within each section', () => {
  const out = getMenuText({
    key: {
      remoteJid: RESTRICTED_JID,
      participant: '628xxx@s.whatsapp.net'
    }
  })
  const lines = out.split('\n')
  let sectionIdx = 0
  let cmdCols = []
  for (const line of lines) {
    if (line.startsWith('╭─')) {
      // New section — reset
      cmdCols = []
    } else if (line.startsWith('╰')) {
      // End of section — verify all cmdCols had same » column
      if (cmdCols.length > 1) {
        const allSame = cmdCols.every(c => c === cmdCols[0])
        ok(allSame, `section ${sectionIdx}: » should align, got cols ${JSON.stringify(cmdCols)}`)
      }
      sectionIdx++
    } else if (line.startsWith('│') && line.includes('⌬ ') && line.includes(' » ')) {
      cmdCols.push(line.indexOf(' » '))
    }
  }
})

await test('menu: header rows use Label : value format (no ◇)', () => {
  const out = getMenuText({
    key: { remoteJid: '628xxx@s.whatsapp.net', participant: '628xxx@s.whatsapp.net' }
  })
  // First box is the header (User/Prefix)
  const lines = out.split('\n')
  const headerEnd = lines.findIndex(l => l.startsWith('╰'))
  const headerLines = lines.slice(0, headerEnd + 1)
  // Should have "User   : @" and "Prefix : ." lines (no ◇)
  const headerText = headerLines.join('\n')
  has(headerText, 'User   :')
  has(headerText, 'Prefix :')
  // Should NOT have ◇ in header (that's only for section info notes)
  ok(!headerText.includes('◇'), 'header should not use ◇ prefix')
})

await test('menu: section info notes use ◇ prefix', () => {
  const out = getMenuText({
    key: { remoteJid: '628xxx@s.whatsapp.net', participant: '628xxx@s.whatsapp.net' }
  })
  // AI section has info notes
  has(out, '◇ Chat biasa')
  has(out, '◇ Per-user memory')
})

await test('menu: command names not truncated', () => {
  const out = getMenuText({
    key: { remoteJid: '628xxx@s.whatsapp.net', participant: '628xxx@s.whatsapp.net' }
  })
  // .autoclip (9 chars) should not become .autocli…
  has(out, '.autoclip')
  has(out, '.cryptoprediksi')
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
