/**
 * menu.js — render menu command YANZYAHA-BOT
 *
 * Style: ORIGINAL (pre-refactor) — ⌬ .cmd    » desc, narrow box, casual Indo
 * 3 variant:
 *   - USER (private, non-restricted) — full menu
 *   - OWNER — comprehensive dengan 86 command
 *   - RESTRICTED (grup filtered) — cuma 4 section: INFO, AI, SEARCH, DOWNLOAD
 *
 * Auto-size: lebar box ngikutin konten terpanjang (jadi ga ambur-adul)
 */

import restrictions from './restrictions.cjs'
const { isRestrictedGroup, getAllowedCommands } = restrictions

// ─── SECTION DEFINITIONS ────────────────────────────────────────
// Setiap section punya title + items array.
// Items bisa:
//   - { type: 'cmd', cmd: '.foo', desc: '...' }   → ⌬ .foo » ...
//   - { type: 'info', text: '◇ ...' }              → ◇ ...
//
// Style inspired by ORIGINAL menu (before my refactor):
// - Bahasa casual Indo (bukan formal)
// - ⌬ untuk command, ◇ untuk info/note
// - Per-user memory (private) jalan default, group memory khusus whitelist

const SECTIONS = {
  info: {
    title: '📌 INFO',
    items: [
      { type: 'cmd', cmd: '.ping', desc: 'Cek status bot' },
      { type: 'cmd', cmd: '.botinfo', desc: 'Info bot' },
      { type: 'cmd', cmd: '.owner', desc: 'Kontak owner' },
    ],
  },
  ai: {
    title: '🤖 AI CHAT (Hermes Agent)',
    items: [
      { type: 'cmd', cmd: '.ai [tanya]', desc: 'Tanya AI' },
      { type: 'cmd', cmd: '.reset', desc: 'Reset percakapan' },
      { type: 'info', text: '◇ Chat biasa = auto AI reply' },
      { type: 'info', text: '◇ Per-user memory (Hermes session)' },
    ],
  },
  search: {
    title: '🔍 SEARCH & CUACA',
    items: [
      { type: 'cmd', cmd: '.search [query]', desc: 'Cari Google' },
      { type: 'cmd', cmd: '.cuaca [kota]', desc: 'Info cuaca' },
    ],
  },
  market: {
    title: '📊 MARKET & CRYPTO',
    items: [
      { type: 'cmd', cmd: '.market', desc: 'Info pasar' },
      { type: 'cmd', cmd: '.saham [kode]', desc: 'Info saham' },
      { type: 'cmd', cmd: '.forex [pair]', desc: 'Info forex' },
      { type: 'cmd', cmd: '.crypto [koin]', desc: 'Harga crypto' },
      { type: 'cmd', cmd: '.cryptotop', desc: 'Top 10 crypto' },
      { type: 'cmd', cmd: '.cryptoprediksi [koin]', desc: 'Prediksi' },
    ],
  },
  download: {
    title: '📥 DOWNLOAD',
    items: [
      { type: 'cmd', cmd: '.ytdl [link]', desc: 'Video YT' },
      { type: 'cmd', cmd: '.ytmp3 [link]', desc: 'Audio YT' },
      { type: 'cmd', cmd: '.ttdl [link]', desc: 'Video TT' },
      { type: 'cmd', cmd: '.autoclip [link YT]', desc: 'Auto clip + sub Indo' },
      { type: 'cmd', cmd: '.clip [link] [mulai] [akhir]', desc: 'Clip manual' },
      { type: 'cmd', cmd: '.dl [link platform lain]', desc: 'Twitter/IG/FB/Pin' },
    ],
  },
  sosmed: {
    title: '👤 CEK SOSMED',
    items: [
      { type: 'cmd', cmd: '.ig [user]', desc: 'Instagram' },
      { type: 'cmd', cmd: '.tt [user]', desc: 'TikTok' },
      { type: 'cmd', cmd: '.gh [user]', desc: 'GitHub' },
      { type: 'cmd', cmd: '.roblox [user]', desc: 'Roblox' },
      { type: 'cmd', cmd: '.yt [nama]', desc: 'YouTube' },
    ],
  },
  ml: {
    title: '🎮 MOBILE LEGENDS',
    items: [
      { type: 'cmd', cmd: '.ml [ID] [Zone]', desc: 'Cek profil' },
      { type: 'cmd', cmd: '.mlhelp', desc: 'Panduan' },
    ],
  },
  game: {
    title: '🎲 GAME',
    items: [
      { type: 'cmd', cmd: '.dadu', desc: 'Lempar dadu' },
      { type: 'cmd', cmd: '.koin', desc: 'Lempar koin' },
      { type: 'cmd', cmd: '.suit [pilihan]', desc: 'Suit' },
      { type: 'cmd', cmd: '.tebak', desc: 'Tebak angka' },
      { type: 'cmd', cmd: '.kuis', desc: 'Kuis acak' },
      { type: 'cmd', cmd: '.jawab [jwb]', desc: 'Jawab kuis' },
    ],
  },
  menfess: {
    title: '📨 MENFESS',
    items: [
      { type: 'cmd', cmd: '.menfess [pesan]', desc: 'Kirim ke grup' },
      { type: 'cmd', cmd: '.menfessp [pesan]', desc: 'Kirim private' },
    ],
  },
  others: {
    title: '📝 LAINNYA',
    items: [
      { type: 'cmd', cmd: '.groupid', desc: 'Info group ID (kalo di grup)' },
      { type: 'cmd', cmd: '.teks [pesan]', desc: 'Echo pesan' },
    ],
  },
  personalConfig: {
    title: '⚙️ PERSONAL CONFIG (per-user)',
    requiresPrivate: true,
    items: [
      { type: 'info', text: '◇ Tiap user bisa punya API key / model sendiri' },
      { type: 'cmd', cmd: '.models', desc: 'List model dr base_url' },
      { type: 'cmd', cmd: '.setapikey <key>', desc: 'Set API key pribadi' },
      { type: 'cmd', cmd: '.setbaseurl <url>', desc: 'Set base URL pribadi' },
      { type: 'cmd', cmd: '.setmodel <model>', desc: 'Set model pribadi' },
      { type: 'cmd', cmd: '.myconfig', desc: 'Lihat config lo' },
      { type: 'cmd', cmd: '.resetmyconfig', desc: 'Hapus config custom' },
      { type: 'info', text: '◇ Kosong = pake default Railway' },
    ],
  },
  personalConfigRestricted: {
    title: '⚙️ PERSONAL CONFIG',
    items: [
      { type: 'cmd', cmd: '.setapikey <key>', desc: 'Set API key pribadi' },
      { type: 'cmd', cmd: '.setbaseurl <url>', desc: 'Set base URL pribadi' },
      { type: 'cmd', cmd: '.myconfig', desc: 'Lihat config lo' },
      { type: 'cmd', cmd: '.resetmyconfig', desc: 'Hapus config custom' },
    ],
  },
  ownerConfig: {
    title: '👑 OWNER CONFIG',
    ownerOnly: true,
    items: [
      { type: 'cmd', cmd: '.showconfig', desc: 'Global config' },
      { type: 'cmd', cmd: '.resetconfig', desc: 'Reset global' },
    ],
  },
}

// Sections tambahan khusus OWNER
const OWNER_EXTRA_SECTIONS = {
  ownerAdmin: {
    title: '👑 OWNER ONLY',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.run [shell]', desc: 'Eksekusi shell command' },
      { type: 'cmd', cmd: '.banned [nomor]', desc: 'Ban user' },
      { type: 'cmd', cmd: '.unban [nomor]', desc: 'Unban user' },
      { type: 'cmd', cmd: '.users', desc: 'Daftar user' },
      { type: 'cmd', cmd: '.restart', desc: 'Restart bot' },
      { type: 'cmd', cmd: '.update', desc: 'Update bot' },
      { type: 'cmd', cmd: '.memory', desc: 'Lihat memory grup' },
      { type: 'cmd', cmd: '.forget', desc: 'Hapus memory grup' },
    ],
  },
  ownerML: {
    title: '⚔️ ML (lengkap)',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.ml [id] [zone]', desc: 'Profil ML' },
      { type: 'cmd', cmd: '.mlacc / .mltaut', desc: 'Akun terikat ML' },
      { type: 'cmd', cmd: '.mlzone', desc: 'Zone server' },
      { type: 'cmd', cmd: '.mlmenu', desc: 'Menu info ML' },
      { type: 'cmd', cmd: '.mlinfo', desc: 'Info detail ML' },
      { type: 'cmd', cmd: '.cekml', desc: 'Alias .ml' },
      { type: 'cmd', cmd: '.mlhelp', desc: 'Panduan ML' },
    ],
  },
  ownerDownload: {
    title: '📥 DOWNLOAD (lengkap)',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.ytdl [link]', desc: 'Video YouTube' },
      { type: 'cmd', cmd: '.ytmp3 [link]', desc: 'Audio YouTube' },
      { type: 'cmd', cmd: '.ttdl [link]', desc: 'Video TikTok' },
      { type: 'cmd', cmd: '.twdl [link]', desc: 'Video Twitter/X' },
      { type: 'cmd', cmd: '.xdl [link]', desc: 'Alias .twdl' },
      { type: 'cmd', cmd: '.pindl [link]', desc: 'Pinterest' },
      { type: 'cmd', cmd: '.igdl [link]', desc: 'Instagram' },
      { type: 'cmd', cmd: '.fbdl [link]', desc: 'Facebook' },
      { type: 'cmd', cmd: '.dl [link]', desc: 'Auto-detect' },
      { type: 'cmd', cmd: '.download [link]', desc: 'Alias .dl' },
      { type: 'cmd', cmd: '.autoclip', desc: 'Auto clip YT' },
      { type: 'cmd', cmd: '.clip', desc: 'Clip manual' },
    ],
  },
  ownerAI: {
    title: '🤖 AI (lengkap)',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.ai / .grok', desc: 'Tanya AI' },
      { type: 'cmd', cmd: '.reset', desc: 'Hapus riwayat pribadi' },
      { type: 'cmd', cmd: '.forget', desc: 'Hapus riwayat grup' },
      { type: 'cmd', cmd: '.memory', desc: 'Statistik memory grup' },
      { type: 'cmd', cmd: 'chat langsung', desc: 'Auto AI reply' },
    ],
  },
  ownerSearch: {
    title: '🔍 CARI (lengkap)',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.search / .ddg', desc: 'Google search' },
      { type: 'cmd', cmd: '.cuaca / .weather', desc: 'Cuaca kota' },
      { type: 'cmd', cmd: '.searchhelp', desc: 'Panduan search' },
    ],
  },
  ownerPasar: {
    title: '📊 PASAR (lengkap)',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.market', desc: 'Info pasar' },
      { type: 'cmd', cmd: '.saham [kode]', desc: 'Saham ID' },
      { type: 'cmd', cmd: '.forex [pair]', desc: 'Forex' },
      { type: 'cmd', cmd: '.ta [pair]', desc: 'Analisa teknikal' },
      { type: 'cmd', cmd: '.crypto [nama]', desc: 'Harga crypto' },
      { type: 'cmd', cmd: '.cryptotop', desc: 'Top 10 crypto' },
      { type: 'cmd', cmd: '.cryptoprediksi [koin]', desc: 'Prediksi trend' },
    ],
  },
  ownerSosmed: {
    title: '👤 SOSMED (lengkap)',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.ig [user]', desc: 'Instagram' },
      { type: 'cmd', cmd: '.tt [user]', desc: 'TikTok' },
      { type: 'cmd', cmd: '.gh [user]', desc: 'GitHub' },
      { type: 'cmd', cmd: '.roblox [user]', desc: 'Roblox' },
      { type: 'cmd', cmd: '.yt [nama]', desc: 'YouTube' },
    ],
  },
  ownerGame: {
    title: '🎲 GAME (lengkap)',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.game', desc: 'Game random' },
      { type: 'cmd', cmd: '.dadu', desc: 'Lempar dadu' },
      { type: 'cmd', cmd: '.koin', desc: 'Lempar koin' },
      { type: 'cmd', cmd: '.suit [pilihan]', desc: 'Suit' },
      { type: 'cmd', cmd: '.tebak', desc: 'Tebak angka' },
      { type: 'cmd', cmd: '.kuis', desc: 'Kuis acak' },
      { type: 'cmd', cmd: '.jawab [jawaban]', desc: 'Jawab kuis' },
    ],
  },
  ownerMenfess: {
    title: '📨 MENFESS (lengkap)',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.menfess [pesan]', desc: 'Anonim ke grup' },
      { type: 'cmd', cmd: '.menfessp [pesan]', desc: 'Anonim ke user' },
    ],
  },
  ownerImage: {
    title: '🎨 IMAGE',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.imagine [prompt]', desc: 'Generate gambar AI' },
      { type: 'cmd', cmd: '.img', desc: 'Alias .imagine' },
      { type: 'cmd', cmd: '.generate / .gen', desc: 'Alias .imagine' },
    ],
  },
  ownerGroup: {
    title: '🆔 GROUP INFO',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.groupid', desc: 'Info group' },
      { type: 'cmd', cmd: '.groupinfo', desc: 'Alias .groupid' },
      { type: 'cmd', cmd: '.idgc', desc: 'Alias .groupid' },
    ],
  },
  ownerConfig: {
    title: '🔐 KONFIG PRIBADI (lengkap)',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.models', desc: 'List model AI' },
      { type: 'cmd', cmd: '.setapikey', desc: 'Set API key' },
      { type: 'cmd', cmd: '.setkey', desc: 'Alias .setapikey' },
      { type: 'cmd', cmd: '.setbaseurl', desc: 'Set base URL' },
      { type: 'cmd', cmd: '.seturl', desc: 'Alias .setbaseurl' },
      { type: 'cmd', cmd: '.setmodel', desc: 'Set model AI' },
      { type: 'cmd', cmd: '.myconfig', desc: 'Lihat config' },
      { type: 'cmd', cmd: '.mycfg', desc: 'Alias .myconfig' },
      { type: 'cmd', cmd: '.myapikey', desc: 'Lihat API key' },
      { type: 'cmd', cmd: '.mybaseurl', desc: 'Lihat base URL' },
      { type: 'cmd', cmd: '.mymodel', desc: 'Lihat model' },
      { type: 'cmd', cmd: '.apitest', desc: 'Test API' },
      { type: 'cmd', cmd: '.testapikey', desc: 'Alias .apitest' },
      { type: 'cmd', cmd: '.checkapi', desc: 'Alias .apitest' },
      { type: 'cmd', cmd: '.resetmyconfig', desc: 'Hapus config pribadi' },
      { type: 'cmd', cmd: '.clearmyconfig', desc: 'Alias .resetmyconfig' },
    ],
  },
  ownerMisc: {
    title: '🔧 MISC',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.start', desc: 'Menu / redirect' },
      { type: 'cmd', cmd: '.menu / .help', desc: 'Tampilin menu' },
      { type: 'cmd', cmd: '.ping', desc: 'Cek status' },
      { type: 'cmd', cmd: '.botinfo', desc: 'Info bot' },
      { type: 'cmd', cmd: '.owner', desc: 'Kontak owner' },
      { type: 'cmd', cmd: '.teks [pesan]', desc: 'Echo pesan' },
      { type: 'cmd', cmd: '.forget', desc: 'Hapus memory grup' },
    ],
  },
}

// Sections khusus RESTRICTED GROUP (5: INFO, AI, SEARCH, DOWNLOAD, PERSONAL CONFIG)
const RESTRICTED_SECTIONS = ['info', 'ai', 'search', 'download', 'personalConfigRestricted']

// ─── RENDER ENGINE ────────────────────────────────────────────
// Style: OPEN BOX (narrow top/bottom, wide body, no right border)
//   ╭─「 EMOJI TITLE 」
//   │ ⌬ .cmd      » description
//   │ ⌬ .longer   » description
//   │ ◇ note text
//   ╰────────────────
//
// Rules:
//   - Header: ╭─「 TITLE 」  (no closing ╮, no fill dashes)
//   - Footer: ╰────────────────  (fixed 16 dashes — konsisten across sections)
//   - Cmd col: padEnd(longest_cmd + 1) untuk cmd sederhana, +2 kalau ada
//              bracket/slash (lebih banyak space buat "visual breathing room")
//   - Info notes (di section): ◇ prefix, no padding
//   - Header rows (User/Prefix/Group/Kamu): TANPA prefix, plain "│ Label : value"

function cmdColumnWidth(items) {
  const cmdItems = (items || []).filter(it => it.type === 'cmd')
  if (cmdItems.length === 0) return 0
  const longest = cmdItems.reduce((m, it) => Math.max(m, (it.cmd || '').length), 0)
  const longestCmd = cmdItems.find(it => (it.cmd || '').length === longest)?.cmd || ''
  // +1 untuk cmd simple (.ping, .reset), +2 kalau ada bracket/slash/arrow
  // (`.ai [tanya]`, `.cryptoprediksi [koin]`) biar » ga terlalu mepet
  const hasComplex = /[\[<>\/]/.test(longestCmd)
  return longest + (hasComplex ? 2 : 1)
}

function renderItem(item, cmdWidth) {
  if (item.type === 'info') {
    // Info note: ◇ prefix, no padding (strip leading "◇ " kalau ada)
    const text = (item.text || '').replace(/^◇\s*/, '')
    return '◇ ' + text
  }
  // Cmd: ⌬ prefix + padded cmd + » + desc
  const paddedCmd = (item.cmd || '').padEnd(cmdWidth)
  return '⌬ ' + paddedCmd + ' » ' + (item.desc || '')
}

function renderSection(section) {
  const cmdWidth = cmdColumnWidth(section.items)
  const contentLines = section.items.map(it => renderItem(it, cmdWidth))
  const titlePart = '「 ' + section.title + ' 」'

  // Header: ╭─「 TITLE 」  (narrow, no closing ╮)
  const header = '╭─' + titlePart
  // Body: │ <content>  (no closing │ — open box aesthetic)
  const body = contentLines.map(line => '│ ' + line)
  // Footer: ╰────────────────  (fixed 16 dashes — konsisten di semua section)
  const footer = '╰' + '─'.repeat(16)

  return [header, ...body, footer].join('\n')
}

function renderHeader(jid, sender, isGroup = false) {
  // User/Group rows: plain "Label : value" TANPA ◇ prefix.
  // Alignment: label di-padEnd ke 7 char, lalu ':', lalu space, lalu value.
  //   "User   : @xxx"   (4 + 3 sp + :) = 8 chars sebelum value
  //   "Prefix : ."      (6 + 1 sp + :) = 8 chars sebelum value
  //   "Group  : ..."    (5 + 2 sp + :) = 8 chars sebelum value
  //   "Kamu   : @xxx"   (4 + 3 sp + :) = 8 chars sebelum value
  const user = (sender || jid || '').split('@')[0].split(':')[0]
  const labelUser = 'User'.padEnd(7) + ':'
  const labelPrefix = 'Prefix'.padEnd(7) + ':'
  const labelGroup = 'Group'.padEnd(7) + ':'
  const labelKamu = 'Kamu'.padEnd(7) + ':'

  const rows = isGroup
    ? [
        labelGroup + ' ' + (jid || '-'),
        labelKamu + ' @' + user,
        labelPrefix + ' .',
      ]
    : [
        labelUser + ' @' + user,
        labelPrefix + ' .',
      ]

  const titlePart = '「 YANZYAHA-BOT 」'
  const header = '╭─' + titlePart
  const body = rows.map(r => '│ ' + r)
  const footer = '╰' + '─'.repeat(16)

  return [header, ...body, footer].join('\n')
}

// ─── FILTER LOGIC ──────────────────────────────────────────────
// Filter items per section sesuai context:
// - Restricted group: cuma section yang di-whitelist (4 sections)
// - Private: tampilkan semua EXCEPT ownerOnly (kecuali owner)

function getSectionsForContext(ctx) {
  const { isGroup, isRestricted, jid, isOwner, isPrivate } = ctx

  // Restricted group: cuma 4 sections
  if (isRestricted) {
    return RESTRICTED_SECTIONS.map(k => SECTIONS[k]).filter(Boolean)
  }

  // Private atau group biasa: tampilkan semua section kecuali ownerOnly (kecuali owner)
  const result = []
  for (const [key, section] of Object.entries(SECTIONS)) {
    if (section.ownerOnly && !isOwner) continue
    if (section.requiresPrivate && !isPrivate) continue
    result.push(section)
  }

  // Untuk owner, tambahin section tambahan
  if (isOwner) {
    result.push(OWNER_EXTRA_SECTIONS.ownerMisc)
    result.push(OWNER_EXTRA_SECTIONS.ownerAI)
    result.push(OWNER_EXTRA_SECTIONS.ownerSearch)
    result.push(OWNER_EXTRA_SECTIONS.ownerDownload)
    result.push(OWNER_EXTRA_SECTIONS.ownerPasar)
    result.push(OWNER_EXTRA_SECTIONS.ownerSosmed)
    result.push(OWNER_EXTRA_SECTIONS.ownerML)
    result.push(OWNER_EXTRA_SECTIONS.ownerGame)
    result.push(OWNER_EXTRA_SECTIONS.ownerMenfess)
    result.push(OWNER_EXTRA_SECTIONS.ownerImage)
    result.push(OWNER_EXTRA_SECTIONS.ownerGroup)
    result.push(OWNER_EXTRA_SECTIONS.ownerConfig)
    result.push(OWNER_EXTRA_SECTIONS.ownerAdmin)
  }

  return result
}

// ─── MAIN ENTRY: getMenuText ────────────────────────────────────
export function getMenuText(msg = null, opts = {}) {
  const isGroup = !!(msg && msg.key?.remoteJid?.endsWith('@g.us'))
  const jid = msg?.key?.remoteJid || 'unknown'
  const sender = msg?.key?.participant || jid
  const isRestricted = isRestrictedGroup(jid)
  const isPrivate = !isGroup
  const isOwner = !!opts.isOwner

  const ctx = { isGroup, isRestricted, jid, isOwner, isPrivate }

  // Header
  const headerOut = renderHeader(jid, sender, isGroup)

  // Sections
  const sections = getSectionsForContext(ctx)
  const sectionOuts = sections.map(renderSection)

  // Footer message (bedasarkan context)
  let footerText
  if (isRestricted) {
    const allowed = getAllowedCommands(jid) || []
    footerText = `🔒 Grup ini restricted. Total command diizinkan: ${countAllowedItems(ctx)}. Minta owner buat akses lebih.`
  } else if (isGroup) {
    footerText = 'ℹ️ Chat biasa = auto AI reply.'
  } else {
    footerText = '💡 Tips: Bot otomatis reply chat biasa (ga perlu prefix).'
  }

  return [headerOut, ...sectionOuts, footerText].join('\n\n')
}

function countAllowedItems(ctx) {
  // Count sections × items yang visible di restricted group
  const allowed = new Set(getAllowedCommands(ctx.jid) || [])
  let count = 0
  for (const section of RESTRICTED_SECTIONS.map(k => SECTIONS[k]).filter(Boolean)) {
    for (const it of section.items) {
      if (it.type === 'cmd') {
        const cmd = it.cmd.split(/\s/)[0].replace(/^\./, '')  // ".search" -> "search"
        if (allowed.has(cmd)) count++
      } else if (it.type === 'info') {
        count++  // info lines counted
      }
    }
  }
  return count
}

// ─── START REDIRECT ────────────────────────────────────────────
// Untuk .start di restricted group
export function getStartRedirectText(jid) {
  const isRestricted = isRestrictedGroup(jid)
  if (!isRestricted) return null  // caller should show full menu
  return [
    '👋 *Halo!*',
    '',
    'Bot ini punya banyak command, tapi di grup ini cuma',
    'beberapa yang bisa dipake (sesuai aturan grup).',
    '',
    '📋 Ketik *.menu* buat liat command yang',
    'tersedia buat lo ya kak 😊',
  ].join('\n')
}

// Backward-compat export
export const menuText = getMenuText(null)
