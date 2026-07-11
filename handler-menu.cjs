/**
 * handler-menu.cjs — Dynamic menu management dari WA (owner only)
 *
 * Commands:
 *   .addcmdglobal <cmd> <section> <desc>  — Tambah command ke menu global
 *   .delcmdglobal <cmd>                    — Hapus command dari menu global
 *   .editcmddesc <cmd> <desc>              — Edit deskripsi command
 *   .addsection <name> <title>             — Tambah section baru
 *   .delsection <name>                     — Hapus section (beserta isinya)
 *   .listsections                          — Lihat semua section
 *   .menucmdhelp                           — Panduan menu management
 *
 * Data disimpan di: HERMES_HOME/menu-custom.json (persistent)
 */

const fs = require('fs')
const path = require('path')

// ─── STORAGE ─────────────────────────────────────────────────
function getMenuPath() {
  const home = process.env.HERMES_HOME || '/opt/data'
  const dir = path.join(home, 'auth')
  // Ensure dir exists
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return path.join(home, 'menu-custom.json')
}

function loadCustomMenu() {
  try {
    const raw = fs.readFileSync(getMenuPath(), 'utf8')
    return JSON.parse(raw)
  } catch {
    return { sections: {}, hiddenCmds: [], customDesc: {} }
  }
}

function saveCustomMenu(data) {
  try {
    fs.writeFileSync(getMenuPath(), JSON.stringify(data, null, 2))
    return true
  } catch (e) {
    console.error('[MENU-MGMT] Failed to save:', e.message)
    return false
  }
}

// ─── HANDLER ──────────────────────────────────────────────────
/**
 * @param {object} sock - Baileys socket
 * @param {object} msg - Baileys message
 * @param {string} command - command name (e.g. 'addcmdglobal')
 * @param {string} text - args text after command
 * @param {string} sender - sender JID
 * @param {function} sendText - send text reply
 * @returns {boolean} true jika command ditangani
 */
async function handleMenuCommand(sock, msg, command, text, sender, sendText) {
  const cleanText = (text || '').trim()

  switch (command) {

    // ─── ADDCMDGLOBAL ──────────────────────────────────
    case 'addcmdglobal': {
      // Format: .addcmdglobal <cmd> <section> <desc>
      // Contoh: .addcmdglobal quote others Random quote
      const parts = cleanText.split(/\s+/)
      if (parts.length < 3) {
        await sendText(
          '⚠️ *Format salah!*\n\n' +
          'Contoh: `.addcmdglobal quote others Random quote`\n\n' +
          '• `cmd` — nama command (tanpa titik)\n' +
          '• `section` — nama section (info, ai, sticker, search, market, convert, download, sosmed, ml, game, others, economy, gamesAdvanced, tools)\n' +
          '• `desc` — deskripsi command'
        )
        return true
      }
      const cmd = parts[0].replace(/^\./, '')
      const section = parts[1]
      const desc = parts.slice(2).join(' ')

      const validSections = ['info', 'ai', 'sticker', 'search', 'market', 'convert', 'download', 'sosmed', 'ml', 'game', 'others', 'economy', 'gamesAdvanced', 'tools', 'personalConfig']
      if (!validSections.includes(section)) {
        await sendText(
          `❌ Section *${section}* tidak valid!\n\nSection tersedia: ${validSections.map(s => '`' + s + '`').join(', ')}`
        )
        return true
      }

      const data = loadCustomMenu()
      if (!data.sections[section]) data.sections[section] = []
      // Hapus dari hiddenCmds kalau ada (re-enable command)
      data.hiddenCmds = (data.hiddenCmds || []).filter(c => c !== cmd)
      // Cek duplikat
      const exists = data.sections[section].find(it => it.cmd === '.' + cmd)
      if (exists) {
        exists.desc = desc
      } else {
        data.sections[section].push({ type: 'cmd', cmd: '.' + cmd, desc })
      }
      saveCustomMenu(data)
      await sendText(
        `✅ *Command ditambahkan ke menu global!*\n\n` +
        `⌬ .${cmd} » ${desc}\n` +
        `📂 Section: ${section}\n\n` +
        `Efek: LANGSUNG (ga perlu restart)`
      )
      return true
    }

    // ─── DELCMDGLOBAL ──────────────────────────────────
    case 'delcmdglobal': {
      // Format: .delcmdglobal <cmd>
      if (!cleanText) {
        await sendText('⚠️ Contoh: `.delcmdglobal quote`\n\nHapus command dari menu global. Command jadi ga muncul di .menu.')
        return true
      }
      const cmd = cleanText.replace(/^\./, '')

      const data = loadCustomMenu()
      // Cek di custom sections
      let found = false
      for (const [secName, items] of Object.entries(data.sections)) {
        const before = items.length
        data.sections[secName] = items.filter(it => {
          const itCmd = (it.cmd || '').replace(/^\./, '')
          if (itCmd === cmd) { found = true; return false }
          return true
        })
        if (data.sections[secName].length === 0) delete data.sections[secName]
      }
      // Juga track di hiddenCmds (untuk hide dari built-in menu)
      if (!found) {
        data.hiddenCmds.push(cmd)
      }
      saveCustomMenu(data)
      await sendText(
        `✅ *Command .${cmd} dinonaktifkan & dihapus dari menu!*\n\n` +
        `Efek: LANGSUNG (ga perlu restart)\n` +
        `🚫 User ga bisa pakai .${cmd} sampai di-enable lagi\n\n` +
        `💡 Untuk mengaktifkan lagi:\n` +
        `\`.addcmdglobal ${cmd} <section> <desc>\``
      )
      return true
    }

    // ─── EDITCMDDESC ──────────────────────────────────
    case 'editcmddesc': {
      // Format: .editcmddesc <cmd> <desc>
      const parts = cleanText.split(/\s+/)
      if (parts.length < 2) {
        await sendText('⚠️ Contoh: `.editcmddesc ping Cek status bot (updated)`\n\nEdit deskripsi command di menu.')
        return true
      }
      const cmd = parts[0].replace(/^\./, '')
      const desc = parts.slice(1).join(' ')

      const data = loadCustomMenu()
      data.customDesc[cmd] = desc
      saveCustomMenu(data)
      await sendText(
        `✅ *Deskripsi .${cmd} diupdate!*\n\n` +
        `Deskripsi baru: ${desc}\n\n` +
        `Efek: LANGSUNG (ga perlu restart)`
      )
      return true
    }

    // ─── ADDSECTION ────────────────────────────────────
    case 'addsection': {
      // Format: .addsection <name> <title>
      const parts = cleanText.split(/\s+/)
      if (parts.length < 2) {
        await sendText('⚠️ Contoh: `.addsection custom🎨 Custom Commands`\n\nTambah section baru di menu.')
        return true
      }
      const name = parts[0]
      const title = parts.slice(1).join(' ')

      const data = loadCustomMenu()
      if (!data.sections[name]) data.sections[name] = []
      // Simpan title di metadata
      if (!data.sectionMeta) data.sectionMeta = {}
      data.sectionMeta[name] = { title, custom: true }
      saveCustomMenu(data)
      await sendText(
        `✅ *Section baru ditambahkan!*\n\n` +
        `📂 ${name} → ${title}\n\n` +
        `Sekarang lo bisa: \`.addcmdglobal <cmd> ${name} <desc>\`\n` +
        ` untuk nambah command ke section ini.`
      )
      return true
    }

    // ─── DELSECTION ────────────────────────────────────
    case 'delsection': {
      // Format: .delsection <name>
      if (!cleanText) {
        await sendText('⚠️ Contoh: `.delsection custom🎨`\n\nHapus section custom dari menu.')
        return true
      }
      const name = cleanText

      const data = loadCustomMenu()
      if (data.sections[name]) {
        delete data.sections[name]
      }
      if (data.sectionMeta && data.sectionMeta[name]) {
        delete data.sectionMeta[name]
      }
      saveCustomMenu(data)
      await sendText(`✅ *Section ${name} dihapus dari menu!*`)
      return true
    }

    // ─── LISTSECTIONS ──────────────────────────────────
    case 'listsections': {
      const data = loadCustomMenu()
      const builtIn = ['info', 'ai', 'sticker', 'search', 'market', 'convert', 'download', 'sosmed', 'ml', 'game', 'others', 'economy', 'gamesAdvanced', 'tools', 'personalConfig']
      const custom = Object.keys(data.sections || {}).filter(k => !builtIn.includes(k))

      let out = '📋 *DAFTAR SECTION MENU*\n\n'
      out += '*Built-in:*\n'
      out += builtIn.map(s => '• `' + s + '`').join('\n')
      if (custom.length > 0) {
        out += '\n\n*Custom:*\n'
        out += custom.map(s => {
          const title = data.sectionMeta?.[s]?.title || s
          return `• \`${s}\` → ${title}`
        }).join('\n')
      }
      out += '\n\n💡 *Owner commands:*\n'
      out += '• `.addcmdglobal <cmd> <section> <desc>`\n'
      out += '• `.delcmdglobal <cmd>`\n'
      out += '• `.editcmddesc <cmd> <desc>`\n'
      out += '• `.addsection <name> <title>`\n'
      out += '• `.delsection <name>`'
      await sendText(out)
      return true
    }

    // ─── MENUCMDHELP ───────────────────────────────────
    case 'menucmdhelp': {
      await sendText(
        '👑 *MENU MANAGEMENT (Owner Only)*\n\n' +
        '*Global Menu:*\n' +
        '• `.addcmdglobal <cmd> <section> <desc>` — Tambah command ke menu\n' +
        '• `.delcmdglobal <cmd>` — Hapus command dari menu\n' +
        '• `.editcmddesc <cmd> <desc>` — Edit deskripsi command\n\n' +
        '*Section:*\n' +
        '• `.addsection <name> <title>` — Tambah section baru\n' +
        '• `.delsection <name>` — Hapus section custom\n' +
        '• `.listsections` — Lihat semua section\n\n' +
        '*Contoh:*\n' +
        '```\n' +
        '.addsection mytools 🛠️ Tools Buatan Gw\n' +
        '.addcmdglobal quote mytools Random quote\n' +
        '.editcmddesc ping Cek status bot online\n' +
        '.delcmdglobal quote\n' +
        '```\n\n' +
        '💡 SEMUA langsung effect, ga perlu restart!\n' +
        '💾 Data disimpan di menu-custom.json (persistent)'
      )
      return true
    }

    default:
      return false
  }
}

module.exports = { handleMenuCommand, loadCustomMenu }
