import axios from 'axios'

const TIMEOUT = 15000

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

export async function checkRobloxProfile(username) {
  username = username.replace('@', '').trim()

  let user = null
  for (let i = 0; i < 3; i++) {
    try {
      const res = await axios.post(
        'https://users.roblox.com/v1/usernames/users',
        { usernames: [username], excludeBannedUsers: false },
        { timeout: TIMEOUT, headers: { 'Content-Type': 'application/json' } }
      )
      user = res.data.data?.[0]
      break
    } catch (e) {
      if (e.response?.status === 429) await sleep(2000 * (i + 1))
      else throw e
    }
  }

  if (!user) throw new Error(`User Roblox *${username}* tidak ditemukan.`)

  const [userRes, followersRes, avatarRes] = await Promise.all([
    axios.get(`https://users.roblox.com/v1/users/${user.id}`, { timeout: TIMEOUT }),
    axios.get(`https://friends.roblox.com/v1/users/${user.id}/followers/count`, { timeout: TIMEOUT })
      .catch(() => ({ data: { count: 0 } })),
    axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=420x420&format=Png`, { timeout: TIMEOUT })
      .catch(() => ({ data: { data: [] } }))
  ])

  const data = userRes.data

  return {
    id: data.id,
    username: data.name,
    displayName: data.displayName,
    description: data.description || 'Tidak ada deskripsi',
    isBanned: data.isBanned,
    created: new Date(data.created).toLocaleDateString('id-ID'),
    followers: Number(followersRes.data.count || 0).toLocaleString('id-ID'),
    avatarUrl: avatarRes.data.data?.[0]?.imageUrl || null
  }
}

export function formatRobloxProfile(data) {
  return `╔══════════════════════════╗
║     🎮  ROBLOX INFO        ║
╚══════════════════════════╝

👤 *Display Name :* ${data.displayName}
🔖 *Username     :* @${data.username}
🆔 *User ID      :* ${data.id}
📅 *Bergabung    :* ${data.created}
👥 *Followers    :* ${data.followers}
🚫 *Status Ban   :* ${data.isBanned ? 'Ya ❌' : 'Tidak ✅'}
📝 *Bio          :* ${data.description.slice(0, 100)}

_Ketik .roblox [username] untuk cek ulang_`
}
