import { execFileSync, spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const FFMPEG = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg'
const PYTHON = process.env.WA_EXEC_PYTHON || '/opt/data/venvs/wa-exec/bin/python'

function tmp(name) {
  return path.join(tmpdir(), `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
}

function safeUnlink(...files) {
  for (const f of files) {
    try { if (f && existsSync(f)) unlinkSync(f) } catch {}
  }
}

function runFfmpeg(args, timeoutMs = 60000) {
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 })
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || r.error?.message || 'ffmpeg fail').toString()
    throw new Error(err.slice(-800))
  }
}

/** Detect RIFF/WEBP + ANIM chunk (animated WebP) */
function isAnimatedWebp(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return false
  // RIFF....WEBP
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return false
  // scan for ANIM
  return buf.includes(Buffer.from('ANIM'))
}

/**
 * Extract first frame of static/animated WebP (or any image buffer) → PNG buffer.
 * Order: sharp → pillow → ffmpeg fallbacks
 */
export async function stickerToImage(buffer) {
  const errors = []
  const tmpIn = tmp('toimg_in') + '.webp'
  const tmpOut = tmp('toimg_out') + '.png'
  writeFileSync(tmpIn, buffer)

  // 1) sharp (best for animated webp first frame)
  try {
    const sharp = require('sharp')
    const out = await sharp(buffer, { animated: false, pages: 1 })
      .rotate()
      .png()
      .toBuffer()
    if (out?.length > 100) {
      safeUnlink(tmpIn, tmpOut)
      return out
    }
  } catch (e) {
    errors.push(`sharp: ${e.message}`)
  }

  // 2) pillow (libwebp full animated support)
  try {
    const py = `
from PIL import Image
import sys
im = Image.open(sys.argv[1])
im.seek(0)
im.convert("RGBA").save(sys.argv[2], "PNG")
`
    const r = spawnSync(PYTHON, ['-c', py, tmpIn, tmpOut], { encoding: 'utf8', timeout: 30000 })
    if (r.status === 0 && existsSync(tmpOut) && readFileSync(tmpOut).length > 100) {
      const out = readFileSync(tmpOut)
      safeUnlink(tmpIn, tmpOut)
      return out
    }
    errors.push(`pillow: ${(r.stderr || r.stdout || 'fail').toString().slice(0, 200)}`)
  } catch (e) {
    errors.push(`pillow: ${e.message}`)
  }

  // 3) ffmpeg static / forced demux variants
  const ffTries = [
    ['-y', '-i', tmpIn, '-vframes', '1', tmpOut],
    ['-y', '-c:v', 'libwebp', '-i', tmpIn, '-vframes', '1', tmpOut],
    ['-y', '-f', 'webp_pipe', '-i', tmpIn, '-vframes', '1', tmpOut],
  ]
  for (const args of ffTries) {
    try {
      runFfmpeg(args, 30000)
      if (existsSync(tmpOut) && readFileSync(tmpOut).length > 100) {
        const out = readFileSync(tmpOut)
        safeUnlink(tmpIn, tmpOut)
        return out
      }
    } catch (e) {
      errors.push(`ffmpeg: ${e.message.slice(0, 120)}`)
    }
  }

  safeUnlink(tmpIn, tmpOut)
  throw new Error(`Gagal konversi stiker animasi/static.\n${errors.slice(0, 3).join('\n')}`)
}

/**
 * Convert animated sticker (WebP ANIM) → MP4 for WhatsApp video playback.
 * Falls back to null if not animated / conversion fails.
 */
export async function stickerToVideo(buffer) {
  if (!isAnimatedWebp(buffer)) return null

  const tmpIn = tmp('tovid_in') + '.webp'
  const tmpGif = tmp('tovid_mid') + '.gif'
  const tmpOut = tmp('tovid_out') + '.mp4'
  writeFileSync(tmpIn, buffer)
  const errors = []

  // A) pillow → gif → ffmpeg mp4
  try {
    const py = `
from PIL import Image
import sys
im = Image.open(sys.argv[1])
frames = []
durations = []
try:
    while True:
        frames.append(im.copy().convert("RGBA"))
        durations.append(im.info.get("duration", 80) or 80)
        im.seek(im.tell() + 1)
except EOFError:
    pass
if not frames:
    raise SystemExit("no frames")
frames[0].save(
    sys.argv[2],
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    disposal=2,
    optimize=False,
)
print(len(frames))
`
    const r = spawnSync(PYTHON, ['-c', py, tmpIn, tmpGif], { encoding: 'utf8', timeout: 60000 })
    if (r.status === 0 && existsSync(tmpGif) && readFileSync(tmpGif).length > 100) {
      runFfmpeg([
        '-y', '-i', tmpGif,
        '-movflags', 'faststart',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        tmpOut
      ], 60000)
      if (existsSync(tmpOut) && readFileSync(tmpOut).length > 500) {
        const out = readFileSync(tmpOut)
        safeUnlink(tmpIn, tmpGif, tmpOut)
        return out
      }
    } else {
      errors.push(`pillow-gif: ${(r.stderr || r.stdout || '').toString().slice(0, 200)}`)
    }
  } catch (e) {
    errors.push(`pillow-gif: ${e.message}`)
  }

  // B) sharp animated → gif
  try {
    const sharp = require('sharp')
    const gifBuf = await sharp(buffer, { animated: true, pages: -1 })
      .gif()
      .toBuffer()
    writeFileSync(tmpGif, gifBuf)
    runFfmpeg([
      '-y', '-i', tmpGif,
      '-movflags', 'faststart',
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      tmpOut
    ], 60000)
    if (existsSync(tmpOut) && readFileSync(tmpOut).length > 500) {
      const out = readFileSync(tmpOut)
      safeUnlink(tmpIn, tmpGif, tmpOut)
      return out
    }
  } catch (e) {
    errors.push(`sharp-anim: ${e.message}`)
  }

  safeUnlink(tmpIn, tmpGif, tmpOut)
  console.error('[TOIMG] stickerToVideo fail:', errors.join(' | '))
  return null
}

export async function makeSticker(buffer) {
  try {
    const tmpIn = path.join(tmpdir(), `sticker_in_${Date.now()}`)
    const tmpOut = path.join(tmpdir(), `sticker_out_${Date.now()}.webp`)
    writeFileSync(tmpIn, buffer)
    execFileSync(FFMPEG, [
      '-y', '-i', tmpIn,
      '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2',
      '-c:v', 'libwebp',
      '-lossless', '0',
      '-q:v', '60',
      '-loop', '0',
      tmpOut
    ], { stdio: 'pipe' })
    const result = readFileSync(tmpOut)
    safeUnlink(tmpIn, tmpOut)
    return result
  } catch (err) {
    throw new Error(`Gagal buat stiker: ${err.message}`)
  }
}
