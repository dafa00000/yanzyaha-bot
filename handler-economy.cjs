'use strict'
/**
 * handler-economy.cjs
 * Sistem Economy & Points untuk YANZYAHA-BOT
 * 
 * Fitur:
 * - Point system (menang game = +poin, kalah = -poin)
 * - Daily reward
 * - Balance check (owner = unlimited ∞)
 * - Transfer antar user
 * - Shop beli item
 * - Leaderboard dengan @mention langsung
 * - Rank system (Bronze → Silver → Gold → Platinum → Diamond → Master → Grandmaster → Legend → 👑Owner)
 * - Slot, Blackjack, Roulette
 * - Trivia, Word Game, Number Guess Multiplayer
 */

const fs = require('fs')
const path = require('path')

// ─── DATA PATH ────────────────────────────────────────────────
const DATA_DIR = path.join(process.env.HERMES_HOME || '/opt/data', 'economy')
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const SHOP_FILE = path.join(DATA_DIR, 'shop.json')
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json')

// Pastikan directory ada
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

// ─── HELPERS ──────────────────────────────────────────────────
// Owner IDs - unlimited balance + full slot pity/RNG
// Include LID + phone formats used by WA
const OWNER_IDS = ['83807763972304', '110857451221063', '62895618805248']

function isOwner(sender) {
  const id = String(sender || '').replace(/@(lid|s\.whatsapp\.net)$/i, '').split(':')[0]
  return OWNER_IDS.includes(id)
}

function loadJSON(file, defaultVal = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return defaultVal
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function getUser(sender) {
  const users = loadJSON(USERS_FILE, {})
  const id = sender.replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
  if (!users[id]) {
    users[id] = {
      points: 0,
      xp: 0,
      dailyStreak: 0,
      lastDaily: null,
      wins: 0,
      losses: 0,
      totalGames: 0,
      inventory: [],
      createdAt: new Date().toISOString()
    }
    saveJSON(USERS_FILE, users)
  }
  // Migration: remove old level field if exists
  if (users[id].level !== undefined) {
    delete users[id].level
    saveJSON(USERS_FILE, users)
  }
  return users[id]
}

function saveUser(sender, userData) {
  const users = loadJSON(USERS_FILE, {})
  const id = sender.replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
  users[id] = userData
  saveJSON(USERS_FILE, users)
}

function getToday() {
  return new Date().toISOString().slice(0, 10)
}

function formatNumber(n) {
  // BigInt / digit-string / Number — support all-in rungkat
  let neg = false
  let digits
  if (typeof n === 'bigint') {
    if (n < 0n) { neg = true; n = -n }
    digits = n.toString()
  } else if (typeof n === 'string' && /^-?\d+$/.test(n.trim())) {
    digits = n.trim()
    if (digits.startsWith('-')) { neg = true; digits = digits.slice(1) }
  } else {
    const num = Number(n)
    if (!Number.isFinite(num)) return String(n)
    if (num < 0) { neg = true }
    const abs = Math.abs(num)
    if (abs < 1000) return (neg ? '-' : '') + String(Math.trunc(num))
    if (abs < 1e6) return (neg ? '-' : '') + (abs / 1e3).toFixed(1) + 'K'
    if (abs < 1e9) return (neg ? '-' : '') + (abs / 1e6).toFixed(1) + 'M'
    if (abs < 1e12) return (neg ? '-' : '') + (abs / 1e9).toFixed(1) + 'B'
    if (abs < 1e15) return (neg ? '-' : '') + (abs / 1e12).toFixed(1) + 'T'
    digits = BigInt(Math.trunc(abs)).toString()
  }
  const len = digits.length
  let out
  if (len <= 3) out = digits
  else if (len <= 6) out = (Number(digits.slice(0, len - 2)) / 100).toFixed(1) + 'K'
  else if (len <= 9) out = (Number(digits.slice(0, len - 5)) / 100).toFixed(1) + 'M'
  else if (len <= 12) out = (Number(digits.slice(0, len - 8)) / 100).toFixed(1) + 'B'
  else if (len <= 15) out = (Number(digits.slice(0, len - 11)) / 100).toFixed(1) + 'T'
  else if (len <= 18) out = (Number(digits.slice(0, len - 14)) / 100).toFixed(1) + 'Qa'
  else if (len <= 21) out = (Number(digits.slice(0, len - 17)) / 100).toFixed(1) + 'Qi'
  else out = digits.slice(0, 4) + '…e+' + String(len - 1)
  return (neg ? '-' : '') + out
}

/** Points may be number or decimal-digit string (big balances). */
function pointsToBig(p) {
  if (typeof p === 'bigint') return p >= 0n ? p : 0n
  if (typeof p === 'string' && /^-?\d+$/.test(p.trim())) {
    const b = BigInt(p.trim())
    return b >= 0n ? b : 0n
  }
  const num = Number(p)
  if (!Number.isFinite(num) || num <= 0) return 0n
  try {
    return BigInt(Math.trunc(num))
  } catch {
    return 0n
  }
}

function bigToPointsStore(b) {
  if (typeof b !== 'bigint') b = pointsToBig(b)
  if (b < 0n) b = 0n
  if (b <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(b)
  return b.toString()
}

/** Parse bet raw (string/number) → BigInt; max 36 digits, no upper economic cap. */
function parseBetBig(raw) {
  if (typeof raw === 'bigint') return raw > 0n ? raw : null
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    if (raw > Number.MAX_SAFE_INTEGER) {
      // already lost precision — reject, caller should pass string
      return null
    }
    return BigInt(Math.floor(raw))
  }
  const s = String(raw ?? '').trim().replace(/[,_\s]/g, '')
  if (!/^\d+$/.test(s)) return null
  if (s.length > 36) return null
  // strip leading zeros but keep at least one
  const cleaned = s.replace(/^0+/, '') || '0'
  if (cleaned === '0') return null
  try {
    return BigInt(cleaned)
  } catch {
    return null
  }
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ─── RANK SYSTEM ──────────────────────────────────────────────
// XP-based ranks with progress percentage
const RANKS = [
  { name: 'Bronze',      emoji: '🥉', minXp: 0,          color: '' },
  { name: 'Silver',      emoji: '🥈', minXp: 500,        color: '' },
  { name: 'Gold',        emoji: '🥇', minXp: 2000,       color: '' },
  { name: 'Platinum',    emoji: '💎', minXp: 5000,       color: '' },
  { name: 'Diamond',     emoji: '💠', minXp: 12000,      color: '' },
  { name: 'Master',      emoji: '🔥', minXp: 25000,      color: '' },
  { name: 'Grandmaster', emoji: '⭐', minXp: 50000,      color: '' },
  { name: 'Legend',      emoji: '🌟', minXp: 100000,     color: '' },
  { name: 'God',         emoji: '🔱', minXp: 2000000,    color: '' },
]

function getRank(sender) {
  // Owner always gets highest rank
  if (isOwner(sender)) {
    return {
      name: 'Owner',
      emoji: '👑',
      index: RANKS.length,
      progress: 100,
      xp: Infinity,
      minXp: Infinity,
      nextXp: Infinity,
      label: '👑 Owner'
    }
  }

  const user = getUser(sender)
  const xp = user.xp || 0

  // Find current rank (highest where xp >= minXp)
  let currentRank = RANKS[0]
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (xp >= RANKS[i].minXp) {
      currentRank = RANKS[i]
      break
    }
  }

  const currentIndex = RANKS.indexOf(currentRank)
  const isMaxRank = currentIndex === RANKS.length - 1

  // Calculate progress to next rank
  let progress = 100
  let nextXp = currentRank.minXp
  if (!isMaxRank) {
    const nextRank = RANKS[currentIndex + 1]
    const xpInCurrentRank = xp - currentRank.minXp
    const xpNeeded = nextRank.minXp - currentRank.minXp
    progress = Math.min(100, Math.floor((xpInCurrentRank / xpNeeded) * 100))
    nextXp = nextRank.minXp
  }

  return {
    name: currentRank.name,
    emoji: currentRank.emoji,
    index: currentIndex,
    progress,
    xp,
    minXp: currentRank.minXp,
    nextXp,
    label: `${currentRank.emoji} ${currentRank.name}`
  }
}

function formatProgressBar(percent, length = 10) {
  const filled = Math.round((percent / 100) * length)
  const empty = length - filled
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percent}%`
}

// ─── POINT SYSTEM ─────────────────────────────────────────────
function addPoints(sender, amount) {
  const user = getUser(sender)
  const delta = pointsToBig(amount)
  const next = pointsToBig(user.points) + delta
  user.points = bigToPointsStore(next)
  // xp stays number-ish; cap abs for xp to safe int
  const xpAdd = delta < 0n ? -delta : delta
  const xpN = xpAdd > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(xpAdd)
  user.xp = (Number(user.xp) || 0) + Math.abs(xpN)
  saveUser(sender, user)
  return user
}

function removePoints(sender, amount) {
  if (isOwner(sender)) return getUser(sender) // Owner unlimited
  const user = getUser(sender)
  const cur = pointsToBig(user.points)
  const delta = pointsToBig(amount)
  const next = cur > delta ? cur - delta : 0n
  user.points = bigToPointsStore(next)
  saveUser(sender, user)
  return user
}

function getBalance(sender) {
  if (isOwner(sender)) return '∞' // Owner unlimited
  const user = getUser(sender)
  return user.points
}

// ─── DAILY REWARD ─────────────────────────────────────────────
function claimDaily(sender) {
  const user = getUser(sender)
  const today = getToday()
  
  if (user.lastDaily === today) {
    return { success: false, message: 'Udah ambil daily hari ini! Coba besok ya 😊' }
  }
  
  // Cek streak (harus consecutive days)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)
  
  if (user.lastDaily === yesterdayStr) {
    user.dailyStreak++
  } else {
    user.dailyStreak = 1
  }
  
  // Base reward + streak bonus
  const baseReward = 100
  const streakBonus = Math.min(user.dailyStreak * 10, 100) // Max +100 dari streak
  const totalReward = baseReward + streakBonus
  
  user.points += totalReward
  user.lastDaily = today
  saveUser(sender, user)
  
  return {
    success: true,
    reward: totalReward,
    streak: user.dailyStreak,
    balance: user.points,
    message: `🎁 *Daily Reward!*\n\n` +
      `💰 +${totalReward} poin\n` +
      `🔥 Streak: ${user.dailyStreak} hari\n` +
      `💎 Saldo: ${formatNumber(user.points)} poin\n\n` +
      `Makin sering login, makin gede bonusnya!`
  }
}

// ─── TRANSFER ─────────────────────────────────────────────────
function transfer(from, to, amount) {
  if (amount <= 0) return { success: false, message: 'Jumlah harus lebih dari 0!' }
  
  // Owner ga perlu cek saldo (unlimited)
  if (!isOwner(from)) {
    const fromUser = getUser(from)
    if (fromUser.points < amount) {
      return { success: false, message: `Saldo lo kurang! 💰 ${formatNumber(fromUser.points)} poin` }
    }
  }
  
  // Owner ga dikurangi saldonya
  if (!isOwner(from)) {
    removePoints(from, amount)
  }
  addPoints(to, amount)
  
  return {
    success: true,
    message: `✅ Transfer berhasil!\n\n💸 -${formatNumber(amount)} poin\n💰 Saldo lo: ${formatNumber(getBalance(from))} poin`
  }
}

// ─── SHOP ─────────────────────────────────────────────────────
// Free spin MAHJONG: harga skalable vs bet (bukan fixed slot pack)
// cost/spin ≈ bet × rate (rate turun kalau beli banyak) — kayak beli fitur judi
const MJ_FS_MIN_BET = 10
// No max bet — biar bisa all-in / rungkat (JS safe int ~9e15)
const MJ_FS_MAX_QTY = 20
const MJ_FS_AUTO_MAX = 20 // auto habiskan max 20 FS / command

const DEFAULT_SHOP = [
  {
    id: 'mjfs',
    name: '🀄 Free Spin Mahjong',
    desc: 'Beli FS mahjong · harga = qty × bet × rate · pakai `.mjfs [bet] [qty]`',
    price: 0, // dynamic — jangan .buy polos
    emoji: '🀄',
    dynamic: true,
  },
  { id: 'shield', name: '🛡️ Shield', desc: 'Protect dari kalah -1 game', price: 500, emoji: '🛡️' },
  { id: 'double', name: '⚡ Double XP', desc: 'XP 2x lipat selama 1 jam', price: 300, emoji: '⚡' },
  { id: 'luck', name: '🍀 Lucky Charm', desc: '+20% chance menang', price: 750, emoji: '🍀' },
  { id: 'badge', name: '🏅 VIP Badge', desc: 'Badge VIP di profile', price: 1000, emoji: '🏅' },
  { id: 'crown', name: '👑 Crown', desc: 'Crown emoji di nama', price: 2000, emoji: '👑' },
]

function getShop() {
  // Merge DEFAULT_SHOP by id so new items appear even if shop.json stale
  const saved = loadJSON(SHOP_FILE, null)
  if (!saved || !Array.isArray(saved) || saved.length === 0) return DEFAULT_SHOP
  const byId = new Map(saved.map(i => [i.id, i]))
  for (const d of DEFAULT_SHOP) {
    if (!byId.has(d.id)) byId.set(d.id, d)
  }
  // Drop legacy fixed slot free-spin packs from stale shop.json
  for (const legacy of ['freespin', 'freespin5', 'freespin10']) byId.delete(legacy)
  const ordered = []
  const seen = new Set()
  for (const d of DEFAULT_SHOP) {
    ordered.push(byId.get(d.id) || d)
    seen.add(d.id)
  }
  for (const [id, item] of byId) {
    if (!seen.has(id)) ordered.push(item)
  }
  return ordered
}

// Item aliases - biar user bisa pakai nama panjang
const ITEM_ALIASES = {
  'shield': 'shield',
  'double': 'double',
  'xp': 'double',
  'double xp': 'double',
  'luck': 'luck',
  'lucky': 'luck',
  'charm': 'luck',
  'lucky charm': 'luck',
  'badge': 'badge',
  'vip': 'badge',
  'vip badge': 'badge',
  'crown': 'crown',
  'mjfs': 'mjfs',
  'mahjongfs': 'mjfs',
  'freespin': 'mjfs',
  'free spin': 'mjfs',
  'free spins': 'mjfs',
  'fs': 'mjfs',
  'spin': 'mjfs',
  'freespins': 'mjfs',
}

function findItem(query) {
  const shop = getShop()
  const q = query.toLowerCase().trim()
  
  // Exact ID match
  let item = shop.find(i => i.id === q)
  if (item) return item
  
  // Alias match
  const aliasId = ITEM_ALIASES[q]
  if (aliasId) {
    item = shop.find(i => i.id === aliasId)
    if (item) return item
  }
  
  // Partial match (name contains)
  item = shop.find(i => i.name.toLowerCase().includes(q))
  if (item) return item
  
  return null
}

/** Rate harga per free spin (× bet). Bulk lebih murah — house edge tetap. */
function mjFsRate(qty, ownerMode) {
  if (ownerMode) return 0.5
  const q = Math.max(1, qty)
  if (q >= 25) return 1.40
  if (q >= 10) return 1.50
  if (q >= 5) return 1.65
  return 1.80
}

/** cost = ceil(bet * qty * rate) via BigInt (rate in basis points /100) */
function calcMjFsCostBig(betBig, qty, ownerMode) {
  const rate = mjFsRate(qty, ownerMode)
  const bp = BigInt(Math.round(rate * 100)) // 150 = 1.50x
  const q = BigInt(Math.max(1, qty))
  // ceil(bet * q * bp / 100) = (bet * q * bp + 99) / 100
  return (betBig * q * bp + 99n) / 100n
}

function calcMjFsCost(bet, qty, ownerMode) {
  const b = parseBetBig(bet)
  if (!b) return 0
  const c = calcMjFsCostBig(b, qty, ownerMode)
  return c <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(c) : c.toString()
}

function ensureMjFs(user) {
  if (!Array.isArray(user.mjFs)) user.mjFs = []
  // migrate legacy slot freeSpins → mahjong FS @bet 100
  const legacy = Math.max(0, Number(user.freeSpins) || 0)
  if (legacy > 0) {
    user.mjFs.push({ bet: '100', n: legacy })
    user.freeSpins = 0
  }
  // compact invalid — keep bet as string digits for big bets
  user.mjFs = user.mjFs
    .map(s => {
      const b = parseBetBig(s.bet)
      const n = Math.floor(Number(s.n) || 0)
      if (!b || n <= 0) return null
      return { bet: b.toString(), n }
    })
    .filter(Boolean)
  return user.mjFs
}

function getMjFsTotal(sender) {
  const user = getUser(sender)
  const stacks = ensureMjFs(user)
  const total = stacks.reduce((a, s) => a + s.n, 0)
  return { total, stacks }
}

function formatMjFsStacks(stacks) {
  if (!stacks.length) return '_kosong_'
  return stacks.map(s => `• ${s.n}× @ bet ${formatNumber(s.bet)}`).join('\n')
}

/**
 * Beli free spin mahjong — harga tergantung bet (BigInt, tanpa batas).
 * .mjfs [bet] [qty]  — pass bet as string for huge values
 */
function buyMahjongFreeSpins(sender, betRaw, qtyRaw) {
  const ownerMode = isOwner(sender)
  const betBig = parseBetBig(betRaw)
  let qty = Math.floor(Number(qtyRaw) || 0)

  if (!betBig || betBig < BigInt(MJ_FS_MIN_BET)) {
    return {
      success: false,
      message:
        `🀄 *BELI FREE SPIN MAHJONG*\n\n` +
        `Format: \`.mjfs [bet] [qty]\`\n` +
        `Contoh: \`.mjfs 100 10\` → 10 FS @bet 100\n` +
        `Contoh: \`.mjfs 10000000000000000000 20\` → all-in gila\n\n` +
        `Harga/spin ≈ bet × rate (1.40–1.80×, bulk lebih murah)\n` +
        `Min bet ${MJ_FS_MIN_BET} · max qty ${MJ_FS_MAX_QTY} · **bet tanpa batas**\n` +
        `Pakai auto: \`.mj free\` / \`.mahjong free\``
    }
  }
  if (!qty || qty < 1) {
    return { success: false, message: 'Qty minimal 1. Contoh: `.mjfs 100 10`' }
  }
  if (qty > MJ_FS_MAX_QTY) {
    return { success: false, message: `Qty maksimal ${MJ_FS_MAX_QTY} per beli` }
  }

  const rate = mjFsRate(qty, ownerMode)
  const costBig = calcMjFsCostBig(betBig, qty, ownerMode)
  const user = getUser(sender)
  ensureMjFs(user)

  if (!ownerMode) {
    const bal = pointsToBig(user.points)
    if (bal < costBig) {
      return {
        success: false,
        message:
          `Saldo kurang!\n` +
          `Butuh *${formatNumber(costBig)}* poin (${qty} FS × bet ${formatNumber(betBig)} × ${rate.toFixed(2)})\n` +
          `💰 Saldo: ${formatNumber(user.points)} poin`
      }
    }
    user.points = bigToPointsStore(bal - costBig)
  }

  const betKey = betBig.toString()
  // merge stack same bet
  const same = user.mjFs.find(s => String(s.bet) === betKey)
  if (same) same.n += qty
  else user.mjFs.push({ bet: betKey, n: qty })
  saveUser(sender, user)

  const { total, stacks } = getMjFsTotal(sender)
  return {
    success: true,
    bet: betKey,
    qty,
    cost: costBig <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(costBig) : costBig.toString(),
    rate,
    freeSpins: total,
    message:
      `🀄 *FREE SPIN MAHJONG DIBELI*\n\n` +
      `+${qty} FS @ bet *${formatNumber(betBig)}*\n` +
      `Rate: *${rate.toFixed(2)}x* bet/spin\n` +
      (ownerMode ? `💰 Cost: owner 0.5x · *${formatNumber(costBig)}* (unlimited)\n` : `💰 Bayar: -${formatNumber(costBig)} poin\n`) +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin\n\n` +
      `📦 Stack:\n${formatMjFsStacks(stacks)}\n` +
      `Total FS: *${total}*\n\n` +
      `▶ Auto sampai habis: \`.mj free\``
  }
}

function freeSpinStatus(sender) {
  const user = getUser(sender)
  ensureMjFs(user)
  saveUser(sender, user) // persist migration
  const { total, stacks } = getMjFsTotal(sender)
  const ex100 = calcMjFsCost(100, 10, isOwner(sender))
  const ex500 = calcMjFsCost(500, 10, isOwner(sender))
  return {
    success: true,
    freeSpins: total,
    stacks,
    message:
      `🀄 *FREE SPIN MAHJONG*\n\n` +
      `Total: *${total}* spin\n` +
      `Stack:\n${formatMjFsStacks(stacks)}\n\n` +
      `Beli (harga ikut bet, **tanpa batas**):\n` +
      `• \`.mjfs 100 10\` → ~${formatNumber(ex100)} poin\n` +
      `• \`.mjfs 500 10\` → ~${formatNumber(ex500)} poin\n` +
      `• \`.mjfs [bet] [qty]\` (max qty ${MJ_FS_MAX_QTY})\n\n` +
      `Main auto: \`.mj free\` / \`.mahjong auto\``
  }
}

// legacy helpers (slot FS diganti mahjong)
const FREE_SPIN_BET = 100
function getFreeSpins(sender) {
  return getMjFsTotal(sender).total
}

function buyItem(sender, itemQuery, quantity = 1) {
  const user = getUser(sender)
  const item = findItem(itemQuery)
  
  if (!item) return { success: false, message: `Item "${itemQuery}" ga ada di shop!\n\nKetik .shop buat liat daftar item` }
  
  quantity = Math.max(1, Math.min(100, Number(quantity) || 1))

  // Dynamic mahjong FS — butuh bet, arahkan ke .mjfs
  if (item.id === 'mjfs' || item.dynamic) {
    return {
      success: false,
      message:
        `🀄 Free spin mahjong harganya *ikut bet*.\n\n` +
        `Pakai: \`.mjfs [bet] [qty]\`\n` +
        `Contoh: \`.mjfs 100 10\`\n` +
        `Contoh: \`.mjfs 500 5\`\n\n` +
        `Cek: \`.freespin\``
    }
  }

  // Owner unlimited, skip price check
  if (!isOwner(sender)) {
    const totalCost = item.price * quantity
    if (user.points < totalCost) {
      return { success: false, message: `Saldo kurang! Butuh ${formatNumber(totalCost)} poin (${quantity}x ${item.name})` }
    }
  }

  // Buy multiple cosmetic / buff items
  for (let i = 0; i < quantity; i++) {
    if (!isOwner(sender)) {
      user.points -= item.price
    }
    if (!Array.isArray(user.inventory)) user.inventory = []
    user.inventory.push({ id: item.id, name: item.name, boughtAt: new Date().toISOString() })
  }
  saveUser(sender, user)
  
  return {
    success: true,
    item: item,
    quantity: quantity,
    message: `${item.emoji} *${item.name}* x${quantity} berhasil dibeli!\n\n💰 Sisa saldo: ${formatNumber(getBalance(sender))} poin`
  }
}

// ─── LEADERBOARD ──────────────────────────────────────────────
function getLeaderboard(limit = 10) {
  const users = loadJSON(USERS_FILE, {})
  const sorted = Object.entries(users)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit)
  
  return sorted
}

function formatLeaderboard(lb) {
  if (lb.length === 0) return { text: 'Belum ada data leaderboard!', mentions: [] }
  
  const medals = ['🥇', '🥈', '🥉']
  let text = '🏆 *LEADERBOARD*\n\n'
  const mentions = []
  
  lb.forEach((user, i) => {
    const medal = medals[i] || `${i + 1}.`
    const jid = user.id.includes('@') ? user.id : user.id + '@s.whatsapp.net'
    mentions.push(jid)
    
    // Get rank for this user — filter owner tier from display
    const rank = getRank(jid)
    const isOwnerUser = isOwner(jid)
    const displayRank = isOwnerUser
      ? '🔱 God'
      : `${rank.emoji} ${rank.name}`
    const progress = formatProgressBar(isOwnerUser ? 100 : rank.progress, 5)
    
    text += `${medal} @${user.id}\n`
    text += `   💰 ${formatNumber(user.points)} poin\n`
    text += `   ${displayRank} ${progress}\n\n`
  })
  
  text += `_Ketik .balance buat cek saldo lo_`
  return { text, mentions }
}

// ─── SLOT MACHINE ─────────────────────────────────────────────
/**
 * Slot dual economy:
 * - OWNER: ~99.999% win 2x–10x; GRAND POT 1000x guaranteed max every 10 spins
 * - PUBLIC: heavy house edge (low drop + low mult)
 */
/**
 * @param {string} sender
 * @param {number} bet
 * @param {{ useFree?: boolean }} [opts]
 */
function playSlot(sender, bet, opts = {}) {
  const user = getUser(sender)
  const useFree = !!(opts && opts.useFree)

  if (useFree) {
    const fsLeft = Number(user.freeSpins) || 0
    if (fsLeft < 1) {
      return {
        success: false,
        message:
          'Ga punya free spin!\n\n' +
          'Beli: `.buy freespin` / `.buy fs5` / `.buy fs10`\n' +
          'Cek: `.freespin`'
      }
    }
    bet = FREE_SPIN_BET
  } else {
    if (bet <= 0) return { success: false, message: 'Bet harus lebih dari 0! Atau `.slot free` kalau punya free spin' }
    if (user.points < bet) {
      const fsLeft = Number(user.freeSpins) || 0
      const hint = fsLeft > 0 ? `\n\nLo punya *${fsLeft}* free spin → ketik \`.slot free\`` : ''
      return { success: false, message: `Saldo kurang! 💰 ${formatNumber(user.points)} poin${hint}` }
    }
  }

  const ownerMode = isOwner(sender)
  user.slotSpins = (user.slotSpins || 0) + 1
  const spinCount = user.slotSpins

  let s1, s2, s3
  let multiplier = 0
  let result = ''
  let pityJackpot = false
  let pityMega = false
  let pityGrand = false

  if (ownerMode) {
    // ── OWNER ────────────────────────────────────────────────
    // Pity: max 10 spin → GRAND POT 1000x (guaranteed)
    // Antara pity: ~99.999% menang, mult 2x–10x (drop rate tinggi di tier bawah)
    const pool = ['🍒', '🍋', '🍊', '7️⃣', '⭐', '💎', '🌟']
    pityGrand = spinCount % 10 === 0

    const pickOwnerMult = () => {
      const r = Math.random() * 100
      if (r < 35) return 2
      if (r < 60) return 3
      if (r < 75) return 4
      if (r < 85) return 5
      if (r < 91) return 6
      if (r < 95) return 7
      if (r < 98) return 8
      if (r < 99.5) return 9
      return 10
    }

    if (pityGrand) {
      multiplier = 1000
      s1 = s2 = s3 = '💎'
      result = '🏆 *GRAND POT! (1000x)*'
      user.slotSpins = 0
    } else {
      const loseRoll = getRandomInt(1, 100000)
      const win = loseRoll < 99999 // 99.999%
      if (win) {
        multiplier = pickOwnerMult()
        const base = pool[getRandomInt(0, pool.length - 1)]
        if (multiplier >= 8) {
          s1 = s2 = s3 = base
          result = `🎉 *JACKPOT! (${multiplier}x)*`
        } else if (multiplier >= 5) {
          s1 = base
          s2 = base
          s3 = pool[getRandomInt(0, pool.length - 1)]
          result = `✨ *BIG WIN! (${multiplier}x)*`
        } else {
          s1 = base
          s2 = base
          s3 = pool[getRandomInt(0, pool.length - 1)]
          result = `✨ *WIN! (${multiplier}x)*`
        }
      } else {
        s1 = pool[0]
        s2 = pool[1]
        s3 = pool[2]
        multiplier = 0
        result = '😢 *Kalah!* (rng 0.001%)'
      }
    }
  } else {
    // ── PUBLIC: heavy house edge ──────────────────────────────
    // More symbols = harder matches; most pair hits are discarded
    const symbols = ['🍒', '🍋', '🍊', '7️⃣', '🍇', '🔔', '🥝', '🍉', '🍍', '⭐', '🌟', '🍀']
    const wildSymbols = ['⭐']
    s1 = symbols[getRandomInt(0, symbols.length - 1)]
    s2 = symbols[getRandomInt(0, symbols.length - 1)]
    s3 = symbols[getRandomInt(0, symbols.length - 1)]

    const wildCount = [s1, s2, s3].filter(s => wildSymbols.includes(s)).length
    const nonWild = [s1, s2, s3].filter(s => !wildSymbols.includes(s))
    const allSame = nonWild.length > 0 && nonWild.every(s => s === nonWild[0])
    const twoSame = nonWild.length >= 2 && (
      nonWild[0] === nonWild[1] ||
      (nonWild.length === 3 && (nonWild[0] === nonWild[1] || nonWild[1] === nonWild[2] || nonWild[0] === nonWild[2]))
    )

    // Pity almost off for public
    pityJackpot = spinCount % 100 === 0
    pityMega = spinCount % 300 === 0
    pityGrand = spinCount % 600 === 0

    // Low multipliers
    const M = { grand: 20, mega: 10, jack: 5, wildBoost: 2, triple: 3, pair: 2 }

    // Candidate win from board
    let cand = 0
    let candLabel = '😢 *Kalah!*'
    if (pityGrand) {
      cand = M.grand
      candLabel = `🏆 *GRAND POT! (${M.grand}x)*`
      user.slotSpins = 0
    } else if (pityMega) {
      cand = M.mega
      candLabel = `🌟 *MEGA JACKPOT! (${M.mega}x)*`
    } else if (pityJackpot) {
      cand = M.jack
      candLabel = `🎉 *JACKPOT! (${M.jack}x)*`
    } else if (allSame && nonWild.length === 3) {
      cand = M.triple
      candLabel = `🎉 *TRIPLE! (${M.triple}x)*`
    } else if (wildCount === 1 && allSame) {
      cand = M.jack
      candLabel = `🎉 *WILD TRIPLE! (${M.jack}x)*`
    } else if (wildCount === 1 && twoSame) {
      cand = M.wildBoost
      candLabel = `✨ *WILD PAIR! (${M.wildBoost}x)*`
    } else if (twoSame) {
      cand = M.pair
      candLabel = `✨ *PAIR! (${M.pair}x)*`
    }

    // pair ~8% survive, triple ~25%, wild pair ~15%, pity always pays
    let survive = 0
    if (pityGrand || pityMega || pityJackpot) {
      survive = 1
    } else if (cand === M.triple || cand === M.jack) {
      survive = Math.random() < 0.22 ? 1 : 0
    } else if (cand === M.wildBoost) {
      survive = Math.random() < 0.12 ? 1 : 0
    } else if (cand === M.pair) {
      survive = Math.random() < 0.08 ? 1 : 0
    } else {
      survive = 0
    }

    if (cand > 0 && survive) {
      multiplier = cand
      result = candLabel
    } else {
      multiplier = 0
      result = '😢 *Kalah!*'
    }
  }

  const winAmount = Math.floor(bet * multiplier)
  const spinSnap = user.slotSpins
  // Free spin: stake sudah dibayar lewat shop → credit full win, lose = 0 poin hilang
  const netOnWin = useFree ? winAmount : (winAmount - bet)

  if (multiplier > 0) {
    if (netOnWin > 0) addPoints(sender, netOnWin)
    else if (!useFree && netOnWin < 0) removePoints(sender, -netOnWin)
    const updatedUser = getUser(sender)
    updatedUser.wins = (updatedUser.wins || 0) + 1
    updatedUser.totalGames = (updatedUser.totalGames || 0) + 1
    updatedUser.slotSpins = spinSnap
    if (useFree) updatedUser.freeSpins = Math.max(0, (Number(updatedUser.freeSpins) || 0) - 1)
    saveUser(sender, updatedUser)
  } else {
    if (!useFree) removePoints(sender, bet)
    const updatedUser = getUser(sender)
    updatedUser.losses = (updatedUser.losses || 0) + 1
    updatedUser.totalGames = (updatedUser.totalGames || 0) + 1
    updatedUser.slotSpins = spinSnap
    if (useFree) updatedUser.freeSpins = Math.max(0, (Number(updatedUser.freeSpins) || 0) - 1)
    saveUser(sender, updatedUser)
  }

  const fsAfter = getFreeSpins(sender)
  const pityHint = ownerMode
    ? (pityGrand
        ? `\n👑 Owner · GRANDPOT 1000x 🏆 (reset spin)`
        : `\n👑 Owner · spin ${spinCount % 10 || 10}/10 → GRANDPOT`)
    : `\n🔄 Spin ke-${spinSnap}`
  const freeHint = useFree
    ? `\n🎁 Free spin · sisa *${fsAfter}*`
    : (fsAfter > 0 ? `\n🎁 Free spin siap: *${fsAfter}* → \`.slot free\`` : '')

  return {
    success: true,
    result,
    symbols: `${s1} | ${s2} | ${s3}`,
    bet,
    win: winAmount,
    multiplier,
    useFree,
    freeSpins: fsAfter,
    balance: getBalance(sender),
    message: `🎰 *SLOT MACHINE*${useFree ? ' · FREE SPIN' : ''}\n\n` +
      `┌─────────────┐\n` +
      `│  ${s1} │ ${s2} │ ${s3}  │\n` +
      `└─────────────┘\n\n` +
      `${result}\n` +
      (multiplier > 0
        ? `💰 Menang: +${formatNumber(useFree ? winAmount : winAmount)} poin (${multiplier}x)${useFree ? ' · stake gratis' : ''}\n`
        : (useFree
          ? `💸 Kalah: free spin hangus (0 poin)\n`
          : `💸 Kalah: -${formatNumber(bet)} poin\n`)) +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin` +
      pityHint +
      freeHint
  }
}

// ─── BLACKJACK ────────────────────────────────────────────────
function createDeck() {
  const suits = ['♠️', '♥️', '♦️', '♣️']
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
  const deck = []
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ suit, value, display: `${value}${suit}` })
    }
  }
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

function cardValue(card) {
  if (['J', 'Q', 'K'].includes(card.value)) return 10
  if (card.value === 'A') return 11
  return parseInt(card.value)
}

function handValue(hand) {
  let value = 0
  let aces = 0
  for (const card of hand) {
    value += cardValue(card)
    if (card.value === 'A') aces++
  }
  while (value > 21 && aces > 0) {
    value -= 10
    aces--
  }
  return value
}

function formatHand(hand) {
  return hand.map(c => c.display).join(' ')
}

// Game state untuk blackjack (in-memory)
const blackjackGames = new Map()

function startBlackjack(sender, bet) {
  const user = getUser(sender)
  if (bet <= 0) return { success: false, message: 'Bet harus lebih dari 0!' }
  if (user.points < bet) return { success: false, message: `Saldo kurang! 💰 ${formatNumber(user.points)} poin` }
  
  const deck = createDeck()
  const playerHand = [deck.pop(), deck.pop()]
  const dealerHand = [deck.pop(), deck.pop()]
  
  blackjackGames.set(sender, {
    deck, playerHand, dealerHand, bet,
    status: 'playing' // playing, stand, bust, blackjack
  })
  
  const playerVal = handValue(playerHand)
  const dealerVal = handValue(dealerHand)
  
  // Check natural blackjack
  if (playerVal === 21) {
    blackjackGames.delete(sender)
    const winAmount = Math.floor(bet * 2.5)
    addPoints(sender, winAmount - bet)
    user.wins++
    user.totalGames++
    saveUser(sender, user)
    
    return {
      success: true,
      status: 'blackjack',
      message: `🃏 *BLACKJACK!*\n\n` +
        `Kamu: ${formatHand(playerHand)} = ${playerVal}\n` +
        `Dealer: ${formatHand(dealerHand)} = ${dealerVal}\n\n` +
        `🎉 *BLACKJACK!* Menang +${formatNumber(winAmount)} poin!\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  }
  
  return {
    success: true,
    status: 'playing',
    message: `🃏 *BLACKJACK*\n\n` +
      `Kamu: ${formatHand(playerHand)} = ${playerVal}\n` +
      `Dealer: ${dealerHand[0].display} ❓\n\n` +
      `Bet: ${formatNumber(bet)} poin\n\n` +
      `Ketik:\n` +
      `.hit — Tambah kartu\n` +
      `.stand — Tahan\n` +
      `.double — Double bet`
  }
}

function hitBlackjack(sender) {
  const game = blackjackGames.get(sender)
  if (!game) return { success: false, message: 'Ga ada game blackjack yang aktif! Ketik .bj [bet] buat mulai' }
  
  game.playerHand.push(game.deck.pop())
  const playerVal = handValue(game.playerHand)
  
  if (playerVal > 21) {
    // Bust
    blackjackGames.delete(sender)
    removePoints(sender, game.bet)
    const user = getUser(sender)
    user.losses++
    user.totalGames++
    saveUser(sender, user)
    
    return {
      success: true,
      status: 'bust',
      message: `🃏 *BLACKJACK*\n\n` +
        `Kamu: ${formatHand(game.playerHand)} = ${playerVal}\n\n` +
        `💥 *BUST!* Kalah -${formatNumber(game.bet)} poin\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  }
  
  return {
    success: true,
    status: 'playing',
    message: `🃏 *BLACKJACK*\n\n` +
      `Kamu: ${formatHand(game.playerHand)} = ${playerVal}\n` +
      `Dealer: ${game.dealerHand[0].display} ❓\n\n` +
      `Ketik .hit atau .stand`
  }
}

function standBlackjack(sender) {
  const game = blackjackGames.get(sender)
  if (!game) return { success: false, message: 'Ga ada game blackjack yang aktif!' }

  const ownerMode = isOwner(sender)

  // Dealer draws until 17+ (public: dealer hits soft-ish until 18 for edge)
  const dealerStop = ownerMode ? 17 : 18
  while (handValue(game.dealerHand) < dealerStop) {
    game.dealerHand.push(game.deck.pop())
  }

  const playerVal = handValue(game.playerHand)
  let dealerVal = handValue(game.dealerHand)

  blackjackGames.delete(sender)

  let result = ''
  let winAmount = 0
  let playerWins = false
  let push = false

  if (dealerVal > 21) {
    playerWins = true
    result = '🎉 *Dealer BUST! Kamu Menang!*'
  } else if (playerVal > dealerVal) {
    playerWins = true
    result = '🎉 *Kamu Menang!*'
  } else if (playerVal === dealerVal) {
    push = true
    result = '🤝 *PUSH (Seri)!*'
  } else {
    result = '😢 *Dealer Menang!*'
  }

  // Public: void ~18% of pure wins (not push)
  if (!ownerMode && playerWins && Math.random() < 0.18) {
    playerWins = false
    // cosmetic: bump dealer display if needed
    if (dealerVal <= playerVal && dealerVal <= 21) dealerVal = Math.min(21, playerVal + 1)
    result = '😢 *Dealer Menang!*'
  }

  if (playerWins) {
    winAmount = game.bet * 2
    addPoints(sender, winAmount - game.bet)
    const user = getUser(sender)
    user.wins = (user.wins || 0) + 1
    user.totalGames = (user.totalGames || 0) + 1
    saveUser(sender, user)
  } else if (push) {
    const user = getUser(sender)
    user.totalGames = (user.totalGames || 0) + 1
    saveUser(sender, user)
    winAmount = game.bet
  } else {
    removePoints(sender, game.bet)
    const user = getUser(sender)
    user.losses = (user.losses || 0) + 1
    user.totalGames = (user.totalGames || 0) + 1
    saveUser(sender, user)
  }

  return {
    success: true,
    status: 'done',
    message: `🃏 *BLACKJACK - HASIL*\n\n` +
      `Kamu: ${formatHand(game.playerHand)} = ${playerVal}\n` +
      `Dealer: ${formatHand(game.dealerHand)} = ${dealerVal}\n\n` +
      `${result}\n` +
      (playerWins ? `💰 +${formatNumber(winAmount)} poin\n` : push ? `🔁 Bet dikembalikan\n` : '') +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
  }
}

// ─── ROULETTE ─────────────────────────────────────────────────
function playRoulette(sender, choice, bet) {
  const user = getUser(sender)
  if (bet <= 0) return { success: false, message: 'Bet harus lebih dari 0!' }
  if (user.points < bet) return { success: false, message: `Saldo kurang! 💰 ${formatNumber(user.points)} poin` }

  const ownerMode = isOwner(sender)
  let number = getRandomInt(0, 36)

  // Public: slight house bias — 12% re-roll away from player's even-money color/parity side
  // (owner fair roll)
  const isRedOf = (n) => [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n)

  let won = false
  let multiplier = 0
  let choiceLabel = choice
  choice = String(choice || '').toLowerCase()

  if (choice === 'merah' || choice === 'red') {
    if (!ownerMode && Math.random() < 0.18) {
      // bias: prefer black/green
      const blacks = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35, 0]
      number = blacks[getRandomInt(0, blacks.length - 1)]
    }
    won = isRedOf(number)
    multiplier = ownerMode ? 2 : 1.9
    choiceLabel = '🔴 Merah'
  } else if (choice === 'hitam' || choice === 'black') {
    if (!ownerMode && Math.random() < 0.18) {
      const reds = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36, 0]
      number = reds[getRandomInt(0, reds.length - 1)]
    }
    won = number !== 0 && !isRedOf(number)
    multiplier = ownerMode ? 2 : 1.9
    choiceLabel = '⚫ Hitam'
  } else if (choice === 'genap' || choice === 'even') {
    if (!ownerMode && Math.random() < 0.18) number = getRandomInt(0, 18) * 2 + 1 // force odd-ish incl bias
    won = number !== 0 && number % 2 === 0
    multiplier = ownerMode ? 2 : 1.9
    choiceLabel = 'Genap'
  } else if (choice === 'ganjil' || choice === 'odd') {
    if (!ownerMode && Math.random() < 0.18) number = getRandomInt(0, 18) * 2 // even/0
    won = number % 2 === 1
    multiplier = ownerMode ? 2 : 1.9
    choiceLabel = 'Ganjil'
  } else if (/^\d+$/.test(choice)) {
    const num = parseInt(choice, 10)
    if (num < 0 || num > 36) return { success: false, message: 'Angka harus 0-36!' }
    won = num === number
    // Public straight payout nerfed hard
    multiplier = ownerMode ? 36 : 18
    choiceLabel = `Angka ${num}`
  } else {
    return { success: false, message: 'Pilihan: merah/hitam/genap/ganjil/angka(0-36)' }
  }

  // Public even-money: extra 15% void-win (force lose even if hit)
  if (!ownerMode && won && multiplier <= 2 && Math.random() < 0.15) {
    won = false
  }

  const isRed = isRedOf(number)
  const color = number === 0 ? '🟢' : (isRed ? '🔴' : '⚫')
  const multDisp = Number.isInteger(multiplier) ? String(multiplier) : multiplier.toFixed(1)

  if (won) {
    const winAmount = Math.floor(bet * multiplier)
    addPoints(sender, winAmount - bet)
    const updated = getUser(sender)
    updated.wins = (updated.wins || 0) + 1
    updated.totalGames = (updated.totalGames || 0) + 1
    saveUser(sender, updated)

    return {
      success: true,
      message: `🎡 *ROULETTE*\n\n` +
        `Bola: ${color} *${number}*\n` +
        `Pilihan: ${choiceLabel}\n\n` +
        `🎉 *MENANG!*\n` +
        `💰 +${formatNumber(winAmount)} poin (${multDisp}x)\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  }

  removePoints(sender, bet)
  const updated = getUser(sender)
  updated.losses = (updated.losses || 0) + 1
  updated.totalGames = (updated.totalGames || 0) + 1
  saveUser(sender, updated)

  return {
    success: true,
    message: `🎡 *ROULETTE*\n\n` +
      `Bola: ${color} *${number}*\n` +
      `Pilihan: ${choiceLabel}\n\n` +
      `😢 *KALAH!*\n` +
      `💸 -${formatNumber(bet)} poin\n` +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
  }
}

// ─── TRIVIA QUIZ ──────────────────────────────────────────────
const TRIVIA_QUESTIONS = [
  { q: '🌍 Berapa jumlah planet di tata surya?', a: '8', options: ['7', '8', '9', '10'] },
  { q: '🎨 Siapa pelukis Mona Lisa?', a: 'Leonardo da Vinci', options: ['Leonardo da Vinci', 'Michelangelo', 'Picasso', 'Van Gogh'] },
  { q: '🌊 Samudra terbesar di dunia?', a: 'Pasifik', options: ['Atlantik', 'Hindia', 'Pasifik', 'Arctic'] },
  { q: '⚡ Kecepatan cahaya dalam km/s?', a: '300000', options: ['150000', '200000', '300000', '400000'] },
  { q: '🏔️ Gunung tertinggi di Indonesia?', a: 'Puncak Jaya', options: ['Rinjani', 'Semeru', 'Puncak Jaya', 'Kerinci'] },
  { q: '🎵 Berapa nada dalam oktaf?', a: '8', options: ['5', '6', '7', '8'] },
  { q: '🦴 Berapa tulang dalam tubuh manusia?', a: '206', options: ['180', '196', '206', '216'] },
  { q: '🌍 Benua terkecil di dunia?', a: 'Australia', options: ['Eropa', 'Australia', 'Antartika', 'Afrika'] },
  { q: '💧 Rumus kimia air?', a: 'H2O', options: ['CO2', 'H2O', 'NaCl', 'O2'] },
  { q: '🌙 Berapa hari dalam setahun?', a: '365', options: ['360', '365', '366', '370'] },
  { q: '🇮🇩 Ibukota Indonesia?', a: 'Jakarta', options: ['Surabaya', 'Bandung', 'Jakarta', 'Medan'] },
  { q: '⚽ Berapa pemain dalam 1 tim sepak bola?', a: '11', options: ['9', '10', '11', '12'] },
  { q: '🌡️ Suhu air mendidih?', a: '100°C', options: ['90°C', '95°C', '100°C', '110°C'] },
  { q: '🦕 Dinosaurus punah berapa juta tahun lalu?', a: '66', options: ['45', '55', '66', '75'] },
  { q: '🌍 Planet terbesar di tata surya?', a: 'Jupiter', options: ['Saturnus', 'Jupiter', 'Uranus', 'Neptunus'] },
]

const triviaGames = new Map()

function startTrivia(sender) {
  const question = TRIVIA_QUESTIONS[getRandomInt(0, TRIVIA_QUESTIONS.length - 1)]
  const shuffled = [...question.options].sort(() => Math.random() - 0.5)
  const letters = ['A', 'B', 'C', 'D']
  // Store correct letter AFTER shuffle (never use original index)
  const correctIdx = shuffled.indexOf(question.a)
  const correctLetter = correctIdx >= 0 ? letters[correctIdx] : 'A'

  triviaGames.set(sender, {
    q: question.q,
    a: question.a,
    options: shuffled,
    letters,
    correctLetter,
    startTime: Date.now()
  })

  let text = `❓ *TRIVIA QUIZ*\n\n${question.q}\n\n`
  shuffled.forEach((opt, i) => {
    text += `${letters[i]}. ${opt}\n`
  })
  text += `\nJawab dengan: .trivia [A/B/C/D]\n⏰ 30 detik!`

  return { success: true, message: text, options: shuffled, letters, correctLetter }
}

function answerTrivia(sender, answer) {
  const game = triviaGames.get(sender)
  if (!game) return { success: false, message: 'Ga ada trivia aktif! Ketik .trivia buat mulai' }

  const elapsed = Date.now() - game.startTime
  if (elapsed > 30000) {
    triviaGames.delete(sender)
    return { success: false, message: '⏰ Waktu habis! Ketik .trivia buat main lagi' }
  }

  const ans = String(answer || '').trim().toUpperCase()
  const letters = game.letters || ['A', 'B', 'C', 'D']
  const idx = letters.indexOf(ans)
  if (idx === -1) return { success: false, message: 'Jawab dengan A, B, C, atau D!' }

  triviaGames.delete(sender)

  // Prefer stored correctLetter; fallback compare option text
  const correctLetter = game.correctLetter || letters[(game.options || []).indexOf(game.a)]
  const correct = ans === correctLetter || (game.options && game.options[idx] === game.a)

  if (correct) {
    const timeBonus = Math.max(0, Math.floor((30000 - elapsed) / 1000))
    const reward = 50 + timeBonus * 5
    addPoints(sender, reward)
    const user = getUser(sender)
    user.wins = (user.wins || 0) + 1
    user.totalGames = (user.totalGames || 0) + 1
    saveUser(sender, user)

    return {
      success: true,
      correct: true,
      message: `✅ *BENAR!*\n\n` +
        `Jawaban: ${game.a} (${correctLetter})\n` +
        `⏱️ ${Math.floor(elapsed / 1000)} detik\n` +
        `💰 +${reward} poin (termasuk bonus waktu)\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  }

  removePoints(sender, 20)
  const user = getUser(sender)
  user.losses = (user.losses || 0) + 1
  user.totalGames = (user.totalGames || 0) + 1
  saveUser(sender, user)

  return {
    success: true,
    correct: false,
    message: `❌ *SALAH!*\n\n` +
      `Jawaban benar: ${game.a} (${correctLetter || '?'})\n` +
      `💸 -20 poin\n` +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
  }
}

// ─── WORD GAME ────────────────────────────────────────────────
const WORD_LIST = [
  'program', 'python', 'javascript', 'algorithm', 'database',
  'network', 'server', 'client', 'browser', 'keyboard',
  'monitor', 'printer', 'scanner', 'speaker', 'microphone',
  'android', 'iphone', 'windows', 'linux', 'macbook',
  'internet', 'website', 'application', 'software', 'hardware'
]

const wordGames = new Map()

function startWordGame(sender) {
  const word = WORD_LIST[getRandomInt(0, WORD_LIST.length - 1)]
  const scrambled = word.split('').sort(() => Math.random() - 0.5).join('')
  
  wordGames.set(sender, { word, scrambled, startTime: Date.now() })
  
  return {
    success: true,
    message: `🔤 *WORD GAME*\n\n` +
      `Susun huruf ini jadi kata:\n` +
      `*${scrambled.toUpperCase()}*\n\n` +
      `Ketik: .word [jawaban]\n` +
      `⏰ 60 detik!`
  }
}

function answerWordGame(sender, answer) {
  const game = wordGames.get(sender)
  if (!game) return { success: false, message: 'Ga ada word game aktif! Ketik .word buat mulai' }
  
  const elapsed = Date.now() - game.startTime
  if (elapsed > 60000) {
    wordGames.delete(sender)
    return { success: false, message: '⏰ Waktu habis! Ketik .word buat main lagi' }
  }
  
  wordGames.delete(sender)
  
  if (answer.toLowerCase() === game.word) {
    const timeBonus = Math.max(0, Math.floor((60000 - elapsed) / 1000))
    const reward = 80 + timeBonus * 3
    addPoints(sender, reward)
    const user = getUser(sender)
    user.wins++
    user.totalGames++
    saveUser(sender, user)
    
    return {
      success: true,
      correct: true,
      message: `✅ *BENAR!*\n\n` +
        `Kata: *${game.word.toUpperCase()}*\n` +
        `⏱️ ${Math.floor(elapsed / 1000)} detik\n` +
        `💰 +${reward} poin\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  } else {
    removePoints(sender, 30)
    const user = getUser(sender)
    user.losses++
    user.totalGames++
    saveUser(sender, user)
    
    return {
      success: true,
      correct: false,
      message: `❌ *SALAH!*\n\n` +
        `Kata yang benar: *${game.word.toUpperCase()}*\n` +
        `💸 -30 poin\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  }
}

// ─── NUMBER GUESS MULTIPLAYER ─────────────────────────────────
const numberGames = new Map()

function startNumberGame(sender, groupJid) {
  const number = getRandomInt(1, 100)
  numberGames.set(groupJid, {
    number,
    players: new Map(),
    startedBy: sender,
    startTime: Date.now(),
    maxPlayers: 10,
    guesses: []
  })
  
  return {
    success: true,
    message: `🔢 *NUMBER GUESS MULTIPLAYER*\n\n` +
      `Angka 1-100 sudah dipilih!\n` +
      `Siapa aja boleh nebak.\n\n` +
      `Ketik: .guess [angka]\n` +
      `⏰ 60 detik!\n` +
      `👥 Max 10 pemain`
  }
}

function guessNumber(sender, groupJid, guess) {
  const game = numberGames.get(groupJid)
  if (!game) return { success: false, message: 'Ga ada game aktif! Ketik .startnum buat mulai' }
  
  if (Date.now() - game.startTime > 60000) {
    numberGames.delete(groupJid)
    return { success: false, message: '⏰ Game udah selesai!' }
  }
  
  if (guess < 1 || guess > 100) return { success: false, message: 'Angka harus 1-100!' }
  
  game.guesses.push({ sender, guess })
  
  if (guess === game.number) {
    // Winner!
    numberGames.delete(groupJid)
    const reward = 150
    addPoints(sender, reward)
    const user = getUser(sender)
    user.wins++
    user.totalGames++
    saveUser(sender, user)
    
    return {
      success: true,
      winner: true,
      message: `🎉 *BENAR! @${sender.split('@')[0]} MENANG!*\n\n` +
        `Angka: *${game.number}*\n` +
        `Tebakan: ${guess}\n` +
        `💰 +${reward} poin\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  } else {
    const hint = guess < game.number ? '📈 Lebih besar!' : '📉 Lebih kecil!'
    return {
      success: true,
      winner: false,
      message: `${hint}\n\nTebakan @${sender.split('@')[0]}: ${guess}`
    }
  }
}

// ─── MACAU (2D/3D/4D togel-style) ─────────────────────────────
/**
 * .macau 2d 25 100
 * .macau 3d 123 50
 * .macau 4d 1234 50
 * Public payouts heavily house-edged; owner higher payout + soft pity.
 */
function playMacau(sender, mode, pick, bet) {
  const user = getUser(sender)
  if (bet <= 0) return { success: false, message: 'Bet harus lebih dari 0!' }
  if (user.points < bet) return { success: false, message: `Saldo kurang! 💰 ${formatNumber(user.points)} poin` }

  const ownerMode = isOwner(sender)
  const m = String(mode || '').toLowerCase().replace(/\s+/g, '')
  const digits = m === '2d' || m === '2' ? 2 : m === '3d' || m === '3' ? 3 : m === '4d' || m === '4' ? 4 : 0
  if (!digits) {
    return {
      success: false,
      message:
        '🎰 *MACAU*\n\n' +
        'Format: `.macau [2d/3d/4d] [angka] [bet]`\n' +
        'Contoh: `.macau 2d 25 100`\n' +
        'Contoh: `.macau 4d 1234 50`'
    }
  }

  const pickStr = String(pick ?? '').replace(/\D/g, '')
  if (pickStr.length !== digits) {
    return { success: false, message: `Angka harus ${digits} digit (contoh ${'0'.repeat(digits)})` }
  }

  const max = 10 ** digits
  const result = String(getRandomInt(0, max - 1)).padStart(digits, '0')
  let hit = result === pickStr

  // Public: even full-hit has small void chance on 2D only? No — real odds already harsh.
  // Partial (belakang) for 3D/4D public - small consolation rarely
  let multiplier = 0
  let label = 'KALAH'

  if (hit) {
    if (digits === 2) multiplier = ownerMode ? 90 : 55
    else if (digits === 3) multiplier = ownerMode ? 700 : 350
    else multiplier = ownerMode ? 5000 : 2000
    label = 'TEBAKAN PAS!'
  } else if (digits >= 3 && result.slice(-2) === pickStr.slice(-2)) {
    // 2D belakang
    if (ownerMode || Math.random() < 0.85) {
      multiplier = ownerMode ? 12 : 6
      label = '2D BELAKANG'
      hit = true
    }
  } else if (digits === 4 && result.slice(-3) === pickStr.slice(-3)) {
    if (ownerMode || Math.random() < 0.9) {
      multiplier = ownerMode ? 80 : 35
      label = '3D BELAKANG'
      hit = true
    }
  }

  // Owner soft pity: every 8th macau spin guarantee at least 2D belakang-style mini if lose
  if (ownerMode) {
    user.macauSpins = (user.macauSpins || 0) + 1
    if (!hit && user.macauSpins % 8 === 0) {
      hit = true
      multiplier = digits === 2 ? 8 : 6
      label = 'OWNER PITY'
    }
    if (hit && label.includes('PAS')) user.macauSpins = 0
    saveUser(sender, user)
  }

  if (hit && multiplier > 0) {
    const winAmount = Math.floor(bet * multiplier)
    addPoints(sender, winAmount - bet)
    const u = getUser(sender)
    u.wins = (u.wins || 0) + 1
    u.totalGames = (u.totalGames || 0) + 1
    if (ownerMode) u.macauSpins = user.macauSpins || 0
    saveUser(sender, u)
    return {
      success: true,
      hit: true,
      message:
        `🧧 *MACAU ${digits}D*\n\n` +
        `Tebakan: *${pickStr}*\n` +
        `Hasil   : *${result}*\n` +
        `Status  : ✅ ${label}\n\n` +
        `💰 +${formatNumber(winAmount)} poin (${multiplier}x)\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  }

  removePoints(sender, bet)
  const u = getUser(sender)
  u.losses = (u.losses || 0) + 1
  u.totalGames = (u.totalGames || 0) + 1
  if (ownerMode) u.macauSpins = user.macauSpins || 0
  saveUser(sender, u)
  return {
    success: true,
    hit: false,
    message:
      `🧧 *MACAU ${digits}D*\n\n` +
      `Tebakan: *${pickStr}*\n` +
      `Hasil   : *${result}*\n` +
      `Status  : ❌ KALAH\n\n` +
      `💸 -${formatNumber(bet)} poin\n` +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
  }
}

// ─── SPACEMAN (crash) ─────────────────────────────────────────
/**
 * Instant crash round (WA-friendly):
 * .spaceman [bet] [target]
 * Contoh: .spaceman 100 1.5
 * Menang jika crashAt >= target.
 */
function generateCrashPoint(ownerMode) {
  const r = Math.random()
  if (ownerMode) {
    // generous: rare instant bust, higher mean
    if (r < 0.02) return 1.0
    const crash = Math.floor(((0.97) / (1 - Math.min(r, 0.985))) * 100) / 100
    return Math.min(Math.max(crash, 1.01), 50)
  }
  // Public heavy house edge
  if (r < 0.28) return 1.0 // instant crash ~28%
  if (r < 0.55) return Math.round((1.01 + Math.random() * 0.35) * 100) / 100 // 1.01-1.36
  // residual: classic formula with edge
  const e = 0.08
  let crash = Math.floor(((1 - e) / (1 - Math.min(r, 0.99))) * 100) / 100
  if (crash < 1.01) crash = 1.01
  if (crash > 25) crash = 25 // hard cap public
  // extra kill on high targets already handled by distribution
  return crash
}

function playSpaceman(sender, bet, targetRaw) {
  const user = getUser(sender)
  if (bet <= 0) return { success: false, message: 'Bet harus lebih dari 0!' }
  if (user.points < bet) return { success: false, message: `Saldo kurang! 💰 ${formatNumber(user.points)} poin` }

  let target = parseFloat(String(targetRaw ?? '2').replace(',', '.'))
  if (!Number.isFinite(target)) target = 2
  target = Math.round(target * 100) / 100
  if (target < 1.01) return { success: false, message: 'Target minimal 1.01x' }
  if (target > 100) return { success: false, message: 'Target maksimal 100x' }

  const ownerMode = isOwner(sender)
  // Public: very high targets almost never pay (extra gate)
  if (!ownerMode && target >= 5 && Math.random() < 0.65) {
    // force early crash below target
    const crashAt = Math.round((1 + Math.random() * Math.min(target - 1.01, 1.2)) * 100) / 100
    removePoints(sender, bet)
    const u = getUser(sender)
    u.losses = (u.losses || 0) + 1
    u.totalGames = (u.totalGames || 0) + 1
    saveUser(sender, u)
    return {
      success: true,
      crashed: true,
      message:
        `🚀 *SPACEMAN*\n\n` +
        `🎯 Target: *${target.toFixed(2)}x*\n` +
        `💥 Crash : *${crashAt.toFixed(2)}x*\n\n` +
        `😢 *RUGI!* Spaceman jatuh sebelum target\n` +
        `💸 -${formatNumber(bet)} poin\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  }

  const crashAt = generateCrashPoint(ownerMode)
  const won = crashAt >= target

  if (won) {
    // Public payout slightly reduced from target (edge)
    const payMult = ownerMode ? target : Math.round(target * 0.92 * 100) / 100
    const winAmount = Math.floor(bet * payMult)
    addPoints(sender, winAmount - bet)
    const u = getUser(sender)
    u.wins = (u.wins || 0) + 1
    u.totalGames = (u.totalGames || 0) + 1
    saveUser(sender, u)
    return {
      success: true,
      crashed: false,
      message:
        `🚀 *SPACEMAN*\n\n` +
        `🎯 Target : *${target.toFixed(2)}x*\n` +
        `📈 Crash  : *${crashAt.toFixed(2)}x*\n` +
        `💵 Bayar  : *${payMult.toFixed(2)}x*\n\n` +
        `🎉 *CASH OUT SUKSES!*\n` +
        `💰 +${formatNumber(winAmount)} poin\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  }

  removePoints(sender, bet)
  const u = getUser(sender)
  u.losses = (u.losses || 0) + 1
  u.totalGames = (u.totalGames || 0) + 1
  saveUser(sender, u)
  return {
    success: true,
    crashed: true,
    message:
      `🚀 *SPACEMAN*\n\n` +
      `🎯 Target: *${target.toFixed(2)}x*\n` +
      `💥 Crash : *${crashAt.toFixed(2)}x*\n\n` +
      `😢 *RUGI!* Spaceman jatuh di ${crashAt.toFixed(2)}x\n` +
      `💸 -${formatNumber(bet)} poin\n` +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
  }
}

// ─── MAHJONG (tile hand) ──────────────────────────────────────
/**
 * Instant mahjong-style hand (WA-friendly):
 * .mahjong [bet]  |  .mj [bet]
 * .mjfs [bet] [qty] · .mj free (auto FS max 20)
 *
 * PUBLIC: natural board dari wall (4 kopi/tile), mult RTP~judi asli, TANPA void palsu
 * OWNER: ~pair floor + KONG pity tiap 10 hand (sama seperti sebelumnya)
 */
const MJ_TILE_SET = [
  // Circles / Dots
  '🀙', '🀚', '🀛', '🀜', '🀝',
  // Bamboo
  '🀐', '🀑', '🀒', '🀓', '🀔',
  // Characters
  '🀇', '🀈', '🀉', '🀊', '🀋',
  // Honors
  '🀄', '🀅', '🀆', '🀀', '🀁',
]
// alias lama
const MJ_TILES = MJ_TILE_SET
const MJ_HONORS = new Set(['🀄', '🀅', '🀆', '🀀', '🀁', '🀂', '🀃'])

/** Wall 4 kopi tiap tile → acak tanpa replacement (lebih "asli") */
function buildMahjongWall() {
  const wall = []
  for (const t of MJ_TILE_SET) {
    for (let c = 0; c < 4; c++) wall.push(t)
  }
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]]
  }
  return wall
}

function drawMahjongHand(count = 5) {
  const wall = buildMahjongWall()
  return wall.slice(0, count)
}

/**
 * Score natural hand — dipakai owner (board + pity di luar).
 * Public pakai rollPublicMahjong() (weighted judi asli).
 */
function scoreMahjongHand(hand, ownerMode) {
  const freq = {}
  for (const t of hand) freq[t] = (freq[t] || 0) + 1
  const counts = Object.values(freq).sort((a, b) => b - a)
  const maxC = counts[0] || 0
  const pairs = counts.filter(c => c >= 2).length
  const honorTiles = hand.filter(t => MJ_HONORS.has(t)).length
  const allHonor = honorTiles === hand.length
  const allSame = maxC === hand.length

  let mult = 0
  let label = '❌ *BUKAN KOMBO*'

  if (allSame && hand.length >= 5) {
    mult = ownerMode ? 80 : 100
    label = `🏆 *FIVE OF A KIND! (${mult}x)*`
  } else if (maxC >= 4) {
    mult = ownerMode ? 25 : 28
    label = `🌟 *KONG! (${mult}x)*`
  } else if (maxC >= 3 && pairs >= 2) {
    mult = ownerMode ? 12 : 14
    label = `✨ *FULL HOUSE! (${mult}x)*`
  } else if (maxC >= 3) {
    mult = ownerMode ? 6 : 5
    label = `🎉 *PUNG! (${mult}x)*`
  } else if (pairs >= 2) {
    if (ownerMode) {
      mult = 4
      label = `✨ *DOUBLE PAIR! (${mult}x)*`
    } else {
      mult = 0
      label = '❌ *DOUBLE PAIR · no pay*'
    }
  } else if (pairs === 1) {
    if (ownerMode) {
      mult = 2
      label = `🀄 *PAIR! (${mult}x)*`
    } else {
      mult = 0
      label = '❌ *PAIR · no pay*'
    }
  } else if (allHonor) {
    mult = ownerMode ? 5 : 8
    label = `🐉 *ALL HONOR! (${mult}x)*`
  }

  return { mult, label, freq, maxC }
}

/**
 * Public mahjong — weighted table kayak slot/judi online.
 * Target long-run RTP ~95–96%, hit ~18–22%. Apa yang keluar = yang dibayar.
 * Tile display dibangun biar cocok sama hasil (bukan void palsu).
 */
function rollPublicMahjong() {
  const r = Math.random() * 100
  // cumulative weights → EV ≈ 0.955
  // 0.05% five@80 + 0.20% kong@25 + 0.55% fh@12 + 1.7% honor@6 + 17.5% pung@4
  // = 0.04 + 0.05 + 0.066 + 0.102 + 0.70 = 0.958
  if (r < 0.05) return { mult: 80, kind: 'five', label: '🏆 *FIVE OF A KIND! (80x)*' }
  if (r < 0.25) return { mult: 25, kind: 'kong', label: '🌟 *KONG! (25x)*' }
  if (r < 0.80) return { mult: 12, kind: 'fh', label: '✨ *FULL HOUSE! (12x)*' }
  if (r < 2.50) return { mult: 6, kind: 'honor', label: '🐉 *ALL HONOR! (6x)*' }
  if (r < 20.0) return { mult: 4, kind: 'pung', label: '🎉 *PUNG! (4x)*' }
  // lose / near-miss display
  if (r < 45) return { mult: 0, kind: 'pair', label: '❌ *PAIR · no pay*' }
  if (r < 55) return { mult: 0, kind: 'dpair', label: '❌ *DOUBLE PAIR · no pay*' }
  return { mult: 0, kind: 'bust', label: '❌ *BUKAN KOMBO*' }
}

function paintMahjongHand(kind) {
  const honors = ['🀄', '🀅', '🀆', '🀀', '🀁']
  const normals = MJ_TILE_SET.filter(t => !MJ_HONORS.has(t))
  const pick = (arr) => arr[getRandomInt(0, arr.length - 1)]
  const filler = () => pick(MJ_TILE_SET)

  if (kind === 'five') {
    const t = pick(normals)
    return [t, t, t, t, t]
  }
  if (kind === 'kong') {
    const t = pick(normals)
    let x = filler()
    while (x === t) x = filler()
    return [t, t, t, t, x]
  }
  if (kind === 'fh') {
    const a = pick(normals)
    let b = pick(normals)
    while (b === a) b = pick(normals)
    return [a, a, a, b, b]
  }
  if (kind === 'honor') {
    // 5 honor tiles
    const hand = []
    for (let i = 0; i < 5; i++) hand.push(pick(honors))
    return hand
  }
  if (kind === 'pung') {
    const t = pick(normals)
    let x = filler(), y = filler()
    while (x === t) x = filler()
    while (y === t || y === x) y = filler()
    const hand = [t, t, t, x, y]
    // shuffle
    for (let i = hand.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [hand[i], hand[j]] = [hand[j], hand[i]]
    }
    return hand
  }
  if (kind === 'pair') {
    const t = pick(normals)
    const hand = [t, t, filler(), filler(), filler()]
    // ensure no accidental pung
    return hand.map((c, i) => (i > 1 && c === t ? pick(normals.filter(n => n !== t)) : c))
  }
  if (kind === 'dpair') {
    const a = pick(normals)
    let b = pick(normals)
    while (b === a) b = pick(normals)
    let c = pick(normals)
    while (c === a || c === b) c = pick(normals)
    return [a, a, b, b, c]
  }
  // bust — all unique-ish
  const hand = []
  const used = new Set()
  while (hand.length < 5) {
    const t = filler()
    if (!used.has(t) || hand.length >= 4) {
      hand.push(t)
      used.add(t)
    }
  }
  return hand
}

function playMahjong(sender, bet, opts = {}) {
  const useFree = !!(opts && opts.useFree)
  const user = getUser(sender)
  const ownerMode = isOwner(sender)
  const betBig = parseBetBig(bet)
  if (!betBig) return { success: false, message: 'Bet harus lebih dari 0!' }
  const betKey = betBig.toString()

  if (useFree) {
    ensureMjFs(user)
    const idx = user.mjFs.findIndex(s => String(s.bet) === betKey && s.n > 0)
    if (idx < 0) {
      return {
        success: false,
        message:
          `Ga punya free spin @ bet ${formatNumber(betBig)}!\n` +
          `Cek: \`.freespin\` · beli: \`.mjfs ${betKey} 10\` · auto: \`.mj free\``
      }
    }
  } else if (!ownerMode) {
    if (pointsToBig(user.points) < betBig) {
      const { total } = getMjFsTotal(sender)
      const hint = total > 0 ? `\n\nLo punya *${total}* FS mahjong → \`.mj free\`` : ''
      return { success: false, message: `Saldo kurang! 💰 ${formatNumber(user.points)} poin${hint}` }
    }
  }

  const result = resolveMahjongOnce(sender, betKey, { useFree })
  if (!result.ok) return { success: false, message: result.message || 'Gagal main mahjong' }

  if (useFree) {
    const u = getUser(sender)
    ensureMjFs(u)
    const idx = u.mjFs.findIndex(s => String(s.bet) === betKey && s.n > 0)
    if (idx >= 0) {
      u.mjFs[idx].n -= 1
      if (u.mjFs[idx].n <= 0) u.mjFs.splice(idx, 1)
      saveUser(sender, u)
    }
  }

  const { total } = getMjFsTotal(sender)
  const fsHint = useFree
    ? `\n🎁 FS · sisa *${total}*`
    : (total > 0 ? `\n🎁 FS siap: *${total}* → \`.mj free\`` : '')

  return {
    success: true,
    hit: result.hit,
    multiplier: result.mult,
    win: result.winAmount,
    bet: betKey,
    useFree,
    freeSpins: total,
    message:
      `🀄 *MAHJONG*${useFree ? ' · FREE SPIN' : ''}\n\n` +
      `┌───────────────┐\n` +
      `│ ${result.handLine} │\n` +
      `└───────────────┘\n\n` +
      `${result.label}\n` +
      (result.hit
        ? `💰 +${formatNumber(result.winAmount)} poin (${result.mult}x)${useFree ? ' · stake gratis' : ''}\n`
        : (useFree
          ? `💸 Kalah: FS hangus (0 poin)\n`
          : `💸 -${formatNumber(betBig)} poin\n`)) +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin` +
      (result.ownerMode ? '' : `\n🔄 Hand ke-${result.handSnap}`) +
      fsHint
  }
}

/**
 * Core one hand — no FS consume (caller handles stacks).
 * useFree: no stake debit; win credits full mult*bet
 * PUBLIC: weighted judi-asli table + painted tiles
 * OWNER: board score + pair floor + KONG pity /10 (sama sebelumnya)
 * bet: number|string|bigint
 */
function resolveMahjongOnce(sender, bet, { useFree = false } = {}) {
  const user = getUser(sender)
  const ownerMode = isOwner(sender)
  const betBig = parseBetBig(bet)
  if (!betBig) return { ok: false, message: 'Bet invalid' }

  user.mahjongHands = (user.mahjongHands || 0) + 1
  const handNo = user.mahjongHands

  let hand
  let mult
  let label

  if (ownerMode) {
    hand = drawMahjongHand(5)
    ;({ mult, label } = scoreMahjongHand(hand, true))
    if (handNo % 10 === 0) {
      const t = MJ_TILES[getRandomInt(0, MJ_TILES.length - 1)]
      hand = [t, t, t, t, MJ_TILES[getRandomInt(0, MJ_TILES.length - 1)]]
      mult = 25
      label = `🌟 *KONG! OWNER PITY (${mult}x)*`
      user.mahjongHands = 0
    } else if (mult === 0) {
      if (Math.random() < 0.995) {
        const t = hand[0]
        hand[1] = t
        mult = 2
        label = `🀄 *PAIR! (${mult}x)*`
      }
    }
  } else {
    const roll = rollPublicMahjong()
    mult = roll.mult
    label = roll.label
    hand = paintMahjongHand(roll.kind)
  }

  const handSnap = user.mahjongHands
  // mult may be float historically — keep integer mults from tables
  const multInt = Math.floor(Number(mult) || 0)
  const winBig = betBig * BigInt(multInt)
  const winAmount = winBig <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(winBig) : winBig.toString()
  const handLine = hand.join(' ')

  const base = getUser(sender)
  base.mahjongHands = handSnap
  if (Array.isArray(user.mjFs)) base.mjFs = user.mjFs
  saveUser(sender, base)

  if (multInt > 0) {
    if (useFree) {
      addPoints(sender, winBig)
    } else {
      // net = win - bet = bet*(mult-1)
      const net = winBig - betBig
      if (net > 0n) addPoints(sender, net)
      else if (net < 0n && !ownerMode) removePoints(sender, -net)
    }
    const u = getUser(sender)
    u.wins = (u.wins || 0) + 1
    u.totalGames = (u.totalGames || 0) + 1
    u.mahjongHands = handSnap
    if (Array.isArray(base.mjFs)) u.mjFs = base.mjFs
    saveUser(sender, u)
    return { ok: true, hit: true, mult: multInt, label, handLine, winAmount, handSnap, ownerMode }
  }

  if (!useFree && !ownerMode) removePoints(sender, betBig)
  const u = getUser(sender)
  u.losses = (u.losses || 0) + 1
  u.totalGames = (u.totalGames || 0) + 1
  u.mahjongHands = handSnap
  if (Array.isArray(base.mjFs)) u.mjFs = base.mjFs
  saveUser(sender, u)
  return { ok: true, hit: false, mult: 0, label, handLine, winAmount: 0, handSnap, ownerMode }
}

/** Pop 1 spin FIFO from mjFs stacks; returns {bet: string} or null */
function consumeOneMjFs(sender) {
  const u = getUser(sender)
  ensureMjFs(u)
  if (!u.mjFs.length) {
    saveUser(sender, u)
    return null
  }
  const stack = u.mjFs[0]
  const bet = String(stack.bet)
  stack.n -= 1
  if (stack.n <= 0) u.mjFs.shift()
  saveUser(sender, u)
  return { bet }
}

const mjAutoLocks = new Set()

/**
 * Auto-play semua free spin mahjong sampai habis (cap MJ_FS_AUTO_MAX).
 * Satu ringkasan — biar WA ga kebanjiran.
 */
function playMahjongFreeAuto(sender) {
  const id = String(sender || '').replace(/@(lid|s\.whatsapp\.net)$/i, '').split(':')[0]
  if (mjAutoLocks.has(id)) {
    return { success: false, message: '⏳ Auto free spin mahjong masih jalan. Tunggu selesai.' }
  }

  const user = getUser(sender)
  ensureMjFs(user)
  saveUser(sender, user)
  let { total } = getMjFsTotal(sender)
  if (total < 1) {
    return {
      success: false,
      message:
        'Ga punya free spin mahjong!\n\n' +
        'Beli: `.mjfs [bet] [qty]` — contoh `.mjfs 100 10`\n' +
        'Cek: `.freespin`'
    }
  }

  mjAutoLocks.add(id)
  try {
    const balBefore = isOwner(sender) ? null : pointsToBig(getUser(sender).points)
    let played = 0
    let hits = 0
    let totalWinBig = 0n
    let best = { mult: 0, win: 0, bet: '0', label: '', handLine: '' }
    const byBet = {}
    const highlights = []

    while (played < MJ_FS_AUTO_MAX) {
      const popped = consumeOneMjFs(sender)
      if (!popped) break
      const bet = popped.bet
      const r = resolveMahjongOnce(sender, bet, { useFree: true })
      if (!r.ok) break
      played++
      byBet[bet] = (byBet[bet] || 0) + 1
      if (r.hit) {
        hits++
        const w = pointsToBig(r.winAmount)
        totalWinBig += w
        if (r.mult > best.mult || (r.mult === best.mult && w > pointsToBig(best.win))) {
          best = { mult: r.mult, win: r.winAmount, bet, label: r.label, handLine: r.handLine }
        }
        if (r.mult >= 3 && highlights.length < 5) {
          highlights.push(`${r.handLine} · ${r.mult}x · +${formatNumber(r.winAmount)} (bet ${formatNumber(bet)})`)
        }
      }
    }

    const left = getMjFsTotal(sender)
    const balAfter = isOwner(sender) ? null : pointsToBig(getUser(sender).points)
    const netBig = balAfter == null || balBefore == null ? null : (balAfter - balBefore)
    const betBreak = Object.entries(byBet)
      .map(([b, n]) => `${n}×@${formatNumber(b)}`)
      .join(' · ')
    const totalWin = totalWinBig <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(totalWinBig) : totalWinBig.toString()

    let msg =
      `🀄 *MAHJONG FREE SPIN · AUTO*\n\n` +
      `▶ Dimainkan: *${played}* hand\n` +
      `✅ Menang: *${hits}* · ❌ Kalah: *${played - hits}*\n` +
      `💰 Total menang: +${formatNumber(totalWin)} poin\n` +
      (netBig == null ? '' : `📈 Net saldo: ${netBig >= 0n ? '+' : ''}${formatNumber(netBig)} poin\n`) +
      `🎟 Bet breakdown: ${betBreak || '-'}\n` +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin\n` +
      `🎁 Sisa FS: *${left.total}*` +
      (left.total > 0 ? ` (cap ${MJ_FS_AUTO_MAX}/cmd — ketik \`.mj free\` lagi)` : '')

    if (best.mult > 0) {
      msg +=
        `\n\n🏆 *Best hit*\n` +
        `${best.handLine}\n` +
        `${best.label}\n` +
        `+${formatNumber(best.win)} (bet ${formatNumber(best.bet)})`
    }
    if (highlights.length) {
      msg += `\n\n✨ Hit ≥3x:\n` + highlights.map(h => `• ${h}`).join('\n')
    }
    if (played === 0) {
      msg = 'Gagal jalankan free spin.'
      return { success: false, message: msg }
    }

    return {
      success: true,
      played,
      hits,
      totalWin,
      left: left.total,
      message: msg
    }
  } finally {
    mjAutoLocks.delete(id)
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────
module.exports = {
  // Point system
  addPoints,
  removePoints,
  getBalance,
  getUser,
  saveUser,
  isOwner,
  
  // Rank system
  getRank,
  formatProgressBar,
  RANKS,
  
  // Daily
  claimDaily,
  
  // Transfer
  transfer,
  
  // Shop
  getShop,
  buyItem,
  findItem,
  ITEM_ALIASES,
  FREE_SPIN_BET,
  getFreeSpins,
  freeSpinStatus,
  buyMahjongFreeSpins,
  getMjFsTotal,
  calcMjFsCost,
  mjFsRate,
  
  // Leaderboard
  getLeaderboard,
  formatLeaderboard,
  
  // Games
  playSlot,
  playMahjong,
  playMahjongFreeAuto,
  startBlackjack,
  hitBlackjack,
  standBlackjack,
  playRoulette,
  playMacau,
  playSpaceman,
  startTrivia,
  answerTrivia,
  startWordGame,
  answerWordGame,
  startNumberGame,
  guessNumber,
  
  // Helpers
  formatNumber,
  blackjackGames,
  triviaGames,
  wordGames,
  numberGames,
}
