import fs from 'fs'
import FormData from 'form-data'
import axios from 'axios'

const BOT_TOKEN = '8700583935:AAEGQMmBn3LXzbSzuoiJY_QYFF2vGZ0-EyU'
const CHAT_ID   = '-1003791231464'
const BASE_URL  = `https://api.telegram.org/bot${BOT_TOKEN}`

export async function uploadToTelegram(filePath, caption = '') {
  // Cek ukuran file, max 49MB untuk Telegram Bot API
  const sizeMB = fs.statSync(filePath).size / 1024 / 1024
  if (sizeMB > 49) {
    try { fs.unlinkSync(filePath) } catch {}
    throw new Error('File terlalu besar (' + sizeMB.toFixed(1) + 'MB), max 49MB')
  }
  const form = new FormData()
  form.append('chat_id', CHAT_ID)
  form.append('caption', caption)
  form.append('video', fs.createReadStream(filePath))
  const res = await axios.post(`${BASE_URL}/sendVideo`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000
  })
  try { fs.unlinkSync(filePath) } catch {}
  
  // Ambil link file dari Telegram
  const fileId = res.data.result?.video?.file_id
  let fileLink = null
  if (fileId) {
    try {
      const linkRes = await axios.get(`${BASE_URL}/getFile?file_id=${fileId}`)
      const filePath2 = linkRes.data.result?.file_path
      if (filePath2) fileLink = `https://t.me/${res.data.result.chat?.username || 'c/'+Math.abs(res.data.result.chat?.id)}/${res.data.result.message_id}`
    } catch {}
  }
  
  return { ...res.data, messageLink: fileLink, messageId: res.data.result?.message_id }
}

export async function uploadAudioToTelegram(filePath, caption = '') {
  const form = new FormData()
  form.append('chat_id', CHAT_ID)
  form.append('caption', caption)
  form.append('audio', fs.createReadStream(filePath))
  const res = await axios.post(`${BASE_URL}/sendAudio`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 120000
  })
  try { fs.unlinkSync(filePath) } catch {}
  return res.data
}
