import { Jimp, JimpMime } from 'jimp'

export async function makeSticker(buffer) {
  try {
    const image = await Jimp.read(buffer)
    image.resize({ w: 512, h: 512 })
    const pngBuffer = await image.getBuffer(JimpMime.png)
    return pngBuffer
  } catch (err) {
    throw new Error(`Gagal buat stiker: ${err.message}`)
  }
}

export async function stickerToImage(buffer) {
  try {
    const image = await Jimp.read(buffer)
    const pngBuffer = await image.getBuffer(JimpMime.png)
    return pngBuffer
  } catch (err) {
    throw new Error(`Gagal konversi stiker: ${err.message}`)
  }
}
