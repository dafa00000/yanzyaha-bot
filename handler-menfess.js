// handler-menfess.js

const DEFAULT_TARGET = '120363045668127291@g.us' // ganti dengan JID grup/nomor default

export async function handleMenfess(sock, msg, text) {
  const from = msg.key.remoteJid
  const isGroup = from.endsWith('@g.us')
  const sender = isGroup ? msg.key.participant : from

  console.log('FROM JID:', from)
  console.log('SENDER JID:', sender)

  const sendText = async (to, t) =>
    sock.sendMessage(to, { text: t }, { quoted: msg })

  if (!text) {
    return sendText(from,
      `📨 *CARA PAKAI MENFESS*\n\n` +
      `*Kirim ke default:*\n` +
      `*.menfess pesanmu*\n\n` +
      `*Kirim ke target tertentu:*\n` +
      `*.menfess @628xxx pesanmu*\n\n` +
      `Contoh:\n` +
      `• .menfess Halo semua!\n` +
      `• .menfess @628123456789 Halo kamu!\n\n` +
      `_Identitasmu tidak akan diketahui penerima_ 🕵️`
    )
  }

  const targetMatch = text.match(/^@(\d+)\s+/)
  let target, menfessText

  if (targetMatch) {
    target = targetMatch[1] + '@s.whatsapp.net'
    menfessText = text.slice(targetMatch[0].length).trim()
  } else {
    target = DEFAULT_TARGET
    menfessText = text.trim()
  }

  if (!menfessText) {
    return sendText(from, `❌ Pesan menfess tidak boleh kosong!`)
  }

  const menfessMsg =
    `📨 *MENFESS ANONIM*\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${menfessText}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `_Dikirim secara anonim_ 🕵️`

  try {
    await sock.sendMessage(target, { text: menfessMsg })
    await sendText(from, `✅ Menfess berhasil dikirim secara anonim!`)
  } catch (err) {
    await sendText(from, `❌ Gagal kirim menfess: ${err.message}`)
  }
}
