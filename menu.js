/**
 * menu.js — render menu command YANZYAHA-BOT
 *
 * Style konsisten (pakai format.cjs):
 *   - Section title: emoji + nama section
 *   - Command format: ⌬ .cmd    » Deskripsi bahasa Indonesia
 *   - Footer: tips + versi bot
 *
 * Visibility:
 *   - Private chat        : full menu (semua section)
 *   - Group (non-restricted): hampir full, kecuali per-user config
 *   - Group (restricted)  : cuma section yang di-whitelist
 */

import restrictions from './restrictions.cjs'
const { isRestrictedGroup, getAllowedCommands } = restrictions

import format from './format.cjs'
// format.cjs is CJS — destructure default + named exports
const fmt = format.default || format

// ─── SECTION DEFINITIONS ─────────────────────────────────────
// Definisi terpusat biar gampang diedit. Tiap section punya:
//   - id: identifier unik
//   - title: emoji + judul (untuk header section)
//   - items: [{ cmd, desc, restricted? }] — restricted: hanya muncul kalau diizinkan
//   - requiresPrivate: kalau true, hanya muncul di private chat

const SECTIONS = {
  info: {
    title: '📌 INFO',
    items: [
      { cmd: '.ping',    desc: 'Cek status bot' },
      { cmd: '.botinfo', desc: 'Info lengkap bot' },
      { cmd: '.owner',   desc: 'Kontak owner' },
    ],
  },
  ai: {
    title: '🤖 AI CHAT',
    items: [
      { cmd: '.ai',     desc: 'Tanya AI (pakai memory)' },
      { cmd: '.reset',  desc: 'Hapus memory chat ini' },
      { cmd: '.forget', desc: 'Hapus memory grup ini', groupOnly: true },
      { cmd: 'chat',    desc: 'Langsung ketik = auto AI (tanpa prefix)' },
    ],
  },
  search: {
    title: '🔍 PENCARIAN',
    items: [
      { cmd: '.search', desc: 'Cari di Google' },
      { cmd: '.cuaca',  desc: 'Info cuaca kota' },
    ],
  },
  download: {
    title: '📥 DOWNLOAD',
    // Tampil di private + non-restricted group. Di restricted group, otomatis hidden
    // (command .ytdl dll ga ada di allowed list mereka)
    items: [
      { cmd: '.ytdl',     desc: 'Download video YouTube' },
      { cmd: '.ytmp3',    desc: 'Download audio YouTube' },
      { cmd: '.ttdl',     desc: 'Download video TikTok' },
      { cmd: '.autoclip', desc: 'Auto-clip video YT (AI)' },
      { cmd: '.clip',     desc: 'Clip manual YT (start/end)' },
      { cmd: '.dl',       desc: 'Twitter/IG/FB/Pin (auto-detect)' },
    ],
  },
  market: {
    title: '📊 PASAR & CRYPTO',
    items: [
      { cmd: '.market',    desc: 'Info pasar (saham/crypto/forex)' },
      { cmd: '.saham',     desc: 'Info saham (kode: BBCA, TLKM)' },
      { cmd: '.forex',     desc: 'Info forex (USDIDR, EURUSD)' },
      { cmd: '.crypto',    desc: 'Harga crypto' },
      { cmd: '.cryptotop', desc: 'Top 10 crypto' },
    ],
  },
  sosmed: {
    title: '👤 CEK SOSMED',
    items: [
      { cmd: '.ig',     desc: 'Cek profil Instagram' },
      { cmd: '.tt',     desc: 'Cek profil TikTok' },
      { cmd: '.gh',     desc: 'Cek profil GitHub' },
      { cmd: '.roblox', desc: 'Cek profil Roblox' },
      { cmd: '.yt',     desc: 'Cari channel YouTube' },
    ],
  },
  ml: {
    title: '🎮 MOBILE LEGENDS',
    items: [
      { cmd: '.ml',     desc: 'Cek profil ML (ID Zone)' },
      { cmd: '.mlhelp', desc: 'Panduan cari ID & Zone' },
    ],
  },
  game: {
    title: '🎲 GAME',
    items: [
      { cmd: '.dadu',  desc: 'Lempar dadu' },
      { cmd: '.koin',  desc: 'Lempar koin' },
      { cmd: '.suit',  desc: 'Suit (batu/gunting/kertas)' },
      { cmd: '.tebak', desc: 'Tebak angka' },
      { cmd: '.kuis',  desc: 'Kuis random' },
    ],
  },
  menfess: {
    title: '📨 MENFESS',
    items: [
      { cmd: '.menfess',  desc: 'Kirim pesan ke grup' },
      { cmd: '.menfessp', desc: 'Kirim pesan ke user (anonim)' },
    ],
  },
  personalConfig: {
    title: '⚙️ KONFIG PRIBADI',
    requiresPrivate: true,  // cuma muncul di private chat
    items: [
      { cmd: '.models',        desc: 'Lihat model yang tersedia' },
      { cmd: '.setapikey',     desc: 'Set API key pribadi' },
      { cmd: '.setbaseurl',    desc: 'Set base URL pribadi' },
      { cmd: '.setmodel',      desc: 'Set model pribadi' },
      { cmd: '.myconfig',      desc: 'Lihat konfig lo' },
      { cmd: '.resetmyconfig', desc: 'Hapus konfig custom' },
    ],
  },
  ownerConfig: {
    title: '👑 KONFIG OWNER',
    requiresPrivate: true,
    items: [
      { cmd: '.showconfig',  desc: 'Lihat konfig global' },
      { cmd: '.resetconfig', desc: 'Reset konfig global' },
      { cmd: '.memory',      desc: 'Lihat memory grup (owner)' },
    ],
  },
}

// ─── RENDER LOGIC ─────────────────────────────────────────────
function shouldShowSection(sectionKey, section, ctx) {
  const { isGroup, isRestricted, jid, isPrivateOwner, isPrivate } = ctx
  const allowed = isRestricted ? (getAllowedCommands(jid) || []) : null

  // requiresPrivate: only private chat
  if (section.requiresPrivate && !isPrivate && !isPrivateOwner) return false

  // privateOnly section: only private chat
  if (section.privateOnly && !isPrivate && !isPrivateOwner) return false

  // Filter items based on context
  let visibleItems
  if (isRestricted) {
    // Restricted group: hanya command yang ada di allowed list
    visibleItems = section.items.filter(it => {
      if (it.cmd === 'chat') return false  // 'chat' cuma pseudo-command, jangan tampil
      const cmd = it.cmd.replace('.', '')
      return allowed.includes(cmd)
    })
  } else if (isGroup) {
    // Non-restricted group: tampilkan semua KECUALI privateOnly items
    visibleItems = section.items.filter(it => {
      if (it.cmd === 'chat') return true  // no-prefix chat works in group too
      if (it.privateOnly) return false
      return true
    })
  } else {
    // Private chat: tampilkan semua
    visibleItems = section.items.filter(it => {
      if (it.cmd === 'chat') return true  // pseudo-command, useful untuk user
      return true
    })
  }

  // Apply groupOnly filter (cuma muncul di group, bukan private)
  if (!isGroup) {
    visibleItems = visibleItems.filter(it => !it.groupOnly)
  }

  if (visibleItems.length === 0) return false
  section._visibleItems = visibleItems
  return true
}

// ─── MAIN ENTRY ───────────────────────────────────────────────
export function getMenuText(msg = null, opts = {}) {
  const isGroup = !!(msg && msg.key?.remoteJid?.endsWith('@g.us'))
  const jid = msg?.key?.remoteJid || 'unknown'
  const sender = msg?.key?.participant || jid
  const user = (sender || '').split('@')[0].split(':')[0]
  const isRestricted = isRestrictedGroup(jid)
  const isPrivate = !isGroup
  const isPrivateOwner = isPrivate && opts.isOwner  // optional hint

  const ctx = { isGroup, isRestricted, jid, isPrivateOwner, isPrivate }

  // ─── HEADER ─────────────────────────────────────────────
  const headerOut = fmt.header({
    name: 'YANZYAHA-BOT',
    jid,
    senderJid: sender,
    isGroup,
    prefix: '.',
  })

  // ─── SECTIONS ───────────────────────────────────────────
  const sectionOuts = []
  for (const [key, section] of Object.entries(SECTIONS)) {
    if (!shouldShowSection(key, section, ctx)) continue
    sectionOuts.push(fmt.section(section.title, section._visibleItems))
  }

  // ─── FOOTER + TIPS ─────────────────────────────────────
  let footerText = ''
  if (isRestricted) {
    const allowed = getAllowedCommands(jid) || []
    const hidden = sectionOuts.length === 0
      ? 'Hanya command tertentu yang aktif di grup ini.'
      : `Total command diizinkan: ${countAllowedItems(ctx)}.`
    footerText = `🔒 Grup ini restricted. ${hidden} Minta owner buat akses lebih.`
  } else if (isGroup) {
    footerText = 'ℹ️ Bot inget chat grup ini seperti Meta AI — konteks lengkap tersimpan otomatis.'
  } else {
    footerText = '💡 Chat biasa (tanpa prefix) langsung dijawab AI. Memory per-user aktif.'
  }

  const versionFooter = `YANZYAHA-BOT v2.2.0 · Powered by Baileys + Hermes Agent 🧠`

  return [
    headerOut,
    sectionOuts.join('\n\n'),
    footerText,
    versionFooter,
  ].filter(Boolean).join('\n\n')
}

function countAllowedItems(ctx) {
  const { isRestricted, jid } = ctx
  if (!isRestricted) return 0
  const allowed = new Set(getAllowedCommands(jid) || [])
  let count = 0
  for (const section of Object.values(SECTIONS)) {
    for (const it of section.items) {
      const cmd = it.cmd.replace('.', '')
      if (it.restricted ? allowed.has(cmd) : true) count++
    }
  }
  return count
}

// ─── START REDIRECT MESSAGE ───────────────────────────────────
// Pesan yang dikirim kalau user di restricted group ketik .start
export function getStartRedirectText(jid) {
  const isRestricted = isRestrictedGroup(jid)
  if (!isRestricted) return null  // caller should show full menu
  return [
    '👋 *Halo!*',
    '',
    'Bot ini punya banyak command, tapi di grup ini cuma',
    'beberapa yang bisa dipake (sesuai aturan grup).',
    '',
    '📋 Ketik *.menu* buat liat daftar lengkap command',
    'yang tersedia buat lo ya kak 😊',
    '',
    fmt.footer('Powered by YANZYAHA-BOT 🧠'),
  ].join('\n')
}

// Backward-compat export (untuk tests & existing callers)
export const menuText = getMenuText(null)
