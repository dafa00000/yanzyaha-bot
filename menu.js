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
const { isRestrictedGroup, getAllowedCommands, getGlobalEnabledCommands, isOwnerMgmtCommand } = restrictions

function extractCmdNames(cmdStr) {
  // ".sticker / .s" → ["sticker","s"]
  // ".ai [tanya]" → ["ai"]
  // ".addcmd <cmd>" → ["addcmd"]
  return String(cmdStr || '')
    .split('/')
    .map(part => part.trim().replace(/^\./, '').split(/[\s<\[]/)[0].toLowerCase())
    .filter(Boolean)
}

/**
 * Restricted-group menu: only show commands that are in the allowlist.
 * When owner .addcmd / .removecmd, menu updates automatically on next .menu.
 */
function buildRestrictedSections(jid) {
  const allowed = new Set((getAllowedCommands(jid) || []).map(c => String(c).toLowerCase()))
  const result = []
  const shown = new Set()

  // Prefer well-known section order, then remaining SECTIONS
  const orderedKeys = [
    ...RESTRICTED_SECTIONS,
    ...Object.keys(SECTIONS).filter(k => !RESTRICTED_SECTIONS.includes(k)),
  ]
  const seenKey = new Set()

  for (const key of orderedKeys) {
    if (seenKey.has(key)) continue
    seenKey.add(key)
    const section = SECTIONS[key]
    if (!section || section.ownerOnly) continue

    const keptCmds = []
    for (const it of section.items || []) {
      if (it.type !== 'cmd') continue
      const names = extractCmdNames(it.cmd)
      if (names.some(n => allowed.has(n))) {
        keptCmds.push(it)
        names.forEach(n => shown.add(n))
      }
    }
    if (keptCmds.length === 0) continue
    const infos = (section.items || []).filter(it => it.type === 'info')
    result.push({ title: section.title, items: [...keptCmds, ...infos] })
  }

  // Commands allowed but not represented in any static section → extra list
  const orphans = [...allowed].filter(c => {
    if (shown.has(c)) return false
    if (typeof isOwnerMgmtCommand === 'function' && isOwnerMgmtCommand(c)) return false
    // meta cmds usually not listed as user features
    if (['menu', 'help', 'start', 'listcmd'].includes(c)) return false
    return true
  })
  if (orphans.length > 0) {
    result.push({
      title: '✅ COMMAND AKTIF',
      items: orphans.sort().map(c => ({
        type: 'cmd',
        cmd: '.' + c,
        desc: 'Diizinkan di grup ini',
      })),
    })
  }

  return result
}

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
  sticker: {
    title: '🎨 STICKER & MEDIA',
    items: [
      { type: 'cmd', cmd: '.sticker / .s', desc: 'Foto/video jadi stiker' },
      { type: 'cmd', cmd: '.toimg / .toimage', desc: 'Stiker jadi foto' },
    ],
  },
  search: {
    title: '🔍 SEARCH',
    items: [
      { type: 'cmd', cmd: '.search [query]', desc: 'Cari Google/DuckDuckGo' },
      { type: 'cmd', cmd: '.cuaca [kota]', desc: 'Info cuaca (wttr.in)' },
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
  convert: {
    title: '💱 CONVERT',
    items: [
      { type: 'cmd', cmd: '.convert [amount] [from] to [to]', desc: 'Konversi mata uang' },
      { type: 'info', text: '◇ Crypto: btc, eth, sol, bnb, xrp, doge' },
      { type: 'info', text: '◇ Fiat: usd, idr, eur, jpy, gbp, sgd' },
      { type: 'info', text: '◇ Contoh: .convert 1 btc to idr' },
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
      { type: 'cmd', cmd: '.roblox [user]', desc: 'Roblox + video ava' },
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
  others: {
    title: '📝 LAINNYA',
    items: [
      { type: 'cmd', cmd: '.groupid / .idgc', desc: 'Info group ID (di grup)' },
      { type: 'cmd', cmd: '.teks [pesan]', desc: 'Echo pesan' },
    ],
  },
  menfess: {
    title: '📨 MENFESS',
    items: [
      { type: 'cmd', cmd: '.menfess [pesan]', desc: 'Kirim pesan anonim ke grup' },
      { type: 'cmd', cmd: '.menfessp @nomor [pesan]', desc: 'Kirim pesan anonim ke user' },
    ],
  },
  economy: {
    title: '💰 ECONOMY & POINTS',
    items: [
      { type: 'cmd', cmd: '.daily', desc: 'Ambil hadiah harian' },
      { type: 'cmd', cmd: '.balance', desc: 'Cek saldo poin' },
      { type: 'cmd', cmd: '.pay @user [jumlah]', desc: 'Transfer poin' },
      { type: 'cmd', cmd: '.shop', desc: 'Lihat item shop' },
      { type: 'cmd', cmd: '.buy [item]', desc: 'Beli item shop' },
      { type: 'cmd', cmd: '.mjfs [bet] [qty]', desc: 'Beli free spin mahjong (max 20)' },
      { type: 'cmd', cmd: '.freespin', desc: 'Cek free spin mahjong' },
      { type: 'cmd', cmd: '.top', desc: 'Leaderboard poin' },
    ],
  },
  gamesAdvanced: {
    title: '🎰 GAME PREMIUM',
    items: [
      { type: 'info', text: '◇ Economy games · house edge aktif (kecuali owner)' },
      { type: 'cmd', cmd: '.slot [bet]', desc: 'Slot machine' },
      { type: 'cmd', cmd: '.mahjong / .mj [bet]', desc: 'Mahjong 5 tile' },
      { type: 'cmd', cmd: '.mj free', desc: 'Auto free spin mahjong' },
      { type: 'cmd', cmd: '.mjfs [bet] [qty]', desc: 'Beli FS mahjong (harga×bet, max 20)' },
      { type: 'cmd', cmd: '.bj [bet]', desc: 'Blackjack (.hit / .stand)' },
      { type: 'cmd', cmd: '.roulette [pilihan] [bet]', desc: 'Roulette (merah/hitam/angka)' },
      { type: 'cmd', cmd: '.macau [2d/3d/4d] [angka] [bet]', desc: 'Macau / togel' },
      { type: 'cmd', cmd: '.spaceman [bet] [target]', desc: 'Spaceman crash' },
      { type: 'cmd', cmd: '.trivia [A/B/C/D]', desc: 'Trivia quiz' },
      { type: 'cmd', cmd: '.word [jawaban]', desc: 'Susun kata' },
      { type: 'cmd', cmd: '.startnum', desc: 'Tebak angka (grup)' },
      { type: 'cmd', cmd: '.guess [angka]', desc: 'Jawab tebak angka' },
    ],
  },
  tools: {
    title: '🛠️ TOOLS',
    items: [
      { type: 'cmd', cmd: '.translate / .tr [teks] [lang]', desc: 'Translate teks' },
      { type: 'cmd', cmd: '.calc / .kalkulator [expr]', desc: 'Kalkulator' },
      { type: 'cmd', cmd: '.vn [teks]', desc: 'Teks → voice note' },
      { type: 'cmd', cmd: '.convert [amt] [from] to [to]', desc: 'Konversi mata uang/crypto' },
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
      { type: 'cmd', cmd: '.models', desc: 'List model AI' },
      { type: 'cmd', cmd: '.setmodel <model>', desc: 'Set model pribadi' },
      { type: 'cmd', cmd: '.setapikey <key>', desc: 'Set API key pribadi' },
      { type: 'cmd', cmd: '.setbaseurl <url>', desc: 'Set base URL pribadi' },
      { type: 'cmd', cmd: '.mykeys', desc: 'Lihat semua API key' },
      { type: 'cmd', cmd: '.myconfig', desc: 'Lihat config lo' },
      { type: 'cmd', cmd: '.resetmyconfig', desc: 'Hapus config custom' },
    ],
  },
  voiceNoteRestricted: {
    title: '🎤 VOICE NOTE',
    items: [
      { type: 'cmd', cmd: '.vn [teks]', desc: 'Teks jadi voice note' },
      { type: 'info', text: '◇ Suara imut Indonesia!' },
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
  ownerGroupMgmt: {
    title: '🔒 GROUP FILTER MANAGEMENT',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.restrictgroup', desc: 'Jadikan grup ini terfilter' },
      { type: 'cmd', cmd: '.unrestrictgroup', desc: 'Hapus filter grup' },
      { type: 'cmd', cmd: '.addcmd <cmd>', desc: 'Tambah command ke grup' },
      { type: 'cmd', cmd: '.removecmd <cmd>', desc: 'Hapus command dari grup' },
      { type: 'cmd', cmd: '.listcmd', desc: 'Lihat command yang diizinkan' },
      { type: 'cmd', cmd: '.addcmdall <cmd>', desc: 'Tambah cmd ke SEMUA grup' },
      { type: 'cmd', cmd: '.removecmdall <cmd>', desc: 'Hapus cmd dari SEMUA grup' },
    ],
  },
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
      { type: 'cmd', cmd: '.broadcast [pesan]', desc: 'Broadcast ke semua user' },
      { type: 'cmd', cmd: '.broadcastgroup [pesan]', desc: 'Broadcast ke semua grup' },
      { type: 'cmd', cmd: '.broadcastall [pesan]', desc: 'Broadcast ke user + grup' },
      { type: 'cmd', cmd: '.addcmdglobal <cmd> <sec> <desc>', desc: 'Tambah command ke menu global' },
      { type: 'cmd', cmd: '.delcmdglobal <cmd>', desc: 'Hapus command dari menu global' },
      { type: 'cmd', cmd: '.editcmddesc <cmd> <desc>', desc: 'Edit deskripsi command' },
      { type: 'cmd', cmd: '.addsection <name> <title>', desc: 'Tambah section menu baru' },
      { type: 'cmd', cmd: '.delsection <name>', desc: 'Hapus section custom' },
      { type: 'cmd', cmd: '.listsections', desc: 'Lihat semua section' },
      { type: 'cmd', cmd: '.menucmdhelp', desc: 'Panduan menu management' },
    ],
  },
  ownerMenfess: {
    title: '📨 MENFESS ADMIN',
    requiresOwner: true,
    items: [
      { type: 'cmd', cmd: '.menfesslist', desc: 'Statistik menfess (total, hari ini, banned)' },
      { type: 'cmd', cmd: '.menfessban <nomor>', desc: 'Ban user dari menfess' },
      { type: 'cmd', cmd: '.menfessunban <nomor>', desc: 'Unban user dari menfess' },
      { type: 'cmd', cmd: '.menfesscooldown <detik>', desc: 'Set cooldown (min 5 detik)' },
      { type: 'cmd', cmd: '.menfessmaxlen <karakter>', desc: 'Set max panjang pesan (min 10)' },
      { type: 'cmd', cmd: '.menfessgroupadd <nama> <jid>', desc: 'Tambah grup ke whitelist' },
      { type: 'cmd', cmd: '.menfessgrouplist', desc: 'Lihat whitelist grup menfess' },
    ],
  },
  ownerWhale: {
    title: '🐋 WHALE TRACKER (Solana)',
    requiresOwner: true,
    items: [
      { type: 'info', text: '◇ Monitor 300+ Solana whale wallets, auto buy/sell' },
      { type: 'cmd', cmd: '.whale start', desc: 'Start monitoring whale wallets' },
      { type: 'cmd', cmd: '.whale stop', desc: 'Stop monitoring' },
      { type: 'cmd', cmd: '.whale status', desc: 'Lihat status tracker' },
      { type: 'cmd', cmd: '.whale help', desc: 'Panduan lengkap whale' },
      { type: 'cmd', cmd: '.whale add <addr> [label]', desc: 'Tambah wallet whale' },
      { type: 'cmd', cmd: '.whale addbatch <addr1> <addr2>', desc: 'Bulk add massal' },
      { type: 'cmd', cmd: '.whale remove <addr>', desc: 'Hapus wallet whale' },
      { type: 'cmd', cmd: '.whale clear', desc: 'Hapus SEMUA wallet' },
      { type: 'cmd', cmd: '.whale list', desc: 'Lihat semua wallet' },
      { type: 'cmd', cmd: '.whale mcap <amount>', desc: 'Set max MCAP (default $50K)' },
      { type: 'cmd', cmd: '.whale buyamount <sol>', desc: 'Set jumlah buy (default 0.05)' },
      { type: 'cmd', cmd: '.whale autobuy <on|off>', desc: 'Toggle auto-buy (konfirmasi WA)' },
      { type: 'cmd', cmd: '.whale autosell <on|off>', desc: 'Toggle auto-sell saat whale sell' },
      { type: 'cmd', cmd: '.whale holdings', desc: 'Lihat posisi token aktif' },
      { type: 'cmd', cmd: '.whale setwallet <key>', desc: 'Set Solana wallet (auto buy/sell)' },
      { type: 'cmd', cmd: '.whale balance', desc: 'Cek SOL balance' },
      { type: 'info', text: '◇ Pas alert buy masuk, balas "beli" / "skip" / "beli 0.1"' },
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
      { type: 'cmd', cmd: '.roblox [user]', desc: 'Roblox + video ava' },
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
      { type: 'info', text: '◇ Premium economy' },
      { type: 'cmd', cmd: '.slot [bet]', desc: 'Slot (owner full pity/RNG)' },
      { type: 'cmd', cmd: '.mahjong / .mj [bet]', desc: 'Mahjong 5 tile' },
      { type: 'cmd', cmd: '.mj free / .mahjong auto', desc: 'Auto free spin mahjong' },
      { type: 'cmd', cmd: '.mjfs [bet] [qty]', desc: 'Beli FS mahjong (max 20)' },
      { type: 'cmd', cmd: '.freespin', desc: 'Cek FS mahjong' },
      { type: 'cmd', cmd: '.bj / .blackjack [bet]', desc: 'Blackjack' },
      { type: 'cmd', cmd: '.hit / .stand', desc: 'Aksi blackjack' },
      { type: 'cmd', cmd: '.roulette / .roul [pilihan] [bet]', desc: 'Roulette' },
      { type: 'cmd', cmd: '.macau / .togel [2d/3d/4d] [angka] [bet]', desc: 'Macau togel' },
      { type: 'cmd', cmd: '.spaceman / .crash [bet] [target]', desc: 'Spaceman crash' },
      { type: 'cmd', cmd: '.trivia [A-D]', desc: 'Trivia' },
      { type: 'cmd', cmd: '.word [jawaban]', desc: 'Susun kata' },
      { type: 'cmd', cmd: '.startnum / .guess', desc: 'Tebak angka grup' },
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
    title: '🔐 KONFIG GLOBAL & PRIBADI (lengkap)',
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
  ownerHidden: {
    title: '📦 SEMUA COMMAND (tersembunyi)',
    requiresOwner: true,
    items: [
      { type: 'info', text: '◇ Command yang udah ada di code tapi ga di menu utama' },
      { type: 'info', text: '◇ Owner bisa .addcmd untuk aktifkan di grup terfilter' },
      { type: 'cmd', cmd: '.sticker / .s', desc: 'Foto/video jadi stiker WA' },
      { type: 'cmd', cmd: '.toimg / .toimage', desc: 'Stiker jadi foto' },
      { type: 'cmd', cmd: '.info', desc: 'Info bot' },
      { type: 'cmd', cmd: '.translate / .tr', desc: 'Translate teks' },
      { type: 'cmd', cmd: '.blackjack / .hit / .stand', desc: 'Game blackjack' },
      { type: 'cmd', cmd: '.transfer @user [jml]', desc: 'Transfer poin (alias .pay)' },
      { type: 'cmd', cmd: '.leaderboard / .top', desc: 'Leaderboard poin' },
      { type: 'cmd', cmd: '.saldo / .bal / .balance', desc: 'Cek saldo' },
      { type: 'cmd', cmd: '.kalkulator / .calc', desc: 'Kalkulator' },
      { type: 'cmd', cmd: '.mp3 [link]', desc: 'Alias .ytmp3' },
      { type: 'cmd', cmd: '.youtube [link]', desc: 'Alias .yt' },
      { type: 'cmd', cmd: '.tiktok [link]', desc: 'Alias .tt' },
      { type: 'cmd', cmd: '.mobilelegend / .mlbb', desc: 'Alias .ml' },
      { type: 'cmd', cmd: '.roul', desc: 'Alias .roulette' },
      { type: 'cmd', cmd: '.togel', desc: 'Alias .macau' },
      { type: 'cmd', cmd: '.crash', desc: 'Alias .spaceman' },
      { type: 'cmd', cmd: '.mj / .majiang', desc: 'Alias .mahjong' },
      { type: 'cmd', cmd: '.mjfs / .buyfs', desc: 'Beli free spin mahjong' },
      { type: 'cmd', cmd: '.fs / .freespins', desc: 'Alias .freespin (status/beli FS MJ)' },
      { type: 'info', text: '◇ Total command di code: ~90+ (termasuk alias)' },
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

// Sections khusus RESTRICTED GROUP (6: INFO, AI, SEARCH, DOWNLOAD, PERSONAL CONFIG, VOICE NOTE)
const RESTRICTED_SECTIONS = ['info', 'ai', 'sticker', 'search', 'download', 'convert', 'tools', 'personalConfigRestricted', 'voiceNoteRestricted']

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

function buildEnabledSection() {
  const cmds = getGlobalEnabledCommands()
  if (!cmds || cmds.length === 0) return null
  const descMap = {
    sticker: 'Foto/video jadi stiker WA',
    toimg: 'Stiker jadi foto',
    toaudio: 'Video ke MP3 (semua platform)',
    tomp3: 'Video ke MP3 (semua platform)',
    translate: 'Translate teks (auto-detect)',
    tr: 'Alias .translate',
    calc: 'Kalkulator',
    vn: 'Teks jadi voice note',
    convert: 'Konversi mata uang/crypto',
    cuaca: 'Info cuaca',
    weather: 'Alias .cuaca',
    info: 'Info bot',
    short: 'Pendekin link',
    qr: 'Generate QR code',
    ss: 'Screenshot website',
    quote: 'Random quote',
    fakta: 'Random fact',
    gempa: 'Info gempa BMKG',
    sholat: 'Jadwal sholat',
    spotify: 'Cari & download lagu',
  }
  return {
    title: '📢 FITUR TAMBAHAN',
    items: cmds.map(c => ({
      type: 'cmd',
      cmd: '.' + c,
      desc: descMap[c] || c,
    })),
  }
}

function getSectionsForContext(ctx) {
  const { isGroup, isRestricted, jid, isOwner, isPrivate } = ctx

  // Build dynamic section from owner-enabled commands
  const enabledSection = buildEnabledSection()

  // Restricted group: cuma command di allowlist (auto-update pas .addcmd/.removecmd)
  if (isRestricted) {
    const sections = buildRestrictedSections(jid)
    // Owner di restricted group tetap liat management filter
    if (isOwner) {
      if (OWNER_EXTRA_SECTIONS.ownerGroupMgmt) sections.push(OWNER_EXTRA_SECTIONS.ownerGroupMgmt)
    }
    return sections
  }

  // Private atau group biasa: tampilkan semua section kecuali ownerOnly (kecuali owner)
  const result = []
  for (const [key, section] of Object.entries(SECTIONS)) {
    if (section.ownerOnly && !isOwner) continue
    if (section.requiresPrivate && !isPrivate) continue
    result.push(section)
  }
  // Tambahin fitur tambahan buat semua user (non-owner)
  if (enabledSection && !isOwner) result.push(enabledSection)

  // Untuk owner, tambahin section tambahan
  if (isOwner) {
    result.push(OWNER_EXTRA_SECTIONS.ownerMisc)
    result.push(OWNER_EXTRA_SECTIONS.ownerAI)
    result.push(OWNER_EXTRA_SECTIONS.ownerSearch)
    result.push(OWNER_EXTRA_SECTIONS.ownerDownload)
    result.push(OWNER_EXTRA_SECTIONS.ownerPasar)
    result.push(OWNER_EXTRA_SECTIONS.ownerSosmed)
    // whale tracker disabled — intentionally not pushed
    result.push(OWNER_EXTRA_SECTIONS.ownerML)
    result.push(OWNER_EXTRA_SECTIONS.ownerGame)
    result.push(OWNER_EXTRA_SECTIONS.ownerGroup)
    result.push(OWNER_EXTRA_SECTIONS.ownerConfig)
    result.push(OWNER_EXTRA_SECTIONS.ownerGroupMgmt)
    result.push(OWNER_EXTRA_SECTIONS.ownerHidden)
    result.push(OWNER_EXTRA_SECTIONS.ownerAdmin)
  }

  return result
}

// ─── MAIN ENTRY: getMenuText ────────────────────────────────────
export async function getMenuText(msg = null, opts = {}) {
  const isGroup = !!(msg && msg.key?.remoteJid?.endsWith('@g.us'))
  const jid = msg?.key?.remoteJid || 'unknown'
  const sender = msg?.key?.participant || jid
  const isRestricted = isRestrictedGroup(jid)
  const isPrivate = !isGroup
  const isOwner = !!opts.isOwner

  const ctx = { isGroup, isRestricted, jid, isOwner, isPrivate }

  // Load custom menu data
  let customData = null
  try {
    const { loadCustomMenu } = await import('./handler-menu.cjs')
    customData = loadCustomMenu()
  } catch {}

  // Header
  const headerOut = renderHeader(jid, sender, isGroup)

  // Sections
  const sections = getSectionsForContext(ctx)

  // Apply custom descs + hide hidden cmds
  if (customData) {
    const hiddenSet = new Set(customData.hiddenCmds || [])
    for (const section of sections) {
      // Filter hidden cmds
      if (section.items) {
        section.items = section.items.filter(it => {
          if (it.type === 'cmd') {
            const cmd = (it.cmd || '').replace(/^\./, '').split(/\s/)[0]
            return !hiddenSet.has(cmd)
          }
          return true
        })
      }
      // Apply custom descs
      if (section.items) {
        for (const it of section.items) {
          if (it.type === 'cmd') {
            const cmd = (it.cmd || '').replace(/^\./, '').split(/\s/)[0]
            if (customData.customDesc && customData.customDesc[cmd]) {
              it.desc = customData.customDesc[cmd]
            }
          }
        }
      }
    }

    // Add custom sections
    if (customData.sections) {
      for (const [name, items] of Object.entries(customData.sections)) {
        if (items.length === 0) continue
        const title = customData.sectionMeta?.[name]?.title || name
        sections.push({ title, items })
      }
    }
  }

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
  // Count visible cmd items after allowlist filter
  let count = 0
  for (const section of buildRestrictedSections(ctx.jid)) {
    for (const it of section.items || []) {
      if (it.type === 'cmd') count++
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

// Backward-compat export — getMenuText is now async, so callers must await
export const menuText = null
