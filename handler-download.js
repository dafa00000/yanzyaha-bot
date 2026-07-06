import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const TIMEOUT = 30000
const TMP_DIR = '/tmp/wa-tmp'
const MAX_DURATION = 36000
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true })

function cleanTmp(filePath) { try { fs.unlinkSync(filePath) } catch {} }
function isYouTubeUrl(url) { return /youtube\.com|youtu\.be/.test(url) }
function isTikTokUrl(url) { return /tiktok\.com|vm\.tiktok\.com/.test(url) }
function isTwitterUrl(url) { return /twitter\.com|x\.com/.test(url) }
function isPinterestUrl(url) { return /pinterest\.com|pin\.it/.test(url) }
function isInstagramUrl(url) { return /instagram\.com/.test(url) }
function isFacebookUrl(url) { return /facebook\.com|fb\.watch/.test(url) }
function isThreadsUrl(url) { return /threads\\.com/.test(url) }
function isRedditUrl(url) { return /reddit\\.com|redd\\.it/.test(url) }
function isBilibiliUrl(url) { return /bilibili\\.com|b23\\.tv/.test(url) }
function isVimeoUrl(url) { return /vimeo\\.com/.test(url) }
function isDailymotionUrl(url) { return /dailymotion\\.com/.test(url) }
function isSpotifyUrl(url) { return /open\\.spotify\\.com|spotify:/.test(url) }
function isSoundCloudUrl(url) { return /soundcloud\\.com/.test(url) }
function isCapcutUrl(url) { return /capcut\\.com/.test(url) }
function isLikeeUrl(url) { return /likee\\.video|likee\\.com/.test(url) }
function cleanUrl(url) { return url.split('?')[0] }

// Detect platform from URL for any-media-to-audio conversion
function detectPlatform(url) {
  if (isYouTubeUrl(url)) return 'youtube'
  if (isTikTokUrl(url)) return 'tiktok'
  if (isInstagramUrl(url)) return 'instagram'
  if (isTwitterUrl(url)) return 'twitter'
  if (isFacebookUrl(url)) return 'facebook'
  if (isPinterestUrl(url)) return 'pinterest'
  if (isRedditUrl(url)) return 'reddit'
  if (isThreadsUrl(url)) return 'threads'
  if (isBilibiliUrl(url)) return 'bilibili'
  if (isVimeoUrl(url)) return 'vimeo'
  if (isDailymotionUrl(url)) return 'dailymotion'
  if (isSpotifyUrl(url)) return 'spotify'
  if (isSoundCloudUrl(url)) return 'soundcloud'
  if (isCapcutUrl(url)) return 'capcut'
  if (isLikeeUrl(url)) return 'likee'
  return 'generic'
}

async function isYtdlpSupported(url) {
  try {
    await execAsync(`yt-dlp --simulate --quiet "${url}"`, { timeout: 20000 })
    return true
  } catch {
    return false
  }
}

async function getVideoDuration(url) {
  try {
    const { stdout } = await execAsync(`yt-dlp --print duration "${cleanUrl(url)}"`, { timeout: 60000 })
    return parseInt(stdout.trim()) || 0
  } catch {
    return 0
  }
}

async function downloadWithYtdlp(url, audioOnly = false, platformHint = '', retries = 2) {
  const ext = audioOnly ? 'mp3' : 'mp4'
  const filePath = path.join(TMP_DIR, `${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`)
  // Use realistic browser User-Agent (bypasses some anti-bot blocks)
  const ua = '"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"'
  // Cookies: user can provide IG/FB session cookies via env var
  // (Railway IP blocked from IG/FB; cookies from real browser = trusted IP)
  const cookiesArg = buildYtdlpCookiesArg(platformHint)

  if (audioOnly) {
    // Audio-only: simple strategy, convert to mp3
    const cmd = `yt-dlp -x --audio-format mp3 --user-agent ${ua} ${cookiesArg} -o "${filePath}" "${url}"`
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await execAsync(cmd, { timeout: 180000 })
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return filePath
      } catch (e) {
        console.error(`[yt-dlp audio] attempt ${attempt + 1} failed: ${e.message?.slice(0, 200)}`)
        if (attempt === retries) throw e
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      }
    }
  }

  // Video: try multiple format strategies in order of preference
  const formatStrategies = [
    `-f "best[ext=mp4][height<=720]/best[height<=720]/best[ext=mp4]/best"`,
    `-f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best"`,
    `-f "best[ext=mp4]/best" --merge-output-format mp4`,
    `-f "best"`,
  ]

  let lastError = null
  for (const format of formatStrategies) {
    const attemptFilePath = path.join(TMP_DIR, `${Date.now()}_${Math.random().toString(36).slice(2,8)}.mp4`)
    const cmd = `yt-dlp ${format} --no-playlist --user-agent ${ua} ${cookiesArg} -o "${attemptFilePath}" "${url}"`
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await execAsync(cmd, { timeout: 180000 })
        if (fs.existsSync(attemptFilePath) && fs.statSync(attemptFilePath).size > 0) {
          // If the file was saved with a different extension (e.g. .mkv), find and rename it
          const dir = path.dirname(attemptFilePath)
          const baseName = path.basename(attemptFilePath, path.extname(attemptFilePath))
          const files = fs.readdirSync(dir).filter(f => f.startsWith(baseName))
          const actualFile = files.length > 0 ? path.join(dir, files[0]) : attemptFilePath
          if (actualFile !== filePath && fs.existsSync(actualFile)) {
            fs.renameSync(actualFile, filePath)
          } else if (actualFile === attemptFilePath) {
            // File is at expected path
          }
          if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return filePath
          // Check attemptFilePath directly
          if (fs.existsSync(attemptFilePath) && fs.statSync(attemptFilePath).size > 0) {
            fs.copyFileSync(attemptFilePath, filePath)
            cleanTmp(attemptFilePath)
            return filePath
          }
        }
      } catch (e) {
        lastError = e
        console.error(`[yt-dlp video] format="${format.slice(0,40)}..." attempt ${attempt + 1} failed: ${e.message?.slice(0, 200)}`)
        if (attempt === retries) break // try next format strategy
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      } finally {
        // Clean up any partial files from this attempt (except our target)
        try {
          if (fs.existsSync(attemptFilePath) && attemptFilePath !== filePath) cleanTmp(attemptFilePath)
        } catch {}
      }
    }
  }
  throw lastError || new Error('All yt-dlp format strategies failed')
}

// Build yt-dlp --cookies flag from env vars
// Cookies needed:
//   Instagram: sessionid (main auth), csrftoken, ds_user_id (optional)
//   Facebook:  c_user, xs (or full cookies file)
// Env vars (Netscape-format file path is also accepted):
//   IG_COOKIES_FILE   → path to Netscape cookies file
//   IG_SESSIONID      → just the sessionid value (we generate the file)
//   FB_COOKIES_FILE   → path to FB cookies file
function buildYtdlpCookiesArg(platform) {
  let cookiesFile = null

  if (platform === 'instagram' || platform === 'ig') {
    if (process.env.IG_COOKIES_FILE && fs.existsSync(process.env.IG_COOKIES_FILE)) {
      cookiesFile = process.env.IG_COOKIES_FILE
    } else if (process.env.IG_SESSIONID) {
      cookiesFile = writeIgCookiesFile(process.env.IG_SESSIONID, process.env.IG_CSRFTOKEN, process.env.IG_USER_ID)
    }
  } else if (platform === 'facebook' || platform === 'fb') {
    if (process.env.FB_COOKIES_FILE && fs.existsSync(process.env.FB_COOKIES_FILE)) {
      cookiesFile = process.env.FB_COOKIES_FILE
    }
  } else {
    // Generic: try both env files
    if (process.env.IG_COOKIES_FILE && fs.existsSync(process.env.IG_COOKIES_FILE)) {
      cookiesFile = process.env.IG_COOKIES_FILE
    } else if (process.env.FB_COOKIES_FILE && fs.existsSync(process.env.FB_COOKIES_FILE)) {
      cookiesFile = process.env.FB_COOKIES_FILE
    }
  }

  return cookiesFile ? `--cookies "${cookiesFile}"` : ''
}

function writeIgCookiesFile(sessionid, csrftoken = 'placeholder', userId = 'placeholder') {
  try {
    const expires = Math.floor(Date.now() / 1000) + 86400 * 365  // 1 year
    const content = [
      '# Netscape HTTP Cookie File',
      `# Generated by yanzyaha-bot at ${new Date().toISOString()}`,
      `.instagram.com\tTRUE\t/\tTRUE\t${expires}\tsessionid\t${sessionid}`,
      `.instagram.com\tTRUE\t/\tTRUE\t${expires}\tcsrftoken\t${csrftoken}`,
      `.instagram.com\tTRUE\t/\tTRUE\t${expires}\tds_user_id\t${userId}`,
      `.instagram.com\tTRUE\t/\tTRUE\t${expires}\tig_did\t${userId}`,
    ].join('\n')
    const filePath = path.join(TMP_DIR, 'ig-cookies.txt')
    fs.writeFileSync(filePath, content, { mode: 0o600 })
    return filePath
  } catch (err) {
    console.error('[cookies] failed to write IG cookies file:', err.message)
    return null
  }
}

// ─── RENDER API FALLBACKS (discardapi + gtech) ──────────────────────────────
// Free-tier Render APIs that proxy IG/FB/TikTok downloads via RapidAPI.
// Pattern: API returns JSON { status, data: { url, ... } } → stream URL
// directly to WhatsApp (no disk download needed, much faster).
//
// Note: these are free public APIs (same ones MEGA-MD-RECODE uses).
// May be rate-limited. yt-dlp remains primary strategy.

// discardapi (creator: GlobalTechInfo) — handles TikTok + Instagram
async function downloadViaDiscardapi(url, type) {
  const endpoints = {
    tiktok:    `https://discardapi.onrender.com/api/dl/tiktok?apikey=guru&url=${encodeURIComponent(url)}`,
    instagram: `https://discardapi.onrender.com/api/dl/instagram?apikey=guru&url=${encodeURIComponent(url)}`,
  }
  const apiUrl = endpoints[type]
  if (!apiUrl) return null

  try {
    const res = await axios.get(apiUrl, {
      timeout: 90000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      validateStatus: s => s < 500,
    })
    const d = res.data
    console.log('[discardapi] ' + type + ' → response keys: ' + Object.keys(d || {}).join(','))
    
    // New format: { result: [{ title: "Download Video", url: "..." }, ...] }
    if (d?.result && Array.isArray(d.result)) {
      // Find video first, then thumbnail, then first item
      const videoItem = d.result.find(r => /video/i.test(r.title)) || d.result.find(r => /download/i.test(r.title)) || d.result[0]
      if (videoItem?.url) {
        return { url: videoItem.url, source: 'discardapi' }
      }
    }
    
    // Old format: { status: true, data: { url: "..." } }
    if (d?.status && d?.data?.url) {
      return { url: d.data.url, source: 'discardapi' }
    }
    if (d?.status && d?.data?.data?.url) {
      return { url: d.data.data.url, source: 'discardapi' }
    }
    
    // Direct url field
    if (d?.url) {
      return { url: d.url, source: 'discardapi' }
    }
    
    return null
  } catch (err) {
    console.error(`[discardapi] ${type} failed:`, err.message)
    return null
  }
}

// gtech-api — handles Facebook
async function downloadViaGtechFB(url) {
  const apiUrl = `https://gtech-api-xtp1.onrender.com/api/download/fb?url=${encodeURIComponent(url)}&apikey=APIKEY`
  try {
    const res = await axios.get(apiUrl, {
      timeout: 90000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      validateStatus: s => s < 500,
    })
    const d = res.data
    console.log(`[gtech] fb → status: ${d?.status}`)
    // Response: { status: true, data: { data: [{ resolution, url, thumbnail }] } }
    if (d?.status && Array.isArray(d?.data?.data) && d.data.data.length) {
      // Pick highest resolution
      const sorted = [...d.data.data].sort((a, b) => {
        const qa = parseInt(a.resolution, 10) || 0
        const qb = parseInt(b.resolution, 10) || 0
        return qb - qa
      })
      const url2 = sorted[0].url
      // gtech returns relative URLs sometimes
      const fullUrl = url2.startsWith('http') ? url2 : `https://gtech-api-xtp1.onrender.com${url2}`
      return { url: fullUrl, source: 'gtech', resolution: sorted[0].resolution }
    }
    return null
  } catch (err) {
    console.error(`[gtech] fb failed:`, err.message)
    return null
  }
}

// ─── DOWNLOAD WITH FALLBACK ─────────────────────────────────────────────────
// Strategy depends on platform:
//   YT / Twitter / Pinterest / TikTok → yt-dlp first (reliable)
//   Instagram → discardapi → yt-dlp → cobalt (if user provides self-host URL)
//   Facebook  → gtech fb → yt-dlp → cobalt
async function downloadWithFallback(url, platformLabel = '') {
  const platform = platformLabel.toLowerCase()

  // For IG: prefer robust multi-strategy download
  if (platform === 'instagram' || platform === 'ig') {
    try {
      return await downloadInstagramRobust(url)
    } catch (e) {
      console.error(`[download] all IG strategies failed: ${e.message?.slice(0, 200)}`)
    }
  }

  // For FB: prefer gtech fb (fast, returns direct URL) with retry
  if (platform === 'facebook' || platform === 'fb') {
    for (let attempt = 0; attempt < 2; attempt++) {
      const apiResult = await downloadViaGtechFB(url)
      if (apiResult) return { ...apiResult, type: 'direct' }
      if (attempt < 1) await new Promise(r => setTimeout(r, 2000))
    }
    // fallback to yt-dlp with retry
    try {
      return { filePath: await downloadWithYtdlp(url, false, platform), source: 'yt-dlp', type: 'file' }
    } catch (e) {
      console.error(`[download] yt-dlp failed for FB: ${e.message?.slice(0, 200)}`)
    }
  }

  // Default: yt-dlp (YT, Twitter, Pinterest, generic) with retry
  try {
    return { filePath: await downloadWithYtdlp(url, false, platform), source: 'yt-dlp', type: 'file' }
  } catch (ytdlpErr) {
    console.error(`[download] yt-dlp failed for ${platform || url}: ${ytdlpErr.message?.slice(0, 200)}`)
    throw ytdlpErr
  }
}

async function downloadTikTok(url, retries = 2) {
  const strategies = []

  // Strategy 1: tikwm.com API
  strategies.push(async () => {
    const res = await axios.get(`https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, { timeout: TIMEOUT })
    if (!res.data || res.data.code !== 0) throw new Error('tikwm API error')
    const videoUrl = res.data.data?.hdplay || res.data.data?.play
    if (!videoUrl) throw new Error('No video URL in tikwm response')
    const title = res.data.data?.title?.slice(0, 50) || 'tiktok'
    const filePath = path.join(TMP_DIR, `tt_${Date.now()}.mp4`)
    const videoRes = await axios.get(videoUrl, { responseType: 'stream', timeout: TIMEOUT })
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath)
      videoRes.data.pipe(writer)
      writer.on('finish', () => resolve({ filePath, title }))
      writer.on('error', reject)
    })
  })

  // Strategy 2: discardapi (free, no auth)
  strategies.push(async () => {
    const result = await downloadViaDiscardapi(url, 'tiktok')
    if (!result?.url) throw new Error('discardapi no url')
    const filePath = path.join(TMP_DIR, 'tt_' + Date.now() + '.mp4')
    const videoRes = await axios.get(result.url, { responseType: 'stream', timeout: TIMEOUT })
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath)
      videoRes.data.pipe(writer)
      writer.on('finish', () => resolve({ filePath, title: 'tiktok', source: 'discardapi' }))
      writer.on('error', reject)
    })
  })

  // Strategy 3: cobalt API (returns direct URL)
  strategies.push(async () => {
    const cobaltUrl = process.env.COBALT_URL || 'https://api.cobalt.tools/'
    const apiUrl = cobaltUrl.endsWith('/') ? cobaltUrl.slice(0, -1) : cobaltUrl
    const res = await axios.post(apiUrl, { url, filenamePattern: 'basic' }, {
      timeout: 60000,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      validateStatus: s => s < 500,
    })
    const videoUrl = res.data?.url || res.data?.streamUrl
    if (!videoUrl) throw new Error('cobalt no url')
    const filePath = path.join(TMP_DIR, 'tt_' + Date.now() + '.mp4')
    const videoRes = await axios.get(videoUrl, { responseType: 'stream', timeout: TIMEOUT })
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(filePath)
      videoRes.data.pipe(writer)
      writer.on('finish', () => resolve({ filePath, title: 'tiktok', source: 'cobalt' }))
      writer.on('error', reject)
    })
  })

  // Strategy 4: yt-dlp fallback
  strategies.push(async () => {
    const filePath = await downloadWithYtdlp(url, false, 'tiktok')
    return { filePath, title: 'tiktok' }
  })

  let lastError = null
  for (const strategy of strategies) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await strategy()
      } catch (err) {
        lastError = err
        console.error(`[ttdl] attempt ${attempt + 1} failed: ${err.message?.slice(0, 200)}`)
        if (attempt < retries) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      }
    }
  }
  throw lastError || new Error('Gagal mengambil video TikTok.')
}

function cobaltFallback(url) {
  return `⚠️ Tidak dapat mendownload otomatis.\n\n` +
    `Silakan download manual:\n` +
    `🔗 https://cobalt.tools\n\n` +
    `Paste link ini:\n${url}`
}

// ─── TWITTER/X DOWNLOAD VIA API (ZERO DISK) ─────────────────────────────────
// Returns direct video URL — no file download to disk.
// WhatsApp fetches the video from CDN directly (like Telegram sendVideo pattern).
// Fallback chain: fxtwitter API → vxtwitter API → cobalt → yt-dlp
async function getTwitterVideoUrl(url) {
  const clean = url.split('?')[0]
  const tweetId = clean.match(/status\/(\d+)/)?.[1]
  if (!tweetId) {
    console.error('[twitter-api] no tweet ID found in URL:', clean)
    return null
  }

  // Strategy 1: fxtwitter API (most reliable, returns bitrate variants)
  // API format: https://api.fxtwitter.com/i/status/{tweetId}
  try {
    const apiUrl = `https://api.fxtwitter.com/i/status/${tweetId}`
    console.log(`[twitter-api] trying fxtwitter...`)
    const res = await axios.get(apiUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      validateStatus: s => s < 500,
    })
    const tweet = res.data?.tweet
    if (tweet) {
      // Check for video
      const videos = tweet.media?.videos
      if (videos?.length > 0) {
        // Pick highest bitrate MP4
        let bestUrl = null
        for (const v of videos) {
          if (v.variants?.length > 0) {
            const mp4s = v.variants.filter(vr => vr.content_type === 'video/mp4' && vr.url)
            if (mp4s.length > 0) {
              bestUrl = mp4s.reduce((best, cur) =>
                (cur.bitrate || 0) > (best.bitrate || 0) ? cur : best
              ).url
            }
          }
          if (!bestUrl && v.url) bestUrl = v.url
        }
        if (bestUrl) {
          console.log(`[twitter-api] ✅ got video URL via fxtwitter (no disk)`)
          return { videoUrl: bestUrl, source: 'fxtwitter', type: 'direct' }
        }
      }
      // Check photos
      const photos = tweet.media?.photos
      if (photos?.length > 0) {
        console.log(`[twitter-api] ✅ got photo URL via fxtwitter`)
        return { photoUrl: photos[0].url || photos[0].direct_url, source: 'fxtwitter', type: 'photo' }
      }
      console.log(`[twitter-api] fxtwitter: tweet found but no media (text-only tweet?)`)
    }
  } catch (err) {
    console.error(`[twitter-api] fxtwitter failed:`, err.message)
  }

  // Strategy 2: vxtwitter API (different JSON format, direct URLs)
  // API format: https://api.vxtwitter.com/i/status/{tweetId}
  try {
    const apiUrl = `https://api.vxtwitter.com/i/status/${tweetId}`
    console.log(`[twitter-api] trying vxtwitter...`)
    const res = await axios.get(apiUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      validateStatus: s => s < 500,
    })
    const data = res.data
    if (data?.hasMedia) {
      // vxtwitter uses mediaURLs[] (direct URLs, highest quality already)
      const mediaUrls = data.mediaURLs || []
      const mediaExt = data.media_extended || []

      // Check if it's a video
      for (let i = 0; i < mediaExt.length; i++) {
        if (mediaExt[i].type === 'video' && mediaUrls[i]) {
          console.log(`[twitter-api] ✅ got video URL via vxtwitter (no disk)`)
          return { videoUrl: mediaUrls[i], source: 'vxtwitter', type: 'direct' }
        }
      }
      // Fallback: check if any mediaURL looks like video
      for (const mUrl of mediaUrls) {
        if (mUrl && mUrl.includes('.mp4')) {
          console.log(`[twitter-api] ✅ got mp4 URL via vxtwitter (no disk)`)
          return { videoUrl: mUrl, source: 'vxtwitter', type: 'direct' }
        }
      }
      // It's a photo
      if (mediaUrls.length > 0) {
        console.log(`[twitter-api] ✅ got photo URL via vxtwitter`)
        return { photoUrl: mediaUrls[0], source: 'vxtwitter', type: 'photo' }
      }
    }
    console.log(`[twitter-api] vxtwitter: no media found`)
  } catch (err) {
    console.error(`[twitter-api] vxtwitter failed:`, err.message)
  }

  // Strategy 3: Cobalt API (returns direct URL, no disk needed)
  const cobaltInstances = process.env.COBALT_URL
    ? [process.env.COBALT_URL]
    : [
        'https://co.eepy.today/',
        'https://api.cobalt.tools/',
      ]
  for (const instance of cobaltInstances) {
    try {
      const apiUrl = instance.endsWith('/') ? instance.slice(0, -1) : instance
      console.log(`[twitter-api] trying cobalt ${apiUrl}...`)
      const res = await axios.post(apiUrl, { url: clean, filenamePattern: 'basic' }, {
        timeout: 60000,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        validateStatus: s => s < 500,
      })
      const d = res.data
      const videoUrl = d?.url || d?.streamUrl
      if (videoUrl) {
        console.log(`[twitter-api] ✅ got URL via cobalt (${apiUrl})`)
        return { videoUrl, source: 'cobalt', type: 'direct' }
      }
    } catch (err) {
      console.error(`[twitter-api] cobalt ${instance} failed:`, err.message)
    }
  }

  console.log(`[twitter-api] ❌ all direct URL methods failed for tweet ${tweetId}`)
  return null
}

// Legacy wrapper — falls back to yt-dlp disk download if direct URL fails
async function downloadViaTwitterAPI(url) {
  const result = await getTwitterVideoUrl(url)
  if (result?.videoUrl || result?.photoUrl) return result

  // Fallback: yt-dlp (downloads to disk)
  try {
    console.log(`[twitter-api] falling back to yt-dlp (disk download)...`)
    const filePath = await downloadWithYtdlp(url)
    return { filePath, source: 'yt-dlp', type: 'file' }
  } catch (e) {
    console.error(`[twitter-api] yt-dlp fallback failed:`, e.message?.slice(0, 200))
    return null
  }
}

// ─── ROBUST INSTAGRAM DOWNLOAD ───────────────────────────────────────────────
// Tries multiple strategies in order:
//   1. discardapi (fast, returns direct URL)
//   2. yt-dlp with cookies (if available)
//   3. yt-dlp with different flags (--extractor-args, --no-check-certificates)
//   4. igram.world API fallback
// Supports: reels, posts (single/multi), stories, IGTV
async function downloadInstagramRobust(url) {
  // NO COOKIES NEEDED — all strategies use free public APIs.
  // Cookies are optional bonus (env vars IG_SESSION_ID etc).
  const strategies = []

  // Strategy 1: snapinsta.app API (free, no auth, fast)
  strategies.push(async () => {
    try {
      const apiUrl = `https://api.snapinsta.app/api/download`
      const res = await axios.post(apiUrl, { url }, {
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Content-Type': 'application/json' },
        validateStatus: s => s < 500,
      })
      const data = res.data
      if (data?.data?.length > 0) {
        const media = data.data[0]
        const videoUrl = media.url || media.video_url
        if (videoUrl) return { url: videoUrl, source: 'snapinsta', type: 'direct', strategy: 'snapinsta' }
      }
    } catch (e) {
      console.error('[snapinsta] failed:', e.message?.slice(0, 100))
    }
    return null
  })

  // Strategy 2: discardapi (free, no auth)
  strategies.push(async () => {
    const result = await downloadViaDiscardapi(url, 'instagram')
    if (result) return { ...result, type: 'direct', strategy: 'discardapi' }
    return null
  })

  // Strategy 3: saveig.app API (free, no auth)
  strategies.push(async () => {
    try {
      const apiUrl = `https://saveig.app/api/download`
      const res = await axios.post(apiUrl, { url }, {
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Content-Type': 'application/json' },
        validateStatus: s => s < 500,
      })
      const data = res.data
      const videoUrl = data?.data?.url || data?.data?.video_url
      if (videoUrl) return { url: videoUrl, source: 'saveig', type: 'direct', strategy: 'saveig' }
    } catch (e) {
      console.error('[saveig] failed:', e.message?.slice(0, 100))
    }
    return null
  })

  // Strategy 4: igram.world API (free, no auth)
  strategies.push(async () => {
    try {
      const apiUrl = `https://igram.world/api/ig/postInfo?url=${encodeURIComponent(url)}`
      const res = await axios.get(apiUrl, {
        timeout: 60000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        validateStatus: s => s < 500,
      })
      const data = res.data
      if (data?.success && data?.data?.media?.length > 0) {
        const media = data.data.media[0]
        const videoUrl = media.video_url || media.url
        if (videoUrl) return { url: videoUrl, source: 'igram.world', type: 'direct', strategy: 'igram' }
      }
    } catch (e) {
      console.error('[igram] failed:', e.message?.slice(0, 100))
    }
    return null
  })

  // Strategy 5: cobalt API (self-hosted or public instance)
  strategies.push(async () => {
    const cobaltInstances = process.env.COBALT_URL
      ? [process.env.COBALT_URL]
      : ['https://co.eepy.today/', 'https://api.cobalt.tools/']
    for (const instance of cobaltInstances) {
      try {
        const apiUrl = instance.endsWith('/') ? instance.slice(0, -1) : instance
        console.log('[igdl] trying cobalt ' + apiUrl + '...')
        const res = await axios.post(apiUrl, { url, filenamePattern: 'basic' }, {
          timeout: 60000,
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          validateStatus: s => s < 500,
        })
        const videoUrl = res.data?.url || res.data?.streamUrl
        if (videoUrl) {
          console.log('[igdl] got URL via cobalt (' + apiUrl + ')')
          const filePath = path.join(TMP_DIR, 'ig_' + Date.now() + '.mp4')
          const videoRes = await axios.get(videoUrl, { responseType: 'stream', timeout: 60000 })
          return new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(filePath)
            videoRes.data.pipe(writer)
            writer.on('finish', () => resolve({ filePath, source: 'cobalt', type: 'file', strategy: 'cobalt' }))
            writer.on('error', reject)
          })
        }
      } catch (e) {
        console.error('[igdl] cobalt ' + instance + ' failed:', e.message?.slice(0, 100))
      }
    }
    return null
  })

  // Strategy 6: yt-dlp (works if Railway IP not blocked, no cookies needed)
  strategies.push(async () => {
    const filePath = await downloadWithYtdlp(url, false, 'instagram')
    return { filePath, source: 'yt-dlp', type: 'file', strategy: 'yt-dlp' }
  })

  // Strategy 7: yt-dlp with cookies (ONLY if user provided them — optional)
  strategies.push(async () => {
    const ua = '"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"'
    const cookiesArg = buildYtdlpCookiesArg('instagram')
    if (!cookiesArg) return null  // skip if no cookies configured
    const filePath = path.join(TMP_DIR, `ig_${Date.now()}.mp4`)
    const cmd = `yt-dlp -f "best[ext=mp4]/best" --extractor-args "instagram:api_version=v1" --no-check-certificates --user-agent ${ua} ${cookiesArg} -o "${filePath}" "${url}"`
    await execAsync(cmd, { timeout: 180000 })
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) throw new Error('Empty file')
    return { filePath, source: 'yt-dlp+cookies', type: 'file', strategy: 'yt-dlp-cookies' }
  })

  // Execute strategies in sequence, return first success
  let lastError = null
  for (const strategy of strategies) {
    try {
      const result = await strategy()
      if (result) {
        console.log('[igdl] ✅ success via: ' + result.strategy)
        return result
      }
    } catch (err) {
      lastError = err
      console.error('[igdl] strategy failed: ' + err.message?.slice(0, 200))
    }
  }
  throw lastError || new Error('Gagal download Instagram. Coba lagi dalam beberapa menit.')
}

// ─── UNIVERSAL VIDEO-TO-AUDIO (TOAUDIO / TOMP3) ─────────────────────────────
// Converts ANY video URL to MP3 audio. Works for YouTube, TikTok, IG, Twitter, etc.
// Uses yt-dlp -x --audio-format mp3 with platform-aware cookies.
async function convertUrlToAudio(url) {
  const platform = detectPlatform(url)
  console.log(`[toaudio] detected platform: ${platform} for ${url.slice(0, 80)}`)

  // For Spotify/SoundCloud, these are already audio — try yt-dlp directly
  // For everything else, use yt-dlp -x to extract audio

  const ua = '"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"'
  const cookiesArg = buildYtdlpCookiesArg(platform)
  const filePath = path.join(TMP_DIR, `toaudio_${Date.now()}_${Math.random().toString(36).slice(2,6)}.mp3`)

  // Strategy 1: yt-dlp -x --audio-format mp3 (universal, most reliable)
  const ytdlpCmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 --no-playlist --user-agent ${ua} ${cookiesArg} -o "${filePath}" "${url}"`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await execAsync(ytdlpCmd, { timeout: 180000 })
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        return { filePath, platform, method: 'yt-dlp', title: await getTitleForUrl(url) }
      }
      // yt-dlp might save as .mp3.webm or similar — find the actual file
      const dir = path.dirname(filePath)
      const baseName = path.basename(filePath, '.mp3')
      const found = fs.readdirSync(dir).find(f => f.startsWith(baseName))
      if (found) {
        const actual = path.join(dir, found)
        if (fs.statSync(actual).size > 0) {
          if (actual !== filePath) fs.renameSync(actual, filePath)
          return { filePath, platform, method: 'yt-dlp', title: await getTitleForUrl(url) }
        }
      }
    } catch (e) {
      console.error(`[toaudio] yt-dlp attempt ${attempt + 1} failed: ${e.message?.slice(0, 200)}`)
      if (attempt === 2) break
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
    }
  }

  // Strategy 2: yt-dlp with --extract-audio flag (alternative approach)
  const altCmd = `yt-dlp --extract-audio --audio-format mp3 --audio-quality 0 --no-playlist --user-agent ${ua} ${cookiesArg} -o "${filePath}" "${url}"`
  try {
    await execAsync(altCmd, { timeout: 180000 })
    // Check for .mp3 file (yt-dlp might create .mp3 from original name)
    const dir = path.dirname(filePath)
    const files = fs.readdirSync(dir).filter(f => f.includes('toaudio_') && f.endsWith('.mp3'))
    for (const f of files) {
      const p = path.join(dir, f)
      if (fs.existsSync(p) && fs.statSync(p).size > 0 && p !== filePath) {
        fs.renameSync(p, filePath)
      }
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      return { filePath, platform, method: 'yt-dlp-alt', title: await getTitleForUrl(url) }
    }
  } catch (e) {
    console.error(`[toaudio] yt-dlp alt strategy failed: ${e.message?.slice(0, 200)}`)
  }

  // If we get here, all strategies failed
  throw new Error('Gagal mengkonversi ke audio. Pastikan link valid dan coba lagi.')
}

// Helper: get video title for caption
async function getTitleForUrl(url) {
  try {
    const { stdout } = await execAsync(
      `yt-dlp --print title --print uploader --no-playlist "${cleanUrl(url)}"`,
      { timeout: 20000 }
    )
    const [title, uploader] = stdout.trim().split('\n').map(s => s.trim())
    return { title: title || '', uploader: uploader || '' }
  } catch {
    return { title: '', uploader: '' }
  }
}

export async function handleDownload(sock, msg, text, command) {
  const from = msg.key.remoteJid
  const sendText = async (t) => await sock.sendMessage(from, { text: t }, { quoted: msg })
  const url = text.trim()


  if (command === 'clip') {
    const parts = text.trim().split(/\s+/)
    const cUrl   = parts[0]
    const cStart = parts[1]
    const cEnd   = parts[2]

    if (!cUrl || !cStart || !cEnd) {
      return sendText('⚠️ *Format salah!*\n\n*.clip [link] [mulai] [akhir]*\n\nContoh:\n.clip https://youtu.be/xxx 01:30 02:45\n.clip https://youtu.be/xxx 1:30:00 1:32:00\n\n📝 Format waktu: MM:SS atau HH:MM:SS\n⚠️ Maks durasi: 10 menit')
    }

    const toSec = t => {
      const p = t.split(':').map(Number)
      return p.length === 3 ? p[0]*3600+p[1]*60+p[2] : p[0]*60+p[1]
    }
    const durasi = toSec(cEnd) - toSec(cStart)

    if (durasi <= 0) return sendText('❌ Waktu akhir harus lebih besar dari waktu mulai!')
    if (durasi > 600) return sendText('⚠️ Durasi clip maksimal 10 menit!\nPerkecil rentang waktumu.')

    await sendText(`⏳ Mengunduh video...\n⏱️ Target clip: ${cStart} → ${cEnd}`)

    let tmpFull = null, tmpClip = null
    try {
      const ts = Date.now()
      tmpFull = `${TMP_DIR}/${ts}_full.mp4`
      tmpClip = `${TMP_DIR}/${ts}_clip.mp4`

      await execAsync(
        `yt-dlp -f "best[ext=mp4]/best" --merge-output-format mp4 --no-playlist -o "${tmpFull}" "${cUrl}"`,
        { timeout: 180000 }
      )

      await sendText(`✂️ Memotong ${cStart} → ${cEnd}...`)

      await execAsync(
        `ffmpeg -i "${tmpFull}" -ss ${cStart} -to ${cEnd} -c:v libx264 -c:a aac "${tmpClip}" -y`,
        { timeout: 60000 }
      )

      const sizeMB = (fs.statSync(tmpClip).size / 1024 / 1024).toFixed(1)
      if (parseFloat(sizeMB) > 64) {
        return sendText(`❌ Clip terlalu besar (${sizeMB} MB).\nCoba perkecil rentang waktu.`)
      }

      await sock.sendMessage(from, {
        video    : fs.readFileSync(tmpClip),
        caption  : `✂️ *Clip Berhasil!*\n⏱️ ${cStart} → ${cEnd}\n📦 ${sizeMB} MB`,
        mimetype : 'video/mp4'
      }, { quoted: msg })
    } catch (err) {
      await sendText(`❌ Gagal clip video!\n${err.message}\n\n💡 Pastikan ffmpeg terinstall:\n\`pkg install ffmpeg\``)
    } finally {
      if (tmpFull) cleanTmp(tmpFull)
      if (tmpClip) cleanTmp(tmpClip)
    }
    return
  }

  if (command === 'ytdl' || command === 'ytmp3') {
    if (!url || !isYouTubeUrl(url)) return sendText(`❌ Format salah!\nContoh: .${command} https://youtu.be/xxxxx`)
    await sendText('⏳ Mengecek durasi video...')
    const duration = await getVideoDuration(url)
    if (duration > MAX_DURATION) {
      const menit = Math.floor(duration / 60)
      return sendText(`⚠️ Video terlalu panjang (*${menit} menit*).\n\nSilakan download manual:\n🔗 https://cobalt.tools\n\nPaste link ini di cobalt.tools:\n${url}`)
    }
    await sendText('⏳ Sedang mengunduh dari YouTube...')
    let filePath = null
    try {
      const audioOnly = command === 'ytmp3'
      filePath = await downloadWithYtdlp(url, audioOnly)
      if (audioOnly) {
        await sock.sendMessage(from, { audio: fs.readFileSync(filePath), mimetype: 'audio/mpeg', ptt: false }, { quoted: msg })
      } else {
        await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: '🎬 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
      }
    } catch (err) {
      await sendText(`❌ Gagal download YouTube: ${err.message}`)
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  if (command === 'ttdl') {
    if (!url || !isTikTokUrl(url)) return sendText('❌ Format salah!\nContoh: .ttdl https://vm.tiktok.com/xxxxx')
    await sendText('⏳ Sedang mengunduh video TikTok...')
    let filePath = null
    try {
      const result = await downloadTikTok(url)
      filePath = result.filePath
      await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: `🎵 *${result.title}*\n\n_Download by WA Bot_`, mimetype: 'video/mp4' }, { quoted: msg })
    } catch (err) {
      await sendText(`❌ Gagal download TikTok: ${err.message}`)
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  if (command === 'twdl' || command === 'xdl') {
    if (!url || !isTwitterUrl(url)) return sendText(`❌ Format salah!\nContoh: .${command} https://x.com/user/status/xxxxx`)
    await sendText('⏳ Sedang mengunduh dari Twitter/X...')
    let filePath = null
    try {
      // Strategy 1: Direct URL (zero disk usage — WA fetches from CDN)
      const result = await getTwitterVideoUrl(url)
      if (result?.videoUrl) {
        console.log(`[twdl] ✅ sending direct URL via ${result.source} (zero disk)`)
        await sock.sendMessage(from, {
          video: { url: result.videoUrl },
          caption: `🐦 Downloaded by WA Bot — *${result.source}*`,
          mimetype: 'video/mp4'
        }, { quoted: msg })
        return
      }
      if (result?.photoUrl) {
        console.log(`[twdl] ✅ sending photo URL via ${result.source}`)
        await sock.sendMessage(from, {
          image: { url: result.photoUrl },
          caption: `🐦 Downloaded by WA Bot — *${result.source}*`
        }, { quoted: msg })
        return
      }
      // Strategy 2: Legacy API download (to disk)
      const apiResult = await downloadViaTwitterAPI(url)
      if (apiResult?.filePath) {
        filePath = apiResult.filePath
        console.log(`[twdl] downloaded via ${apiResult.source} (disk fallback)`)
        await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: `🐦 Downloaded by WA Bot — *${apiResult.source}*`, mimetype: 'video/mp4' }, { quoted: msg })
        return
      }
      // Strategy 3: yt-dlp direct fallback
      filePath = await downloadWithYtdlp(url)
      await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: '🐦 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
    } catch (err) {
      console.error(`[twdl] all methods failed:`, err.message)
      await sendText(cobaltFallback(url))
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  if (command === 'pindl') {
    if (!url || !isPinterestUrl(url)) return sendText('❌ Format salah! Contoh: .pindl https://pin.it/xxxxx')
    await sendText('⏳ Sedang mengunduh dari Pinterest...')
    let filePath = null
    try {
      // Try with retry via downloadWithYtdlp (has built-in retry now)
      filePath = await downloadWithYtdlp(url, false, 'pinterest')
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('Downloaded file is empty')
      }
      const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1)
      await sock.sendMessage(from, {
        video: fs.readFileSync(filePath),
        caption: `📌 *Pinterest* — ${sizeMB} MB\n\n_Downloaded by WA Bot_`,
        mimetype: 'video/mp4'
      }, { quoted: msg })
    } catch (err) {
      console.error(`[pindl] failed: ${err.message?.slice(0, 200)}`)
      await sendText(cobaltFallback(url))
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  if (command === 'igdl') {
    if (!url || !isInstagramUrl(url)) return sendText('❌ Format salah! Contoh: .igdl https://www.instagram.com/reel/xxxxx')
    await sendText('⏳ Sedang mengunduh dari Instagram...')
    try {
      const result = await downloadInstagramRobust(url)
      console.log(`[igdl] downloaded via ${result.strategy || result.source} (${result.type})`)

      // Build caption with metadata if available
      let finalCaption = `📸 *Instagram*${result.source ? ` — ${result.source}` : ''}\n\n_Downloaded by WA Bot_`
      try {
        const { stdout: meta } = await execAsync(
          `yt-dlp --print title --print uploader --no-playlist "${url}"`,
          { timeout: 30000 }
        )
        const [title, uploader] = meta.trim().split('\n').map(s => s.trim())
        if (title || uploader) {
          finalCaption = `📸 *Instagram*\n${title ? `📝 ${title}\n` : ''}${uploader ? `👤 @${uploader}\n` : ''}\n_Downloaded by WA Bot_`
        }
      } catch { /* metadata fetch optional */ }

      if (result.type === 'direct') {
        // Stream URL directly to WA (faster, no disk)
        await sock.sendMessage(from, {
          video: { url: result.url },
          caption: finalCaption,
          mimetype: 'video/mp4',
        }, { quoted: msg })
      } else {
        // File path (from yt-dlp fallback) — check size + send
        const fpath = result.filePath
        if (!fs.existsSync(fpath) || fs.statSync(fpath).size === 0) {
          throw new Error('Downloaded file is empty or missing')
        }
        const sizeMB = fs.statSync(fpath).size / 1024 / 1024
        if (sizeMB > 64) {
          cleanTmp(fpath)
          return sendText(`⚠️ Video terlalu besar (*${sizeMB.toFixed(1)} MB*). Instagram limit.\n\nCoba:\n🔗 https://saveig.app\nPaste: ${url}`)
        }
        await sock.sendMessage(from, { video: fs.readFileSync(fpath), caption: finalCaption, mimetype: 'video/mp4' }, { quoted: msg })
        cleanTmp(fpath)
      }
    } catch (err) {
      const cookiesHelp = !process.env.IG_SESSIONID && !process.env.IG_COOKIES_FILE
        ? `\n\n💡 *Fix permanen:* set Railway env var\n   \`IG_SESSIONID=<sessionid lo>\`\n   (lihat di IG → DevTools → Application → Cookies)`
        : ''
      await sendText(
        `❌ Gagal download Instagram.\n\n` +
        `Penyebab umum:\n` +
        `• IP Railway di-block IG (paling sering)\n` +
        `• Video private / butuh login\n` +
        `• API public sedang down${cookiesHelp}\n\n` +
        `Coba alternatif web:\n` +
        `🔗 https://saveig.app\n` +
        `🔗 https://snapinsta.app\n\n` +
        `Paste: ${url}`
      )
    }
    return
  }

  if (command === 'fbdl') {
    if (!url || !isFacebookUrl(url)) return sendText('❌ Format salah! Contoh: .fbdl https://www.facebook.com/share/v/xxxxx')
    await sendText('⏳ Sedang mengunduh dari Facebook...')
    try {
      // gtech fb → yt-dlp fallback
      const result = await downloadWithFallback(url, 'facebook')
      console.log(`[fbdl] downloaded via ${result.source} (${result.type})`)

      // Build caption with metadata
      let finalFbCaption = `📘 *Facebook* — ${result.resolution || result.source}\n\n_Downloaded by WA Bot_`

      if (result.type === 'direct') {
        // Stream URL directly to WA (faster)
        await sock.sendMessage(from, {
          video: { url: result.url },
          caption: finalFbCaption,
          mimetype: 'video/mp4',
        }, { quoted: msg })
      } else {
        const fpath = result.filePath
        const sizeMB = fs.statSync(fpath).size / 1024 / 1024
        if (sizeMB > 64) {
          cleanTmp(fpath)
          return sendText(`⚠️ Video terlalu besar (*${sizeMB.toFixed(1)} MB*). FB limit.\n\nCoba:\n🔗 https://fdown.net\nPaste: ${url}`)
        }
        await sock.sendMessage(from, { video: fs.readFileSync(fpath), caption: finalFbCaption, mimetype: 'video/mp4' }, { quoted: msg })
        cleanTmp(fpath)
      }
    } catch (err) {
      const cookiesHelp = !process.env.FB_COOKIES_FILE
        ? `\n\n💡 *Fix permanen:* export cookies FB dari browser\n   (extension "Get cookies.txt LOCALLY" → save as file →\n    upload ke Railway volume, set env var\n    \`FB_COOKIES_FILE=/app/fb-cookies.txt\`)`
        : ''
      await sendText(
        `❌ Gagal download Facebook.\n\n` +
        `Penyebab umum:\n` +
        `• Video private / restricted\n` +
        `• IP Railway di-block FB\n` +
        `• Perlu login (FB agresif anti-bot)${cookiesHelp}\n\n` +
        `Coba alternatif web:\n` +
        `🔗 https://fdown.net\n` +
        `🔗 https://snapsave.app\n\n` +
        `Paste: ${url}`
      )
    }
    return
  }

  if (command === 'dl' || command === 'download') {
    if (!url || !url.startsWith('http')) return sendText('❌ Format salah!\nContoh: .dl https://contoh.com/video')
    await sendText('⏳ Mencoba mengunduh...')
    let filePath = null
    try {
const supported = await isYtdlpSupported(url)
if (!supported) return sendText(cobaltFallback(url))
      const duration = await getVideoDuration(url)
      if (duration > MAX_DURATION) {
        const menit = Math.floor(duration / 60)
        return sendText(`⚠️ Video terlalu panjang (*${menit} menit*).\n\nSilakan download manual:\n🔗 https://cobalt.tools\n\nPaste link ini:\n${url}`)
      }
      filePath = await downloadWithYtdlp(url)
      await sock.sendMessage(from, { video: fs.readFileSync(filePath), caption: '📥 Downloaded by WA Bot', mimetype: 'video/mp4' }, { quoted: msg })
    } catch (err) {
      await sendText(cobaltFallback(url))
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }

  // ─── UNIVERSAL VIDEO-TO-AUDIO: .toaudio / .tomp3 ───────────────────────────
  // Converts ANY video URL to MP3 audio. Works for YouTube, TikTok, IG, Twitter, etc.
  // Usage: .toaudio <url> or .tomp3 <url>
  if (command === 'toaudio' || command === 'tomp3') {
    if (!url || !url.startsWith('http')) return sendText(
      `❌ Format salah!\n\n` +
      `*.${command} <link video>*\n\n` +
      `✅ Didukung: YouTube, TikTok, Instagram, Twitter/X, Facebook, Reddit, Vimeo, Bilibili, dll.\n\n` +
      `Contoh:\n.${command} https://youtu.be/xxxxx\n.${command} https://www.tiktok.com/...`
    )
    const platform = detectPlatform(url)
    await sendText(`⏳ Mengkonversi ke audio MP3...\n📱 Platform: *${platform}*`)
    let filePath = null
    try {
      const result = await convertUrlToAudio(url)
      filePath = result.filePath

      // Check file exists and has content
      if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('File audio kosong atau tidak ditemukan')
      }

      const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1)
      const { title, uploader } = result.title || {}
      let caption = `🎵 *Audio MP3*\n`
      if (title) caption += `📝 ${title}\n`
      if (uploader) caption += `👤 ${uploader}\n`
      caption += `📱 ${result.platform} | ${result.method}\n📦 ${sizeMB} MB\n\n_Downloaded by WA Bot_`

      await sock.sendMessage(from, {
        audio: fs.readFileSync(filePath),
        mimetype: 'audio/mpeg',
        ptt: false,
        fileName: title ? `${title.slice(0, 60)}.mp3` : 'audio.mp3',
      }, { quoted: msg })
      // Send caption separately since audio messages don't support caption
      await sendText(caption)
    } catch (err) {
      console.error(`[toaudio] failed for ${url}: ${err.message}`)
      await sendText(
        `❌ Gagal konversi ke audio!\n\n` +
        `Error: ${err.message?.slice(0, 200)}\n\n` +
        `💡 Tips:\n` +
        `• Pastikan link valid dan video tidak private\n` +
        `• Coba lagi dalam beberapa menit\n` +
        `• Gunakan link alternatif (misal: youtu.be → youtube.com)`
      )
    } finally {
      if (filePath) cleanTmp(filePath)
    }
    return
  }
}
