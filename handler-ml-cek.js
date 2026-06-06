// handler-ml-cek.js
// Cek info akun Mobile Legends via WhatsApp Bot (Baileys - ES Module)
// Commands: .cekml .mlinfo .mlacc .mltaut .mlzone

// ─── CONFIG API ────────────────────────────────────────────────────────────
// Ganti URL ini sesuai provider API yang kamu pakai
// Provider populer: gamefox.id, zydbot.com, digimondes.com
const API_CFG = {
  detail:   'https://api.isan.eu.org/nickname/ml',
  binding:  'https://api.isan.eu.org/nickname/ml',
  validate: 'https://api.isan.eu.org/nickname/ml',
  apiKey:   '', // isi jika provider butuh API key
}

// ─── DAFTAR ZONE / SERVER ──────────────────────────────────────────────────
const ZONE_LIST = {
  '1': 'Indonesia (ID)', '2': 'Malaysia (MY)', '3': 'Thailand (TH)',
  '4': 'Philippines (PH)', '5': 'Singapore (SG)', '6': 'Vietnam (VN)',
  '7': 'Myanmar (MM)', '8': 'Cambodia (KH)', '9': 'Taiwan (TW)',
  '10': 'Hong Kong (HK)', '11': 'India (IN)', '12': 'Brazil (BR)',
  '13': 'USA (US)', '14': 'Europe (EU)', '15': 'Middle East (ME)',
  '16': 'Russia (RU)', '17': 'Turkey (TR)', '18': 'Saudi Arabia (SA)',
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
async function kirim(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
}

function loadingMsg(uid, zone) {
  return `⏳ *Mengecek akun ML...*\n\n📋 UID : \`${uid}\`\n🌐 Zone: \`${zone}\`\n\nMohon tunggu sebentar...`
}

// Fetch dengan timeout 10 detik
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timer)
    return res
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

// Ambil nilai dari berbagai kemungkinan nama field (normalisasi response API)
function getField(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  }
  return null
}

// Format tanggal dari timestamp atau string
function formatDate(val) {
  if (!val) return '❓ Tidak tersedia'
  try {
    const num = Number(val)
    const d = !isNaN(num) ? new Date(num * (num < 1e12 ? 1000 : 1)) : new Date(val)
    if (isNaN(d.getTime())) return String(val)
    return d.toLocaleDateString('id-ID', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta'
    }) + ' WIB'
  } catch {
    return String(val)
  }
}

// Emoji status binding
function bindEmoji(val) {
  if (!val) return '❌'
  const v = String(val).toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes' || v === 'terhubung') return '✅'
  if (v === '0' || v === 'false' || v === 'no' || v === 'tidak') return '❌'
  return `✅ ${val}`
}

// ─── FETCH INFO AKUN ML ────────────────────────────────────────────────────
async function fetchMLInfo(uid, zone) {
  try {
    const res = await fetchWithTimeout(
      `https://api.isan.eu.org/nickname/ml?id=${uid}&zone=${zone}`
    )
    const data = await res.json()
    if (data.success && data.name) {
      return { ok: true, data: { nickname: data.name } }
    }
  } catch {}
  return { ok: false }
}

// ─── FETCH BINDING (akun terkait) ──────────────────────────────────────────
async function fetchMLBinding(uid, zone) {
  const headers = { 'Content-Type': 'application/json' }
  if (API_CFG.apiKey) headers['Authorization'] = `Bearer ${API_CFG.apiKey}`

  const attempts = [
    () => fetchWithTimeout(`${API_CFG.binding}?uid=${uid}&zone=${zone}`, { headers }),
    () => fetchWithTimeout(API_CFG.binding, {
      method: 'POST',
      headers,
      body: JSON.stringify({ uid, zone })
    }),
  ]

  for (const attempt of attempts) {
    try {
      const res = await attempt()
      if (!res.ok) continue
      const data = await res.json()
      if (data && (data.data || data.result || data.binding)) {
        return { ok: true, data: data.data || data.result || data }
      }
    } catch {
      continue
    }
  }
  return { ok: false }
}

// ─── FORMAT HASIL CEK AKUN ─────────────────────────────────────────────────
function formatMLInfo(uid, zone, info) {
  const d = info || {}

  const nickname  = getField(d, 'nickname', 'username', 'name', 'player_name') || '❓ Tidak diketahui'
  const level     = getField(d, 'level', 'exp_level', 'player_level') || '❓'
  const server    = getField(d, 'server_name', 'zone_name', 'region') || ZONE_LIST[zone] || zone
  const rank      = getField(d, 'rank', 'rank_name', 'tier', 'badge_name') || '❓'
  const created   = getField(d, 'created_at', 'create_time', 'register_time', 'reg_date', 'join_date')
  const lastLogin = getField(d, 'last_login', 'last_login_time', 'login_time')
  const hero      = getField(d, 'hero_count', 'total_hero', 'heroes')
  const skin      = getField(d, 'skin_count', 'total_skin', 'skins')
  const diamond   = getField(d, 'diamond', 'gems', 'currency')

  let msg = `╔══════════════════╗\n`
  msg    += `║  🎮 *CEKML - INFO AKUN*  ║\n`
  msg    += `╚══════════════════╝\n\n`
  msg    += `👤 *Nickname* : ${nickname}\n`
  msg    += `🆔 *UID*      : \`${uid}\`\n`
  msg    += `🌐 *Zone*     : ${zone} — ${server}\n`
  msg    += `⭐ *Level*    : ${level}\n`
  msg    += `🏆 *Rank*     : ${rank}\n`

  if (hero)      msg += `🦸 *Hero*     : ${hero}\n`
  if (skin)      msg += `👘 *Skin*     : ${skin}\n`
  if (diamond)   msg += `💎 *Diamond* : ${diamond}\n`

  msg += `\n📅 *Tanggal Buat* : ${formatDate(created)}\n`
  if (lastLogin) msg += `🕐 *Login Terakhir* : ${formatDate(lastLogin)}\n`

  return msg
}

function formatMLBinding(uid, zone, binding) {
  const d = binding || {}

  const facebook = getField(d, 'facebook', 'fb', 'fb_binding', 'isFacebook', 'is_facebook')
  const google   = getField(d, 'google', 'gg', 'google_binding', 'isGoogle', 'is_google')
  const moonton  = getField(d, 'moonton', 'email', 'moonton_binding', 'isMoonton', 'is_moonton')
  const apple    = getField(d, 'apple', 'apple_binding', 'isApple', 'is_apple')
  const huawei   = getField(d, 'huawei', 'hms', 'huawei_binding', 'isHuawei', 'is_huawei')
  const vk       = getField(d, 'vk', 'vk_binding')
  const twitter  = getField(d, 'twitter', 'twitter_binding')

  let msg = `╔══════════════════╗\n`
  msg    += `║  🔗 *AKUN TERKAIT ML*   ║\n`
  msg    += `╚══════════════════╝\n\n`
  msg    += `🆔 UID  : \`${uid}\` | Zone: ${zone}\n\n`
  msg    += `${bindEmoji(facebook)} Facebook\n`
  msg    += `${bindEmoji(google)}   Google\n`
  msg    += `${bindEmoji(moonton)}  Moonton / Email\n`

  if (apple !== null)   msg += `${bindEmoji(apple)}   Apple\n`
  if (huawei !== null)  msg += `${bindEmoji(huawei)}  Huawei\n`
  if (vk !== null)      msg += `${bindEmoji(vk)}   VK\n`
  if (twitter !== null) msg += `${bindEmoji(twitter)} Twitter\n`

  // Jika tidak ada field binding sama sekali
  const anyFound = [facebook, google, moonton, apple, huawei, vk, twitter].some(v => v !== null)
  if (!anyFound) {
    msg += `⚠️ API tidak mengembalikan data binding.\n`
    msg += `Data ini mungkin tidak tersedia di provider ini.\n`
  }

  return msg
}

// ─── COMMAND: .cekml / .mlinfo ─────────────────────────────────────────────
export async function handleCekML(sock, msg, text) {
  try {
    const args = (text || '').trim().split(/\s+/).slice(1)
    const uid  = args[0]
    const zone = args[1] || '1'

    if (!uid) {
      await kirim(sock, msg,
        `🎮 *Cek Akun Mobile Legends*\n\n` +
        `Penggunaan:\n` +
        `\`.cekml <uid> <zone>\`\n\n` +
        `Contoh:\n` +
        `\`.cekml 123456789 1\`\n\n` +
        `ℹ️ Zone default = 1 (Indonesia)\n` +
        `Ketik \`.mlzone\` untuk daftar zone`
      )
      return
    }

    if (!/^\d+$/.test(uid)) {
      await kirim(sock, msg, `❌ UID harus berupa angka!\nContoh: \`.cekml 123456789 1\``)
      return
    }

    const loadMsg = await kirim(sock, msg, loadingMsg(uid, zone))

    const [infoRes, bindRes] = await Promise.allSettled([
      fetchMLInfo(uid, zone),
      fetchMLBinding(uid, zone),
    ])

    const infoOk = infoRes.status === 'fulfilled' && infoRes.value.ok
    const bindOk = bindRes.status === 'fulfilled' && bindRes.value.ok

    if (!infoOk && !bindOk) {
      await kirim(sock, msg,
        `❌ *Gagal mengambil data!*\n\n` +
        `Kemungkinan penyebab:\n` +
        `• UID atau Zone salah\n` +
        `• API provider sedang down\n` +
        `• Perlu ganti URL API di \`API_CFG\`\n\n` +
        `UID: \`${uid}\` | Zone: \`${zone}\``
      )
      return
    }

    let reply = ''
    if (infoOk)  reply += formatMLInfo(uid, zone, infoRes.value.data) + '\n'
    if (bindOk)  reply += formatMLBinding(uid, zone, bindRes.value.data)
    if (!bindOk) reply += `\n⚠️ _Data binding tidak tersedia dari provider ini._`

    reply += `\n\n_Powered by ML Checker Bot_ 🤖`

    await kirim(sock, msg, reply.trim())
  } catch (err) {
    console.error('[handleCekML]', err.message)
    await kirim(sock, msg, `❌ Error: ${err.message}`)
  }
}

// ─── COMMAND: .mlacc (hanya akun terkait) ──────────────────────────────────
export async function handleMLAcc(sock, msg, text) {
  try {
    const args = (text || '').trim().split(/\s+/).slice(1)
    const uid  = args[0]
    const zone = args[1] || '1'

    if (!uid || !/^\d+$/.test(uid)) {
      await kirim(sock, msg,
        `🔗 *Cek Akun Terkait ML*\n\n` +
        `\`.mlacc <uid> <zone>\`\n` +
        `Contoh: \`.mlacc 123456789 1\``
      )
      return
    }

    await kirim(sock, msg, loadingMsg(uid, zone))

    const res = await fetchMLBinding(uid, zone)
    if (!res.ok) {
      await kirim(sock, msg,
        `❌ Gagal ambil data binding!\n\nUID: \`${uid}\` | Zone: \`${zone}\`\n` +
        `Cek apakah UID & Zone sudah benar.`
      )
      return
    }

    await kirim(sock, msg, formatMLBinding(uid, zone, res.data))
  } catch (err) {
    console.error('[handleMLAcc]', err.message)
    await kirim(sock, msg, `❌ Error: ${err.message}`)
  }
}

// ─── COMMAND: .mlzone ──────────────────────────────────────────────────────
export async function handleMLZone(sock, msg) {
  try {
    let list = `🌐 *Daftar Zone Mobile Legends*\n\n`
    for (const [id, name] of Object.entries(ZONE_LIST)) {
      list += `\`${id.padStart(2, ' ')}\` — ${name}\n`
    }
    list += `\nContoh: \`.cekml 123456789 1\``
    await kirim(sock, msg, list)
  } catch (err) {
    console.error('[handleMLZone]', err.message)
  }
}

// ─── MAIN EXECUTE (dipanggil dari handler.js / index.js) ───────────────────
export async function execute(sock, msg, body, sender) {
  const text = (body || '').trim().toLowerCase()

  if (text.startsWith('.cekml') || text.startsWith('.mlinfo')) {
    await handleCekML(sock, msg, body)
    return true
  }
  if (text.startsWith('.mlacc') || text.startsWith('.mltaut')) {
    await handleMLAcc(sock, msg, body)
    return true
  }
  if (text === '.mlzone') {
    await handleMLZone(sock, msg)
    return true
  }

  return false
}

// ─── MENU ──────────────────────────────────────────────────────────────────
export async function handleMLMenu(sock, msg) {
  await kirim(sock, msg,
    `🎮 *Menu Cek Mobile Legends*\n\n` +
    `🔍 \`.cekml <uid> <zone>\`\n` +
    `   Info akun + tanggal buat + akun terkait\n\n` +
    `📋 \`.mlinfo <uid> <zone>\`\n` +
    `   Alias dari .cekml\n\n` +
    `🔗 \`.mlacc <uid> <zone>\`\n` +
    `   Cek akun terkait saja (FB/Google/dll)\n\n` +
    `🌐 \`.mlzone\`\n` +
    `   Daftar semua zone/server\n\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Contoh: \`.cekml 123456789 1\`\n` +
    `Zone default: 1 (Indonesia)`
  )
}
