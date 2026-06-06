import axios from 'axios'

/**
 * Download video TikTok tanpa watermark
 * Menggunakan API tikwm.com (gratis, tanpa watermark)
 * @param {string} url - URL TikTok
 */
export async function downloadTiktok(url) {
  try {
    // API tikwm - gratis dan tanpa watermark
    const response = await axios.post(
      'https://www.tikwm.com/api/',
      new URLSearchParams({ url, hd: '1' }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36'
        },
        timeout: 30000
      }
    )

    const data = response.data

    if (!data || data.code !== 0) {
      throw new Error(data?.msg || 'Gagal mendapatkan data TikTok')
    }

    const videoData = data.data

    return {
      url: videoData.play || videoData.hdplay,
      title: videoData.title || 'TikTok Video',
      author: videoData.author?.nickname || 'Unknown',
      duration: videoData.duration
    }
  } catch (err) {
    if (err.response) {
      throw new Error(`Server error: ${err.response.status}`)
    }
    throw new Error(`Download TikTok gagal: ${err.message}`)
  }
}
