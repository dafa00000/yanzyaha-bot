import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

export async function makeSticker(buffer) {
  try {
    const tmpIn = path.join(tmpdir(), `sticker_in_${Date.now()}`)
    const tmpOut = path.join(tmpdir(), `sticker_out_${Date.now()}.webp`)
    writeFileSync(tmpIn, buffer)
    execSync(`ffmpeg -y -i "${tmpIn}" -vf "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2" "${tmpOut}"`, { stdio: 'pipe' })
    const result = readFileSync(tmpOut)
    unlinkSync(tmpIn)
    unlinkSync(tmpOut)
    return result
  } catch (err) {
    throw new Error(`Gagal buat stiker: ${err.message}`)
  }
}

export async function stickerToImage(buffer) {
  try {
    const tmpIn = path.join(tmpdir(), `toimg_in_${Date.now()}.webp`)
    const tmpOut = path.join(tmpdir(), `toimg_out_${Date.now()}.png`)
    writeFileSync(tmpIn, buffer)
    execSync(`ffmpeg -y -i "${tmpIn}" "${tmpOut}"`, { stdio: 'pipe' })
    const result = readFileSync(tmpOut)
    unlinkSync(tmpIn)
    unlinkSync(tmpOut)
    return result
  } catch (err) {
    throw new Error(`Gagal konversi stiker: ${err.message}`)
  }
}
