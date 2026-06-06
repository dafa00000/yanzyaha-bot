// handler-imagine.js
// Generate gambar via Cloudflare Workers AI
// Support: text-to-image + image-to-image (foto + prompt)
// Auto-detect prompt gambar tanpa command

// ─── CONFIG ────────────────────────────────────────────────────────────────
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || ''
const CF_API_TOKEN  = process.env.CF_TOKEN || ''
const CF_MODEL_TXT  = '@cf/black-forest-labs/flux-1-schnell'
const CF_MODEL_IMG  = '@cf/runwayml/stable-diffusion-v1-5-img2img'

const COOLDOWN_MS = 15000
const cooldownMap = new Map()

// ─── KEYWORD DETECT ────────────────────────────────────────────────────────
const TRIGGER_WORDS = [
  'gambarkan', 'gambarin', 'gambar', 'buatkan', 'buatin', 'buat gambar',
  'lukis', 'lukiskan', 'ilustrasi', 'ilustrasikan',
  'tampilkan gambar', 'generate gambar', 'bikin gambar', 'bikin foto',
  'tolong gambar', 'tolong buat', 'coba gambar',
  'jadikan', 'ubah', 'ubah jadi', 'jadiin', 'edit foto', 'edit gambar',
  'seperti canva', 'seperti krayon', 'seperti lukisan', 'gaya lukisan',
  'gaya anime', 'gaya cartoon', 'gaya oil painting',
  'draw', 'generate', 'create image', 'make image', 'make a photo',
  'illustrate', 'paint', 'sketch', 'render',
  'image of', 'picture of', 'photo of', 'drawing of',
  'anime style', 'cartoon style', 'oil painting', 'watercolor',
  'anime', 'wallpaper', 'fanart', 'artwork',
]

const BLACKLIST_WORDS = [
  'cuaca', 'weather', 'saham', 'crypto', 'harga', 'kurs',
  'download', 'unduh', 'cari', 'search', 'bantuan',
  'help', 'menu', 'ping', 'restart', 'update', 'cekml', 'mlacc',
]

function isImagePrompt(text) {
  if (!text || text.length < 5) return false
  const lower = text.toLowerCase().trim()
  if (BLACKLIST_WORDS.some(w => lower.includes(w))) return false
  if (lower.trim().split(/\s+/).length < 2) return false
  return TRIGGER_WORDS.some(w => lower.includes(w))
}

function cleanPrompt(text) {
  let cleaned = text.trim()
  const prefixes = [
    'gambarkan', 'gambarin', 'buatkan', 'buatin', 'lukiskan', 'lukis',
    'ilustrasikan', 'ilustrasi', 'tolong gambar', 'tolong buat',
    'coba gambar', 'bikin gambar', 'bikin foto', 'buat gambar',
    'generate gambar', 'tampilkan gambar', 'jadikan', 'jadiin',
    'ubah jadi', 'ubah ke', 'edit foto jadi', 'edit gambar jadi',
    'draw', 'generate', 'illustrate', 'paint', 'sketch', 'render',
    'create image of', 'make image of', 'make a photo of',
    'image of', 'picture of', 'photo of', 'drawing of',
  ]
  for (const p of prefixes) {
    const re = new RegExp(`^${p}\\s*`, 'i')
    cleaned = cleaned.replace(re, '')
  }
  return cleaned.trim() || text.trim()
}

// ─── HELPERS ───────────────────────────────────────────────────────────────
async function kirim(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
}

async function kirimGambar(sock, msg, buffer, caption) {
  return sock.sendMessage(msg.key.remoteJid, { image: buffer, caption }, { quoted: msg })
}

function getSender(msg) {
  return msg.key.participant || msg.key.remoteJid
}

function isOnCooldown(sender) {
  const last = cooldownMap.get(sender)
  if (!last) return false
  return Date.now() - last < COOLDOWN_MS
}

function setCooldown(sender) {
  cooldownMap.set(sender, Date.now())
  setTimeout(() => cooldownMap.delete(sender), COOLDOWN_MS)
}

// Ambil buffer gambar dari pesan (foto yang dikirim user)
async function getImageBuffer(sock, msg) {
  try {
    const { downloadMediaMessage } = await import('@whiskeysockets/baileys')
    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: { level: 'silent', child: () => ({ level: 'silent', info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, trace: () => {}, fatal: () => {} }) },
      reuploadRequest: sock.updateMediaMessage,
    })
    return buffer
  } catch (err) {
    console.error('[getImageBuffer]', err.message)
    return null
  }
}

// ─── TEXT TO IMAGE ─────────────────────────────────────────────────────────
async function textToImage(prompt) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL_TXT}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt: prompt + ', highly detailed, 4k, sharp, high quality' }),
    signal: AbortSignal.timeout(60000),
  })

  if (!res.ok) throw new Error(`API error ${res.status}`)
  const data = await res.json()
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'Generate gagal')
  const base64 = data.result?.image
  if (!base64) throw new Error('Tidak ada gambar di response')
  return Buffer.from(base64, 'base64')
}

// ─── IMAGE TO IMAGE ────────────────────────────────────────────────────────
async function imageToImage(prompt, imageBuffer) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL_IMG}`

  // Resize buffer jika terlalu besar (max ~512KB untuk API)
  let buf = imageBuffer
  if (buf.length > 512 * 1024) {
    // Ambil sebagian saja kalau terlalu besar — CF butuh ukuran kecil
    buf = buf.slice(0, 512 * 1024)
  }

  // Convert ke array of numbers (format yang diterima CF)
  const imageArray = Array.from(new Uint8Array(buf))

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: prompt + ', highly detailed, sharp, high quality, masterpiece',
      image: imageArray,
      strength: 0.7,
      num_steps: 20,
    }),
    signal: AbortSignal.timeout(90000),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('[img2img error]', errText)
    throw new Error(`API error ${res.status}`)
  }

  // Cek apakah response adalah gambar langsung atau JSON
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('image')) {
    return Buffer.from(await res.arrayBuffer())
  }

  const data = await res.json()
  if (!data.success) throw new Error(data.errors?.[0]?.message || 'img2img gagal')
  const base64 = data.result?.image
  if (!base64) throw new Error('Tidak ada gambar di response')
  return Buffer.from(base64, 'base64')
}

// ─── CORE GENERATE ─────────────────────────────────────────────────────────
async function doGenerate(sock, msg, prompt, isAuto = false, imgBuffer = null) {
  const sender = getSender(msg)

  if (isOnCooldown(sender)) {
    const sisa = Math.ceil((COOLDOWN_MS - (Date.now() - cooldownMap.get(sender))) / 1000)
    return kirim(sock, msg, `⏳ Tunggu *${sisa} detik* lagi sebelum generate berikutnya!`)
  }

  setCooldown(sender)

  const mode = imgBuffer ? '🖼️ Image-to-Image' : '✏️ Text-to-Image'

  await kirim(sock, msg,
    `🎨 *Generating image...*\n\n` +
    `📝 Prompt: _${prompt}_\n` +
    `⚙️ Mode: ${mode}\n\n` +
    `⏳ Mohon tunggu ~15-30 detik...`
  )

  try {
    let resultBuffer
    if (imgBuffer) {
      resultBuffer = await imageToImage(prompt, imgBuffer)
    } else {
      resultBuffer = await textToImage(prompt)
    }

    await kirimGambar(sock, msg, resultBuffer,
      `🎨 *Hasil Generate*\n` +
      `📝 ${prompt}\n` +
      `⚙️ ${mode}\n\n` +
      `_Generated by Cloudflare AI_ 🤖`
    )
  } catch (err) {
    console.error('[doGenerate]', err.message)
    let errMsg = `❌ *Gagal generate gambar!*\n\n`
    if (err.message.includes('timeout') || err.message.includes('abort')) {
      errMsg += `⏱️ Timeout — coba lagi beberapa saat.`
    } else if (err.message.includes('401') || err.message.includes('Authentication')) {
      errMsg += `🔑 API Token tidak valid.\nUpdate token di handler-imagine.js`
    } else {
      errMsg += `Error: ${err.message}`
    }
    await kirim(sock, msg, errMsg)
  }
}

// ─── COMMAND HANDLER ───────────────────────────────────────────────────────
export async function handleImagine(sock, msg, text) {
  const prompt = (text || '').trim().split(/\s+/).slice(1).join(' ').trim()

  if (!prompt) {
    return kirim(sock, msg,
      `🎨 *Image Generator*\n\n` +
      `*Text to Image:*\n` +
      `\`.imagine cat in space, realistic\`\n` +
      `\`.imagine anime girl with sword\`\n\n` +
      `*Image to Image (kirim foto + caption):*\n` +
      `Kirim foto dengan caption:\n` +
      `\`.imagine like oil painting\`\n` +
      `\`.imagine anime style\`\n` +
      `\`.imagine crayon drawing style\`\n\n` +
      `💡 Atau langsung ketik:\n` +
      `_"gambarkan kucing lucu di taman"_\n` +
      `_"jadikan seperti lukisan cat air"_ (sambil kirim foto)`
    )
  }

  // Cek apakah ada gambar di pesan (foto dikirim dengan caption command)
  const hasImage = msg.message?.imageMessage ||
                   msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage

  let imgBuffer = null
  if (hasImage) {
    imgBuffer = await getImageBuffer(sock, msg)
  }

  await doGenerate(sock, msg, prompt, false, imgBuffer)
}

// ─── AUTO DETECT ───────────────────────────────────────────────────────────
export async function handleAutoImagine(sock, msg, body) {
  const hasImage = msg.message?.imageMessage

  // Kalau ada foto yang dikirim dengan caption
  if (hasImage) {
    const caption = msg.message?.imageMessage?.caption || ''
    if (caption && isImagePrompt(caption)) {
      const prompt = cleanPrompt(caption)
      const imgBuffer = await getImageBuffer(sock, msg)
      await doGenerate(sock, msg, prompt, true, imgBuffer)
      return true
    }
    // Foto tanpa caption yang jelas — tanya user
    if (!caption || caption.length < 3) return false
  }

  // Pesan teks biasa
  if (!body || body.startsWith('.')) return false
  if (!isImagePrompt(body)) return false

  const prompt = cleanPrompt(body)
  await doGenerate(sock, msg, prompt, true, null)
  return true
}

// ─── EXECUTE ───────────────────────────────────────────────────────────────
export async function execute(sock, msg, body, sender) {
  const text = (body || '').trim().toLowerCase()
  if (
    text.startsWith('.imagine') ||
    text.startsWith('.img') ||
    text.startsWith('.generate') ||
    text.startsWith('.gen')
  ) {
    await handleImagine(sock, msg, body)
    return true
  }
  return false
}
