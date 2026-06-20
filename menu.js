export function getMenuText(sender) {
  const user = sender.replace('@s.whatsapp.net', '').replace('@lid', '').split(':')[0]
  return `╭─「 YANZYAHA-BOT 」
│ User   : @${user}
│ Prefix : .
╰────────────────

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

╭─「 ⚙️ PERSONAL CONFIG (per-user) 」
│ ◇ Tiap user bisa punya API key / model sendiri
│ ⌬ .models               » List model dr base_url
│ ⌬ .setapikey <key>      » Set API key pribadi
│ ⌬ .setbaseurl <url>     » Set base URL pribadi
│ ⌬ .setmodel <model>     » Set model pribadi
│ ⌬ .myconfig             » Lihat config lo
│ ⌬ .resetmyconfig        » Hapus config custom
│ ◇ Kosong = pake default Railway
╰────────────────

╭─「 👑 OWNER CONFIG 」
│ ⌬ .showconfig           » Global config
│ ⌬ .resetconfig          » Reset global
╰────────────────

╭─「 📥 DOWNLOAD 」
│ ⌬ .ytdl  [link]            » Video YT
│ ⌬ .ytmp3 [link]            » Audio YT
│ ⌬ .ttdl  [link]            » Video TT
│ ⌬ .autoclip [link YT]      » Auto clip
│ ⌬ .clip [link] [mulai] [akhir] » Clip
│ ⌬ .dl [link platform lain] 
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
│ ⌬ .market              » Info pasar
│ ⌬ .saham [kode]        » Info saham
│ ⌬ .forex [pair]        » Info forex
│ ⌬ .crypto [koin]       » Harga crypto
│ ⌬ .cryptotop           » Top 10 crypto
│ ⌬ .cryptoprediksi [koin] » Prediksi
╰────────────────

╭─「 📨 MENFESS 」
│ ⌬ .menfess  [pesan] » Kirim ke grup
│ ⌬ .menfessp [pesan] » Kirim private
╰────────────────

╭─「 📝 LAINNYA 」
│ ⌬ .teks [pesan] » Echo pesan
╰────────────────`
}

export const menuText = getMenuText('user@s.whatsapp.net')
