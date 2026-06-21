// tests/format.test.mjs — verify box/section/footer rendering rapi & konsisten
//
// Run: node tests/format.test.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const f = require('../format.cjs')

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
function has(s, sub, msg = '') { if (!s.includes(sub)) throw new Error(`${msg || 'has'} — "${sub}" not in:\n${s}`) }
function notHas(s, sub, msg = '') { if (s.includes(sub)) throw new Error(`${msg || 'notHas'} — "${sub}" should NOT be in:\n${s}`) }

// ─── BOX ──────────────────────────────────────────────────
console.log('\n── box() ──')

await test('box: renders 3 lines minimum (header, 1 row, footer)', () => {
  const out = f.box('TEST', [{ emoji: '📌', label: 'Key', value: 'Val' }])
  const lines = out.split('\n')
  ok(lines.length === 3, `expected 3 lines, got ${lines.length}`)
  ok(lines[0].startsWith('╭─'), 'first line should start with ╭─')
  ok(lines[0].endsWith('╮'), 'first line should end with ╮')
  ok(lines[1].startsWith('│ '), 'middle should start with │ ')
  ok(lines[2].startsWith('╰'), 'last should start with ╰')
})

await test('box: header contains title', () => {
  const out = f.box('YANZYAHA', [{ emoji: '📌', label: 'X', value: 'Y' }])
  has(out, 'YANZYAHA')
})

await test('box: all rows have same width', () => {
  const out = f.box('T', [
    { emoji: '📌', label: 'A', value: '1' },
    { emoji: '📌', label: 'BB', value: '22' },
    { emoji: '📌', label: 'CCC', value: '333' },
  ])
  const lines = out.split('\n')
  const widths = lines.map(l => l.length)
  ok(widths.every(w => w === widths[0]), `lines should have same width, got: ${JSON.stringify(widths)}`)
})

await test('box: all rows start with │ and end with │', () => {
  const out = f.box('T', [
    { emoji: '📌', label: 'A', value: '1' },
    { emoji: '📌', label: 'B', value: '2' },
  ])
  const middleLines = out.split('\n').slice(1, -1)
  for (const l of middleLines) {
    ok(l.startsWith('│ '), `line should start with │ : "${l}"`)
    ok(l.endsWith(' │'), `line should end with " │": "${l}"`)
  }
})

await test('box: long value gets truncated with ellipsis', () => {
  const longValue = 'x'.repeat(200)
  const out = f.box('T', [{ emoji: '📌', label: 'Long', value: longValue }])
  has(out, '…', 'should have ellipsis')
  // The truncated line should not be super long
  const lines = out.split('\n')
  ok(lines[1].length < 100, `truncated line should be reasonable length, got ${lines[1].length}`)
})

await test('box: emoji + label render correctly', () => {
  const out = f.box('T', [
    { emoji: '⚡', label: 'Power', value: '100' },
    { emoji: '🤖', label: 'Bot', value: 'ON' },
  ])
  // Note: ⚡ is padded with extra space to fill 2-char emoji slot
  has(out, 'Power')
  has(out, 'Bot')
  has(out, '100')
  has(out, 'ON')
})

await test('box: empty rows array → 2 lines (header + footer only)', () => {
  const out = f.box('EMPTY', [])
  const lines = out.split('\n')
  eq(lines.length, 2)
})

await test('box: null/undefined value renders as -', () => {
  const out = f.box('T', [{ emoji: '📌', label: 'Null', value: null }])
  has(out, '-', 'null value should render as -')
})

// ─── SECTION ──────────────────────────────────────────────
console.log('\n── section() ──')

await test('section: has ⌬ prefix for each command', () => {
  const out = f.section('TEST', [{ cmd: '.foo', desc: 'foo command' }])
  has(out, '⌬ .foo')
})

await test('section: has » separator between cmd and desc', () => {
  const out = f.section('TEST', [{ cmd: '.foo', desc: 'description here' }])
  has(out, '»')
})

await test('section: all lines aligned (same width)', () => {
  const out = f.section('T', [
    { cmd: '.a', desc: 'short' },
    { cmd: '.longer', desc: 'longer desc' },
    { cmd: '.x', desc: 'd' },
  ])
  const lines = out.split('\n')
  const widths = lines.map(l => l.length)
  ok(widths.every(w => w === widths[0]), `lines should have same width: ${JSON.stringify(widths)}`)
})

await test('section: long description gets truncated', () => {
  const out = f.section('T', [{ cmd: '.foo', desc: 'x'.repeat(200) }])
  has(out, '…', 'should have ellipsis for truncated desc')
})

await test('section: empty items → just header + footer', () => {
  const out = f.section('EMPTY', [])
  const lines = out.split('\n')
  eq(lines.length, 2)
})

// ─── FOOTER ───────────────────────────────────────────────
console.log('\n── footer() ──')

await test('footer: empty → empty string', () => {
  eq(f.footer(''), '')
  eq(f.footer(null), '')
  eq(f.footer(undefined), '')
})

await test('footer: wraps in _underscore_italic_', () => {
  eq(f.footer('Hello'), '\n\n_Hello_')
})

await test('footer: prepends double newline', () => {
  const out = f.footer('Test')
  ok(out.startsWith('\n\n_'), 'should start with \\n\\n_')
})

// ─── PAD ──────────────────────────────────────────────────
console.log('\n── padR / padL ──')

await test('padR: short string padded to width', () => {
  eq(f.padR('hi', 5), 'hi   ')
})

await test('padR: long string truncated', () => {
  eq(f.padR('hello world', 5), 'hello')
})

await test('padR: null → empty padded', () => {
  eq(f.padR(null, 3), '   ')
})

await test('padL: short string left-padded', () => {
  eq(f.padL('hi', 5), '   hi')
})

// ─── HEADER ───────────────────────────────────────────────
console.log('\n── header() ──')

await test('header: private shows user', () => {
  const out = f.header({ name: 'YANZYAHA-BOT', jid: '628xxx@s.whatsapp.net' })
  has(out, '@628xxx')
})

await test('header: group shows group indicator', () => {
  const out = f.header({
    name: 'YANZYAHA-BOT',
    jid: '120363405661184579@g.us',
    isGroup: true,
  })
  has(out, 'Group')        // field label shown
  has(out, '120363405661184')  // numeric prefix visible (truncated)
  has(out, 'Kamu')         // user shown
})

await test('header: long group jid truncated with ellipsis', () => {
  const longJid = '120363405661184579' + '@g.us'
  const out = f.header({ name: 'YANZYAHA-BOT', jid: longJid, isGroup: true })
  has(out, '120363405661184')  // prefix preserved
  has(out, '…')               // ellipsis indicates truncation
})

// ─── DIVIDER ──────────────────────────────────────────────
console.log('\n── divider ──')

await test('divider: returns horizontal line', () => {
  const d = f.divider()
  ok(d.length >= 20, `should be at least 20 chars, got ${d.length}`)
  ok(d.startsWith('─'), 'should start with ─')
})

// ─── INTEGRATION: botinfo style ────────────────────────────
console.log('\n── integration: botinfo-style output ──')

await test('integration: botinfo-style box has all expected fields', () => {
  const out = f.box('⚡ YANZYAHA-BOT', [
    { emoji: '📌', label: 'Prefix', value: '.' },
    { emoji: '👤', label: 'Owner', value: 'wa.me/62895618805248' },
    { emoji: '⚙️', label: 'Library', value: 'Baileys' },
    { emoji: '🤖', label: 'Model', value: 'MiniMax-M3' },
    { emoji: '🟢', label: 'Status', value: 'Online' },
    { emoji: '📦', label: 'Versi', value: '2.2.0' },
  ])
  has(out, '⚡ YANZYAHA-BOT')
  has(out, 'Prefix')
  has(out, 'Owner')
  has(out, 'Library')
  has(out, 'Model')
  has(out, 'Status')
  has(out, 'Versi')
  // All lines aligned
  const lines = out.split('\n')
  const widths = lines.map(l => l.length)
  ok(widths.every(w => w === widths[0]), `aligned: ${JSON.stringify(widths)}`)
})

await test('integration: footer does not concatenate without newline', () => {
  // The old bug was "_Powered by X_ ⚡_AI Powered by Y_ 🧠" without \n
  const footerText = f.footer('Powered by YANZYAHA-BOT ⚡')
  ok(footerText.includes('\n\n_'), 'must have \\n\\n before _ for separation')
})

// ─── Summary ──────────────────────────────────────────────
console.log('\n────────────────────────────────────────')
console.log(`${pass}/${pass + fail} passed`)
if (fail > 0) {
  console.error('\nFailures:')
  for (const x of failures) console.error('  -', x.name, ':', x.err)
  process.exit(1)
}
process.exit(0)
