import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

const TIMEOUT = 15000
const FFMPEG = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg'
const CACHE_DIR = path.join(process.env.HERMES_HOME || '/opt/data', 'cache', 'roblox-ava')
const CACHE_TTL_MS = 6 * 3600 * 1000

// Asset types related to animation / expression (public avatar API)
const ANIM_TYPE_NAMES = new Set([
  'MoodAnimation',
  'ClimbAnimation',
  'DeathAnimation',
  'FallAnimation',
  'IdleAnimation',
  'JumpAnimation',
  'RunAnimation',
  'SwimAnimation',
  'WalkAnimation',
  'PoseAnimation',
  'EmoteAnimation'
])

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function runFfmpeg(args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    const t = setTimeout(() => {
      p.kill('SIGKILL')
      reject(new Error('ffmpeg timeout'))
    }, timeoutMs)
    p.stderr.on('data', d => { err += d.toString() })
    p.on('close', code => {
      clearTimeout(t)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`))
    })
    p.on('error', e => {
      clearTimeout(t)
      reject(e)
    })
  })
}

async function downloadToFile(url, dest) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: TIMEOUT })
  fs.writeFileSync(dest, Buffer.from(res.data))
  return dest
}

/**
 * Build short Roblox-style idle loop MP4 from full-body avatar PNG.
 * Works for ANY username — not tied to one account.
 * Note: real paid emote 3D playback is NOT exposed by public Roblox API;
 * we animate the official full-body thumbnail + list equipped animation assets.
 */
async function renderAvatarVideo(pngPath, outMp4) {
  const flat = pngPath.replace(/\.png$/i, '') + '_flat.png'

  // Flatten transparency onto dark navy bg
  await runFfmpeg([
    '-y',
    '-i', pngPath,
    '-f', 'lavfi', '-i', 'color=c=0x0b1020:s=720x720',
    '-filter_complex',
    '[0:v]scale=520:-1:flags=lanczos[ava];[1:v][ava]overlay=(W-w)/2:(H-h)/2+10:shortest=1,format=rgb24',
    '-update', '1',
    '-frames:v', '1',
    flat
  ])

  // Idle-ish loop: gentle bob + breathe zoom (looks closer to Roblox idle than static)
  await runFfmpeg([
    '-y',
    '-loop', '1',
    '-i', flat,
    '-vf',
    [
      "zoompan=",
      "z='1.05+0.035*sin(2*PI*on/45)':",
      "x='iw/2-(iw/zoom/2)':",
      "y='ih/2-(ih/zoom/2)+14*sin(2*PI*on/36)':",
      'd=1:s=720x720:fps=30,',
      'eq=contrast=1.06:saturation=1.12,',
      'format=yuv420p'
    ].join(''),
    '-t', '4',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outMp4
  ])

  try { fs.unlinkSync(flat) } catch {}
  return outMp4
}

async function fetchAvatarMeta(userId) {
  try {
    const res = await axios.get(`https://avatar.roblox.com/v1/users/${userId}/avatar`, { timeout: TIMEOUT })
    const assets = res.data?.assets || []
    const animAssets = []
    for (const a of assets) {
      const typeName = a?.assetType?.name || ''
      if (ANIM_TYPE_NAMES.has(typeName) || /anim|emote|mood/i.test(typeName)) {
        animAssets.push({
          id: a.id,
          name: a.name || typeName,
          type: typeName
        })
      }
    }
    return {
      avatarType: res.data?.playerAvatarType || 'R15',
      animAssets,
      totalAssets: assets.length
    }
  } catch {
    return { avatarType: 'R15', animAssets: [], totalAssets: 0 }
  }
}

/**
 * Resolve ANY Roblox username → profile + animated avatar video path.
 */
export async function checkRobloxProfile(username) {
  username = String(username || '').replace(/^@+/, '').trim()
  if (!username) throw new Error('Username kosong.')

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

  if (!user?.id) throw new Error(`User Roblox *${username}* tidak ditemukan.`)

  const [userRes, followersRes, headRes, bodyRes, avatarMeta] = await Promise.all([
    axios.get(`https://users.roblox.com/v1/users/${user.id}`, { timeout: TIMEOUT }),
    axios.get(`https://friends.roblox.com/v1/users/${user.id}/followers/count`, { timeout: TIMEOUT })
      .catch(() => ({ data: { count: 0 } })),
    axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=720x720&format=Png`, { timeout: TIMEOUT })
      .catch(() => ({ data: { data: [] } })),
    axios.get(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${user.id}&size=720x720&format=Png`, { timeout: TIMEOUT })
      .catch(() => ({ data: { data: [] } })),
    fetchAvatarMeta(user.id)
  ])

  const data = userRes.data
  const headUrl = headRes.data.data?.[0]?.imageUrl || null
  const bodyUrl = bodyRes.data.data?.[0]?.imageUrl || headUrl

  // Generate animated avatar video for THIS user id (any username)
  let videoPath = null
  try {
    ensureDir(CACHE_DIR)
    const stamp = String(data.id)
    const bodyLocal = path.join(CACHE_DIR, `${stamp}-body.png`)
    videoPath = path.join(CACHE_DIR, `${stamp}-ava.mp4`)

    let useCache = false
    try {
      const st = fs.statSync(videoPath)
      if (Date.now() - st.mtimeMs < CACHE_TTL_MS && st.size > 10000) useCache = true
    } catch {}

    if (!useCache) {
      if (!bodyUrl) throw new Error('no avatar url')
      await downloadToFile(bodyUrl, bodyLocal)
      await renderAvatarVideo(bodyLocal, videoPath)
    }

    if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size < 5000) {
      videoPath = null
    }
  } catch (e) {
    console.error('[ROBLOX] avatar video fail:', username, e.message)
    videoPath = null
  }

  return {
    id: data.id,
    username: data.name,
    displayName: data.displayName,
    description: data.description || 'Tidak ada deskripsi',
    isBanned: data.isBanned,
    created: new Date(data.created).toLocaleDateString('id-ID'),
    followers: Number(followersRes.data.count || 0).toLocaleString('id-ID'),
    avatarUrl: bodyUrl || headUrl,
    headUrl,
    videoPath,
    avatarType: avatarMeta.avatarType,
    animAssets: avatarMeta.animAssets || []
  }
}

export function formatRobloxProfile(data) {
  let animLine = '🎬 *Animasi ava :* idle render (bot)'
  if (data.animAssets?.length) {
    const names = data.animAssets.slice(0, 4).map(a => a.name).join(', ')
    animLine =
      `🎬 *Equipped anim :* ${names}` +
      (data.animAssets.length > 4 ? ` +${data.animAssets.length - 4}` : '')
  }

  return `╔══════════════════════════╗
║     🎮  ROBLOX INFO        ║
╚══════════════════════════╝

👤 *Display Name :* ${data.displayName}
🔖 *Username     :* @${data.username}
🆔 *User ID      :* ${data.id}
🦴 *Avatar       :* ${data.avatarType || 'R15'}
📅 *Bergabung    :* ${data.created}
👥 *Followers    :* ${data.followers}
🚫 *Status Ban   :* ${data.isBanned ? 'Ya ❌' : 'Tidak ✅'}
${animLine}
📝 *Bio          :* ${String(data.description || '').slice(0, 100)}

_Video = avatar full-body resmi Roblox + idle anim_
_Ketik .roblox [username] untuk user lain_`
}
