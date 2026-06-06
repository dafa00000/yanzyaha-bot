import fetch from 'node-fetch'
import { parse } from 'node-html-parser'

const cooldown = new Map()
const COOLDOWN_MS = 5000

export async function handleSearch(sock, msg, text, command) {
  const from = msg.key.remoteJid
  const sender = msg.key.participant || from
  const sendText = async (t) => sock.sendMessage(from, { text: t }, { quoted: msg })

  const now = Date.now()
  const last = cooldown.get(sender) || 0
  if (now - last < COOLDOWN_MS) {
    const sisa = Math.ceil((COOLDOWN_MS - (now - last)) / 1000)
    return sendText(`⏳ Tunggu *${sisa} detik* lagi ya.`)
  }
  cooldown.set(sender, now)

  const query = text.trim()
  if (!query) {
    return sendText(`❌ Masukkan kata kunci.\nContoh: *.search cuaca Jakarta*`)
  }

  await sendText(`🔍 Mencari *${query}* ...`)

  try {
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}&kl=id-id`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
        'Referer': 'https://lite.duckduckgo.com/',
      }
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()
    const root = parse(html)

    const links = root.querySelectorAll('a.result-link')
    const snippets = root.querySelectorAll('.result-snippet')

    if (!links || links.length === 0) {
      return sendText(`❌ Tidak ditemukan hasil untuk *${query}*.\nCoba kata kunci lain.`)
    }

    const top = Math.min(4, links.length)
    let hasil = `🔎 *Hasil: ${query}*\n${'─'.repeat(30)}\n\n`

    for (let i = 0; i < top; i++) {
      const title = links[i].text.trim()
      const link = links[i].getAttribute('href') || ''
      const desc = snippets[i]?.text.trim() || ''

      hasil += `*${i + 1}. ${title}*\n`
      if (desc) hasil += `${desc.slice(0, 200)}\n`
      hasil += `🔗 ${link}\n\n`
    }

    hasil += `_Powered by DuckDuckGo_`
    await sendText(hasil.trim())

  } catch (err) {
    console.error('[handler-search] Error:', err)
    await sendText('⚠️ Gagal mencari. Coba lagi nanti.')
  }
}
