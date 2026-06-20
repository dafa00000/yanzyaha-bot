/**
 * menu.js — renders the bot's command menu.
 * Context-aware:
 *   - Private chat: full menu
 *   - Group:       per-user config hidden, group ID shown
 *   - Restricted group: only allowed sections visible
 *
 * Restrictions config: ./restrictions.cjs (CJS)
 */

import restrictions from './restrictions.cjs'
const { isRestrictedGroup, getAllowedCommands } = restrictions

export function getMenuText(msg = null) {
  const isGroup = !!(msg && msg.key?.remoteJid?.endsWith('@g.us'))
  const jid = msg?.key?.remoteJid || 'unknown'
  const sender = msg?.key?.participant || jid
  const user = (sender || '').split('@')[0].split(':')[0]
  const isRestricted = isRestrictedGroup(jid)

  const header = isGroup
    ? `╭─「 YANZYAHA-BOT 」 (GROUP${isRestricted ? ' 🔒' : ''})
│ Group  : ${jid}
│ Kamu   : @${user}
│ Prefix : .
╰────────────────`
    : `╭─「 YANZYAHA-BOT 」
│ User   : @${user}
│ Prefix : .
╰────────────────`

  // ── INFO + AI CHAT — always shown ──
  let menu = `
╭─「 📌 INFO 」
│ ⌬ .ping    » Cek status bot
│ ⌬ .botinfo » Info bot
│ ⌬ .owner   » Kontak owner
╰────────────────

╭─「 🤖 AI CHAT (Hermes Agent) 」
│ ⌬ .ai [tanya]  » Tanya AI
│ ⌬ .reset       » Reset percakapan
│ ◇ Chat biasa = auto AI reply
│ ◇ Per-user memory (Hermes session)
╰────────────────`

  // ── SEARCH (always, but .cuaca only if not restricted) ──
  if (isRestricted) {
    menu += `
╭─「 🔍 SEARCH 」
│ ⌬ .search [query] » Cari Google
╰────────────────`
  } else {
    menu += `
╭─「 🔍 SEARCH & CUACA 」
│ ⌬ .search [query] » Cari Google
│ ⌬ .cuaca  [kota]  » Info cuaca
╰────────────────`
  }

  // ── MARKET & CRYPTO — hidden in restricted groups ──
  if (!isRestricted) {
    menu += `
╭─「 📊 MARKET & CRYPTO 」
│ ⌬ .market               » Info pasar
│ ⌬ .saham [kode]         » Info saham
│ ⌬ .forex [pair]         » Info forex
│ ⌬ .crypto [koin]        » Harga crypto
│ ⌬ .cryptotop            » Top 10 crypto
│ ⌬ .cryptoprediksi [koin]» Prediksi
╰────────────────`
  }

  // ── DOWNLOAD — hidden in restricted groups ──
  if (!isRestricted) {
    menu += `
╭─「 📥 DOWNLOAD 」
│ ⌬ .ytdl  [link]               » Video YT
│ ⌬ .ytmp3 [link]               » Audio YT
│ ⌬ .ttdl  [link]               » Video TT
│ ⌬ .autoclip [link YT]         » Auto clip + sub Indo
│ ⌬ .clip [link] [mulai] [akhir]» Clip manual
│ ⌬ .dl [link platform lain]    » Twitter/IG/FB/Pin
╰────────────────`
  }

  // ── CEK SOSMED — hidden in restricted groups ──
  if (!isRestricted) {
    menu += `
╭─「 👤 CEK SOSMED 」
│ ⌬ .ig     [user] » Instagram
│ ⌬ .tt     [user] » TikTok
│ ⌬ .gh     [user] » GitHub
│ ⌬ .roblox [user] » Roblox
│ ⌬ .yt     [nama] » YouTube
╰────────────────`
  }

  // ── MOBILE LEGENDS — hidden in restricted groups ──
  if (!isRestricted) {
    menu += `
╭─「 🎮 MOBILE LEGENDS 」
│ ⌬ .ml [ID] [Zone] » Cek profil
│ ⌬ .mlhelp         » Panduan
╰────────────────`
  }

  // ── GAME — hidden in restricted groups ──
  if (!isRestricted) {
    menu += `
╭─「 🎲 GAME 」
│ ⌬ .dadu           » Lempar dadu
│ ⌬ .koin           » Lempar koin
│ ⌬ .suit [pilihan] » Suit
│ ⌬ .tebak          » Tebak angka
│ ⌬ .kuis           » Kuis acak
│ ⌬ .jawab [jwb]    » Jawab kuis
╰────────────────`
  }

  // ── MENFESS — hidden in restricted groups ──
  if (!isRestricted) {
    menu += `
╭─「 📨 MENFESS 」
│ ⌬ .menfess  [pesan] » Kirim ke grup
│ ⌬ .menfessp [pesan] » Kirim private
╰────────────────`
  }

  // ── LAINNYA — hidden in restricted groups (including .groupid) ──
  if (!isRestricted) {
    menu += `
╭─「 📝 LAINNYA 」
│ ⌬ .groupid  » Info group ID (kalo di grup)
│ ⌬ .teks [pesan] » Echo pesan
╰────────────────`
  }

  // ── PERSONAL CONFIG (private only, hidden in restricted) ──
  if (!isGroup && !isRestricted) {
    menu += `
╭─「 ⚙️ PERSONAL CONFIG (per-user) 」
│ ◇ Tiap user bisa punya API key / model sendiri
│ ⌬ .models               » List model dr base_url
│ ⌬ .setapikey <key>      » Set API key pribadi
│ ⌬ .setbaseurl <url>     » Set base URL pribadi
│ ⌬ .setmodel <model>     » Set model pribadi
│ ⌬ .myconfig             » Lihat config lo
│ ⌬ .resetmyconfig        » Hapus config custom
│ ◇ Kosong = pake default Railway
╰────────────────`
  }

  // ── OWNER CONFIG (private only, hidden in restricted) ──
  if (!isGroup && !isRestricted) {
    menu += `
╭─「 👑 OWNER CONFIG 」
│ ⌬ .showconfig           » Global config
│ ⌬ .resetconfig          » Reset global
╰────────────────`
  }

  // ── FOOTER ──
  if (isRestricted) {
    const allowed = getAllowedCommands(jid)
    menu += `\n🔒 *Grup ini restricted.*\n• Hanya command tertentu yang bisa dipake\n• Total diizinkan: ${allowed.length} command\n• Minta owner buat akses lebih`
  } else if (isGroup) {
    menu += '\nℹ️ *Group mode:*\n• AI/download work normal\n• Per-user config = private only\n• `.groupid` buat dapetin ID grup ini'
  } else {
    menu += '\n💡 Tips: Bot otomatis reply chat biasa (ga perlu prefix).'
  }

  return header + menu
}

export const menuText = getMenuText(null)
