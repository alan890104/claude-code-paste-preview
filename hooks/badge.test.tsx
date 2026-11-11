import { expect, test } from 'claude-code/testing'

import { badgeAt, decodePng, isOnBadge, withBadge, withoutPlaceholder } from './badge'
import { fromBase64 } from './platform'

// 24 by 12, made with Pillow: RGB, each pixel (x * 10, y * 20, x * y * 7) mod 256, and
// the same reduced to an 8-colour palette; both deflated with dynamic Huffman codes.
const RGB = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAMCAIAAAD3UuoiAAAAqUlEQVR42q2OIQ4CMRAAh4SEBIECdw5Xd66urq4vqMOdw/GCvuDcOf6Cw+FwPAVB9rJHe03IkYyY3U0muwK2/2DNHtgsZwztFqJDhx9JevwKNfPE6rXJQ8cpPtuMJD0WQwYMWBFNV1oOYOZCbUbMNkmPxZCFFqwQlFs4T8f+I5WPLDjw4ISTcgdJ5AHXPORVyCui8ovIHXrw8Kp8FOSjoOhEbpAgwBMGCG/MBS2N+LkRGAAAAABJRU5ErkJggg=='
const PALETTE = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAMBAMAAACKHmBGAAAAGFBMVEWqvn4yvnWqeHsyeHWqPIaqCjwyPGEyChJ1Cx/WAAAAYElEQVR42k3HsQ3CMBAAwPvINYQRYARGYCmWo2ABJC8Q5AniiN42BRS57uIOeoEE1k39pTIqMUsqvcQ8tirRctzWIo5bGi27Pj7nxeWQWualL7xNTwggTqCCCQy7xD5/X5p5ILtHnEZUAAAAAElFTkSuQmCC'

const pixelAt = (p: { width: number; rgba: Uint8Array }, x: number, y: number) => [...p.rgba.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)]

test('a PNG’s pixels are read as RGBA, from RGB and from a palette', async () => {
  const rgb = decodePng(fromBase64(RGB))!
  expect([rgb.width, rgb.height]).toEqual([24, 12])
  for (const [x, y] of [[0, 0], [23, 11], [5, 7]] as const) expect(pixelAt(rgb, x, y)).toEqual([(x * 10) % 256, (y * 20) % 256, (x * y * 7) % 256, 255])
  // As Pillow reads the palette file.
  const palette = decodePng(fromBase64(PALETTE))!
  expect(pixelAt(palette, 0, 0)).toEqual([50, 10, 18, 255])
  expect(pixelAt(palette, 23, 11)).toEqual([170, 190, 126, 255])
  expect(pixelAt(palette, 5, 7)).toEqual([50, 120, 117, 255])
  // Only a header, or not a PNG: nothing to draw a badge on.
  expect(() => decodePng(fromBase64(RGB.slice(0, 44)))).toThrow()
  expect(decodePng(new TextEncoder().encode('GIF89a'))).toBeUndefined()
})

test('the badge is drawn in the top right corner, round, and a click there is on it', async () => {
  const picture = decodePng(fromBase64(RGB))!
  const out = withBadge(picture, 28, 8)
  expect([out.width, out.height]).toEqual([280, 160])
  const { x, y, radius } = badgeAt(28, 8)
  // Dark at its centre, the picture's own at its left, white on the cross.
  expect(pixelAt(out, x - radius - 3, y).slice(0, 3)).not.toEqual([0, 0, 0])
  expect(Math.max(...pixelAt(out, Math.floor(x - radius / 2), Math.floor(y)).slice(0, 3))).toBeLessThan(60)
  expect(Math.min(...pixelAt(out, Math.floor(x), Math.floor(y)).slice(0, 3))).toBeGreaterThan(200)
  // In cells: 26.5 columns across and under one row down.
  expect(isOnBadge(26.5, 0.75, 28, 8)).toBe(true)
  expect(isOnBadge(24, 0.75, 28, 8)).toBe(false)
  expect(isOnBadge(26.5, 2, 28, 8)).toBe(false)
  expect(isOnBadge(5, 4, 28, 8)).toBe(false)
})

test('a placeholder leaves with one space beside it, the caret where it was', async () => {
  expect(withoutPlaceholder('see [Image #1] and [Image #2]', 29, 1)).toEqual({ text: 'see and [Image #2]', cursor: 18 })
  expect(withoutPlaceholder('see [Image #1] and [Image #2]', 29, 2)).toEqual({ text: 'see [Image #1] and', cursor: 18 })
  expect(withoutPlaceholder('[Image #3]', 10, 3)).toEqual({ text: '', cursor: 0 })
  // The caret inside the removed span goes to where it was; before it, stays.
  expect(withoutPlaceholder('a [Image #1] b', 6, 1)).toEqual({ text: 'a b', cursor: 2 })
  expect(withoutPlaceholder('a [Image #1] b', 1, 1)).toEqual({ text: 'a b', cursor: 1 })
  // #1 is not #10.
  expect(withoutPlaceholder('[Image #10]', 0, 1)).toEqual({ text: '[Image #10]', cursor: 0 })
})
