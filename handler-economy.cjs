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
// Owner IDs - unlimited balance
const OWNER_IDS = ['83807763972304', '110857451221063']

function isOwner(sender) {
  const id = sender.replace(/@(lid|s\.whatsapp\.net)$/, '').split(':')[0]
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
  if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
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
  user.points += amount
  user.xp += Math.abs(amount)
  saveUser(sender, user)
  return user
}

function removePoints(sender, amount) {
  if (isOwner(sender)) return getUser(sender) // Owner unlimited
  const user = getUser(sender)
  user.points = Math.max(0, user.points - amount)
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
const DEFAULT_SHOP = [
  { id: 'shield', name: '🛡️ Shield', desc: 'Protect dari kalah -1 game', price: 500, emoji: '🛡️' },
  { id: 'double', name: '⚡ Double XP', desc: 'XP 2x lipat selama 1 jam', price: 300, emoji: '⚡' },
  { id: 'luck', name: '🍀 Lucky Charm', desc: '+20% chance menang', price: 750, emoji: '🍀' },
  { id: 'badge', name: '🏅 VIP Badge', desc: 'Badge VIP di profile', price: 1000, emoji: '🏅' },
  { id: 'crown', name: '👑 Crown', desc: 'Crown emoji di nama', price: 2000, emoji: '👑' },
]

function getShop() {
  return loadJSON(SHOP_FILE, DEFAULT_SHOP)
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

function buyItem(sender, itemQuery, quantity = 1) {
  const user = getUser(sender)
  const item = findItem(itemQuery)
  
  if (!item) return { success: false, message: `Item "${itemQuery}" ga ada di shop!\n\nKetik .shop buat liat daftar item` }
  
  // Owner unlimited, skip price check
  if (!isOwner(sender)) {
    const totalCost = item.price * quantity
    if (user.points < totalCost) {
      return { success: false, message: `Saldo kurang! Butuh ${formatNumber(totalCost)} poin (${quantity}x ${item.name})` }
    }
  }
  
  // Buy multiple
  for (let i = 0; i < quantity; i++) {
    if (!isOwner(sender)) {
      user.points -= item.price
    }
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
function playSlot(sender, bet) {
  const user = getUser(sender)
  if (bet <= 0) return { success: false, message: 'Bet harus lebih dari 0!' }
  if (user.points < bet) return { success: false, message: `Saldo kurang! 💰 ${formatNumber(user.points)} poin` }
  
  const symbols = ['🍒', '🍋', '🍊', '🍇', '💎', '7️⃣', '⭐']
  const s1 = symbols[getRandomInt(0, symbols.length - 1)]
  const s2 = symbols[getRandomInt(0, symbols.length - 1)]
  const s3 = symbols[getRandomInt(0, symbols.length - 1)]
  
  let multiplier = 0
  let result = ''
  
  if (s1 === s2 && s2 === s3) {
    // Jackpot!
    if (s1 === '💎') multiplier = 10
    else if (s1 === '7️⃣') multiplier = 7
    else if (s1 === '⭐') multiplier = 5
    else multiplier = 3
    result = '🎉 *JACKPOT!*'
  } else if (s1 === s2 || s2 === s3 || s1 === s3) {
    multiplier = 1.5
    result = '✨ *Small Win!*'
  } else {
    multiplier = 0
    result = '😢 *Kalah!*'
  }
  
  const winAmount = Math.floor(bet * multiplier)
  if (multiplier > 0) {
    addPoints(sender, winAmount - bet)
    user.wins++
  } else {
    removePoints(sender, bet)
    user.losses++
  }
  user.totalGames++
  saveUser(sender, user)
  
  return {
    success: true,
    result: result,
    symbols: `${s1} | ${s2} | ${s3}`,
    bet: bet,
    win: winAmount,
    multiplier: multiplier,
    balance: getBalance(sender),
    message: `🎰 *SLOT MACHINE*\n\n` +
      `┌─────────────┐\n` +
      `│  ${s1} │ ${s2} │ ${s3}  │\n` +
      `└─────────────┘\n\n` +
      `${result}\n` +
      (multiplier > 0 
        ? `💰 Menang: +${formatNumber(winAmount)} poin (${multiplier}x)\n`
        : `💸 Kalah: -${formatNumber(bet)} poin\n`) +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
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
  
  // Dealer draws until 17+
  while (handValue(game.dealerHand) < 17) {
    game.dealerHand.push(game.deck.pop())
  }
  
  const playerVal = handValue(game.playerHand)
  const dealerVal = handValue(game.dealerHand)
  
  blackjackGames.delete(sender)
  
  const user = getUser(sender)
  user.totalGames++
  
  let result = ''
  let winAmount = 0
  
  if (dealerVal > 21) {
    result = '🎉 *Dealer BUST! Kamu Menang!*'
    winAmount = game.bet * 2
    addPoints(sender, winAmount - game.bet)
    user.wins++
  } else if (playerVal > dealerVal) {
    result = '🎉 *Kamu Menang!*'
    winAmount = game.bet * 2
    addPoints(sender, winAmount - game.bet)
    user.wins++
  } else if (playerVal === dealerVal) {
    result = '🤝 *PUSH (Seri)!*'
    winAmount = game.bet
    // No change
  } else {
    result = '😢 *Dealer Menang!*'
    removePoints(sender, game.bet)
    user.losses++
  }
  
  saveUser(sender, user)
  
  return {
    success: true,
    status: 'done',
    message: `🃏 *BLACKJACK - HASIL*\n\n` +
      `Kamu: ${formatHand(game.playerHand)} = ${playerVal}\n` +
      `Dealer: ${formatHand(game.dealerHand)} = ${dealerVal}\n\n` +
      `${result}\n` +
      (winAmount > 0 ? `💰 +${formatNumber(winAmount)} poin\n` : '') +
      `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
  }
}

// ─── ROULETTE ─────────────────────────────────────────────────
function playRoulette(sender, choice, bet) {
  const user = getUser(sender)
  if (bet <= 0) return { success: false, message: 'Bet harus lebih dari 0!' }
  if (user.points < bet) return { success: false, message: `Saldo kurang! 💰 ${formatNumber(user.points)} poin` }
  
  const number = getRandomInt(0, 36)
  const isRed = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(number)
  const isBlack = number !== 0 && !isRed
  const isEven = number !== 0 && number % 2 === 0
  const isOdd = number % 2 === 1
  
  let won = false
  let multiplier = 0
  let choiceLabel = choice
  
  choice = choice.toLowerCase()
  
  if (choice === 'merah' || choice === 'red') {
    won = isRed
    multiplier = 2
    choiceLabel = '🔴 Merah'
  } else if (choice === 'hitam' || choice === 'black') {
    won = isBlack
    multiplier = 2
    choiceLabel = '⚫ Hitam'
  } else if (choice === 'genap' || choice === 'even') {
    won = isEven
    multiplier = 2
    choiceLabel = 'Genap'
  } else if (choice === 'ganjil' || choice === 'odd') {
    won = isOdd
    multiplier = 2
    choiceLabel = 'Ganjil'
  } else if (/^\d+$/.test(choice)) {
    const num = parseInt(choice)
    if (num < 0 || num > 36) return { success: false, message: 'Angka harus 0-36!' }
    won = num === number
    multiplier = 36
    choiceLabel = `Angka ${num}`
  } else {
    return { success: false, message: 'Pilihan: merah/hitam/genap/ganjil/angka(0-36)' }
  }
  
  const color = number === 0 ? '🟢' : (isRed ? '🔴' : '⚫')
  
  user.totalGames++
  
  if (won) {
    const winAmount = bet * multiplier
    addPoints(sender, winAmount - bet)
    user.wins++
    saveUser(sender, user)
    
    return {
      success: true,
      message: `🎡 *ROULETTE*\n\n` +
        `Bola: ${color} *${number}*\n` +
        `Pilihan: ${choiceLabel}\n\n` +
        `🎉 *MENANG!*\n` +
        `💰 +${formatNumber(winAmount)} poin (${multiplier}x)\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  } else {
    removePoints(sender, bet)
    user.losses++
    saveUser(sender, user)
    
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
  triviaGames.set(sender, { ...question, startTime: Date.now() })
  
  const shuffled = [...question.options].sort(() => Math.random() - 0.5)
  const letters = ['A', 'B', 'C', 'D']
  
  let text = `❓ *TRIVIA QUIZ*\n\n${question.q}\n\n`
  shuffled.forEach((opt, i) => {
    text += `${letters[i]}. ${opt}\n`
  })
  text += `\nJawab dengan: .trivia [A/B/C/D]\n⏰ 30 detik!`
  
  return { success: true, message: text, options: shuffled, letters }
}

function answerTrivia(sender, answer) {
  const game = triviaGames.get(sender)
  if (!game) return { success: false, message: 'Ga ada trivia aktif! Ketik .trivia buat mulai' }
  
  const elapsed = Date.now() - game.startTime
  if (elapsed > 30000) {
    triviaGames.delete(sender)
    return { success: false, message: '⏰ Waktu habis! Ketik .trivia buat main lagi' }
  }
  
  const letters = ['A', 'B', 'C', 'D']
  const idx = letters.indexOf(answer.toUpperCase())
  if (idx === -1) return { success: false, message: 'Jawab dengan A, B, C, atau D!' }
  
  triviaGames.delete(sender)
  
  // Find which letter corresponds to correct answer
  // We need to map back from the shuffled order
  // Actually, let's simplify - just check if the answer matches
  const correct = answer.toUpperCase() === game.letters[game.options.indexOf(game.a)] || 
                  game.options[idx] === game.a
  
  const user = getUser(sender)
  user.totalGames++
  
  if (correct) {
    const timeBonus = Math.max(0, Math.floor((30000 - elapsed) / 1000))
    const reward = 50 + timeBonus * 5
    addPoints(sender, reward)
    user.wins++
    saveUser(sender, user)
    
    return {
      success: true,
      correct: true,
      message: `✅ *BENAR!*\n\n` +
        `Jawaban: ${game.a}\n` +
        `⏱️ ${Math.floor(elapsed / 1000)} detik\n` +
        `💰 +${reward} poin (termasuk bonus waktu)\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
  } else {
    removePoints(sender, 20)
    user.losses++
    saveUser(sender, user)
    
    return {
      success: true,
      correct: false,
      message: `❌ *SALAH!*\n\n` +
        `Jawaban benar: ${game.a}\n` +
        `💸 -20 poin\n` +
        `💎 Saldo: ${formatNumber(getBalance(sender))} poin`
    }
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
  
  // Leaderboard
  getLeaderboard,
  formatLeaderboard,
  
  // Games
  playSlot,
  startBlackjack,
  hitBlackjack,
  standBlackjack,
  playRoulette,
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
