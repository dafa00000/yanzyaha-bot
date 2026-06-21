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

// Sections khusus RESTRICTED GROUP (cuma 4: INFO, AI, SEARCH, DOWNLOAD)
const RESTRICTED_SECTIONS = ['info', 'ai', 'search', 'download']

// ─── RENDER ENGINE ────────────────────────────────────────────
// Render section dengan auto-sized box (lebar ngikutin konten terpanjang)
// Style: ╭─「 TITLE 」───╮
//        │ cmd » desc        │
//        ╰────────────╯

function renderItem(item) {
  if (item.type === 'info') return item.text
  // Pad cmd dengan 2 trailing spaces (atau sampe 18 char) buat align
  const paddedCmd = item.cmd.padEnd(18)
  return '⌬ ' + paddedCmd + ' » ' + item.desc
}

function renderSection(section) {
  // Build content lines (no border chars yet)
  const contentLines = section.items.map(renderItem)

  // titlePart panjang jadi acuan box width
  const titlePart = '「 ' + section.title + ' 」'
  // innerContentWidth = panjang maksimal baris content (atau titlePart)
  const innerContentWidth = Math.max(
    titlePart.length,
    ...contentLines.map(l => l.length)
  )

  // BOX_WIDTH = innerContentWidth + 4 (untuk │ + spasi di body)
  // Semua baris (header, body, footer) akan punya BOX_WIDTH char
  const boxWidth = innerContentWidth + 4

  // Header: ╭─「 TITLE 」─...─╮  (total BOX_WIDTH)
  const headerDashCount = Math.max(2, boxWidth - 3 - titlePart.length)
  const header = '╭─' + titlePart + '─'.repeat(headerDashCount) + '╮'

  // Body: │ <content padded> │  (total BOX_WIDTH)
  const body = contentLines.map(line => {
    const padded = line + ' '.repeat(innerContentWidth - line.length)
    return '│ ' + padded + ' │'
  })

  // Footer: ╰─...─╯  (total BOX_WIDTH)
  const footerDashCount = boxWidth - 2
  const footer = '╰' + '─'.repeat(footerDashCount) + '╯'

  return [header, ...body, footer].join('\n')
}

function renderHeader(jid, sender, isGroup = false) {
  const user = (sender || jid || '').split('@')[0].split(':')[0]
  if (isGroup) {
    return renderSection({
      title: 'YANZYAHA-BOT',
      items: [
        { type: 'info', text: 'Group  : ' + (jid || '-') },
        { type: 'info', text: 'Kamu   : @' + user },
        { type: 'info', text: 'Prefix : .' },
      ],
    })
  }
  return renderSection({
    title: 'YANZYAHA-BOT',
    items: [
      { type: 'info', text: 'User   : @' + user },
      { type: 'info', text: 'Prefix : .' },
    ],
  })
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
