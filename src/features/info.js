import os from 'os'

/**
 * Dapatkan informasi sistem
 */
export function getInfo() {
  const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0)
  const freeMem = (os.freemem() / 1024 / 1024).toFixed(0)
  const usedMem = (totalMem - freeMem).toFixed(0)

  return {
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    totalMem: `${totalMem} MB`,
    freeMem: `${freeMem} MB`,
    usedMem: `${usedMem} MB`,
    uptime: formatUptime(process.uptime())
  }
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}j ${m}m ${s}d`
}
