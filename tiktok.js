import axios from 'axios'

const TIMEOUT = 15000

function decodeHTML(str) {
  if (!str) return ''
  return str
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(parseInt(c)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

function parseNum(n) {
  if (!n) return 0
  const str = n.toString().replace(',', '.').toLowerCase()
  if (str.includes('m')) return Math.round(parseFloat(str) * 1000000)
  if (str.includes('k')) return Math.round(parseFloat(str) * 1000)
  return parseInt(str.replace(/[^0-9]/g, '')) || 0
}

async function method1(username) {
  const res = await axios.get(`https://www.tiktok.com/@${username}`, {
    timeout: TIMEOUT,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'id-ID,id;q=0.9',
      'Accept': 'text/html'
    }
  })
  const html = res.data
  const match = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('Tidak ada data JSON')
  const json = JSON.parse(match[1])
  const info = json?.['__DEFAULT_SCOPE__']?.['webapp.user-detail']?.userInfo
  if (!info?.user) throw new Error('Tidak ada user')
  const user = info.user
  const stats = info.stats
  return {
    username: user.uniqueId,
    nickname: user.nickname || '-',
    bio: user.signature || '-',
    region: user.region || '-',
    followers: parseNum(stats?.followerCount).toLocaleString('id-ID'),
    following: parseNum(stats?.followingCount).toLocaleString('id-ID'),
    likes: parseNum(stats?.heartCount).toLocaleString('id-ID'),
    videos: parseNum(stats?.videoCount).toLocaleString('id-ID'),
    isPrivate: user.privateAccount || false,
    isVerified: user.verified || false,
    avatarUrl: user.avatarLarger || user.avatarMedium || null
  }
}

async function method2(username) {
  const res = await axios.get(`https://www.tiktok.com/@${username}`, {
    timeout: TIMEOUT,
    headers: {
      'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Accept': 'text/html'
    }
  })
  const html = res.data
  const title = html.match(/property="og:title" content="([^"]+)"/)?.[1]
  const desc  = html.match(/property="og:description" content="([^"]+)"/)?.[1]
  const image = html.match(/property="og:image" content="([^"]+)"/)?.[1]
  if (!title) throw new Error('Tidak ada meta tag')
  const decodedTitle = decodeHTML(title)
  const decodedDesc  = decodeHTML(desc || '')
  const stats = decodedDesc.match(/([\d,.]+[KkMm]?)\s+Followers?\s*[·•]\s*([\d,.]+[KkMm]?)\s+Following\s*[·•]\s*([\d,.]+[KkMm]?)\s+Likes?/i)
  return {
    username,
    nickname: decodedTitle.replace(/\|.*$/i, '').replace(/@\S+/g, '').trim() || username,
    bio: decodedDesc.replace(/[\d,.]+[KkMm]?\s+Followers?.*Likes?\s*[-–]?\s*/i, '').trim() || '-',
    region: '-',
    followers: stats ? parseNum(stats[1]).toLocaleString('id-ID') : '0',
    following: stats ? parseNum(stats[2]).toLocaleString('id-ID') : '0',
    likes: stats ? parseNum(stats[3]).toLocaleString('id-ID') : '0',
    videos: '0',
    isPrivate: false,
    isVerified: decodedTitle.includes('✓'),
    avatarUrl: image ? decodeHTML(image) : null
  }
}

export async function checkTikTokProfile(username) {
  username = username.replace('@', '').toLowerCase().trim()
  try { return await method1(username) } catch {}
  try { return await method2(username) } catch {}
  throw new Error(
    `Tidak bisa mengambil data *@${username}*\n\n` +
    `• Akun tidak ada atau private\n` +
    `• TikTok membatasi akses\n\n` +
    `Coba lagi beberapa menit kemudian.`
  )
}

export function formatTikTokProfile(data) {
  return `╔══════════════════════════╗
║     🎵  TIKTOK INFO        ║
╚══════════════════════════╝

👤 *Nama       :* ${data.nickname}
🔖 *Username   :* @${data.username}
${data.isVerified ? '✅ *Akun Verified*\n' : ''}🔒 *Status     :* ${data.isPrivate ? 'Private 🔐' : 'Public 🌐'}
👥 *Followers  :* ${data.followers}
➡️ *Following  :* ${data.following}
❤️ *Total Like :* ${data.likes}
🎬 *Video      :* ${data.videos}
📝 *Bio        :* ${data.bio.slice(0, 100)}

_Ketik .tt [username] untuk cek ulang_`
}
