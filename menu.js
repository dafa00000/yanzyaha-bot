/**
 * menu.js — renders the bot's command menu.
 * Context-aware: shows different sections for private chat vs group.
 *
 * Called by:
 *   - handler.js / index.js when user sends `.menu` or `.help`
 *   - Receives msg object so it can detect isGroup + show group context
 */

export function getMenuText(msg = null) {
  const isGroup = !!(msg && msg.key?.remoteJid?.endsWith('@g.us'))
  const jid = msg?.key?.remoteJid || 'unknown'
  const sender = msg?.key?.participant || jid
  const user = (sender || '').split('@')[0].split(':')[0]

  const header = isGroup
    ? `╭─「 YANZYAHA-BOT 」 (GROUP)
│ Group  : ${jid}
│ Kamu   : @${user}
│ Prefix : .
╰────────────────`
    : `╭─「 YANZYAHA-BOT 」
│ User   : @${user}
│ Prefix : .
╰────────────────`

  // Sections shown in BOTH private and group
  const commonSections = `
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
╰────────────────

╭─「 📥 DOWNLOAD 」
│ ⌬ .ytdl  [link]               » Video YT
│ ⌬ .ytmp3 [link]               » Audio YT
│ ⌬ .ttdl  [link]               » Video TT
│ ⌬ .autoclip [link YT]         » Auto clip + sub Indo
│ ⌬ .clip [link] [mulai] [akhir]» Clip manual
│ ⌬ .dl [link platform lain]    » Twitter/IG/FB/Pin
╰────────────────

╭─「 👤 CEK SOSMED 」
│ ⌬ .ig     [user] » Instagram
│ ⌬ .tt     [user] » TikTok
│ ⌬ .gh     [user] » GitHub
│ ⌬ .roblox [user] » Roblox
│ ⌬ .yt     [nama] » YouTube
╰────────────────

╭─「 🎮 MOBILE LEGENDS 」
│ ⌬ .ml [ID] [Zone] » Cek profil
│ ⌬ .mlhelp         » Panduan
╰────────────────

╭─「 🎲 GAME 」
│ ⌬ .dadu           » Lempar dadu
│ ⌬ .koin           » Lempar koin
│ ⌬ .suit [pilihan] » Suit
│ ⌬ .tebak          » Tebak angka
│ ⌬ .kuis           » Kuis acak
│ ⌬ .jawab [jwb]    » Jawab kuis
╰────────────────

╭─「 🔍 SEARCH & CUACA 」
│ ⌬ .search [query] » Cari Google
│ ⌬ .cuaca  [kota]  » Info cuaca
╰────────────────

╭─「 📊 MARKET & CRYPTO 」
│ ⌬ .market               » Info pasar
│ ⌬ .saham [kode]         » Info saham
│ ⌬ .forex [pair]         » Info forex
│ ⌬ .crypto [koin]        » Harga crypto
│ ⌬ .cryptotop            » Top 10 crypto
│ ⌬ .cryptoprediksi [koin]» Prediksi
╰────────────────

╭─「 📨 MENFESS 」
│ ⌬ .menfess  [pesan] » Kirim ke grup
│ ⌬ .menfessp [pesan] » Kirim private
╰────────────────

╭─「 📝 LAINNYA 」
│ ⌬ .groupid  » Info group ID (kalo di grup)
│ ⌬ .teks [pesan] » Echo pesan
╰────────────────`

  // Sections ONLY for private chat (per-user config)
  const privateOnly = `
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

  // Sections ONLY for owner (private chat)
  const ownerOnly = `
╭─「 👑 OWNER CONFIG 」
│ ⌬ .showconfig           » Global config
│ ⌬ .resetconfig          » Reset global
╰────────────────`

  const footer = isGroup
    ? '\nℹ️ *Group mode:*\n• AI/download work normal\n• Per-user config = private only\n• `.groupid` buat dapetin ID grup ini'
    : '\n💡 Tips: Bot otomatis reply chat biasa (ga perlu prefix).'

  return header + commonSections + (isGroup ? '' : privateOnly) + (isGroup ? '' : ownerOnly) + footer
}

export const menuText = getMenuText(null)
