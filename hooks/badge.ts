// The close badge: a round dark button with a white cross in each thumbnail's top right
// corner, drawn into the picture's own pixels so it is round on every terminal (a glyph
// would be a cell, square). No system tool reads a PNG's pixels on Linux and Windows,
// and a mod has no zlib, so the PNG is read here: inflate, unfilter, then scaled to the
// cells the band gives it. What the band draws is then raw RGBA, which an Image takes.

// The pixels behind one terminal cell, twice as tall as wide like the cell itself, so a
// circle in these pixels is a circle on screen.
export const CELL_PX = { width: 10, height: 20 }
// The largest side of the copy kept per picture, from which each size is scaled.
const BASE_PX = 480

export type Pixels = { width: number; height: number; rgba: Uint8Array }

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

// A canonical Huffman code as one table indexed by the next `bits` bits of the stream
// (which come least significant first): each entry is symbol << 4 | its code's length.
type Code = { table: Int32Array; bits: number }

const codeOf = (lengths: ArrayLike<number>): Code => {
  let bits = 0
  for (let i = 0; i < lengths.length; i++) bits = Math.max(bits, lengths[i]!)
  const table = new Int32Array(1 << Math.max(1, bits)).fill(-1)
  const counts = new Array<number>(16).fill(0)
  for (let i = 0; i < lengths.length; i++) if (lengths[i]! > 0) counts[lengths[i]!]! += 1
  const next = new Array<number>(16).fill(0)
  for (let len = 1, code = 0; len < 16; len++) {
    code = (code + counts[len - 1]!) << 1
    next[len] = code
  }
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const len = lengths[symbol]!
    if (len === 0) continue
    const code = next[len]!++
    let reversed = 0
    for (let i = 0; i < len; i++) reversed |= ((code >> i) & 1) << (len - 1 - i)
    for (let i = reversed; i < table.length; i += 1 << len) table[i] = (symbol << 4) | len
  }
  return { table, bits: Math.max(1, bits) }
}

const FIXED_LITERALS = codeOf([...new Array(144).fill(8), ...new Array(112).fill(9), ...new Array(24).fill(7), ...new Array(8).fill(8)])
const FIXED_DISTANCES = codeOf(new Array(30).fill(5))

// A zlib stream inflated into `out`, which the caller sizes (a PNG says how much it holds).
export const inflate = (data: Uint8Array, out: Uint8Array): number => {
  let at = 2
  let buffer = 0
  let held = 0
  let written = 0
  const need = (n: number) => {
    while (held < n) {
      if (at >= data.length) throw new Error('inflate: the stream ends early')
      buffer |= data[at++]! << held
      held += 8
    }
  }
  const take = (n: number) => {
    if (n === 0) return 0
    need(n)
    const value = buffer & ((1 << n) - 1)
    buffer >>>= n
    held -= n
    return value
  }
  const symbol = ({ table, bits }: Code) => {
    while (held < bits && at < data.length) {
      buffer |= data[at++]! << held
      held += 8
    }
    const entry = table[buffer & ((1 << bits) - 1)]!
    const len = entry & 15
    if (entry < 0 || len > held) throw new Error('inflate: a bad code')
    buffer >>>= len
    held -= len
    return entry >> 4
  }
  for (let isLast = false; !isLast; ) {
    isLast = take(1) === 1
    const kind = take(2)
    if (kind === 0) {
      // To the next byte; whole bytes already read ahead go back to the stream.
      take(held & 7)
      at -= held >> 3
      buffer = 0
      held = 0
      const len = data[at]! | (data[at + 1]! << 8)
      at += 4
      if (at + len > data.length || written + len > out.length) throw new Error('inflate: a stored block runs over')
      out.set(data.subarray(at, at + len), written)
      at += len
      written += len
      continue
    }
    let literals = FIXED_LITERALS
    let distances = FIXED_DISTANCES
    if (kind === 2) {
      const literalCount = take(5) + 257
      const distanceCount = take(5) + 1
      const lengthCount = take(4) + 4
      const lengthLengths = new Uint8Array(19)
      for (let i = 0; i < lengthCount; i++) lengthLengths[CODE_LENGTH_ORDER[i]!] = take(3)
      const lengthCode = codeOf(lengthLengths)
      const lengths = new Uint8Array(literalCount + distanceCount)
      for (let i = 0; i < lengths.length; ) {
        const s = symbol(lengthCode)
        if (s < 16) lengths[i++] = s
        else {
          const [value, times] = s === 16 ? [lengths[i - 1] ?? 0, 3 + take(2)] : s === 17 ? [0, 3 + take(3)] : [0, 11 + take(7)]
          if (i + times > lengths.length) throw new Error('inflate: lengths run over')
          lengths.fill(value, i, i + times)
          i += times
        }
      }
      literals = codeOf(lengths.subarray(0, literalCount))
      distances = codeOf(lengths.subarray(literalCount))
    } else if (kind !== 1) throw new Error('inflate: a bad block')
    for (;;) {
      const s = symbol(literals)
      if (s < 256) {
        if (written >= out.length) throw new Error('inflate: the output runs over')
        out[written++] = s
        continue
      }
      if (s === 256) break
      const len = LENGTH_BASE[s - 257]! + take(LENGTH_EXTRA[s - 257]!)
      const d = symbol(distances)
      const distance = DISTANCE_BASE[d]! + take(DISTANCE_EXTRA[d]!)
      if (distance > written || written + len > out.length) throw new Error('inflate: a bad match')
      for (let i = 0; i < len; i++, written++) out[written] = out[written - distance]!
    }
  }
  return written
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

// A whole PNG's pixels as RGBA, or undefined for one this does not read (interlaced).
export const decodePng = (bytes: Uint8Array): Pixels | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return undefined
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let palette: Uint8Array | undefined
  let alphas: Uint8Array | undefined
  const parts: Uint8Array[] = []
  for (let at = 8; at + 8 <= bytes.length; ) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!)
    const body = bytes.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      depth = bytes[at + 16]!
      colorType = bytes[at + 17]!
      if (bytes[at + 20] !== 0) return undefined
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') alphas = body
    else if (type === 'IDAT') parts.push(body)
    else if (type === 'IEND') break
    at += 12 + len
  }
  const channels = CHANNELS[colorType]
  if (channels === undefined || width === 0 || height === 0 || ![1, 2, 4, 8, 16].includes(depth)) return undefined
  if (colorType === 3 && palette === undefined) return undefined
  const stream = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0))
  parts.reduce((at, p) => (stream.set(p, at), at + p.length), 0)
  const stride = Math.ceil((width * channels * depth) / 8)
  const raw = new Uint8Array(height * (stride + 1))
  if (inflate(stream, raw) !== raw.length) return undefined
  const step = Math.max(1, (channels * depth) / 8)
  const rows = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const at = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= step ? rows[at + x - step]! : 0
      const b = y > 0 ? rows[at - stride + x]! : 0
      const c = x >= step && y > 0 ? rows[at - stride + x - step]! : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      const predicted = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0
      rows[at + x] = (line[x]! + predicted) & 255
    }
  }
  const rgba = new Uint8Array(width * height * 4)
  const sample = (y: number, i: number) => {
    if (depth === 8) return rows[y * stride + i]!
    if (depth === 16) return rows[y * stride + i * 2]!
    const bit = i * depth
    return (rows[y * stride + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
  }
  const wide = depth < 8 && colorType !== 3 ? 255 / ((1 << depth) - 1) : 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const i = x * channels
      if (colorType === 3) {
        const index = sample(y, i)
        rgba[o] = palette![index * 3] ?? 0
        rgba[o + 1] = palette![index * 3 + 1] ?? 0
        rgba[o + 2] = palette![index * 3 + 2] ?? 0
        rgba[o + 3] = alphas?.[index] ?? 255
      } else if (channels <= 2) {
        const gray = Math.round(sample(y, i) * wide)
        rgba[o] = rgba[o + 1] = rgba[o + 2] = gray
        rgba[o + 3] = channels === 2 ? sample(y, i + 1) : 255
      } else {
        rgba[o] = sample(y, i)
        rgba[o + 1] = sample(y, i + 1)
        rgba[o + 2] = sample(y, i + 2)
        rgba[o + 3] = channels === 4 ? sample(y, i + 3) : 255
      }
    }
  }
  return { width, height, rgba }
}

// Each target pixel the average of the source pixels it covers (the nearest one when
// it covers less than one), weighted by their opacity so a transparent edge stays clean.
export const resize = (from: Pixels, width: number, height: number): Pixels => {
  const rgba = new Uint8Array(width * height * 4)
  for (let ty = 0; ty < height; ty++) {
    const y0 = Math.floor((ty * from.height) / height)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * from.height) / height))
    for (let tx = 0; tx < width; tx++) {
      const x0 = Math.floor((tx * from.width) / width)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * from.width) / width))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * from.width + x) * 4
          const alpha = from.rgba[o + 3]!
          r += from.rgba[o]! * alpha
          g += from.rgba[o + 1]! * alpha
          b += from.rgba[o + 2]! * alpha
          a += alpha
        }
      }
      const o = (ty * width + tx) * 4
      const count = (y1 - y0) * (x1 - x0)
      if (a > 0) {
        rgba[o] = Math.round(r / a)
        rgba[o + 1] = Math.round(g / a)
        rgba[o + 2] = Math.round(b / a)
      }
      rgba[o + 3] = Math.round(a / count)
    }
  }
  return { width, height, rgba }
}

// The copy kept per picture: at most BASE_PX on its longer side.
export const baseOf = (pixels: Pixels): Pixels => {
  const scale = Math.min(1, BASE_PX / Math.max(pixels.width, pixels.height))
  return scale === 1 ? pixels : resize(pixels, Math.max(1, Math.round(pixels.width * scale)), Math.max(1, Math.round(pixels.height * scale)))
}

// Where the badge sits on a thumbnail of `columns` by `rows` cells, in pixels: its
// centre a little in from the top right corner, smaller on a thumbnail one row tall.
export const badgeAt = (columns: number, rows: number) => {
  const width = columns * CELL_PX.width
  const height = rows * CELL_PX.height
  const radius = Math.max(4, Math.min(11, Math.floor(Math.min(width, height) / 2) - 2))
  const margin = Math.min(4, Math.floor(height / 2 - radius))
  return { x: width - radius - margin, y: radius + margin, radius }
}

// Whether a point of the thumbnail, in cells from its top left corner, is on the badge;
// a little past its edge counts, as a fingertip would.
export const isOnBadge = (x: number, y: number, columns: number, rows: number) => {
  const badge = badgeAt(columns, rows)
  const dx = x * CELL_PX.width - badge.x
  const dy = y * CELL_PX.height - badge.y
  return Math.hypot(dx, dy) <= badge.radius + CELL_PX.width / 2
}

const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

const blend = (rgba: Uint8Array, o: number, [r, g, b]: readonly [number, number, number], alpha: number) => {
  if (alpha <= 0) return
  const under = rgba[o + 3]! / 255
  const out = alpha + under * (1 - alpha)
  rgba[o] = Math.round((r * alpha + rgba[o]! * under * (1 - alpha)) / out)
  rgba[o + 1] = Math.round((g * alpha + rgba[o + 1]! * under * (1 - alpha)) / out)
  rgba[o + 2] = Math.round((b * alpha + rgba[o + 2]! * under * (1 - alpha)) / out)
  rgba[o + 3] = Math.round(out * 255)
}

// The picture scaled to `columns` by `rows` cells with the badge drawn on it, edges
// smoothed by how much of each pixel the shape covers.
export const withBadge = (base: Pixels, columns: number, rows: number): Pixels => {
  const out = resize(base, columns * CELL_PX.width, rows * CELL_PX.height)
  const { x: cx, y: cy, radius } = badgeAt(columns, rows)
  const arm = radius * 0.42
  const stroke = Math.max(1.5, radius * 0.22) / 2
  for (let y = Math.max(0, Math.floor(cy - radius - 1)); y < Math.min(out.height, Math.ceil(cy + radius + 1)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius - 1)); x < Math.min(out.width, Math.ceil(cx + radius + 1)); x++) {
      const px = x + 0.5
      const py = y + 0.5
      const o = (y * out.width + x) * 4
      const disc = Math.max(0, Math.min(1, radius + 0.5 - Math.hypot(px - cx, py - cy)))
      blend(out.rgba, o, [0, 0, 0], disc * 0.85)
      const cross = Math.min(distanceToSegment(px, py, cx - arm, cy - arm, cx + arm, cy + arm), distanceToSegment(px, py, cx - arm, cy + arm, cx + arm, cy - arm))
      blend(out.rgba, o, [255, 255, 255], Math.max(0, Math.min(1, stroke + 0.5 - cross)))
    }
  }
  return out
}

// Bytes as base64, a slice at a time so no call takes too many arguments.
export const toBase64 = (bytes: Uint8Array) => {
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}

// The text without one `[Image #N]`, and one space beside it so no double space is left,
// with the caret moved to stay where it was in what remains.
export const withoutPlaceholder = (text: string, cursor: number, n: number) => {
  const token = `[Image #${n}]`
  let start = text.indexOf(token)
  if (start === -1) return { text, cursor }
  let end = start + token.length
  if (text[end] === ' ') end += 1
  else if (start > 0 && text[start - 1] === ' ') start -= 1
  const moved = cursor >= end ? cursor - (end - start) : cursor > start ? start : cursor
  return { text: text.slice(0, start) + text.slice(end), cursor: moved }
}
