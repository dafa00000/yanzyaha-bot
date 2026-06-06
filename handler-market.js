// handler-market.js
// Fitur Market untuk WhatsApp Bot (Baileys)
// API: CoinGecko (Crypto) | Yahoo Finance (Saham IDX) | Frankfurter (Forex)
// Semua GRATIS, tanpa API key!

// ─── DAFTAR COIN ID COINGECKO ──────────────────────────────────────────────
const COIN_IDS = {
  btc: 'bitcoin',       bitcoin: 'bitcoin',
  eth: 'ethereum',      ethereum: 'ethereum',
  bnb: 'binancecoin',   binance: 'binancecoin',
  sol: 'solana',        solana: 'solana',
  xrp: 'ripple',        ripple: 'ripple',
  ada: 'cardano',       cardano: 'cardano',
  doge: 'dogecoin',     dogecoin: 'dogecoin',
  usdt: 'tether',       tether: 'tether',
  usdc: 'usd-coin',
  dot: 'polkadot',      polkadot: 'polkadot',
  matic: 'matic-network', polygon: 'matic-network',
  link: 'chainlink',    chainlink: 'chainlink',
  ltc: 'litecoin',      litecoin: 'litecoin',
  shib: 'shiba-inu',
  avax: 'avalanche-2',  avalanche: 'avalanche-2',
  uni: 'uniswap',       uniswap: 'uniswap',
  atom: 'cosmos',       cosmos: 'cosmos',
  near: 'near',
  trx: 'tron',          tron: 'tron',
  not: 'notcoin',        notcoin: 'notcoin',
  pepe: 'pepe',
  wld: 'worldcoin-wld',  worldcoin: 'worldcoin-wld',
  ton: 'the-open-network', toncoin: 'the-open-network',
  apt: 'aptos',          aptos: 'aptos',
  arb: 'arbitrum',       arbitrum: 'arbitrum',
  op: 'optimism',        optimism: 'optimism',
  sui: 'sui',
  sei: 'sei-network'
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
function formatAngka(num) {
  if (!num) return '0'
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T'
  if (num >= 1e9)  return (num / 1e9).toFixed(2)  + 'B'
  if (num >= 1e6)  return (num / 1e6).toFixed(2)  + 'M'
  if (num >= 1e3)  return (num / 1e3).toFixed(2)  + 'K'
  return num.toFixed(2)
}

function formatRupiah(num) {
  return 'Rp ' + Math.round(num).toLocaleString('id-ID')
}

function getSignal(change24h, change7d) {
  const score = (change24h * 0.6) + ((change7d || 0) * 0.4)
  if (score > 5)  return { label: '🟢 STRONG BUY',  desc: 'Momentum sangat positif' }
  if (score > 2)  return { label: '🟡 BUY',          desc: 'Tren naik, pantau terus' }
  if (score < -5) return { label: '🔴 STRONG SELL',  desc: 'Momentum sangat negatif' }
  if (score < -2) return { label: '🟠 SELL',          desc: 'Tren turun, hati-hati' }
  return           { label: '⚪ HOLD / WAIT',         desc: 'Pasar sedang konsolidasi' }
}

function getArah(pct) {
  return pct >= 0 ? `🟢 +${pct.toFixed(2)}%` : `🔴 ${pct.toFixed(2)}%`
}


async function searchCoinId(query) {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
      { headers: { Accept: 'application/json' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.coins?.[0]?.id || null
  } catch {
    return null
  }
}

async function kirim(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
}

function getArg(text, upper = false) {
  if (typeof text !== 'string' || !text.trim()) return ''
  const parts = text.trim().split(' ')
  const arg = parts[0].startsWith('.') ? parts.slice(1).join(' ').trim() : parts.join(' ').trim()
  return upper ? arg.toUpperCase() : arg.toLowerCase()
}

// ─── CRYPTO ────────────────────────────────────────────────────────────────
export async function handleCrypto(sock, msg, text) {
  try {
    const arg = getArg(text)

    if (!arg) {
      await kirim(sock, msg,
        `₿ *Cek Harga Crypto*\n\n` +
        `Gunakan: \`.crypto <simbol/nama>\`\n\n` +
        `Contoh:\n` +
        `• \`.crypto btc\`\n` +
        `• \`.crypto eth\`\n` +
        `• \`.crypto sol\`\n\n` +
        `Tersedia: BTC ETH BNB SOL XRP ADA DOGE\n` +
        `MATIC LINK LTC SHIB AVAX UNI ATOM NEAR TRX`
      )
      return
    }

    await kirim(sock, msg, '🔍 Mengambil data crypto...')
    let coinId = COIN_IDS[arg] || await searchCoinId(arg) || arg

    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`,
      { headers: { Accept: 'application/json' } }
    )

    if (!res.ok) {
      await kirim(sock, msg,
        `❌ Coin *${arg.toUpperCase()}* tidak ditemukan!\n\n` +
        `Coba gunakan nama lengkap.\nContoh: \`.crypto bitcoin\``
      )
      return
    }

    const data  = await res.json()
    const m     = data.market_data
    const c24h  = m.price_change_percentage_24h  || 0
    const c7d   = m.price_change_percentage_7d   || 0
    const c30d  = m.price_change_percentage_30d  || 0
    const signal = getSignal(c24h, c7d)

    await kirim(sock, msg,
      `₿ *${data.name} (${data.symbol.toUpperCase()})*\n` +
      `🏆 Rank #${data.market_cap_rank || '-'}\n\n` +
      `💰 Harga IDR : *${formatRupiah(m.current_price.idr)}*\n` +
      `💵 Harga USD : *$${m.current_price.usd?.toLocaleString()}*\n\n` +
      `📊 Perubahan:\n` +
      `  24 Jam : ${getArah(c24h)}\n` +
      `  7 Hari : ${getArah(c7d)}\n` +
      `  30 Hari: ${getArah(c30d)}\n\n` +
      `⬆️ High 24h   : $${m.high_24h?.usd?.toLocaleString() || '-'}\n` +
      `⬇️ Low 24h    : $${m.low_24h?.usd?.toLocaleString()  || '-'}\n` +
      `📦 Volume 24h : $${formatAngka(m.total_volume?.usd)}\n` +
      `🏦 Market Cap : $${formatAngka(m.market_cap?.usd)}\n\n` +
      `🔮 *Sinyal : ${signal.label}*\n` +
      `📝 ${signal.desc}\n\n` +
      `⚠️ _Bukan saran investasi. DYOR!_`
    )
  } catch (err) {
    console.error('[handleCrypto]', err.message)
    await kirim(sock, msg, '❌ Gagal mengambil data crypto. Coba lagi!')
  }
}

// ─── SAHAM IDX ─────────────────────────────────────────────────────────────
export async function handleSaham(sock, msg, text) {
  try {
    const arg = getArg(text, true)

    if (!arg) {
      await kirim(sock, msg,
        `📈 *Cek Harga Saham IDX*\n\n` +
        `Gunakan: \`.saham <kode>\`\n\n` +
        `Contoh:\n` +
        `• \`.saham BBCA\`\n` +
        `• \`.saham TLKM\`\n` +
        `• \`.saham GOTO\`\n` +
        `• \`.saham BBRI\``
      )
      return
    }

    await kirim(sock, msg, '🔍 Mengambil data saham...')

    const symbol = arg.endsWith('.JK') ? arg : `${arg}.JK`
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=7d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    )

    if (!res.ok) throw new Error('Fetch gagal')

    const data   = await res.json()
    const result = data.chart?.result?.[0]

    if (!result) {
      await kirim(sock, msg,
        `❌ Saham *${arg}* tidak ditemukan!\n\n` +
        `Pastikan kode saham benar.\nContoh: \`.saham BBCA\``
      )
      return
    }

    const meta      = result.meta
    const harga     = meta.regularMarketPrice       || 0
    const kemarin   = meta.chartPreviousClose        || harga
    const change    = harga - kemarin
    const changePct = kemarin ? ((change / kemarin) * 100) : 0
    const high      = meta.regularMarketDayHigh      || 0
    const low       = meta.regularMarketDayLow       || 0
    const volume    = meta.regularMarketVolume        || 0
    const signal    = getSignal(changePct, null)

    // Hitung perubahan 7 hari dari data historis
    const closes  = result.indicators?.quote?.[0]?.close || []
    const valid   = closes.filter(v => v !== null && v !== undefined)
    const c7dPct  = valid.length >= 2
      ? (((valid[valid.length - 1] - valid[0]) / valid[0]) * 100)
      : 0

    await kirim(sock, msg,
      `📈 *Saham ${arg} (IDX)*\n\n` +
      `💰 Harga     : *${formatRupiah(harga)}*\n` +
      `${getArah(changePct)} (1 hari)\n` +
      `${getArah(c7dPct)} (7 hari)\n\n` +
      `⬆️ High Hari Ini : ${formatRupiah(high)}\n` +
      `⬇️ Low Hari Ini  : ${formatRupiah(low)}\n` +
      `📦 Volume        : ${formatAngka(volume)} lot\n\n` +
      `🔮 *Sinyal : ${signal.label}*\n` +
      `📝 ${signal.desc}\n\n` +
      `⚠️ _Bukan saran investasi. DYOR!_`
    )
  } catch (err) {
    console.error('[handleSaham]', err.message)
    await kirim(sock, msg, '❌ Gagal mengambil data saham. Coba lagi!')
  }
}

// ─── FOREX ─────────────────────────────────────────────────────────────────
export async function handleForex(sock, msg, text) {
  try {
    const parts2 = typeof text === 'string' ? text.trim().split(' ') : []
    const arg = parts2[0]?.startsWith(".") ? (parts2[1]?.toUpperCase() || "") : (parts2[0]?.toUpperCase() || "")

    if (!arg) {
      await kirim(sock, msg,
        `💱 *Cek Kurs Forex*\n\n` +
        `Gunakan: \`.forex <mata uang>\`\n\n` +
        `Contoh:\n` +
        `• \`.forex USD\`\n` +
        `• \`.forex EUR\`\n` +
        `• \`.forex JPY\`\n` +
        `• \`.forex SGD\`\n` +
        `• \`.forex MYR\``
      )
      return
    }

    await kirim(sock, msg, '🔍 Mengambil data kurs...')

    const [resHari, resKemarin] = await Promise.all([
      fetch(`https://api.frankfurter.app/latest?from=${arg}&to=IDR,USD,SGD,MYR,EUR,JPY,GBP,AUD`),
      fetch(`https://api.frankfurter.app/latest?from=${arg}&to=IDR`)
        .then(r => r.json()).catch(() => ({ rates: {} }))
    ])

    if (!resHari.ok) {
      await kirim(sock, msg,
        `❌ Mata uang *${arg}* tidak ditemukan!\n\n` +
        `Contoh yang valid: USD EUR JPY SGD MYR GBP AUD SAR`
      )
      return
    }

    const dataHari    = await resHari.json()
    const idrHari     = dataHari.rates?.IDR     || 0
    const idrKemarin  = resKemarin.rates?.IDR   || idrHari
    const change      = idrHari - idrKemarin
    const changePct   = idrKemarin ? ((change / idrKemarin) * 100) : 0
    const signal      = getSignal(changePct, null)

    const flagMap = { USD:'🇺🇸', EUR:'🇪🇺', SGD:'🇸🇬', MYR:'🇲🇾', JPY:'🇯🇵', GBP:'🇬🇧', AUD:'🇦🇺' }

    let ratesText = ''
    for (const [cur, rate] of Object.entries(dataHari.rates || {})) {
      if (cur !== 'IDR') {
        const flag = flagMap[cur] || '🌐'
        ratesText += `  ${flag} ${arg}/${cur} : *${rate.toFixed(cur === 'JPY' ? 2 : 4)}*\n`
      }
    }

    await kirim(sock, msg,
      `💱 *Kurs ${arg} → IDR*\n\n` +
      `💰 1 ${arg} = *${formatRupiah(idrHari)}*\n` +
      `${getArah(changePct)} (dari hari sebelumnya)\n\n` +
      `📊 *Kurs Lainnya:*\n` +
      `${ratesText}\n` +
      `🔮 *Sinyal : ${signal.label}*\n` +
      `📝 ${signal.desc}\n\n` +
      `⚠️ _Bukan saran investasi. DYOR!_`
    )
  } catch (err) {
    console.error('[handleForex]', err.message)
    await kirim(sock, msg, '❌ Gagal mengambil data kurs. Coba lagi!')
  }
}

// ─── MENU MARKET ───────────────────────────────────────────────────────────
export async function handleMarket(sock, msg) {
  try {
    await kirim(sock, msg,
      `📊 *Menu Market*\n\n` +
      `₿ \`.crypto <simbol>\`\n` +
      `   Harga & analisis crypto\n` +
      `   Contoh: \`.crypto btc\`\n\n` +
      `📈 \`.saham <kode>\`\n` +
      `   Harga & analisis saham IDX\n` +
      `   Contoh: \`.saham BBCA\`\n\n` +
      `💱 \`.forex <mata uang>\`\n` +
      `   Kurs & analisis forex\n` +
      `   Contoh: \`.forex USD\`\n\n` +
      `📊 \`.ta crypto <simbol>\`\n` +
      `   Analisis teknikal crypto\n` +
      `   Contoh: \`.ta crypto btc\`\n\n` +
      `📊 \`.ta saham <kode>\`\n` +
      `   Analisis teknikal saham IDX\n` +
      `   Contoh: \`.ta saham BBCA\`\n\n` +
      `Indikator TA: RSI · SMA · Bollinger Bands\n` +
      `Support & Resistance\n\n` +
      `⚠️ _Data bersifat informatif._\n` +
      `_Bukan saran investasi. DYOR!_`
    )
  } catch (err) {
    console.error('[handleMarket]', err.message)
  }
}

// ─── ANALISIS TEKNIKAL ─────────────────────────────────────────────────────

function calcSMA(prices, period) {
  if (prices.length < period) return null
  const slice = prices.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

function calcRSI(prices, period = 14) {
  if (prices.length < period + 1) return null
  let gains = 0, losses = 0
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1]
    if (diff > 0) gains += diff
    else losses += Math.abs(diff)
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  return 100 - (100 / (1 + avgGain / avgLoss))
}

function calcBollinger(prices, period = 20) {
  if (prices.length < period) return null
  const slice = prices.slice(-period)
  const sma = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period
  const std = Math.sqrt(variance)
  return { upper: sma + 2 * std, middle: sma, lower: sma - 2 * std }
}

function getRSILabel(rsi) {
  if (rsi >= 70) return `🔴 Overbought (${rsi.toFixed(1)}) — Potensi turun`
  if (rsi <= 30) return `🟢 Oversold (${rsi.toFixed(1)}) — Potensi naik`
  return `⚪ Netral (${rsi.toFixed(1)})`
}

function getSMASignal(harga, sma7, sma14, sma30) {
  let bullish = 0
  if (sma7 && harga > sma7)   bullish++
  if (sma14 && harga > sma14) bullish++
  if (sma30 && harga > sma30) bullish++
  if (bullish === 3) return '🟢 Di atas semua MA — Bullish kuat'
  if (bullish === 2) return '🟡 Di atas 2 MA — Cenderung Bullish'
  if (bullish === 1) return '🟠 Di atas 1 MA — Cenderung Bearish'
  return '🔴 Di bawah semua MA — Bearish kuat'
}

export async function handleTA(sock, msg, text) {
  try {
    const parts = typeof text === 'string' ? text.trim().split(' ') : []
    // Handle both: '.ta saham BBCA' dan 'saham BBCA'
    const offset = parts[0]?.startsWith('.') ? 1 : 0
    const tipe   = parts[offset]?.toLowerCase()
    const simbol = parts.slice(offset + 1).join(' ').trim()

    if (!tipe || !simbol) {
      await kirim(sock, msg,
        `📊 *Analisis Teknikal*\n\n` +
        `Gunakan: \`.ta <tipe> <simbol>\`\n\n` +
        `Contoh:\n` +
        `• \`.ta crypto btc\`\n` +
        `• \`.ta crypto ethereum\`\n` +
        `• \`.ta saham BBCA\`\n` +
        `• \`.ta saham TLKM\`\n\n` +
        `Indikator: RSI, SMA 7/14/30,\nBollinger Bands, Support & Resistance`
      )
      return
    }

    await kirim(sock, msg, '📊 Menghitung analisis teknikal...')

    let prices = [], nama = '', hargaSkrg = 0

    if (tipe === 'crypto') {
      const coinId = COIN_IDS[simbol.toLowerCase()] || simbol.toLowerCase()
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=idr&days=30&interval=daily`,
        { headers: { Accept: 'application/json' } }
      )
      if (!res.ok) {
        await kirim(sock, msg, `❌ Coin *${simbol.toUpperCase()}* tidak ditemukan!`)
        return
      }
      const data = await res.json()
      prices = (data.prices || []).map(p => p[1])
      hargaSkrg = prices[prices.length - 1]
      nama = simbol.toUpperCase()

    } else if (tipe === 'saham') {
      const symbol = simbol.toUpperCase()
      const ticker = symbol.endsWith('.JK') ? symbol : `${symbol}.JK`
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=30d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!res.ok) throw new Error('Fetch gagal')
      const data   = await res.json()
      const result = data.chart?.result?.[0]
      if (!result) {
        await kirim(sock, msg, `❌ Saham *${symbol}* tidak ditemukan!`)
        return
      }
      const closes = result.indicators?.quote?.[0]?.close || []
      prices = closes.filter(v => v !== null && v !== undefined)
      hargaSkrg = result.meta?.regularMarketPrice || prices[prices.length - 1]
      nama = symbol

    } else {
      await kirim(sock, msg, `❌ Tipe tidak valid!\nGunakan: \`crypto\` atau \`saham\``)
      return
    }

    if (prices.length < 14) {
      await kirim(sock, msg, '❌ Data harga tidak cukup untuk analisis.')
      return
    }

    // Hitung indikator
    const rsi     = calcRSI(prices)
    const sma7    = calcSMA(prices, 7)
    const sma14   = calcSMA(prices, 14)
    const sma30   = calcSMA(prices, 30)
    const bb      = calcBollinger(prices)

    // Support & Resistance dari 30 hari
    const support    = Math.min(...prices.slice(-14))
    const resistance = Math.max(...prices.slice(-14))

    // Posisi Bollinger
    let bbLabel = ''
    if (bb) {
      if (hargaSkrg >= bb.upper) bbLabel = '🔴 Di atas Upper Band — Overbought'
      else if (hargaSkrg <= bb.lower) bbLabel = '🟢 Di bawah Lower Band — Oversold'
      else bbLabel = '⚪ Di dalam Band — Normal'
    }

    const smaSignal = getSMASignal(hargaSkrg, sma7, sma14, sma30)

    const fmt = tipe === 'saham'
      ? (n) => n ? `Rp ${Math.round(n).toLocaleString('id-ID')}` : '-'
      : (n) => n ? formatRupiah(n) : '-'

    await kirim(sock, msg,
      `📊 *Analisis Teknikal — ${nama}*\n` +
      `💰 Harga Saat Ini: *${fmt(hargaSkrg)}*\n\n` +

      `📈 *RSI (14):*\n  ${rsi ? getRSILabel(rsi) : '-'}\n\n` +

      `〽️ *Moving Average:*\n` +
      `  SMA 7  : ${sma7  ? fmt(sma7)  : '-'}\n` +
      `  SMA 14 : ${sma14 ? fmt(sma14) : '-'}\n` +
      `  SMA 30 : ${sma30 ? fmt(sma30) : '-'}\n` +
      `  Sinyal : ${smaSignal}\n\n` +

      `🎯 *Bollinger Bands (20):*\n` +
      `  Upper : ${bb ? fmt(bb.upper)  : '-'}\n` +
      `  Middle: ${bb ? fmt(bb.middle) : '-'}\n` +
      `  Lower : ${bb ? fmt(bb.lower)  : '-'}\n` +
      `  Posisi: ${bbLabel || '-'}\n\n` +

      `🛡️ *Support & Resistance (14 hari):*\n` +
      `  Support    : ${fmt(support)}\n` +
      `  Resistance : ${fmt(resistance)}\n\n` +

      `⚠️ _Bukan saran investasi. DYOR!_`
    )
  } catch (err) {
    console.error('[handleTA]', err.message)
    await kirim(sock, msg, '❌ Gagal menghitung analisis teknikal. Coba lagi!')
  }
}
