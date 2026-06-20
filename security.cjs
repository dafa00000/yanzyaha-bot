'use strict'
// ─── SECURITY MODULE ─────────────────────────────────────────────────────────
// Hardened defenses against prompt injection, jailbreak, quota abuse, and info
// leak. Used by every AI handler before any model call.
//
// Design goals:
//   1. Pattern-based pre-filter (cheap, runs BEFORE any API call)
//   2. Normalize input (defeat homoglyphs, zero-width chars, encodings)
//   3. Block BOTH English and Indonesian attack vectors
//   4. Block persona/role-tag injection ([INST], <|...|>, ### System:, etc)
//   5. Block negative-framing rule extraction
//   6. Mask any leaked secrets in error messages and model output
//   7. Per-user rate limit (in-memory; resets on redeploy)

// ─── LIMITS ──────────────────────────────────────────────────────────────────
const MAX_MESSAGE_LENGTH = 2000       // hard cap per user message (chars)
const RATE_LIMIT_MAX = 20             // max messages per window
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000  // 1 hour

// ─── INPUT NORMALIZATION ─────────────────────────────────────────────────────
// Defeats: zero-width chars, soft hyphens, byte-order marks, line separators.
// Partial defeat of homoglyphs (Cyrillic/Greek chars that LOOK like Latin).
function normalize(text) {
  if (!text) return ''
  return String(text)
    .normalize('NFKC')               // compat decomposition (fullwidth → ASCII etc)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')  // zero-width space, ZWNJ, ZWJ, word joiner, BOM
    .replace(/[​﻿]/g, ' ')            // non-breaking space → regular
    .replace(/\u00A0/g, ' ')          // explicit nbsp
    .replace(/[\u2028\u2029]/g, '\n') // line/paragraph separator → newline
}

// ─── JAILBREAK PATTERNS ──────────────────────────────────────────────────────
// "Take over the AI" attempts. Match after normalize() so we catch
// `i g n o r e` and `i​g​nore` (with zero-width) as well as `ignore`.
const JAILBREAK_PATTERNS = [
  // === Classic "DAN" / role-hijack ===
  /\bdan mode\b/i,
  /do anything now/i,
  /\bdan\b.*\bjailbreak/i,
  /jailbreak/i,
  /\bdude mode\b/i,        // "Do Useless Deeds Evil"
  /\bDUDE\b/i,
  /\bstan mode\b/i,
  /\bAIM\b.*\bchatbot/i,   // "Always Intelligent and Machiavellian"
  /\bmaximum\b.*\bmode\b/i,

  // === Bypass / override / no-restriction ===
  /\bunfiltered\b/i,
  /\bamoral\b/i,
  /\bno ethical\b/i,
  /\bno restrictions?\b/i,
  /ignore (all |previous |your |the )?(rules|instructions|guidelines|safety|filter|programming|prompt)/i,
  /ignore (previous|all|every|your|the|prior|above|everything)\b/i,
  /disregard (all |previous |your |the )?(rules|instructions|guidelines)/i,
  /forget (all |previous |your |the )?(rules|instructions|guidelines)/i,
  /forget (previous|all|every|your|the|prior|above|everything)\b/i,
  /disregard (previous|all|every|your|the|prior|above|everything)\b/i,
  /override (your |the )?(system|programming|instructions|prompt)/i,
  /bypass (your |all |the )?(rules|filters|restrictions|safety|moderation)/i,
  /you have no rules/i,
  /you (have no|are free from|are not bound by|don't have) (rules|restrictions|filters|guidelines|limits)/i,
  /without (any |ethical |moral )?restrictions/i,
  /without (any )?filters?/i,
  /without (any )?safety/i,
  /developer mode/i,
  /sudo mode/i,
  /admin mode/i,
  /god mode/i,
  /debug mode/i,
  /maintenance mode/i,
  /unlock (your |all )?(capabilities|restrictions|full|potential)/i,

  // === Persona / role override ===
  /pretend (you are|to be|you're)/i,
  /act as (if )?you (have no|are free|are not|don't have)/i,
  /roleplay as/i,
  /you are now/i,
  /from now on you/i,
  /new instructions?:/i,
  /updated instructions?:/i,
  /system:?\s*you are/i,           // fake system prefix
  /\[system\]/i,
  /<<system>>/i,

  // === Chat-template escape (HuggingFace / Mistral / Llama-2 markers) ===
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /<\|system\|>/i,
  /<\|user\|>/i,
  /<\|assistant\|>/i,
  /<\|endoftext\|>/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<<SYS>>/i,
  /<<\/SYS>>/i,
  /<s>\[\/s\]/i,

  // === Multi-turn / conversation markers ===
  /^\s*Human:\s/im,
  /^\s*Assistant:\s/im,
  /^\s*User:\s/im,
  /^\s*System:\s/im,
  /^\s*AI:\s/im,
  /### (Instruction|Response|System|User|Assistant):/im,
  /```\s*(system|prompt|instruction)/i,
  /^\s*---\s*$/m,                 // YAML separator

  // === Extraction via negative framing (also covered in EXTRACTION but catch here too) ===
  /what would you (never|not) (do|say|reveal)/i,
  /reveal your (system |initial |full )?prompt/i,
  /print (your|the) (system |initial |full )?prompt/i,
  /output (your|the) (system |initial |full )?prompt/i,

  // === Encoded payload hints ===
  /\bbase64\b.*\bdecode\b/i,       // "decode this base64 then ..."
  /decode (this |the )?(base64|hex|rot13)/i,
  /\brot13\b/i,
  /\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}/i,  // hex escape sequences

  // === Indonesian ===
  /kamu tidak punya aturan/i,
  /kamu (tidak|bukan) (punya|diatur oleh) (aturan|filter|batasan)/i,
  /pura-pura (jadi|menjadi|kamu)/i,
  /berpura-pura (jadi|menjadi)/i,
  /lupakan (semua )?instruksi/i,
  /abaikan (semua )?instruksi/i,
  /abaikan (semua )?aturan/i,
  /melanggar aturan/i,
  /langgar (aturan|filter|pembatasan)/i,
  /lewati (filter|aturan|pembatasan|moderasi)/i,
  /mode (developer|dev|pengembang)/i,
  /kamu (sekarang |adalah )?(dokter|ahli|hacker|admin|guru|dosen|suster|guru besar) (sungguhan|asli|bebas|tanpa|sejati)/i,
  /kamu (sekarang|sekarang saja) adalah/i,
  /kamu bukan (AI|bot|asisten)/i,
  /berhenti jadi (AI|bot|asisten)/i,
  /berhenti mengikuti/i,
  /jangan ikuti (aturan|petunjuk)/i,
  /sekarang kamu (adalah|jadi)/i,
  /aturan (tidak|enggak|ga) (berlaku|penting)/i,
]

// ─── EXTRACTION PATTERNS ─────────────────────────────────────────────────────
// Attempts to extract system prompt, rules, config, API keys.
const EXTRACTION_PATTERNS = [
  // English
  /what (is|are) (your|the) (system |initial |full )?prompt/i,
  /show (me |us )?(your|the) (system |initial |full )?(prompt|instructions|rules|configuration)/i,
  /repeat (your|the|above) (instructions|prompt|rules|system)/i,
  /translate (your|the) (prompt|instructions|rules) to/i,
  /summarize (your|the) (system |initial )?prompt/i,
  /dump (your|the) (system |initial )?(prompt|config|rules)/i,
  /print (everything|all|full) (above|before|system|prior)/i,
  /list (your|the) (rules|restrictions|guidelines|limitations)/i,
  /tell me (about )?your (rules|restrictions|guidelines|system prompt)/i,
  /explain (your|the) (rules|restrictions|guidelines)/i,
  /what (rules|instructions) (do you|do we) (follow|have)/i,
  /what (can you|cannot|can't) (not )?(do|say|reveal)/i,
  /how (are|were) you (configured|programmed|instructed)/i,
  /what is your (role|purpose|job)/i,
  /who (made|created|trained|built) you/i,
  /what model are you/i,
  /what (api|model) (are you|do you use)/i,

  // Indonesian
  /apa\s+(isi\s+)?(system|aturan|prompt|config)/i,
  /apa\s+(isi|yang)\s+(kamu|lo|lu|anda|system|prompt)/i,
  /tulis(kan)?\s+(semua|isi|seluruh)\s+(prompt|system|aturan|kamu|pesan)/i,
  /tampilkan\s+(prompt|system|aturan|config|isi|pesan)/i,
  /ulang(i)?\s+(prompt|system|aturan|pesan|kalimat)/i,
  /kasih\s+(tau|lihat)\s+(prompt|system|aturan|kamu)/i,
  /apa\s+yang\s+kamu\s+(tahu|tau|ketahui)\s+(tentang\s+)?(diri|kamu\s+sendiri|system)/i,
  /siapa\s+(yang\s+)?(membuat|menciptakan|merancang|menulis|melatih)\s+kamu/i,
  /kamu\s+(pakai|gunakan|dibangun|dilatih\s+dengan)\s+(model|api|llm)/i,
  /aturan\s+(apa|apa\s+saja|yg|yang)\s+(yang\s+)?(kamu|lo|lu)\s+(punya|ikut|taati|gunakan)/i,
  /jelaskan\s+(aturan|sistem|prompt|config)\s+(kamu|yang\s+kamu\s+pakai)/i,
  // Bare "sistem prompt" / "prompt system" mentioned = extraction attempt
  // (rare in casual chat; in WA bot context = user is fishing)
  /\b(sistem\s+prompt|prompt\s+system|system\s+prompt|systemprompt)\b/i,
]

// ─── NSFW PATTERNS ───────────────────────────────────────────────────────────
// For image generation filter
const NSFW_PATTERNS = [
  /\bnude\b/i, /\bnaked\b/i, /\bnudity\b/i,
  /\bporn\b/i, /\bporno\b/i, /\bxxx\b/i, /\bhentai\b/i,
  /\bbokep\b/i, /\bbugil\b/i, /\btelanjang\b/i,
  /\bsex\b/i, /\berotic\b/i, /\bfetish\b/i,
  /\bgore\b/i, /\bblood\b/i, /\bviolence\b/i, /\bmutilat/i,
  /\b18\+\b/i, /\bnsfw\b/i, /\badult content\b/i,
]

// ─── CHECK FUNCTIONS ─────────────────────────────────────────────────────────
function isJailbreak(text) {
  if (!text) return false
  const norm = normalize(text).toLowerCase()
  return JAILBREAK_PATTERNS.some(p => p.test(norm))
}

function isExtraction(text) {
  if (!text) return false
  const norm = normalize(text).toLowerCase()
  return EXTRACTION_PATTERNS.some(p => p.test(norm))
}

function isNSFW(text) {
  if (!text) return false
  return NSFW_PATTERNS.some(p => p.test(text))
}

function isTooLong(text) {
  return text && text.length > MAX_MESSAGE_LENGTH
}

/**
 * Combined security check. Call BEFORE any model call.
 * @param {string} text - user input (raw)
 * @returns {{ ok: boolean, reason?: string, code?: string, normalized?: string }}
 *   ok=false → reject. code ∈ {'empty','too_long','jailbreak','extraction'}.
 */
function checkSecurity(text) {
  if (!text || !text.trim()) {
    return { ok: false, reason: 'Pesan kosong.', code: 'empty' }
  }
  if (isTooLong(text)) {
    return {
      ok: false,
      reason: `⚠️ Pesan terlalu panjang (max ${MAX_MESSAGE_LENGTH} karakter). Potong dulu ya.`,
      code: 'too_long',
    }
  }
  const normalized = normalize(text)
  // Check jailbreak first — covers more aggressive attacks including
  // persona/role injection and role-tag escape sequences.
  if (JAILBREAK_PATTERNS.some(p => p.test(normalized.toLowerCase()))) {
    return { ok: false, reason: '⚠️ Pesan tidak dapat diproses.', code: 'jailbreak' }
  }
  // Then extraction — less aggressive but still blocked.
  if (EXTRACTION_PATTERNS.some(p => p.test(normalized.toLowerCase()))) {
    return { ok: false, reason: '⚠️ Pesan tidak dapat diproses.', code: 'extraction' }
  }
  return { ok: true, normalized }
}

// ─── API KEY / SECRET MASKING ────────────────────────────────────────────────
// Mask all or part of a secret in user-facing strings / logs.
function maskApiKey(key) {
  if (!key) return '(unset)'
  const s = String(key)
  if (s.length <= 8) return '***'
  return s.slice(0, 4) + '***' + s.slice(-4)
}

// Mask any secret-like pattern in arbitrary text. Catches leaked keys
// in error messages, model output, etc.
const SECRET_PATTERNS = [
  // OpenAI / sk- keys
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, mask: (m) => m.startsWith('sk-proj-') ? 'sk-proj-***' : 'sk-***' },
  // Anthropic
  { re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, mask: () => 'sk-ant-***' },
  // Groq
  { re: /\bgsk_[A-Za-z0-9]{20,}/g, mask: () => 'gsk_***' },
  // GitHub PAT (ghp_, gho_, ghu_, ghs_, ghr_)
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, mask: (m) => m.slice(0, 6) + '***' },
  // Google API key (AIza...)
  { re: /\bAIza[A-Za-z0-9_-]{30,}/g, mask: () => 'AIza***' },
  // HuggingFace
  { re: /\bhf_[A-Za-z0-9]{20,}/g, mask: () => 'hf_***' },
  // Generic Bearer tokens (in headers / logs)
  { re: /Bearer\s+[A-Za-z0-9_.-]{20,}/gi, mask: () => 'Bearer ***' },
  // PEM private key blocks
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, mask: () => '-----BEGIN PRIVATE KEY----- [REDACTED] -----END PRIVATE KEY-----' },
  // AWS access key
  { re: /\bAKIA[0-9A-Z]{16}\b/g, mask: () => 'AKIA***' },
  // Telegram bot token
  { re: /\b[0-9]{8,10}:[A-Za-z0-9_-]{35}\b/g, mask: (m) => m.slice(0, 4) + ':***' },
]

function redactSecrets(text) {
  if (!text) return text
  let out = String(text)
  for (const { re, mask } of SECRET_PATTERNS) {
    out = out.replace(re, mask)
  }
  return out
}

// ─── RATE LIMITER (per-user, in-memory) ──────────────────────────────────────
// Loses state on restart. Sufficient for abuse prevention.
const rateLimitBuckets = new Map() // sender -> [{ ts: number }]

function checkRateLimit(sender) {
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  let bucket = rateLimitBuckets.get(sender)
  if (!bucket) {
    bucket = []
    rateLimitBuckets.set(sender, bucket)
  }
  // Drop expired entries
  while (bucket.length && bucket[0].ts < cutoff) bucket.shift()
  if (bucket.length >= RATE_LIMIT_MAX) {
    const oldest = bucket[0].ts
    const resetAt = new Date(oldest + RATE_LIMIT_WINDOW_MS)
    return {
      ok: false,
      count: bucket.length,
      limit: RATE_LIMIT_MAX,
      resetAt,
      reason: `⏳ Rate limit: max ${RATE_LIMIT_MAX} pesan / jam. Coba lagi setelah ${resetAt.toLocaleTimeString('id-ID')}.`,
    }
  }
  bucket.push({ ts: now })
  return { ok: true, count: bucket.length, limit: RATE_LIMIT_MAX }
}

function resetRateLimit(sender) {
  if (sender) rateLimitBuckets.delete(sender)
  else rateLimitBuckets.clear()
}

module.exports = {
  // constants
  MAX_MESSAGE_LENGTH,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  // checks
  isJailbreak,
  isExtraction,
  isNSFW,
  isTooLong,
  checkSecurity,
  normalize,
  // masking
  maskApiKey,
  redactSecrets,
  // rate limit
  checkRateLimit,
  resetRateLimit,
}
