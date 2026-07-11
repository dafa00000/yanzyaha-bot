'use strict'
/**
 * whale-tracker.cjs — Monitor 300+ Solana whale wallets real-time via Helius RPC
 *
 * Polling mode: cek transaksi terakhir dari setiap wallet setiap 30 detik
 * Deteksi: buy token baru (swap SOL → token), sell token (swap token → SOL)
 * Filter: MCAP < $50K (via DexScreener API)
 *
 * Data disimpan di HERMES_HOME/whale-wallets.json (persistent)
 */

const fs = require('fs')
const path = require('path')

const DATA_DIR = process.env.HERMES_HOME || process.cwd()
const WALLETS_FILE = path.join(DATA_DIR, 'whale-wallets.json')
const SEEN_TX_FILE = path.join(DATA_DIR, 'whale-seen-tx.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'whale-settings.json')

// Default settings
const DEFAULT_SETTINGS = {
  maxMCAP: 50000,        // $50K max market cap
  minWhaleBuy: 0.1,      // min 0.1 SOL buy to trigger alert
  autoSellOnWhaleSell: true,
  autoBuyEnabled: false,  // require WA confirmation by default
  buyAmount: 0.05,        // 0.05 SOL per buy
  pollInterval: 30,       // seconds between polls
  rpcEndpoint: 'mainnet-beta', // helius mainnet
}

// ─── WALLET MANAGEMENT ────────────────────────────────────────

function loadWallets() {
  try {
    const data = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function saveWallets(wallets) {
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2))
}

function addWallet(address, label = '') {
  const wallets = loadWallets()
  if (wallets.find(w => w.address === address)) {
    return { success: false, msg: 'Wallet udah ada di list' }
  }
  wallets.push({ address, label, added: Date.now() })
  saveWallets(wallets)
  return { success: true, msg: `Wallet ${address.slice(0, 8)}... ditambahkan` }
}

function removeWallet(address) {
  const wallets = loadWallets()
  const filtered = wallets.filter(w => w.address !== address)
  if (filtered.length === wallets.length) {
    return { success: false, msg: 'Wallet ga ketemu' }
  }
  saveWallets(filtered)
  return { success: true, msg: `Wallet ${address.slice(0, 8)}... dihapus` }
}

function listWallets() {
  return loadWallets()
}

// ─── SETTINGS ────────────────────────────────────────────────

function loadSettings() {
  try {
    const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    return { ...DEFAULT_SETTINGS, ...data }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

function updateSetting(key, value) {
  const settings = loadSettings()
  settings[key] = value
  saveSettings(settings)
  return settings
}

// ─── SEEN TX CACHE (avoid duplicate alerts) ───────────────────

function loadSeenTx() {
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_TX_FILE, 'utf8'))
    // Keep only last 1000 tx
    const entries = Object.entries(data)
    if (entries.length > 1000) {
      const trimmed = entries.slice(-1000)
      const obj = {}
      for (const [k, v] of trimmed) obj[k] = v
      return obj
    }
    return data
  } catch {
    return {}
  }
}

function saveSeenTx(seen) {
  fs.writeFileSync(SEEN_TX_FILE, JSON.stringify(seen, null, 2))
}

function isTxSeen(sig) {
  const seen = loadSeenTx()
  return !!seen[sig]
}

function markTxSeen(sig, data) {
  const seen = loadSeenTx()
  seen[sig] = { ...data, ts: Date.now() }
  saveSeenTx(seen)
}

// ─── HELIUS RPC ──────────────────────────────────────────────

function getHeliusUrl(apiKey) {
  const key = apiKey || '0218e26d-9bcf-4fec-a684-97c89aea09e3'
  return `https://mainnet.helius-rpc.com/?api-key=${key}`
}

/**
 * Get recent transactions for a wallet via Helius
 * Uses getSignaturesForAddress + parseTransaction
 */
async function getRecentTx(walletAddress, apiKey, lastSignature = null) {
  const url = getHeliusUrl(apiKey)
  try {
    // Step 1: Get recent signatures
    const sigResp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [
          walletAddress,
          { limit: 5 }
        ]
      })
    })
    const sigData = await sigResp.json()
    const signatures = sigData.result || []

    if (signatures.length === 0) return []

    // Filter out already-seen tx
    const newSigs = signatures.filter(s => !isTxSeen(s.signature))
    if (newSigs.length === 0) return []

    // Step 2: Parse each new transaction
    const txs = []
    for (const sig of newSigs) {
      if (sig.err) continue // skip failed tx

      try {
        const parseResp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'parseTransaction',
            params: [sig.signature]
          })
        })
        const parseData = await parseResp.json()
        if (parseData.result) {
          txs.push({
            signature: sig.signature,
            ...parseData.result,
            wallet: walletAddress
          })
        }
      } catch (e) {
        // Skip unparseable tx
      }

      // Rate limit: small delay between requests
      await new Promise(r => setTimeout(r, 200))
    }

    return txs
  } catch (e) {
    console.error('[WHALE] Error fetching tx:', e.message)
    return []
  }
}

/**
 * Detect buy/sell from parsed transaction
 * Buy = swapped SOL for token (token balance increased)
 * Sell = swapped token for SOL (token balance decreased)
 */
function detectSwap(tx) {
  if (!tx || !tx.events) return null

  // Helius parseTransaction returns events.swap for Jupiter/Raydium swaps
  const swap = tx.events?.swap
  if (!swap) return null

  const nativeInput = swap.nativeInput?.amount
  const nativeOutput = swap.nativeOutput?.amount
  const tokenInputs = swap.tokenInputs || []
  const tokenOutputs = swap.tokenOutputs || []

  // Buy: SOL in → token out
  if (nativeInput && tokenOutputs.length > 0) {
    const solAmount = parseFloat(nativeInput) / 1e9 // lamports to SOL
    const token = tokenOutputs[0]
    return {
      type: 'buy',
      solAmount,
      tokenAddress: token.rawTokenAddress || token.mint,
      tokenSymbol: token.symbol || '?',
      tokenAmount: parseFloat(token.amount) / Math.pow(10, token.decimals || 9),
      signature: tx.signature,
      timestamp: tx.timestamp || Date.now() / 1000,
      wallet: tx.wallet
    }
  }

  // Sell: token in → SOL out
  if (nativeOutput && tokenInputs.length > 0) {
    const solAmount = parseFloat(nativeOutput) / 1e9
    const token = tokenInputs[0]
    return {
      type: 'sell',
      solAmount,
      tokenAddress: token.rawTokenAddress || token.mint,
      tokenSymbol: token.symbol || '?',
      tokenAmount: parseFloat(token.amount) / Math.pow(10, token.decimals || 9),
      signature: tx.signature,
      timestamp: tx.timestamp || Date.now() / 1000,
      wallet: tx.wallet
    }
  }

  // Token-to-token swap (could be routing)
  if (tokenInputs.length > 0 && tokenOutputs.length > 0) {
    const inputToken = tokenInputs[0]
    const outputToken = tokenOutputs[0]
    // If output is a new token (not SOL, not stable), it's a buy
    if (outputToken.rawTokenAddress && outputToken.rawTokenAddress !== inputToken.rawTokenAddress) {
      return {
        type: 'swap',
        fromToken: inputToken.symbol || '?',
        toToken: outputToken.symbol || '?',
        tokenAddress: outputToken.rawTokenAddress || outputToken.mint,
        tokenSymbol: outputToken.symbol || '?',
        signature: tx.signature,
        timestamp: tx.timestamp || Date.now() / 1000,
        wallet: tx.wallet
      }
    }
  }

  return null
}

// ─── DEXSCREENER — GET TOKEN INFO + MCAP ──────────────────────

async function getTokenInfo(tokenAddress) {
  try {
    const resp = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { timeout: 10000 }
    )
    if (resp.status !== 200) return null
    const data = await resp.json()
    const pairs = data.pairs || []
    if (pairs.length === 0) return null

    const pair = pairs[0] // most liquid pair
    return {
      symbol: pair.baseToken?.symbol || '?',
      name: pair.baseToken?.name || '?',
      price: parseFloat(pair.priceUsd || 0),
      marketCap: parseFloat(pair.fdv || pair.marketCap || 0),
      liquidity: parseFloat(pair.liquidity?.usd || 0),
      volume24h: parseFloat(pair.volume?.h24 || 0),
      priceChange24h: parseFloat(pair.priceChange?.h24 || 0),
      dex: pair.dexId || '?',
      pairAddress: pair.pairAddress || '',
      url: pair.url || `https://dexscreener.com/solana/${tokenAddress}`
    }
  } catch (e) {
    return null
  }
}

// ─── POLLING LOOP ─────────────────────────────────────────────

let polling = false
let pollTimer = null
let lastSignatureByWallet = {}

/**
 * Start polling loop
 * @param {object} opts - { apiKey, onBuy, onSell, sendWA }
 */
function startPolling(opts) {
  if (polling) return
  polling = true

  const settings = loadSettings()
  const interval = (settings.pollInterval || 30) * 1000

  console.log(`[WHALE] Polling started — interval ${interval / 1000}s`)

  async function poll() {
    if (!polling) return

    const wallets = loadWallets()
    if (wallets.length === 0) {
      pollTimer = setTimeout(poll, interval)
      return
    }

    const apiKey = opts.apiKey
    if (!apiKey) {
      console.error('[WHALE] No Helius API key — skipping poll')
      pollTimer = setTimeout(poll, interval)
      return
    }

    // Process wallets in batches of 10 (avoid rate limit)
    const batchSize = 10
    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, i + batchSize)

      await Promise.all(batch.map(async (wallet) => {
        try {
          const lastSig = lastSignatureByWallet[wallet.address]
          const txs = await getRecentTx(wallet.address, apiKey, lastSig)

          for (const tx of txs) {
            const swap = detectSwap(tx)
            if (!swap) {
              markTxSeen(tx.signature, { wallet: wallet.address, type: 'non-swap' })
              continue
            }

            // Update last signature
            if (!lastSignatureByWallet[wallet.address] || tx.timestamp > (lastSignatureByWallet[wallet.address + '_ts'] || 0)) {
              lastSignatureByWallet[wallet.address] = tx.signature
              lastSignatureByWallet[wallet.address + '_ts'] = tx.timestamp
            }

            markTxSeen(tx.signature, { wallet: wallet.address, type: swap.type, token: swap.tokenAddress })

            // Get token info + MCAP filter
            const tokenInfo = await getTokenInfo(swap.tokenAddress)
            const mcap = tokenInfo?.marketCap || 0
            const settings2 = loadSettings()

            if (swap.type === 'buy' || swap.type === 'swap') {
              // Filter: MCAP < $50K
              if (mcap > settings2.maxMCAP) {
                // Skip — MCAP too high
                return
              }
              // Filter: min whale buy amount
              if (swap.solAmount && swap.solAmount < settings2.minWhaleBuy) {
                return
              }

              // Trigger onBuy callback
              if (opts.onBuy) {
                await opts.onBuy({
                  ...swap,
                  tokenInfo,
                  wallet: wallet.address,
                  walletLabel: wallet.label
                })
              }
            } else if (swap.type === 'sell') {
              // Trigger onSell callback
              if (opts.onSell) {
                await opts.onSell({
                  ...swap,
                  tokenInfo,
                  wallet: wallet.address,
                  walletLabel: wallet.label
                })
              }
            }
          }
        } catch (e) {
          console.error(`[WHALE] Error polling ${wallet.address}:`, e.message)
        }
      }))

      // Small delay between batches
      await new Promise(r => setTimeout(r, 1000))
    }

    // Schedule next poll
    if (polling) {
      pollTimer = setTimeout(poll, interval)
    }
  }

  poll()
}

function stopPolling() {
  polling = false
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  console.log('[WHALE] Polling stopped')
}

function isPolling() {
  return polling
}

// ─── AUTO-BUY VIA JUPITER API ─────────────────────────────────

/**
 * Build swap transaction via Jupiter Aggregator API
 * @param {string} inputMint - SOL mint address
 * @param {string} outputMint - token mint address
 * @param {number} amount - amount in SOL (lamports)
 * @param {string} userPublicKey - wallet public key
 * @returns {object} serialized transaction
 */
async function buildBuyTx(inputMint, outputMint, amountLamports, userPublicKey) {
  try {
    // Jupiter Quote API
    const quoteResp = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=500&swapMode=ExactIn`
    )
    const quote = await quoteResp.json()
    if (!quote || quote.error) {
      return { success: false, msg: 'Jupiter quote failed: ' + (quote?.error || 'unknown') }
    }

    // Get swap transaction
    const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true
      })
    })
    const swapData = await swapResp.json()
    if (!swapData || swapData.error) {
      return { success: false, msg: 'Jupiter swap build failed: ' + (swapData?.error || 'unknown') }
    }

    return {
      success: true,
      tx: swapData.swapTransaction,
      outAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct
    }
  } catch (e) {
    return { success: false, msg: 'Jupiter API error: ' + e.message }
  }
}

/**
 * Build sell transaction via Jupiter
 */
async function buildSellTx(inputMint, outputMint, tokenAmount, userPublicKey) {
  try {
    const quoteResp = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${tokenAmount}&slippageBps=1000&swapMode=ExactIn`
    )
    const quote = await quoteResp.json()
    if (!quote || quote.error) {
      return { success: false, msg: 'Jupiter quote failed: ' + (quote?.error || 'unknown') }
    }

    const swapResp = await fetch('https://quote-api.jup.ag/v6/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true
      })
    })
    const swapData = await swapResp.json()
    if (!swapData || swapData.error) {
      return { success: false, msg: 'Jupiter swap build failed: ' + (swapData?.error || 'unknown') }
    }

    return {
      success: true,
      tx: swapData.swapTransaction,
      outAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct
    }
  } catch (e) {
    return { success: false, msg: 'Jupiter API error: ' + e.message }
  }
}

// ─── WALLET STATE (track what we hold) ────────────────────────

const HOLDINGS_FILE = path.join(DATA_DIR, 'whale-holdings.json')

function loadHoldings() {
  try {
    return JSON.parse(fs.readFileSync(HOLDINGS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveHoldings(holdings) {
  fs.writeFileSync(HOLDINGS_FILE, JSON.stringify(holdings, null, 2))
}

function addHolding(tokenAddress, buyTx, amount, solSpent) {
  const holdings = loadHoldings()
  holdings[tokenAddress] = {
    tokenAddress,
    buyTx,
    amount,
    solSpent,
    buyTime: Date.now(),
    status: 'holding'
  }
  saveHoldings(holdings)
}

function removeHolding(tokenAddress, sellTx, solReceived, pnl) {
  const holdings = loadHoldings()
  if (holdings[tokenAddress]) {
    holdings[tokenAddress].status = 'sold'
    holdings[tokenAddress].sellTx = sellTx
    holdings[tokenAddress].solReceived = solReceived
    holdings[tokenAddress].pnl = pnl
    holdings[tokenAddress].sellTime = Date.now()
  }
  saveHoldings(holdings)
}

function getHolding(tokenAddress) {
  const holdings = loadHoldings()
  return holdings[tokenAddress] || null
}

function getActiveHoldings() {
  const holdings = loadHoldings()
  return Object.values(holdings).filter(h => h.status === 'holding')
}

// ─── EXPORTS ──────────────────────────────────────────────────

module.exports = {
  // Wallet management
  loadWallets, saveWallets, addWallet, removeWallet, listWallets,
  // Settings
  loadSettings, saveSettings, updateSetting,
  // Polling
  startPolling, stopPolling, isPolling,
  // Parse
  detectSwap, getRecentTx, getTokenInfo,
  // Jupiter swap
  buildBuyTx, buildSellTx,
  // Holdings
  loadHoldings, saveHoldings, addHolding, removeHolding, getHolding, getActiveHoldings,
  // Seen tx
  isTxSeen, markTxSeen,
  // Constants
  WALLETS_FILE, SETTINGS_FILE, HOLDINGS_FILE,
  SOL_MINT: 'So11111111111111111111111111111111111111112'
}
