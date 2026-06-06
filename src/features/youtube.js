import ytdl from 'ytdl-core'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const TEMP = path.join(__dirname, '../../../temp')

/**
 * Download video/audio dari YouTube
 * @param {string} url - URL YouTube
 * @param {'video'|'audio'} type - Tipe download
 */
export async function downloadYoutube(url, type = 'video') {
  if (!ytdl.validateURL(url)) {
    throw new Error('URL YouTube tidak valid!')
  }

  // Ambil info video
  const info = await ytdl.getInfo(url)
  const title = info.videoDetails.title.replace(/[^\w\s]/gi, '').slice(0, 50)
  const duration = formatDuration(parseInt(info.videoDetails.lengthSeconds))

  // Batasi durasi max 10 menit
  if (parseInt(info.videoDetails.lengthSeconds) > 600) {
    throw new Error('Video terlalu panjang! Maksimal 10 menit.')
  }

  const fileName = `${Date.now()}_${type === 'video' ? 'video.mp4' : 'audio.mp3'}`
  const filePath = path.join(TEMP, fileName)

  return new Promise((resolve, reject) => {
    let stream

    if (type === 'video') {
      stream = ytdl(url, {
        quality: 'highest',
        filter: format => format.container === 'mp4'
      })
    } else {
      stream = ytdl(url, {
        quality: 'highestaudio',
        filter: 'audioonly'
      })
    }

    const fileStream = fs.createWriteStream(filePath)
    stream.pipe(fileStream)

    stream.on('error', (err) => {
      fileStream.close()
      reject(new Error(`Download error: ${err.message}`))
    })

    fileStream.on('finish', () => {
      resolve({ path: filePath, title, duration })
    })

    fileStream.on('error', (err) => {
      reject(new Error(`File write error: ${err.message}`))
    })
  })
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
