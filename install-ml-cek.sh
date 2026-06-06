#!/data/data/com.termux/files/usr/bin/bash
# install-ml-cek.sh
# Script install handler-ml-cek.js ke folder wa-bot
# Jalankan: bash install-ml-cek.sh

set -e

# ─── Warna ───────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════╗"
echo "║   ML Checker Bot Installer   ║"
echo "╚══════════════════════════════╝"
echo -e "${NC}"

# ─── Cari folder bot ─────────────────────────────────────────────────────
BOT_DIR=""
for DIR in ~/wa-bot ~/bot ~/whatsapp-bot ~/baileys-bot; do
  if [ -d "$DIR" ]; then
    BOT_DIR="$DIR"
    break
  fi
done

if [ -z "$BOT_DIR" ]; then
  echo -e "${YELLOW}Folder bot tidak ditemukan otomatis.${NC}"
  echo -n "Masukkan path folder bot kamu: "
  read -r BOT_DIR
fi

if [ ! -d "$BOT_DIR" ]; then
  echo -e "${RED}❌ Folder $BOT_DIR tidak ada!${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Folder bot: $BOT_DIR${NC}"

# ─── Backup jika sudah ada ───────────────────────────────────────────────
TARGET="$BOT_DIR/handler-ml-cek.js"
if [ -f "$TARGET" ]; then
  BACKUP="${TARGET}.backup.$(date +%Y%m%d_%H%M%S)"
  cp "$TARGET" "$BACKUP"
  echo -e "${YELLOW}📦 Backup lama disimpan: $BACKUP${NC}"
fi

# ─── Tulis file handler-ml-cek.js ────────────────────────────────────────
echo -e "${CYAN}📝 Menulis handler-ml-cek.js...${NC}"
cat > "$TARGET" << 'JSEOF'
// handler-ml-cek.js
// Cek info akun Mobile Legends via WhatsApp Bot (Baileys - ES Module)
// Commands: .cekml .mlinfo .mlacc .mltaut .mlzone

const API_CFG = {
  detail:   'https://api.gamefox.id/game/ml/detail',
  binding:  'https://api.gamefox.id/game/ml/binding',
  validate: 'https://api.gamefox.id/game/ml/info',
  apiKey:   '',
}

const ZONE_LIST = {
  '1':'Indonesia (ID)','2':'Malaysia (MY)','3':'Thailand (TH)',
  '4':'Philippines (PH)','5':'Singapore (SG)','6':'Vietnam (VN)',
  '7':'Myanmar (MM)','8':'Cambodia (KH)','9':'Taiwan (TW)',
  '10':'Hong Kong (HK)','11':'India (IN)','12':'Brazil (BR)',
  '13':'USA (US)','14':'Europe (EU)','15':'Middle East (ME)',
  '16':'Russia (RU)','17':'Turkey (TR)','18':'Saudi Arabia (SA)',
}

async function kirim(sock, msg, text) {
  return sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg })
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    clearTimeout(timer); return res
  } catch (err) { clearTimeout(timer); throw err }
}

function getField(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  }
  return null
}

function formatDate(val) {
  if (!val) return '❓ Tidak tersedia'
  try {
    const num = Number(val)
    const d = !isNaN(num) ? new Date(num * (num < 1e12 ? 1000 : 1)) : new Date(val)
    if (isNaN(d.getTime())) return String(val)
    return d.toLocaleDateString('id-ID', {
      day:'2-digit', month:'long', year:'numeric',
      hour:'2-digit', minute:'2-digit', timeZone:'Asia/Jakarta'
    }) + ' WIB'
  } catch { return String(val) }
}

function bindEmoji(val) {
  if (val === null) return null
  const v = String(val).toLowerCase()
  if (v==='1'||v==='true'||v==='yes') return '✅'
  if (v==='0'||v==='false'||v==='no') return '❌'
  return `✅ ${val}`
}

async function fetchMLInfo(uid, zone) {
  const headers = {'Content-Type':'application/json'}
  if (API_CFG.apiKey) headers['Authorization'] = `Bearer ${API_CFG.apiKey}`
  const attempts = [
    () => fetchWithTimeout(`${API_CFG.detail}?uid=${uid}&zone=${zone}`, {headers}),
    () => fetchWithTimeout(`${API_CFG.validate}?user_id=${uid}&zone_id=${zone}`, {headers}),
    () => fetchWithTimeout(API_CFG.detail, {method:'POST',headers,body:JSON.stringify({uid,zone})}),
  ]
  for (const attempt of attempts) {
    try {
      const res = await attempt()
      if (!res.ok) continue
      const data = await res.json()
      if (data && (data.data||data.result||data.nickname||data.username))
        return {ok:true, data:data.data||data.result||data}
    } catch { continue }
  }
  return {ok:false}
}

async function fetchMLBinding(uid, zone) {
  const headers = {'Content-Type':'application/json'}
  if (API_CFG.apiKey) headers['Authorization'] = `Bearer ${API_CFG.apiKey}`
  const attempts = [
    () => fetchWithTimeout(`${API_CFG.binding}?uid=${uid}&zone=${zone}`, {headers}),
    () => fetchWithTimeout(API_CFG.binding, {method:'POST',headers,body:JSON.stringify({uid,zone})}),
  ]
  for (const attempt of attempts) {
    try {
      const res = await attempt()
      if (!res.ok) continue
      const data = await res.json()
      if (data && (data.data||data.result||data.binding))
        return {ok:true, data:data.data||data.result||data}
    } catch { continue }
  }
  return {ok:false}
}

function formatMLInfo(uid, zone, d={}) {
  const nickname = getField(d,'nickname','username','name','player_name') || '❓'
  const level    = getField(d,'level','exp_level','player_level') || '❓'
  const server   = getField(d,'server_name','zone_name','region') || ZONE_LIST[zone] || zone
  const rank     = getField(d,'rank','rank_name','tier','badge_name') || '❓'
  const created  = getField(d,'created_at','create_time','register_time','reg_date','join_date')
  const lastLogin= getField(d,'last_login','last_login_time','login_time')
  const hero     = getField(d,'hero_count','total_hero','heroes')
  const skin     = getField(d,'skin_count','total_skin','skins')
  const diamond  = getField(d,'diamond','gems','currency')
  let msg = `╔══════════════════╗\n║  🎮 *CEKML - INFO AKUN*  ║\n╚══════════════════╝\n\n`
  msg += `👤 *Nickname* : ${nickname}\n🆔 *UID*      : \`${uid}\`\n🌐 *Zone*     : ${zone} — ${server}\n⭐ *Level*    : ${level}\n🏆 *Rank*     : ${rank}\n`
  if (hero)    msg += `🦸 *Hero*     : ${hero}\n`
  if (skin)    msg += `👘 *Skin*     : ${skin}\n`
  if (diamond) msg += `💎 *Diamond* : ${diamond}\n`
  msg += `\n📅 *Tanggal Buat*   : ${formatDate(created)}\n`
  if (lastLogin) msg += `🕐 *Login Terakhir* : ${formatDate(lastLogin)}\n`
  return msg
}

function formatMLBinding(uid, zone, d={}) {
  const facebook = getField(d,'facebook','fb','fb_binding','isFacebook','is_facebook')
  const google   = getField(d,'google','gg','google_binding','isGoogle','is_google')
  const moonton  = getField(d,'moonton','email','moonton_binding','isMoonton','is_moonton')
  const apple    = getField(d,'apple','apple_binding','isApple','is_apple')
  const huawei   = getField(d,'huawei','hms','huawei_binding','isHuawei','is_huawei')
  let msg = `╔══════════════════╗\n║  🔗 *AKUN TERKAIT ML*   ║\n╚══════════════════╝\n\n`
  msg += `🆔 UID: \`${uid}\` | Zone: ${zone}\n\n`
  msg += `${bindEmoji(facebook)??'❓'} Facebook\n${bindEmoji(google)??'❓'}   Google\n${bindEmoji(moonton)??'❓'}  Moonton/Email\n`
  if (apple !== null)  msg += `${bindEmoji(apple)??'❓'}   Apple\n`
  if (huawei !== null) msg += `${bindEmoji(huawei)??'❓'}  Huawei\n`
  const anyFound = [facebook,google,moonton,apple,huawei].some(v=>v!==null)
  if (!anyFound) msg += `\n⚠️ API tidak mengembalikan data binding.\n`
  return msg
}

export async function handleCekML(sock, msg, text) {
  try {
    const args = (text||'').trim().split(/\s+/).slice(1)
    const uid  = args[0], zone = args[1]||'1'
    if (!uid) {
      return kirim(sock,msg,`🎮 *Cek Akun ML*\n\nGunakan: \`.cekml <uid> <zone>\`\nContoh: \`.cekml 123456789 1\`\n\nKetik \`.mlzone\` untuk daftar zone`)
    }
    if (!/^\d+$/.test(uid)) return kirim(sock,msg,`❌ UID harus angka!\nContoh: \`.cekml 123456789 1\``)
    await kirim(sock,msg,`⏳ Mengecek akun ML...\n\nUID: \`${uid}\` | Zone: ${zone}`)
    const [infoRes,bindRes] = await Promise.allSettled([fetchMLInfo(uid,zone),fetchMLBinding(uid,zone)])
    const infoOk = infoRes.status==='fulfilled'&&infoRes.value.ok
    const bindOk = bindRes.status==='fulfilled'&&bindRes.value.ok
    if (!infoOk&&!bindOk) return kirim(sock,msg,`❌ Gagal ambil data!\n\nUID/Zone mungkin salah atau API down.\nUID: \`${uid}\` | Zone: \`${zone}\``)
    let reply = ''
    if (infoOk) reply += formatMLInfo(uid,zone,infoRes.value.data)+'\n'
    if (bindOk) reply += formatMLBinding(uid,zone,bindRes.value.data)
    else reply += `\n⚠️ _Data binding tidak tersedia dari provider ini._`
    reply += `\n\n_Powered by ML Checker Bot_ 🤖`
    await kirim(sock,msg,reply.trim())
  } catch(err) { console.error('[handleCekML]',err.message); await kirim(sock,msg,`❌ Error: ${err.message}`) }
}

export async function handleMLAcc(sock, msg, text) {
  try {
    const args = (text||'').trim().split(/\s+/).slice(1)
    const uid  = args[0], zone = args[1]||'1'
    if (!uid||!/^\d+$/.test(uid)) return kirim(sock,msg,`🔗 \`.mlacc <uid> <zone>\`\nContoh: \`.mlacc 123456789 1\``)
    await kirim(sock,msg,`⏳ Mengecek binding...\nUID: \`${uid}\` | Zone: ${zone}`)
    const res = await fetchMLBinding(uid,zone)
    if (!res.ok) return kirim(sock,msg,`❌ Gagal ambil data binding!\nUID: \`${uid}\` | Zone: \`${zone}\``)
    await kirim(sock,msg,formatMLBinding(uid,zone,res.data))
  } catch(err) { console.error('[handleMLAcc]',err.message) }
}

export async function handleMLZone(sock, msg) {
  let list = `🌐 *Daftar Zone Mobile Legends*\n\n`
  for (const [id,name] of Object.entries(ZONE_LIST)) list += `\`${id.padStart(2,' ')}\` — ${name}\n`
  list += `\nContoh: \`.cekml 123456789 1\``
  await kirim(sock,msg,list)
}

export async function execute(sock, msg, body, sender) {
  const text = (body||'').trim().toLowerCase()
  if (text.startsWith('.cekml')||text.startsWith('.mlinfo')) { await handleCekML(sock,msg,body); return true }
  if (text.startsWith('.mlacc')||text.startsWith('.mltaut')) { await handleMLAcc(sock,msg,body); return true }
  if (text==='.mlzone') { await handleMLZone(sock,msg); return true }
  return false
}

export async function handleMLMenu(sock, msg) {
  await kirim(sock,msg,
    `🎮 *Menu Cek Mobile Legends*\n\n`+
    `🔍 \`.cekml <uid> <zone>\` — Info akun lengkap\n`+
    `🔗 \`.mlacc <uid> <zone>\` — Cek akun terkait\n`+
    `🌐 \`.mlzone\` — Daftar zone\n\n`+
    `Contoh: \`.cekml 123456789 1\``
  )
}
JSEOF

echo -e "${GREEN}✅ handler-ml-cek.js berhasil dibuat!${NC}"

# ─── Patch index.js / handler.js ─────────────────────────────────────────
echo ""
echo -e "${CYAN}🔧 Mencari file handler utama...${NC}"

INDEX_FILE=""
for F in "$BOT_DIR/index.js" "$BOT_DIR/handler.js" "$BOT_DIR/src/index.js"; do
  if [ -f "$F" ]; then
    INDEX_FILE="$F"
    break
  fi
done

if [ -n "$INDEX_FILE" ]; then
  echo -e "${GREEN}✅ Ditemukan: $INDEX_FILE${NC}"
  echo ""
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}Tambahkan kode ini ke $INDEX_FILE secara manual:${NC}"
  echo ""
  echo -e "${CYAN}// Di bagian import (atas file):${NC}"
  echo "import { execute as mlCek } from './handler-ml-cek.js'"
  echo ""
  echo -e "${CYAN}// Di dalam message handler (sebelum handler lain):${NC}"
  echo "if (await mlCek(sock, m, body, sender)) return"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
else
  echo -e "${YELLOW}⚠️ File handler utama tidak ditemukan otomatis.${NC}"
  echo "Tambahkan manual ke handler/index.js kamu:"
  echo ""
  echo "import { execute as mlCek } from './handler-ml-cek.js'"
  echo "if (await mlCek(sock, m, body, sender)) return"
fi

echo ""
echo -e "${GREEN}${BOLD}✅ Instalasi selesai!${NC}"
echo ""
echo -e "${CYAN}Commands yang tersedia:${NC}"
echo "  .cekml <uid> <zone>  — Info lengkap akun ML"
echo "  .mlacc <uid> <zone>  — Cek akun terkait"
echo "  .mlzone              — Daftar zone"
echo ""
echo -e "${YELLOW}⚠️  PENTING: Ganti URL API di handler-ml-cek.js${NC}"
echo "   Buka file dan ubah bagian API_CFG sesuai provider kamu"
echo ""
JSEOF

chmod +x /mnt/user-data/outputs/install-ml-cek.sh
