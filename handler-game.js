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
  },
  // --- TAMBAHAN SOAL BARU ---
  {
    q: '🌋 Gunung berapi aktif di Pulau Jawa?',
    opts: ['A. Rinjani', 'B. Merapi', 'C. Kerinci', 'D. Semeru'],
    ans: 'B', exp: 'Gunung Merapi di batas Yogyakarta & Jawa Tengah adalah gunung berapi paling aktif.'
  },
  {
    q: '💧 Sungai terpanjang di Indonesia?',
    opts: ['A. Sungai Mahakam', 'B. Sungai Kapuas', 'C. Sungai Barito', 'D. Sungai Musi'],
    ans: 'B', exp: 'Sungai Kapuas di Kalimantan Barat sepanjang ±1.143 km, terpanjang di Indonesia.'
  },
  {
    q: '🧬 Unsur kimia dengan simbol O adalah?',
    opts: ['A. Oksigen', 'B. Emas', 'C. Perak', 'D. Tembaga'],
    ans: 'A', exp: 'O adalah simbol untuk Oksigen (Oxygen).'
  },
  {
    q: '🎭 Tokoh wayang yang dikenal sebagai "Ksatria Pandawa" adalah?',
    opts: ['A. Werkudara', 'B. Arjuna', 'C. Nakula', 'D. Sahadewa'],
    ans: 'B', exp: 'Arjuna (Werkudara) adalah salah satu Ksatria Pandawa.'
  },
  {
    q: '🌍 Negara dengan populasi terbesar di dunia?',
    opts: ['A. India', 'B. Amerika Serikat', 'C. Indonesia', 'D. China'],
    ans: 'A', exp: 'India saat ini negara dengan populasi terbesar, melebihi China.'
  },
  {
    q: '🏛️ Candi Borobudur terletak di provinsi?',
    opts: ['A. Jawa Timur', 'B. Jawa Tengah', 'C. DI Yogyakarta', 'D. Jawa Barat'],
    ans: 'B', exp: 'Candi Borobudur berada di Magelang, Jawa Tengah.'
  },
  {
    q: '💻 Singkatan dari CPU adalah?',
    opts: ['A. Central Process Unit', 'B. Central Processing Unit', 'C. Computer Personal Unit', 'D. Core Processing Unit'],
    ans: 'B', exp: 'CPU = Central Processing Unit (Unit Pemroses Pusat).'
  },
  {
    q: '🌈 Warna pelangi ada berapa?',
    opts: ['A. 5', 'B. 6', 'C. 7', 'D. 8'],
    ans: 'C', exp: 'Pelangi memiliki 7 warna: Merah, Jingga, Kuning, Hijau, Biru, Nila, Ungu.'
  },
  {
    q: '📅 Hari Kemerdekaan Indonesia diperingati tanggal?',
    opts: ['A. 17 Agustus 1945', 'B. 17 Agustus 1946', 'C. 28 Oktober 1928', 'D. 1 Juni 1945'],
    ans: 'A', exp: 'Proklamasi Kemerdekaan Indonesia dibacakan 17 Agustus 1945.'
  },
  {
    q: '🪨 Batuan yang terbentuk dari abu vulkanik adalah?',
    opts: ['A. Granit', 'B. Batu Kapur', 'C. Tufa', 'D. Marmer'],
    ans: 'C', exp: 'Tufa (tuff) adalah batuan piroklastik dari endapan abu vulkanik yang mengeras.'
  },
  {
    q: '🦁 Hewan simbol Bendera Merah Putih (Garuda) adalah?',
    opts: ['A. Elang', 'B. Singa', 'C. Garuda', 'D. Rajawali'],
    ans: 'C', exp: 'Garuda Pancasila adalah simbol negara berbentuk burung Garuda (elang mitos).'
  },
  {
    q: '🎮 Game "Mobile Legends" dikembangkan oleh perusahaan?',
    opts: ['A. Moonton', 'B. Tencent', 'C. Garena', 'D. NetEase'],
    ans: 'A', exp: 'Mobile Legends: Bang Bang dikembangkan oleh Moonton (Shanghai Moonton Technology).'
  },
  {
    q: '💰 Mata uang Jepang adalah?',
    opts: ['A. Yuan', 'B. Won', 'C. Yen', 'D. Ringgit'],
    ans: 'C', exp: 'Mata uang Jepang adalah Yen (¥ / JPY).'
  },
  {
    q: '🌊 Lautan terluas di dunia adalah?',
    opts: ['A. Atlantik', 'B. Pasifik', 'C. Hindia', 'D. Antartika'],
    ans: 'B', exp: 'Lautan Pasifik adalah lautan terbesar, meliputi ~30% permukaan bumi.'
  },
  {
    q: '🧮 Hasil 2 pangkat 10 adalah?',
    opts: ['A. 512', 'B. 1024', 'C. 2048', 'D. 4096'],
    ans: 'B', exp: '2^10 = 1024.'
  },
  {
    q: '🦠 Penyakit yang disebabkan virus Corona adalah?',
    opts: ['A. MERS', 'B. SARS', 'C. COVID-19', 'D. Flu Biasa'],
    ans: 'C', exp: 'COVID-19 disebabkan oleh virus SARS-CoV-2 (coronavirus novel).'
  },
  {
    q: '🏝️ Pulau terbesar di Indonesia adalah?',
    opts: ['A. Sumatera', 'B. Kalimantan', 'C. Papua', 'D. Sulawesi'],
    ans: 'B', exp: 'Kalimantan (Borneo) adalah pulau terbesar di Indonesia (±743.000 km²).'
  },
  {
    q: '🗼 Menara Eiffel berada di kota?',
    opts: ['A. London', 'B. Roma', 'C. Paris', 'D. Madrid'],
    ans: 'C', exp: 'Menara Eiffel adalah ikon kota Paris, Prancis.'
  },
  {
    q: '⚛️ Unsur dengan nomor atom 1 adalah?',
    opts: ['A. Helium', 'B. Hidrogen', 'C. Litium', 'D. Berilium'],
    ans: 'B', exp: 'Hidrogen (H) memiliki nomor atom 1, unsur paling ringan.'
  },
  {
    q: '🎵 Nada tertinggi dalam notasi balok (do re mi...) adalah?',
    opts: ['A. Do', 'B. Re', 'C. Mi', 'D. Ti/Si'],
    ans: 'D', exp: 'Dalam skala mayor, Ti (atau Si) adalah nada ke-7 dan tertinggi sebelum Do oktav berikutnya.'
  },
  {
    q: '🏛️ Pancasila disahkan pada tanggal?',
    opts: ['A. 1 Juni 1945', 'B. 18 Agustus 1945', 'C. 22 Juni 1945', 'D. 29 Agustus 1945'],
    ans: 'B', exp: 'Pancasila disahkan sebagai dasar negara oleh PPKI tanggal 18 Agustus 1945.'
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
      ? text.trim().split(/\s+/)[0]?.toUpperCase() || ''
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
