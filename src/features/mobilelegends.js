import axios from 'axios'

export async function checkMLProfile(userId, zoneId = '2107') {
  if (!userId || !/^\d+$/.test(userId)) {
    throw new Error('ID tidak valid! Gunakan angka saja.\nContoh: .ml 123456789 2107')
  }

  const res = await axios.get('https://api.isan.eu.org/nickname/ml', {
    params: { id: userId, server: zoneId },
    timeout: 15000,
    headers: { 'Accept': 'application/json' }
  })

  const data = res.data

  if (!data.success) {
    throw new Error(
      `ID atau Zone tidak ditemukan!\n\n` +
      `Cara cek:\nBuka ML → Profil → lihat angka di bawah nama\n` +
      `Format: *123456789 (2107)*\n` +
      `• 123456789 = ID\n• 2107 = Zone`
    )
  }

  return {
    nickname: data.name,
    userId: data.id,
    zoneId: data.server,
    country: data.country
  }
}

export function formatMLProfile(data) {
  return `╔══════════════════════════╗
║   ⚔️  MOBILE LEGENDS INFO   ║
╚══════════════════════════╝

👤 *Nickname :* ${data.nickname}
🆔 *ID       :* ${data.userId}
🌍 *Zone     :* ${data.zoneId}
🏳️ *Negara  :* ${data.country}

_Ketik .ml [ID] [Zone] untuk cek ulang_`
}
