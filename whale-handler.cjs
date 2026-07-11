'use strict'
/**
 * whale-handler.cjs — Command handler untuk whale tracking dari WA
 *
 * Commands (.whale prefix — owner only):
 *   .whale start          — Start monitoring
 *   .whale stop           — Stop monitoring
 *   .whale status         — Lihat status
 *   .whale add <address> [label]   — Tambah wallet whale
 *   .whale remove <address>       — Hapus wallet
 *   .whale list          — Lihat semua wallet
 *   .whale addbatch <file> — Bulk add dari file (1 address per line)
 *   .whale mcap <amount>  — Set max MCAP (default $50K)
 *   .whale buyamount <SOL> — Set jumlah auto-buy (default 0.05 SOL)
 *   .whale autosell <on|off> — Toggle auto-sell saat whale sell
 *   .whale autobuy <on|off>  — Toggle auto-buy (require konfirmasi WA)
 *   .whale holdings       — Lihat posisi aktif
 *   .whale help           — Panduan
 *
 * Konfirmasi buy:
 *   Setelah alert notifikasi, balas "beli" atau "skip"
 *   Bot tunggu 60 detik, kalau ga dijawab = skip
 */

const tracker = require('./whale-tracker.cjs')

// Session state for pending buy confirmations
// Key: ownerJid, Value: { tokenAddress, tokenSymbol, whale, mcap, expiry }
const pendingBuySessions = new Map()

const PENDING_TIMEOUT = 60000 // 60 seconds to confirm

/**
 * Handle .whale command
 * @returns {Promise<boolean>} true if handled
 */
async function handleWhaleCommand(sock, msg, body, sender, isOwner, sendText) {
  const jid = msg.key.remoteJid
  const args = body.trim().split(/\s+/)
  const subcmd = (args[1] || '').toLowerCase()

  const reply = async (t) => sock.sendMessage(jid, { text: t }, { quoted: msg })

  // ─── Owner only ───
  if (!isOwner) {
    await reply('🔒 Command ini khusus owner.')
    return true
  }

  switch (subcmd) {
    // ─── START ───
    case 'start': {
      const apiKey = process.env.HELIUS_API_KEY || '0218e26d-9bcf-4fec-a684-97c89aea09e3'
      if (!apiKey) {
        await reply(
          '❌ HELIUS_API_KEY belum diset!\n\n' +
          'Tambahkan di .env:\n' +
          'HELIUS_API_KEY=0218e26d-9bcf-4fec-a684-97c89aea09e3\n\n' +
          'Setelah itu restart bot: sudo docker rm -f wa-bot && sudo docker run ...'
        )
        return true
      }

      const wallets = tracker.listWallets()
      if (wallets.length === 0) {
        await reply('⚠️ Belum ada wallet whale. Tambah dulu:\n`.whale add <address> [label]`')
        return true
      }

      tracker.startPolling({
        apiKey,
        onBuy: async (data) => {
          await onWhaleBuyDetected(sock, jid, data, sendText)
        },
        onSell: async (data) => {
          await onWhaleSellDetected(sock, jid, data, sendText)
        }
      })

      const settings = tracker.loadSettings()
      await reply(
        `✅ *Whale Tracker aktif!*\n\n` +
        `🐋 Wallets: ${wallets.length}\n` +
        `💰 Max MCAP: $${settings.maxMCAP.toLocaleString()}\n` +
        `🛒 Buy amount: ${settings.buyAmount} SOL\n` +
        `📊 Auto-sell: ${settings.autoSellOnWhaleSell ? 'ON' : 'OFF'}\n` +
        `🤖 Auto-buy: ${settings.autoBuyEnabled ? 'ON (konfirmasi WA)' : 'OFF (manual)'}\n` +
        `⏱️ Poll interval: ${settings.pollInterval}s\n\n` +
        `💡 Notifikasi bakal muncul otomatis saat whale buy/sell token baru (MCAP < $${settings.maxMCAP.toLocaleString()})`
      )
      return true
    }

    // ─── STOP ───
    case 'stop': {
      tracker.stopPolling()
      await reply('⏹️ Whale Tracker dihentikan.')
      return true
    }

    // ─── STATUS ───
    case 'status': {
      const wallets = tracker.listWallets()
      const settings = tracker.loadSettings()
      const holdings = tracker.getActiveHoldings()
      const polling = tracker.isPolling()

      let status = `📊 *Whale Tracker Status*\n\n`
      status += `Status: ${polling ? '🟢 ACTIVE' : '🔴 STOPPED'}\n`
      status += `🐋 Wallets: ${wallets.length}\n`
      status += `💰 Max MCAP: $${settings.maxMCAP.toLocaleString()}\n`
      status += `🛒 Buy amount: ${settings.buyAmount} SOL\n`
      status += `📊 Auto-sell: ${settings.autoSellOnWhaleSell ? 'ON' : 'OFF'}\n`
      status += `🤖 Auto-buy: ${settings.autoBuyEnabled ? 'ON' : 'OFF'}\n`
      status += `⏱️ Poll: ${settings.pollInterval}s\n`
      status += `📈 Active holdings: ${holdings.length}\n`

      if (holdings.length > 0) {
        status += '\n*Holdings:*\n'
        for (const h of holdings) {
          status += `• ${h.tokenAddress.slice(0, 8)}... | ${h.amount || '?'} tokens | ${h.solSpent} SOL\n`
        }
      }

      await reply(status)
      return true
    }

    // ─── ADD WALLET ───
    case 'add': {
      const address = (args[2] || '').trim()
      const label = args.slice(3).join(' ') || ''
      if (!address || address.length < 32) {
        await reply('❌ Format: `.whale add <address> [label]`')
        return true
      }
      const result = tracker.addWallet(address, label)
      if (result.success) {
        const count = tracker.listWallets().length
        await reply(`✅ ${result.msg}\n\nTotal wallets: ${count}`)
      } else {
        await reply(`❌ ${result.msg}`)
      }
      return true
    }

    // ─── REMOVE WALLET ───
    case 'remove': {
      const address = (args[2] || '').trim()
      if (!address) {
        await reply('❌ Format: `.whale remove <address>`')
        return true
      }
      const result = tracker.removeWallet(address)
      if (result.success) {
        await reply(`✅ ${result.msg}`)
      } else {
        await reply(`❌ ${result.msg}`)
      }
      return true
    }

    // ─── LIST WALLETS ───
    case 'list': {
      const wallets = tracker.listWallets()
      if (wallets.length === 0) {
        await reply('📭 Belum ada wallet. Tambah dengan `.whale add <address>`')
        return true
      }
      let text = `🐋 *Daftar Whale Wallets (${wallets.length})*\n\n`
      for (let i = 0; i < Math.min(wallets.length, 50); i++) {
        const w = wallets[i]
        text += `${i + 1}. \`${w.address}\` ${w.label ? '— ' + w.label : ''}\n`
      }
      if (wallets.length > 50) {
        text += `\n... dan ${wallets.length - 50} wallet lainnya (total ${wallets.length})`
      }
      await reply(text)
      return true
    }

    // ─── ADD BATCH (bulk add from text) ───
    case 'addbatch': {
      // Usage: .whale addbatch <address1> <address2> ... 
      // OR reply to a text file containing addresses (1 per line)
      const restArgs = args.slice(2)
      
      // If reply to a message with text, parse it
      const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
      let addresses = []
      
      if (quoted && !restArgs.length) {
        // Parse from quoted message
        const quotedText = quoted.conversation || quoted.extendedTextMessage?.text || ''
        addresses = quotedText.split('\n').map(l => l.trim().split(/\s+/)[0]).filter(a => a.length >= 32)
      } else {
        // Parse from args — split by commas, spaces, or newlines
        const raw = restArgs.join(' ')
        addresses = raw.split(/[,\n\s]+/).filter(a => a.length >= 32)
      }
      
      if (addresses.length === 0) {
        await reply(
          '❌ Format: `.whale addbatch <addr1> <addr2> ...`\n' +
          'Atau reply ke pesan berisi daftar address (1 per baris)\n\n' +
          'Format baris: `address [label]`'
        )
        return true
      }
      
      let added = 0, skipped = 0
      for (const line of addresses) {
        const parts = line.trim().split(/\s+/)
        const addr = parts[0]
        const label = parts.slice(1).join(' ') || ''
        const result = tracker.addWallet(addr, label)
        if (result.success) added++
        else skipped++
      }
      
      const total = tracker.listWallets().length
      await reply(
        `✅ *Bulk add selesai!*\n\n` +
        `Added: ${added}\n` +
        `Skipped (duplikat): ${skipped}\n` +
        `Total wallets: ${total}`
      )
      return true
    }

    // ─── CLEAR ALL ───
    case 'clear': {
      tracker.saveWallets([])
      await reply('✅ Semua wallet dihapus. Total: 0')
      return true
    }

    // ─── SET MCAP ───
    case 'mcap': {
      const amount = parseFloat(args[2] || '0')
      if (!amount || amount < 0) {
        await reply('❌ Format: `.whale mcap <amount_usd>`\nContoh: `.whale mcap 50000`')
        return true
      }
      tracker.updateSetting('maxMCAP', amount)
      await reply(`✅ Max MCAP di-set ke $${amount.toLocaleString()}`)
      return true
    }

    // ─── SET BUY AMOUNT ───
    case 'buyamount': {
      const amount = parseFloat(args[2] || '0')
      if (!amount || amount < 0) {
        await reply('❌ Format: `.whale buyamount <sol>`\nContoh: `.whale buyamount 0.05`')
        return true
      }
      tracker.updateSetting('buyAmount', amount)
      await reply(`✅ Buy amount di-set ke ${amount} SOL`)
      return true
    }

    // ─── AUTO-SELL TOGGLE ───
    case 'autosell': {
      const val = (args[2] || '').toLowerCase()
      if (val === 'on') {
        tracker.updateSetting('autoSellOnWhaleSell', true)
        await reply('✅ Auto-sell ON — bot bakal sell otomatis saat whale sell')
      } else if (val === 'off') {
        tracker.updateSetting('autoSellOnWhaleSell', false)
        await reply('✅ Auto-sell OFF — hanya notifikasi saat whale sell')
      } else {
        await reply('❌ Format: `.whale autosell <on|off>`')
      }
      return true
    }

    // ─── AUTO-BUY TOGGLE ───
    case 'autobuy': {
      const val = (args[2] || '').toLowerCase()
      if (val === 'on') {
        tracker.updateSetting('autoBuyEnabled', true)
        await reply('✅ Auto-buy ON — bot bakal tanya konfirmasi WA saat whale buy')
      } else if (val === 'off') {
        tracker.updateSetting('autoBuyEnabled', false)
        await reply('✅ Auto-buy OFF — hanya notifikasi saat whale buy')
      } else {
        await reply('❌ Format: `.whale autobuy <on|off>`')
      }
      return true
    }

    // ─── HOLDINGS ───
    case 'holdings': {
      const holdings = tracker.getActiveHoldings()
      if (holdings.length === 0) {
        await reply('📭 Belum ada holding aktif.')
        return true
      }
      let text = `📈 *Active Holdings (${holdings.length})*\n\n`
      for (const h of holdings) {
        const age = Math.round((Date.now() - h.buyTime) / 60000)
        text += `• Token: \`${h.tokenAddress.slice(0, 12)}...\`\n`
        text += `  Amount: ${h.amount || '?'}\n`
        text += `  SOL spent: ${h.solSpent}\n`
        text += `  Buy time: ${age}m ago\n`
        text += `  Buy tx: ${h.buyTx?.slice(0, 16) || '?'}...\n\n`
      }
      await reply(text)
      return true
    }

    // ─── HELP ───
    case 'help': {
      await reply(
        `🐋 *WHALE TRACKER — Command List*\n\n` +
        '` .whale start` — Start monitoring\n' +
        '` .whale stop` — Stop monitoring\n' +
        '` .whale status` — Lihat status\n\n`' +
        '` .whale add <address> [label]` — Tambah wallet whale\n' +
        '` .whale addbatch <addr1> <addr2> ...` — Bulk add massal\n' +
        '` .whale remove <address>` — Hapus wallet\n' +
        '` .whale clear` — Hapus SEMUA wallet\n' +
        '` .whale list` — Lihat semua wallet\n\n`' +
        ' .whale mcap <amount>` — Set max MCAP (default $50K)\n' +
        '` .whale buyamount <sol>` — Set jumlah buy (default 0.05 SOL)\n' +
        '` .whale autosell <on|off>` — Auto-sell saat whale sell\n' +
        '` .whale autobuy <on|off>` — Auto-buy dengan konfirmasi WA\n\n`' +
        ' .whale holdings` — Lihat posisi aktif\n\n`' +
        '_Konfirmasi buy:_\n' +
        'Setelah alert notifikasi, balas `beli` atau `skip`\n' +
        'Bot tunggu 60 detik, kalau ga dijawab = skip'
      )
      return true
    }

    // ─── DEFAULT ───
    default: {
      if (!subcmd) {
        await reply(
          '🐋 *Whale Tracker*\n\n' +
          'Ketik `.whale help` buat lihat semua command.\n' +
          'Ketik `.whale start` buat mulai monitoring.\n' +
          'Ketik `.whale status` buat lihat status.'
        )
        return true
      }
      return false
    }
  }

  return true
}

// ─── WHALE BUY DETECTED → NOTIFIKASI + KONFIRMASI ──────────────

async function onWhaleBuyDetected(sock, ownerJid, data, sendText) {
  const { tokenAddress, tokenSymbol, solAmount, tokenInfo, wallet, walletLabel } = data
  const settings = tracker.loadSettings()

  let alert = `🐋 *WHALE BUY DETECTED!*\n\n`
  alert += `Token: ${tokenInfo?.symbol || tokenSymbol || '?'} (${tokenInfo?.name || '?'})\n`
  alert += `Address: \`${tokenAddress}\`\n`
  alert += `Price: $${tokenInfo?.price?.toFixed(8) || '?'}\n`
  if (tokenInfo) {
    alert += `MCAP/FDV: $${tokenInfo.marketCap?.toLocaleString() || '?'}\n`
    alert += `Liquidity: $${tokenInfo.liquidity?.toLocaleString() || '?'}\n`
    alert += `24h Vol: $${tokenInfo.volume24h?.toLocaleString() || '?'}\n`
    alert += `24h Change: ${tokenInfo.priceChange24h > 0 ? '🟢' : '🔴'} ${tokenInfo.priceChange24h?.toFixed(2) || 0}%\n`
    alert += `DEX: ${tokenInfo.dex || '?'}\n`
  }
  alert += `\n🐋 Whale: \`${wallet.slice(0, 12)}...\` ${walletLabel ? '(' + walletLabel + ')' : ''}\n`
  if (solAmount) {
    alert += `💰 Buy: ${solAmount.toFixed(4)} SOL ($${(solAmount * 180).toFixed(2)})\n`
  }
  alert += `\n📊 DexScreener: ${tokenInfo?.url || 'https://dexscreener.com/solana/' + tokenAddress}`

  // Check if auto-buy is ON
  if (settings.autoBuyEnabled) {
    alert += `\n\n🤖 Auto-buy ON — balas dalam 60 detik:\n`
    alert += `   • \`beli\` → buy ${settings.buyAmount} SOL\n`
    alert += `   • \`skip\` → skip\n`
    alert += `   • \`beli 0.1\` → buy 0.1 SOL (custom amount)`

    // Set pending session
    pendingBuySessions.set(ownerJid, {
      tokenAddress,
      tokenSymbol: tokenInfo?.symbol || tokenSymbol,
      whale: wallet,
      mcap: tokenInfo?.marketCap || 0,
      expiry: Date.now() + PENDING_TIMEOUT
    })

    // Auto-expire after 60s
    setTimeout(() => {
      if (pendingBuySessions.has(ownerJid)) {
        const session = pendingBuySessions.get(ownerJid)
        if (session.tokenAddress === tokenAddress) {
          pendingBuySessions.delete(ownerJid)
          sendText(ownerJid, '⏰ Konfirmasi buy expired — token di-skip.')
        }
      }
    }, PENDING_TIMEOUT)
  } else {
    alert += `\n\n💡 Auto-buy OFF — tinggal check token & beli manual kalau minat.`
  }

  await sendText(ownerJid, alert)
  console.log(`[WHALE] Buy alert sent: ${tokenSymbol || tokenAddress} whale=${wallet.slice(0, 8)}`)
}

// ─── WHALE SELL DETECTED → AUTO-SELL ─────────────────────────

async function onWhaleSellDetected(sock, ownerJid, data, sendText) {
  const { tokenAddress, tokenSymbol, solAmount, tokenInfo, wallet, walletLabel } = data
  const settings = tracker.loadSettings()

  let alert = `🔴 *WHALE SELL DETECTED!*\n\n`
  alert += `Token: ${tokenInfo?.symbol || tokenSymbol || '?'}\n`
  alert += `Address: \`${tokenAddress}\`\n`
  if (tokenInfo) {
    alert += `Price: $${tokenInfo?.price?.toFixed(8) || '?'}\n`
    alert += `MCAP: $${tokenInfo.marketCap?.toLocaleString() || '?'}\n`
  }
  alert += `\n🐋 Whale: \`${wallet.slice(0, 12)}...\` ${walletLabel ? '(' + walletLabel + ')' : ''}\n`
  if (solAmount) {
    alert += `💰 Sell: ${solAmount.toFixed(4)} SOL ($${(solAmount * 180).toFixed(2)})\n`
  }

  // Check if we hold this token → auto-sell
  const holding = tracker.getHolding(tokenAddress)
  if (holding && holding.status === 'holding' && settings.autoSellOnWhaleSell) {
    alert += `\n⚠️ Kita punya token ini! Auto-sell di-execute...`

    // Execute sell via Jupiter
    const sellResult = await tracker.buildSellTx(
      tokenAddress,
      tracker.SOL_MINT,
      holding.amount,
      process.env.WALLET_PUBLIC_KEY
    )

    if (sellResult.success) {
      // TODO: Sign & send transaction via wallet private key
      // For now, just log — actual signing needs @solana/web3.js
      alert += `\n✅ Sell tx built — PENDING SIGN\n`
      alert += `Out amount: ${parseFloat(sellResult.outAmount) / 1e9} SOL\n`
      alert += `Price impact: ${(sellResult.priceImpact * 100).toFixed(2)}%`
    } else {
      alert += `\n❌ Sell gagal: ${sellResult.msg}`
    }
  } else if (holding && holding.status === 'holding') {
    alert += `\n⚠️ Kita punya token ini! Auto-sell OFF — sell manual segera!`
  } else {
    alert += `\n💡 Kita ga pegang token ini — no action needed.`
  }

  await sendText(ownerJid, alert)
  console.log(`[WHALE] Sell alert sent: ${tokenSymbol || tokenAddress} whale=${wallet.slice(0, 8)}`)
}

// ─── HANDLE KONFIRMASI BUY (beli/skip) ────────────────────────

async function handleBuyConfirmation(sock, msg, body, sender, isOwner, sendText) {
  if (!isOwner) return false

  const text = body.trim().toLowerCase()
  const ownerJid = msg.key.remoteJid
  const session = pendingBuySessions.get(ownerJid)

  if (!session) return false

  // Check if message is a buy/skip command
  if (!text.startsWith('beli') && text !== 'skip') return false

  // Check expiry
  if (Date.now() > session.expiry) {
    pendingBuySessions.delete(ownerJid)
    return false
  }

  const reply = async (t) => sock.sendMessage(ownerJid, { text: t }, { quoted: msg })

  if (text === 'skip') {
    pendingBuySessions.delete(ownerJid)
    await reply('⏭️ Buy di-skip.')
    return true
  }

  // Parse buy amount
  let buyAmount = tracker.loadSettings().buyAmount
  const parts = text.split(/\s+/)
  if (parts[1]) {
    const customAmount = parseFloat(parts[1])
    if (customAmount > 0) buyAmount = customAmount
  }

  // Execute buy via Jupiter
  await reply(`🛒 Buy ${buyAmount} SOL — ${session.tokenSymbol || session.tokenAddress.slice(0, 8)}...`)

  const amountLamports = Math.round(buyAmount * 1e9)
  const buyResult = await tracker.buildBuyTx(
    tracker.SOL_MINT,
    session.tokenAddress,
    amountLamports,
    process.env.WALLET_PUBLIC_KEY
  )

  if (buyResult.success) {
    // TODO: Sign & send transaction
    // Actual signing needs @solana/web3.js + private key
    tracker.addHolding(
      session.tokenAddress,
      'pending',
      parseFloat(buyResult.outAmount),
      buyAmount
    )

    await reply(
      `✅ Buy tx built — PENDING SIGN\n\n` +
      `Token: ${session.tokenSymbol || session.tokenAddress.slice(0, 12)}\n` +
      `SOL spent: ${buyAmount}\n` +
      `Tokens received: ${parseFloat(buyResult.outAmount).toLocaleString()}\n` +
      `Price impact: ${(parseFloat(buyResult.priceImpact) * 100).toFixed(2)}%\n\n` +
      `⚠️ Tx perlu di-sign dengan wallet private key (coming soon)`
    )
  } else {
    await reply(`❌ Buy gagal: ${buyResult.msg}`)
  }

  pendingBuySessions.delete(ownerJid)
  return true
}

module.exports = {
  handleWhaleCommand,
  handleBuyConfirmation,
  onWhaleBuyDetected,
  onWhaleSellDetected,
  pendingBuySessions
}
