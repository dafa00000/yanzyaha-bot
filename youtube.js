import axios from 'axios'
const TIMEOUT = 15000
const YT_API_BASE = 'https://www.googleapis.com/youtube/v3'
export async function checkYouTubeChannel(query, apiKey) {
  if (!apiKey) throw new Error('YouTube API Key belum diset!')
  const searchRes = await axios.get(`${YT_API_BASE}/search`, { params: { part: 'snippet', q: query, type: 'channel', maxResults: 1, key: apiKey }, timeout: TIMEOUT })
  const item = searchRes.data.items?.[0]
  if (!item) throw new Error(`Channel *${query}* tidak ditemukan.`)
  const channelId = item.snippet.channelId
  const channelRes = await axios.get(`${YT_API_BASE}/channels`, { params: { part: 'statistics,snippet', id: channelId, key: apiKey }, timeout: TIMEOUT })
  const channel = channelRes.data.items?.[0]
  const { statistics: stats, snippet } = channel
  return { id: channelId, title: snippet.title, customUrl: snippet.customUrl || '-', country: snippet.country || '-', publishedAt: new Date(snippet.publishedAt).toLocaleDateString('id-ID'), subscriberCount: Number(stats.subscriberCount || 0).toLocaleString('id-ID'), viewCount: Number(stats.viewCount || 0).toLocaleString('id-ID'), videoCount: Number(stats.videoCount || 0).toLocaleString('id-ID'), hiddenSubscribers: stats.hiddenSubscriberCount }
}
export function formatYouTubeChannel(data) {
  return `╔══════════════════════════╗\n║     ▶️  YOUTUBE INFO        ║\n╚══════════════════════════╝\n\n📺 *Channel    :* ${data.title}\n🔗 *Custom URL :* ${data.customUrl}\n🆔 *Channel ID :* ${data.id}\n🌍 *Negara     :* ${data.country}\n📅 *Bergabung  :* ${data.publishedAt}\n👥 *Subscriber :* ${data.hiddenSubscribers ? '(Disembunyikan)' : data.subscriberCount}\n👁️ *Total View :* ${data.viewCount}\n🎬 *Video      :* ${data.videoCount}\n\n_Ketik .yt [nama channel] untuk cek ulang_`
}
