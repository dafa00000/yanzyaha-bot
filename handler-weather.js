export async function handleWeather(sock, msg, text, apiKey) {
  const from = msg.key.remoteJid

  // Ambil nama kota dari teks pesan
  // Kalau text = ".cuaca Pekanbaru" → ambil setelah spasi pertama
  // Kalau text = "bandung" (dari cuacabandung) → langsung pakai
  let city = ''
  if (typeof text === 'string') {
    const parts = text.trim().split(' ')
    city = parts[0].startsWith('.') ? parts.slice(1).join(' ').trim() : text.trim()
  }

  if (!city) {
    await sock.sendMessage(from, {
      text: '❌ Format: .cuaca <nama kota>\nContoh: .cuaca Jakarta'
    }, { quoted: msg })
    return
  }

  try {
    await sock.sendMessage(from, { text: '🔍 Mencari data cuaca...' }, { quoted: msg })

    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`)
    if (!res.ok) throw new Error('Kota tidak ditemukan')
    const data = await res.json()

    const cur      = data.current_condition[0]
    const area     = data.nearest_area[0]
    const cityName = area.areaName[0].value
    const country  = area.country[0].value

    const forecasts = data.weather.slice(0, 3).map(d =>
      `  📅 ${d.date}: ${d.mintempC}°C - ${d.maxtempC}°C`
    ).join('\n')

    const text2 =
      `🌤️ *Cuaca di ${cityName}, ${country}*\n\n` +
      `🌡️ Suhu      : *${cur.temp_C}°C* (terasa ${cur.FeelsLikeC}°C)\n` +
      `📝 Kondisi   : ${cur.weatherDesc[0].value}\n` +
      `💧 Kelembaban: ${cur.humidity}%\n` +
      `💨 Angin     : ${cur.windspeedKmph} km/jam\n` +
      `☀️ Indeks UV : ${cur.uvIndex}\n\n` +
      `📆 *Prakiraan 3 Hari:*\n${forecasts}\n\n` +
      `_Sumber: wttr.in_`

    await sock.sendMessage(from, { text: text2 }, { quoted: msg })
  } catch (err) {
    console.error('[handleWeather]', err.message)
    await sock.sendMessage(from, {
      text: `❌ Gagal mengambil cuaca untuk *${city}*. Cek nama kota!`
    }, { quoted: msg })
  }
}
