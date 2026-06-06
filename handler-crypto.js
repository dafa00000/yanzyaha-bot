// handler-crypto.js

import axios from 'axios'

const COINGECKO = 'https://api.coingecko.com/api/v3'

const COIN_MAP = {
  btc: 'bitcoin',
  bitcoin: 'bitcoin',
  eth: 'ethereum',
  ethereum: 'ethereum',
  sol: 'solana',
  solana: 'solana',
  bnb: 'binancecoin',
  binance: 'binancecoin',
  doge: 'dogecoin',
  dogecoin: 'dogecoin',
  xrp: 'ripple',
  ripple: 'ripple',
  ada: 'cardano',
  cardano: 'cardano',
  trx: 'tron',
  tron: 'tron',
  ton: 'the-open-network',
  usdt: 'tether',
  tether: 'tether',
}

function formatNumber(n) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(2) + 'K'
  return n.toFixed(2)
}

function trendIcon(val) {
  return val >= 0 ? '🟢' : '🔴'
}

// Kirim gambar dari URL
async function sendImage(sock, from, msg, imageUrl, caption) {
  try {
    const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 })
    const buffer = Buffer.from(res.data)
    await sock.sendMessage(from, { image: buffer, caption }, { quoted: msg })
  } catch (err) {
    // Kalau gagal kirim gambar, kirim teks saja
    await sock.sendMessage(from, { text: caption }, { quoted: msg })
  }
}

export async function handleCrypto(sock, msg, text, command) {
  const from = msg.key.remoteJid
  const sendText = async (t) => sock.sendMessage(from, { text: t }, { quoted: msg })

  // .crypto = info satu koin
  // .cryptotop = top 10 koin
  // .cryptoprediksi = prediksi sederhana berdasarkan trend 24h

  if (command === 'cryptotop') {
    await sendText('⏳ Mengambil data top 10 crypto...')
    try {
      const res = await axios.get(`${COINGECKO}/coins/markets`, {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 10,
          page: 1,
          price_change_percentage: '24h',
        },
        timeout: 10000,
      })

      let message = `📊 *TOP 10 CRYPTO*\n`
      message += `━━━━━━━━━━━━━━━━━━\n`
      for (const coin of res.data) {
        const change = coin.price_change_percentage_24h?.toFixed(2) ?? '?'
        message += `${trendIcon(coin.price_change_percentage_24h)} *${coin.symbol.toUpperCase()}* $${formatNumber(coin.current_price)} (${change}%)\n`
      }
      message += `━━━━━━━━━━━━━━━━━━\n`
      message += `_Data: CoinGecko_`
      return sendText(message)
    } catch (err) {
      return sendText(`❌ Gagal ambil data: ${err.message}`)
    }
  }

  if (command === 'crypto') {
    if (!text) {
      return sendText(
        `💰 *CARA PAKAI CRYPTO*\n\n` +
        `*.crypto [koin]* — info harga\n` +
        `*.cryptotop* — top 10 crypto\n` +
        `*.cryptoprediksi [koin]* — prediksi trend\n\n` +
        `Koin yang didukung:\n` +
        `BTC, ETH, SOL, BNB, DOGE, XRP, ADA, TRX, TON, USDT\n\n` +
        `Contoh: *.crypto btc*`
      )
    }

    const coinId = COIN_MAP[text.toLowerCase()]
    if (!coinId) return sendText(`❌ Koin *${text.toUpperCase()}* tidak dikenal.\nContoh: .crypto btc`)

    await sendText(`⏳ Mengambil data ${text.toUpperCase()}...`)
    try {
      const res = await axios.get(`${COINGECKO}/coins/${coinId}`, {
        params: { localization: false, tickers: false, community_data: false, developer_data: false },
        timeout: 10000,
      })

      const d = res.data
      const price = d.market_data.current_price
      const change24h = d.market_data.price_change_percentage_24h?.toFixed(2)
      const change7d = d.market_data.price_change_percentage_7d?.toFixed(2)
      const high24h = d.market_data.high_24h
      const low24h = d.market_data.low_24h
      const marketCap = d.market_data.market_cap.usd

      // Ambil URL gambar dari CoinGecko (large = 200x200)
      const imageUrl = d.image?.large || d.image?.small || null

      const caption =
        `╔══════════════════════════╗\n` +
        `║   💰 ${d.symbol.toUpperCase().padEnd(5)} CRYPTO INFO      ║\n` +
        `╚══════════════════════════╝\n\n` +
        `📛 *Nama     :* ${d.name}\n` +
        `💵 *Harga    :* $${price.usd.toLocaleString()} (Rp ${price.idr?.toLocaleString()})\n` +
        `${trendIcon(change24h)} *24h      :* ${change24h}%\n` +
        `${trendIcon(change7d)} *7 Hari   :* ${change7d}%\n` +
        `📈 *High 24h :* $${high24h.usd?.toLocaleString()}\n` +
        `📉 *Low 24h  :* $${low24h.usd?.toLocaleString()}\n` +
        `🏦 *Mkt Cap  :* $${formatNumber(marketCap)}\n\n` +
        `_Data: CoinGecko_`

      if (imageUrl) {
        return sendImage(sock, from, msg, imageUrl, caption)
      } else {
        return sendText(caption)
      }
    } catch (err) {
      return sendText(`❌ Gagal ambil data: ${err.message}`)
    }
  }

  if (command === 'cryptoprediksi') {
    if (!text) return sendText(`❌ Contoh: *.cryptoprediksi btc*`)

    const coinId = COIN_MAP[text.toLowerCase()]
    if (!coinId) return sendText(`❌ Koin *${text.toUpperCase()}* tidak dikenal.`)

    await sendText(`⏳ Menganalisa trend ${text.toUpperCase()}...`)
    try {
      // Ambil data harga + info gambar sekaligus
      const [chartRes, coinRes] = await Promise.all([
        axios.get(`${COINGECKO}/coins/${coinId}/market_chart`, {
          params: { vs_currency: 'usd', days: 7 },
          timeout: 10000,
        }),
        axios.get(`${COINGECKO}/coins/${coinId}`, {
          params: { localization: false, tickers: false, community_data: false, developer_data: false },
          timeout: 10000,
        }),
      ])

      const prices = chartRes.data.prices
      const latest = prices[prices.length - 1][1]
      const weekAgo = prices[0][1]
      const change7d = ((latest - weekAgo) / weekAgo * 100).toFixed(2)
      const change1d = ((latest - prices[prices.length - 24][1]) / prices[prices.length - 24][1] * 100).toFixed(2)

      const imageUrl = coinRes.data.image?.large || coinRes.data.image?.small || null

      let prediksi, saran
      if (change7d > 5 && change1d > 0) {
        prediksi = '📈 *BULLISH* — Trend naik kuat'
        saran = '✅ Potensi lanjut naik jangka pendek'
      } else if (change7d < -5 && change1d < 0) {
        prediksi = '📉 *BEARISH* — Trend turun kuat'
        saran = '⚠️ Hati-hati, potensi lanjut turun'
      } else if (change1d > 0) {
        prediksi = '↗️ *SIDEWALK NAIK* — Mulai membaik'
        saran = '🔍 Pantau terus sebelum keputusan'
      } else {
        prediksi = '↘️ *SIDEWALK TURUN* — Belum stabil'
        saran = '⏳ Tunggu konfirmasi arah trend'
      }

      const caption =
        `╔══════════════════════════╗\n` +
        `║  🔮 PREDIKSI ${text.toUpperCase().padEnd(4)} TREND    ║\n` +
        `╚══════════════════════════╝\n\n` +
        `💵 *Harga Skrg :* $${latest.toLocaleString()}\n` +
        `📊 *Ubah 24h   :* ${change1d}%\n` +
        `📊 *Ubah 7 Hari:* ${change7d}%\n\n` +
        `${prediksi}\n` +
        `${saran}\n\n` +
        `⚠️ _Ini bukan saran investasi._\n` +
        `_Data: CoinGecko_`

      if (imageUrl) {
        return sendImage(sock, from, msg, imageUrl, caption)
      } else {
        return sendText(caption)
      }
    } catch (err) {
      return sendText(`❌ Gagal analisa: ${err.message}`)
    }
  }
}
