// handler-game.js
// Kumpulan mini-game untuk WhatsApp Bot (Baileys)
// Game: Dadu, Koin, Suit, Tebak Angka, Kuis

// ─── STATE GAME (disimpan di memori) ───────────────────────────────────────
const gameState = new Map()

// ─── DATA SOAL KUIS ────────────────────────────────────────────────────────
const soalKuis = [
  {
    q: '🌍 Ibukota Indonesia adalah?',
    opts: ['A. Surabaya', 'B. Medan', 'C. Jakarta', 'D. Bandung'],
    ans: 'C', exp: 'Jakarta adalah ibukota Republik Indonesia sejak 1945.'
  },
  {
    q: '🔢 Berapa hasil dari 15 × 15?',
    opts: ['A. 200', 'B. 225', 'C. 250', 'D. 175'],
    ans: 'B', exp: '15 × 15 = 225.'
  },
  {
    q: '🎵 Lagu "Indonesia Raya" diciptakan oleh?',
    opts: ['A. Ismail Marzuki', 'B. W.R. Supratman', 'C. H. Mutahar', 'D. Gombloh'],
    ans: 'B', exp: 'Lagu Indonesia Raya diciptakan oleh Wage Rudolf Supratman.'
  },
  {
    q: '🌊 Danau terbesar di Indonesia adalah?',
    opts: ['A. Danau Poso', 'B. Danau Singkarak', 'C. Danau Toba', 'D. Danau Sentani'],
    ans: 'C', exp: 'Danau Toba di Sumatera Utara adalah danau terbesar di Indonesia.'
  },
  {
    q: '🪐 Planet terbesar di tata surya adalah?',
    opts: ['A. Saturnus', 'B. Uranus', 'C. Neptunus', 'D. Jupiter'],
    ans: 'D', exp: 'Jupiter adalah planet terbesar di tata surya.'
  },
  {
    q: '⚽ Berapa jumlah pemain sepak bola dalam satu tim?',
    opts: ['A. 9', 'B. 10', 'C. 11', 'D. 12'],
    ans: 'C', exp: 'Setiap tim sepak bola terdiri dari 11 pemain.'
  },
  {
    q: '🌡️ Pada suhu berapa air mendidih (tekanan normal)?',
    opts: ['A. 90°C', 'B. 95°C', 'C. 100°C', 'D. 105°C'],
    ans: 'C', exp: 'Air mendidih pada suhu 100°C pada tekanan atmosfer normal.'
  },
  {
    q: '🏔️ Gunung tertinggi di dunia adalah?',
    opts: ['A. K2', 'B. Kilimanjaro', 'C. Elbrus', 'D. Everest'],
    ans: 'D', exp: 'Gunung Everest (8.848 mdpl) adalah gunung tertinggi di dunia.'
  },
  {
    q: '🔬 Siapa penemu telepon?',
    opts: ['A. Thomas Edison', 'B. Nikola Tesla', 'C. Alexander Graham Bell', 'D. Albert Einstein'],
    ans: 'C', exp: 'Alexander Graham Bell menemukan telepon pada tahun 1876.'
  },
  {
    q: '🦎 Komodo adalah hewan endemik dari?',
    opts: ['A. Bali', 'B. Sulawesi', 'C. Papua', 'D. Pulau Komodo & Flores'],
    ans: 'D', exp: 'Komodo hidup di Pulau Komodo, Flores, dan sekitarnya.'
  }
]

// ─── HELPERS ───────────────────────────────────────────────────────────────
function getUserKey(msg) {
  const jid = msg.key.participant || msg.key.remoteJid
  return jid.replace(/@s\.whatsapp\.net|@lid/g, '')
}

async function kirim(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
}

function acak(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ─── GAME: DADU 🎲 ─────────────────────────────────────────────────────────
export async function handleDadu(sock, msg) {
  try {
    const hasil = acak(1, 6)
    const emojiAngka = ['', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣']
    await kirim(sock, msg,
      `🎲 *Lempar Dadu*\n\n` +
      `${emojiAngka[hasil]} Kamu mendapat angka *${hasil}*!`
    )
  } catch (err) {
    console.error('[handleDadu]', err.message)
  }
}

// ─── GAME: KOIN 🪙 ─────────────────────────────────────────────────────────
export async function handleKoin(sock, msg) {
  try {
    const hasil = Math.random() < 0.5 ? 'HEADS' : 'TAILS'
    const emoji = hasil === 'HEADS' ? '👑' : '🦅'
    await kirim(sock, msg,
      `🪙 *Lempar Koin*\n\n` +
      `${emoji} Hasilnya: *${hasil}*!`
    )
  } catch (err) {
    console.error('[handleKoin]', err.message)
  }
}

// ─── GAME: SUIT ✊ ──────────────────────────────────────────────────────────
export async function handleSuit(sock, msg, text) {
  try {
    const args = typeof text === 'string'
      ? text.trim().split(' ').slice(1).join(' ').toLowerCase()
      : ''

    const valid = ['batu', 'gunting', 'kertas']
    const emojiMap = { batu: '🪨', gunting: '✂️', kertas: '📄' }

    if (!valid.includes(args)) {
      await kirim(sock, msg,
        `✊ *Suit Game*\n\n` +
        `Gunakan: \`.suit <pilihan>\`\n` +
        `Pilihan: \`batu\` | \`gunting\` | \`kertas\`\n\n` +
        `Contoh: \`.suit batu\``
      )
      return
    }

    const botPilih = valid[acak(0, 2)]
    let hasil = ''

    if (args === botPilih) {
      hasil = '🤝 *Seri!*'
    } else if (
      (args === 'batu'    && botPilih === 'gunting') ||
      (args === 'gunting' && botPilih === 'kertas')  ||
      (args === 'kertas'  && botPilih === 'batu')
    ) {
      hasil = '🎉 *Kamu Menang!*'
    } else {
      hasil = '😢 *Kamu Kalah!*'
    }

    await kirim(sock, msg,
      `✊ *Suit Game*\n\n` +
      `Kamu : ${emojiMap[args]} *${args}*\n` +
      `Bot  : ${emojiMap[botPilih]} *${botPilih}*\n\n` +
      `${hasil}`
    )
  } catch (err) {
    console.error('[handleSuit]', err.message)
  }
}

// ─── GAME: TEBAK ANGKA 🔢 ──────────────────────────────────────────────────
export async function handleTebak(sock, msg, text) {
  try {
    const key = `tebak_${getUserKey(msg)}`
    const arg = typeof text === 'string'
      ? text.trim().split(' ').slice(1).join(' ').toLowerCase()
      : ''

    // Mulai game baru
    if (!arg || arg === 'mulai') {
      const angka = acak(1, 100)
      gameState.set(key, { angka, percobaan: 0, max: 7 })
      await kirim(sock, msg,
        `🔢 *Tebak Angka*\n\n` +
        `Aku sudah pilih angka antara *1 - 100*!\n` +
        `Kamu punya *7 kesempatan* untuk menebak.\n\n` +
        `Gunakan: \`.tebak <angka>\`\n` +
        `Contoh: \`.tebak 50\``
      )
      return
    }

    // Cek apakah ada game aktif
    const state = gameState.get(key)
    if (!state) {
      await kirim(sock, msg,
        `❌ Kamu belum mulai game!\n\nKetik \`.tebak mulai\` untuk memulai.`
      )
      return
    }

    // Validasi input
    const tebakan = parseInt(arg)
    if (isNaN(tebakan) || tebakan < 1 || tebakan > 100) {
      await kirim(sock, msg, `❌ Masukkan angka antara *1 - 100*!`)
      return
    }

    state.percobaan++
    const sisa = state.max - state.percobaan

    if (tebakan === state.angka) {
      gameState.delete(key)
      await kirim(sock, msg,
        `🎉 *BENAR!*\n\n` +
        `Angkanya memang *${state.angka}*!\n` +
        `Kamu berhasil dalam *${state.percobaan} percobaan*! 🏆\n\n` +
        `Ketik \`.tebak mulai\` untuk main lagi!`
      )
    } else if (sisa <= 0) {
      gameState.delete(key)
      await kirim(sock, msg,
        `😢 *GAME OVER!*\n\n` +
        `Angka yang benar adalah *${state.angka}*.\n\n` +
        `Ketik \`.tebak mulai\` untuk main lagi!`
      )
    } else {
      const petunjuk = tebakan < state.angka ? '📈 *Terlalu kecil!*' : '📉 *Terlalu besar!*'
      await kirim(sock, msg,
        `${petunjuk}\n\n` +
        `Tebakanmu : *${tebakan}*\n` +
        `Sisa kesempatan: *${sisa}*`
      )
    }
  } catch (err) {
    console.error('[handleTebak]', err.message)
  }
}

// ─── GAME: KUIS ❓ ──────────────────────────────────────────────────────────
export async function handleKuis(sock, msg) {
  try {
    const key = `kuis_${getUserKey(msg)}`
    const soal = soalKuis[acak(0, soalKuis.length - 1)]

    gameState.set(key, { ans: soal.ans, exp: soal.exp })

    await kirim(sock, msg,
      `❓ *KUIS*\n\n` +
      `${soal.q}\n\n` +
      `${soal.opts.join('\n')}\n\n` +
      `Jawab dengan: \`.jawab a/b/c/d\``
    )
  } catch (err) {
    console.error('[handleKuis]', err.message)
  }
}

export async function handleJawab(sock, msg, text) {
  try {
    const key = `kuis_${getUserKey(msg)}`
    const state = gameState.get(key)

    if (!state) {
      await kirim(sock, msg,
        `❌ Tidak ada kuis aktif!\n\nKetik \`.kuis\` untuk mulai kuis.`
      )
      return
    }

    const jawaban = typeof text === 'string'
      ? text.trim().split(' ').slice(1)[0]?.toUpperCase() || ''
      : ''

    if (!['A', 'B', 'C', 'D'].includes(jawaban)) {
      await kirim(sock, msg, `❌ Jawaban harus *A*, *B*, *C*, atau *D*!`)
      return
    }

    gameState.delete(key)

    if (jawaban === state.ans) {
      await kirim(sock, msg,
        `✅ *BENAR!*\n\n` +
        `📚 ${state.exp}\n\n` +
        `Ketik \`.kuis\` untuk soal berikutnya!`
      )
    } else {
      await kirim(sock, msg,
        `❌ *SALAH!*\n\n` +
        `Jawaban yang benar: *${state.ans}*\n` +
        `📚 ${state.exp}\n\n` +
        `Ketik \`.kuis\` untuk coba lagi!`
      )
    }
  } catch (err) {
    console.error('[handleJawab]', err.message)
  }
}

// ─── MAIN: MENU GAME 🎮 ────────────────────────────────────────────────────
export async function handleGame(sock, msg) {
  try {
    await kirim(sock, msg,
      `🎮 *Menu Game*\n\n` +
      `🎲 \`.dadu\` — Lempar dadu\n` +
      `🪙 \`.koin\` — Lempar koin\n` +
      `✊ \`.suit batu/gunting/kertas\` — Suit\n` +
      `🔢 \`.tebak mulai\` — Tebak angka (1-100)\n` +
      `❓ \`.kuis\` — Kuis pengetahuan\n` +
      `📝 \`.jawab a/b/c/d\` — Jawab kuis`
    )
  } catch (err) {
    console.error('[handleGame]', err.message)
  }
}
