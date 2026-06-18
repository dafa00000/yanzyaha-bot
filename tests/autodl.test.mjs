// tests/autodl.test.mjs — smoke test for handler-autodl URL detection logic
// Stubs heavy handlers (avoid pulling in axios + /sdcard mkdir side-effects).
// Run: npm test
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// Loader that swaps handler-download.js & handler-autoclip.js with stubs
register(pathToFileURL(path.resolve('./tests/stub-loader.mjs')))

const { detectAction, _test } = await import('../handler-autodl.js')

const cases = [
  // [body, isGroup, expectedType, expectedPlatform?]
  ['https://youtu.be/dQw4w9WgXcQ',                false, 'download', 'youtube'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', false, 'download', 'youtube'],
  ['https://vm.tiktok.com/ZS2xYzAbCd/',           false, 'download', 'tiktok'],
  ['https://www.tiktok.com/@user/video/123456',   false, 'download', 'tiktok'],
  ['https://x.com/elonmusk/status/1234567890',    false, 'download', 'twitter'],
  ['https://twitter.com/foo/status/123',          false, 'download', 'twitter'],
  ['https://pin.it/abc123',                       false, 'download', 'pinterest'],
  ['https://www.pinterest.com/pin/123/',          false, 'download', 'pinterest'],

  // Timestamp prefix
  ['0:42 https://youtu.be/dQw4w9WgXcQ',            false, 'tsClip'],
  ['1:23:45 https://www.youtube.com/watch?v=dQw4w9WgXcQ', false, 'tsClip'],
  ['05:00 https://youtu.be/dQw4w9WgXcQ',           false, 'tsClip'],

  // Clip keyword
  ['clip https://youtu.be/dQw4w9WgXcQ 01:30 02:45', false, 'manualClip'],
  ['potong https://youtu.be/dQw4w9WgXcQ 1:30 2:45', false, 'manualClip'],

  // Auto keyword
  ['auto https://youtu.be/dQw4w9WgXcQ',            false, 'autoclip'],
  ['autoclip https://youtu.be/dQw4w9WgXcQ',        false, 'autoclip'],
  ['ai https://youtu.be/dQw4w9WgXcQ',              false, 'autoclip'],

  // Plain text — should return null
  ['halo apa kabar',                               false, null],
  ['',                                             false, null],

  // Group: URL embedded in longer text → null
  ['check this out https://youtu.be/dQw4w9WgXcQ amazing', true, null],
  // Group: URL only → download
  ['https://youtu.be/dQw4w9WgXcQ',                  true, 'download', 'youtube'],
  // Group: URL with trailing dot
  ['https://youtu.be/dQw4w9WgXcQ.',                 true, 'download', 'youtube'],

  // Edge cases
  ['hello https://youtu.be/dQw4w9WgXcQ there',      false, 'download', 'youtube'], // private → still triggers
]

let pass = 0, fail = 0
for (const [body, isGroup, expectedType, expectedPlatform] of cases) {
  const action = detectAction(body, isGroup)
  const gotType = action?.type ?? null
  const gotPlatform = action?.platform ?? null
  const ok = gotType === expectedType && (expectedPlatform === undefined || gotPlatform === expectedPlatform)
  if (ok) {
    console.log(`✓ "${body.slice(0, 60)}"  →  ${gotType}${gotPlatform ? '/' + gotPlatform : ''}`)
    pass++
  } else {
    console.log(`✗ "${body.slice(0, 60)}"  →  got ${gotType}${gotPlatform ? '/' + gotPlatform : ''}, expected ${expectedType}${expectedPlatform ? '/' + expectedPlatform : ''}`)
    console.log('   full action:', action)
    fail++
  }
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`)
console.log('parseTimestamp(0:42)      →', _test.parseTimestamp('0:42'), '(expect 42)')
console.log('parseTimestamp(1:23:45)   →', _test.parseTimestamp('1:23:45'), '(expect 5025)')
console.log('formatSec(42)             →', _test.formatSec(42), '(expect 0:42)')
console.log('formatSec(5025)           →', _test.formatSec(5025), '(expect 1:23:45)')
console.log('cleanUrl(...abc.)         →', _test.cleanUrl('https://youtu.be/abc.'), '(expect https://youtu.be/abc)')
process.exit(fail > 0 ? 1 : 0)
