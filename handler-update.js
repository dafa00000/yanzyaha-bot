import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Simpan nomor owner dalam 2 format (phone + LID)
const OWNER = ['6282389424044', '83807763972304']

function isOwner(msg) {
  const sender = (msg.key.participant || msg.key.remoteJid)
    .replace(/@s\.whatsapp\.net|@lid/g, '')
  console.log('[DEBUG] sender:', sender)
  return OWNER.includes(sender)
}

export async function handleUpdate(sock, msg) {
  const from = msg.key.remoteJid

  if (!isOwner(msg)) {
    await sock.sendMessage(from, {
      text: '❌ Hanya owner yang bisa menggunakan perintah ini!'
    }, { quoted: msg })
    return
  }

  try {
    await sock.sendMessage(from, {
      text: '🔄 *Memulai update...*\n📦 Mengupdate packages npm...'
    }, { quoted: msg })

    const { stdout } = await execAsync('cd ~/wa-bot && npm update', { timeout: 60000 })

    await sock.sendMessage(from, {
      text: `✅ *Update selesai!*\n\n${stdout.trim() || 'Semua package sudah up-to-date.'}\n\n🔄 Bot restart dalam 3 detik...`
    }, { quoted: msg })

    setTimeout(() => process.exit(2), 3000)
  } catch (err) {
    await sock.sendMessage(from, {
      text: `❌ *Update gagal!*\n\n${err.message}`
    }, { quoted: msg })
  }
}

export async function handleRestart(sock, msg) {
  const from = msg.key.remoteJid

  if (!isOwner(msg)) {
    await sock.sendMessage(from, {
      text: '❌ Hanya owner yang bisa menggunakan perintah ini!'
    }, { quoted: msg })
    return
  }

  await sock.sendMessage(from, {
    text: '🔄 Bot akan restart dalam 3 detik...'
  }, { quoted: msg })

  setTimeout(() => process.exit(2), 3000)
}
