import axios from 'axios'

const TIMEOUT = 15000

export async function checkGitHubProfile(username) {
  username = username.replace('@', '').trim()

  const res = await axios.get(`https://api.github.com/users/${username}`, {
    timeout: TIMEOUT,
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'WA-Bot'
    }
  })

  const d = res.data
  if (!d?.login) throw new Error(`User GitHub *${username}* tidak ditemukan.`)

  return {
    username: d.login,
    name: d.name || '-',
    bio: d.bio || 'Tidak ada bio',
    company: d.company || '-',
    location: d.location || '-',
    blog: d.blog || '-',
    followers: Number(d.followers || 0).toLocaleString('id-ID'),
    following: Number(d.following || 0).toLocaleString('id-ID'),
    repos: Number(d.public_repos || 0).toLocaleString('id-ID'),
    created: new Date(d.created_at).toLocaleDateString('id-ID'),
    avatarUrl: d.avatar_url || null
  }
}

export function formatGitHubProfile(data) {
  return `╔══════════════════════════╗
║     🐙  GITHUB INFO        ║
╚══════════════════════════╝

👤 *Nama       :* ${data.name}
🔖 *Username   :* @${data.username}
🏢 *Company    :* ${data.company}
📍 *Lokasi     :* ${data.location}
👥 *Followers  :* ${data.followers}
➡️ *Following  :* ${data.following}
📦 *Repos      :* ${data.repos}
📅 *Bergabung  :* ${data.created}
📝 *Bio        :* ${data.bio.slice(0, 100)}

_Ketik .gh [username] untuk cek ulang_`
}
