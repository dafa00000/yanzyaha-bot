'use strict'
/**
 * whale-signer.cjs — Sign & send Solana transactions via @solana/web3.js
 *
 * Functions:
 *   - signAndSendTx(base64Tx, privateKey) — sign + send raw tx from Jupiter API
 *   - getWalletBalance(publicKey) — cek SOL balance
 *   - getTokenBalance(wallet, tokenMint) — cek token balance
 *   - sendSol(toAddress, amount) — transfer SOL
 */

const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} = require('@solana/web3.js')
const bs58 = require('bs58')

const HELIUS_URL = 'https://mainnet.helius-rpc.com/?api-key=0218e26d-9bcf-4fec-a684-97c89aea09e3'

// ─── CONNECTION ───────────────────────────────────────────────

let _conn = null
function getConnection() {
  if (!_conn) {
    _conn = new Connection(HELIUS_URL, 'confirmed')
  }
  return _conn
}

// ─── KEYPAIR FROM PRIVATE KEY ─────────────────────────────────

/**
 * Create Keypair from base58 private key
 * @param {string} privateKey58 - base58 encoded private key (56 or 88 chars)
 * @returns {Keypair}
 */
function keypairFromSecret(privateKey58) {
  try {
    const decoded = bs58.decode(privateKey58)
    return Keypair.fromSecretKey(decoded)
  } catch (e) {
    // Maybe it's a byte array JSON format
    try {
      const parsed = JSON.parse(privateKey58)
      if (Array.isArray(parsed)) {
        return Keypair.fromSecretKey(Uint8Array.from(parsed))
      }
    } catch (e2) {}
    throw new Error('Invalid private key format. Use base58 or byte array JSON.')
  }
}

// ─── SIGN & SEND TRANSACTION ──────────────────────────────────

/**
 * Sign and send a base64-encoded transaction from Jupiter API
 * @param {string} base64Tx - base64 encoded serialized transaction
 * @param {string} privateKey58 - base58 private key
 * @returns {Promise<{success, signature?, error?}>}
 */
async function signAndSendTx(base64Tx, privateKey58) {
  try {
    const conn = getConnection()
    const keypair = keypairFromSecret(privateKey58)

    // Decode base64 transaction
    const txBuffer = Buffer.from(base64Tx, 'base64')

    // Try VersionedTransaction first (Jupiter v6 returns versioned)
    let tx
    try {
      tx = VersionedTransaction.deserialize(txBuffer)
      // Sign with keypair
      tx.sign([keypair])
    } catch (e) {
      // Fallback to legacy Transaction
      tx = Transaction.from(txBuffer)
      tx.sign(keypair)
    }

    // Send transaction
    const signature = await conn.sendRawTransaction(
      tx.serialize(),
      { skipPreflight: false, maxRetries: 3 }
    )

    // Confirm transaction
    await conn.confirmTransaction(signature, 'confirmed')

    return {
      success: true,
      signature,
      explorer: `https://solscan.io/tx/${signature}`
    }
  } catch (e) {
    console.error('[WHALE-SIGNER] Error:', e.message)
    return {
      success: false,
      error: e.message
    }
  }
}

/**
 * Sign and send — with confirmation polling (more robust)
 */
async function signAndSendConfirmed(base64Tx, privateKey58, timeoutMs = 30000) {
  try {
    const conn = getConnection()
    const keypair = keypairFromSecret(privateKey58)

    const txBuffer = Buffer.from(base64Tx, 'base64')

    let tx
    try {
      tx = VersionedTransaction.deserialize(txBuffer)
      tx.sign([keypair])
    } catch (e) {
      tx = Transaction.from(txBuffer)
      tx.sign(keypair)
    }

    const rawTx = tx.serialize()

    // Send with maxRetries
    const signature = await conn.sendRawTransaction(rawTx, {
      skipPreflight: false,
      maxRetries: 5,
      preflightCommitment: 'confirmed'
    })

    // Poll for confirmation
    const start = Date.now()
    let confirmed = false
    while (Date.now() - start < timeoutMs) {
      const status = await conn.getSignatureStatus(signature)
      if (status?.value?.confirmationStatus === 'confirmed' ||
          status?.value?.confirmationStatus === 'finalized') {
        confirmed = true
        break
      }
      if (status?.value?.err) {
        throw new Error('Transaction failed: ' + JSON.stringify(status.value.err))
      }
      await new Promise(r => setTimeout(r, 2000))
    }

    if (!confirmed) {
      return {
        success: false,
        error: 'Transaction sent but not confirmed within timeout. Check manually.',
        signature,
        explorer: `https://solscan.io/tx/${signature}`
      }
    }

    return {
      success: true,
      signature,
      confirmed: true,
      explorer: `https://solscan.io/tx/${signature}`
    }
  } catch (e) {
    console.error('[WHALE-SIGNER] Error:', e.message)
    return {
      success: false,
      error: e.message
    }
  }
}

// ─── BALANCE CHECKS ───────────────────────────────────────────

/**
 * Get SOL balance of a wallet
 * @param {string} publicKey58
 * @returns {Promise<number>} SOL amount
 */
async function getWalletBalance(publicKey58) {
  try {
    const conn = getConnection()
    const pubkey = new PublicKey(publicKey58)
    const balance = await conn.getBalance(pubkey)
    return balance / LAMPORTS_PER_SOL
  } catch (e) {
    console.error('[WHALE-SIGNER] Balance error:', e.message)
    return 0
  }
}

/**
 * Get SPL token balance
 * @param {string} walletAddress
 * @param {string} tokenMint
 * @returns {Promise<{amount, decimals, uiAmount}>}
 */
async function getTokenBalance(walletAddress, tokenMint) {
  try {
    const conn = getConnection()
    const wallet = new PublicKey(walletAddress)
    const mint = new PublicKey(tokenMint)

    // Get token accounts by owner
    const resp = await conn.getParsedTokenAccountsByOwner(wallet, { mint })
    if (resp.value.length === 0) return { amount: 0, uiAmount: 0 }

    const account = resp.value[0]
    const info = account.account.data.parsed.info
    return {
      amount: info.tokenAmount.amount,
      decimals: info.tokenAmount.decimals,
      uiAmount: info.tokenAmount.uiAmount
    }
  } catch (e) {
    console.error('[WHALE-SIGNER] Token balance error:', e.message)
    return { amount: 0, uiAmount: 0 }
  }
}

// ─── TRANSFER SOL ─────────────────────────────────────────────

/**
 * Send SOL to another wallet
 * @param {string} fromPrivate
 * @param {string} toPublic
 * @param {number} solAmount
 */
async function sendSol(fromPrivate, toPublic, solAmount) {
  try {
    const conn = getConnection()
    const keypair = keypairFromSecret(fromPrivate)
    const toPubkey = new PublicKey(toPublic)

    const lamports = Math.round(solAmount * LAMPORTS_PER_SOL)
    const tx = new Transaction().add(
      require('@solana/web3.js').SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey,
        lamports
      })
    )

    const signature = await sendAndConfirmTransaction(conn, tx, [keypair])
    return {
      success: true,
      signature,
      explorer: `https://solscan.io/tx/${signature}`
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// ─── WALLET INFO ──────────────────────────────────────────────

/**
 * Get public key from private key
 */
function getPublicKey(privateKey58) {
  const keypair = keypairFromSecret(privateKey58)
  return keypair.publicKey.toBase58()
}

/**
 * Validate a private key
 */
function validatePrivateKey(privateKey58) {
  try {
    const keypair = keypairFromSecret(privateKey58)
    return {
      valid: true,
      publicKey: keypair.publicKey.toBase58()
    }
  } catch (e) {
    return { valid: false, error: e.message }
  }
}

module.exports = {
  signAndSendTx,
  signAndSendConfirmed,
  getWalletBalance,
  getTokenBalance,
  sendSol,
  getPublicKey,
  validatePrivateKey,
  getConnection,
  LAMPORTS_PER_SOL
}
