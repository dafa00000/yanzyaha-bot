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

function parseIGNumber(str) {
  if (!str) return 0
  str = str.toString().replace(',', '.').toLowerCase().trim()
  if (str.includes('m')) return Math.round(parseFloat(str) * 1000000)
  if (str.includes('k')) return Math.round(parseFloat(str) * 1000)
  return parseInt(str.replace(/[^0-9]/g, '')) || 0
}

function parseFullName(title, username) {
  let name = decodeHTML(title)
  name = name.replace(new RegExp(`\\s*\\(@?${username}\\)`, 'i'), '')
  name = name.replace(/[•·].*$/i, '').replace(/instagram.*/i, '')
  return name.trim() || username
}

function parseStats(desc) {
  const decoded = decodeHTML(desc || '')
  const id = decoded.match(/([\d,.]+[KkMm]?)\s+Pengikut,\s*([\d,.]+[KkMm]?)\s+Mengikuti,\s*([\d,.]+)\s+Postingan/)
  if (id) return {
    followers: parseIGNumber(id[1]).toLocaleString('id-ID'),
    following: parseIGNumber(id[2]).toLocaleString('id-ID'),
    posts: parseIGNumber(id[3]).toLocaleString('id-ID')
  }
  const en = decoded.match(/([\d,.]+[KkMm]?)\s+Followers?,\s*([\d,.]+[KkMm]?)\s+Following,\s*([\d,.]+)\s+Posts?/)
  if (en) return {
    followers: parseIGNumber(en[1]).toLocaleString('id-ID'),
    following: parseIGNumber(en[2]).toLocaleString('id-ID'),
    posts: parseIGNumber(en[3]).toLocaleString('id-ID')
  }
  return { followers: '0', following: '0', posts: '0' }
}

function parseBio(desc) {
  if (!desc) return '-'
  const decoded = decodeHTML(desc)
  const match = decoded.match(/(?:Postingan|Posts)\s*[-–]\s*(.+)$/i)
  if (!match) return '-'
  const bio = match[1].trim()
  if (/lihat foto|see.*photo|instagram photo/i.test(bio)) return '-'
  return bio.replace(/\s*Lihat foto.*$/i, '').replace(/\s*See.*gram.*$/i, '').trim() || '-'
}

export async function checkInstagramProfile(username) {
  username = username.replace('@', '').toLowerCase().trim()

  try {
    const res = await axios.get(`https://www.instagram.com/${username}/`, {
      timeout: TIMEOUT,
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'id-ID,id;q=0.9',
      }
    })

    const html = res.data
    const title   = html.match(/property="og:title" content="([^"]+)"/)?.[1]
                 || html.match(/content="([^"]+)" property="og:title"/)?.[1]
    const desc    = html.match(/property="og:description" content="([^"]+)"/)?.[1]
                 || html.match(/content="([^"]+)" property="og:description"/)?.[1]
    const image   = html.match(/property="og:image" content="([^"]+)"/)?.[1]
                 || html.match(/content="([^"]+)" property="og:image"/)?.[1]

    if (!title) throw new Error('Tidak ada data')

    const stats = parseStats(desc)

    return {
      username,
      fullName: parseFullName(title, username),
      bio: parseBio(desc),
      followers: stats.followers,
      following: stats.following,
      posts: stats.posts,
      isVerified: decodeHTML(title).includes('✓'),
      avatarUrl: image ? decodeHTML(image) : null
    }
  } catch (e) {
    throw new Error(
      `Tidak bisa mengambil data *@${username}*\n\n` +
      `• Akun tidak ada\n` +
      `• Instagram membatasi akses\n\n` +
      `Coba lagi beberapa menit kemudian.`
    )
  }
}

export function formatInstagramProfile(data) {
  return `╔══════════════════════════╗
║    📸  INSTAGRAM INFO      ║
╚══════════════════════════╝

👤 *Nama       :* ${data.fullName}
🔖 *Username   :* @${data.username}
${data.isVerified ? '✅ *Akun Verified*\n' : ''}👥 *Followers  :* ${data.followers}
➡️ *Following  :* ${data.following}
🖼️ *Posts      :* ${data.posts}
📝 *Bio        :* ${data.bio}

_Ketik .ig [username] untuk cek ulang_`
}
