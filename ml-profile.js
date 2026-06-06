import axios from 'axios'

const TIMEOUT = 15000
const CODASHOP_URL = 'https://order-sg.codashop.com/initPayment.action'
const ISAN_URL = 'https://api.isan.eu.org/nickname/ml'

async function checkViaCodeshop(userId, zoneId) {
  const payload = new URLSearchParams({
    'voucherPricePoint.id': '1',
    'voucherPricePoint.price': '10000',
    'voucherPricePoint.variablePrice': '0',
    'user.userId': userId,
    'user.zoneId': zoneId,
    voucherTypeName: 'MOBILE_LEGENDS',
    shopLang: 'id_ID',
  })

  const response = await axios.post(CODASHOP_URL, payload, {
    timeout: TIMEOUT,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
    },
  })

  const data = response.data

  if (data.errorCode === -101) {
    throw new Error(
      `Zone ID *${zoneId}* tidak cocok dengan ID *${userId}*\n\n` +
      `Cara cek Zone:\nBuka ML → Profile → tap foto profil\n` +
      `Lihat angka dalam kurung di bawah nama\n` +
      `Contoh: 123456789 *(2107)*`
    )
  }

  if (data.confirmationFields?.username) {
    return {
      nickname: data.confirmationFields.username,
      userId,
      zoneId,
      source: 'Codashop',
    }
  }

  throw new Error('Codashop gagal')
}

async function checkViaIsan(userId, zoneId) {
  const response = await axios.get(ISAN_URL, {
    params: { id: userId, zone: zoneId },
    timeout: TIMEOUT,
  })

  const data = response.data

  if (!data.success) throw new Error('Isan API gagal')

  return {
    nickname: data.name,
    userId,
    zoneId,
    source: 'isan.eu.org',
  }
}

export async function checkMLProfile(userId, zoneId = '2107') {
  userId = String(userId).replace(/[^0-9]/g, '').trim()
  zoneId = String(zoneId).replace(/[^0-9]/g, '').trim()

  if (!userId || !/^\d+$/.test(userId)) {
    throw new Error('ID tidak valid! Gunakan angka saja.\nContoh: .ml 1234567 2107')
  }

  // Coba Codashop dulu, kalau gagal fallback ke Isan
  try {
    return await checkViaCodeshop(userId, zoneId)
  } catch (err) {
    console.log('Codashop gagal, fallback ke Isan:', err.message)
  }

  try {
    return await checkViaIsan(userId, zoneId)
  } catch (err) {
    throw new Error(`Gagal cek profil ML.\nPastikan ID dan Zone sudah benar.`)
  }
}

export function formatMLProfile(data) {
  return (
    `╔══════════════════════════╗\n` +
    `║   ⚔️  MOBILE LEGENDS INFO   ║\n` +
    `╚══════════════════════════╝\n\n` +
    `👤 *Nickname :* ${data.nickname}\n` +
    `🆔 *ID       :* ${data.userId}\n` +
    `🌍 *Zone     :* ${data.zoneId}\n\n` +
    `_Sumber: ${data.source}_\n` +
    `_Ketik .ml [ID] [Zone] untuk cek ulang_`
  )
}
