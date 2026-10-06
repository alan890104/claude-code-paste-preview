// Just enough PNG for the end-to-end checks: write a picture to put on the clipboard and
// hand the editor, and read back what came out, with Node's zlib and nothing else.

import { deflateSync, inflateSync } from 'node:zlib'

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = bytes => {
  let c = 0xffffffff
  for (const b of bytes) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  data.copy(out, 8)
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

// RGBA pixels, row by row, to a PNG.
export const encode = (width, height, rgba) => {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

// A PNG of 8-bit grey, grey and alpha, RGB or RGBA, not interlaced, to RGBA pixels.
export const decode = file => {
  if (file.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let at = 8
  let width = 0, height = 0, depth = 0, type = 0, interlace = 0
  const data = []
  while (at < file.length) {
    const length = file.readUInt32BE(at)
    const kind = file.toString('latin1', at + 4, at + 8)
    const body = file.subarray(at + 8, at + 8 + length)
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      type = body[9]
      interlace = body[12]
    } else if (kind === 'IDAT') data.push(body)
    at += 12 + length
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type]
  if (depth !== 8 || channels === undefined || interlace !== 0) throw new Error(`PNG kind not read here: depth ${depth}, type ${type}, interlace ${interlace}`)
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const corner = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
      const p = left + up - corner
      const near = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner
      const add = [0, left, up, (left + up) >> 1, near][filter]
      pixels[y * stride + x] = (line[x] + add) & 0xff
    }
  }
  const rgba = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const s = pixels.subarray(i * channels, i * channels + channels)
    const [r, g, b, a] = channels === 1 ? [s[0], s[0], s[0], 255] : channels === 2 ? [s[0], s[0], s[0], s[1]] : channels === 3 ? [s[0], s[1], s[2], 255] : [s[0], s[1], s[2], s[3]]
    rgba.set([r, g, b, a], i * 4)
  }
  return { width, height, rgba }
}

export const pixel = (image, x, y) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
