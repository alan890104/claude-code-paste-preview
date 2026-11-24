import { expect, test } from 'claude-code/testing'

// prompt.edit is the engine's alone to raise, so the paste itself is checked in a
// live session; these hold what the band and the send do around it.

const BAND = {
  plugin: 'paste-preview',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const

test('with no image in the box the band is the engine’s own, on every surface', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^#\d/ })).toBeUndefined()
    await band.unmount()
  }
})

// The conversation the box belongs to, and the state the engine holds for it: each
// paste under its number, then the box's list.
const SESSION = 'abcdef12-3456-7890-abcd-ef1234567890'
const stateOf = (shots: readonly { n: number }[], inBox: readonly number[]) => (e: { key: string; id?: string }) =>
  e.key === 'shot' ? (shots.find(s => String(s.n) === e.id) ?? null) : e.key === 'inBox' ? inBox : undefined

// #1 in the box, a 16:9 paste; its thumbnail, a 1×1 PNG, is all the band reads.
const SHOT = { n: 1, file: '/p/1.png', thumb: '/p/1.thumb.png', gen: 0, width: 1600, height: 900, isEdited: false, ratio: 16 / 9, isLarge: false, session: SESSION }
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

test('the thumbnail keeps its size however many lines the prompt holds', async ($, on) => {
  const state = stateOf([SHOT], [1])
  on('session.id', () => ({ value: SESSION }))
  on('state.get', ($, e) => ({ value: { value: state(e), version: 1 } }))
  on('fs.read', () => ({ value: { base64: PIXEL } }))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: { columns: 105, rows: 46, isFullscreen: true } })
  const size = { columns: 28, rows: 8 }
  expect((await band.find({ type: 'Image' }))?.props).toMatchObject(size)
  // In fullscreen each line typed takes a row from the band.
  for (const maxRows of [12, 8, 4]) {
    await band.redraw({ ...BAND.props, maxRows, scroll: { offset: 0, bodyRows: maxRows - 1 } })
    expect((await band.find({ type: 'Image' }))?.props).toMatchObject(size)
  }
  await band.unmount()
  // A short terminal draws it smaller from the start, a fifth of its rows.
  const short = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: { columns: 80, rows: 24, isFullscreen: true } })
  expect((await short.find({ type: 'Image' }))?.props).toMatchObject({ columns: 14, rows: 4 })
  await short.unmount()
})

import { dropOriginals, ratioOf } from './register'

// A PNG header of the given size, as an image block carries it.
const png = (width: number, height: number) => {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: btoa(String.fromCharCode(...bytes)) } }
}
const text = { type: 'text', text: 'look' }

test('a block’s shape is read from its header', async () => {
  expect(ratioOf(png(1600, 900))).toBe(1600 / 900)
  expect(ratioOf(text)).toBeUndefined()
})

test('at Enter the edited paste’s original is the one left out', async () => {
  const wide = png(1600, 900)
  const tall = png(600, 1200)
  // #3 and #5 pasted, #5 edited: it is the second image, and tall.
  expect(dropOriginals([wide, tall, text], [{ n: 5, rank: 1, ratio: 0.5 }])).toEqual([wide, text])
  // Ordered otherwise than by number: the one image of that shape.
  expect(dropOriginals([tall, wide, text], [{ n: 5, rank: 1, ratio: 0.5 }])).toEqual([wide, text])
  // No image of that shape: nothing is dropped rather than the wrong one.
  expect(dropOriginals([wide, text], [{ n: 5, rank: 0, ratio: 0.5 }])).toEqual([wide, text])
})

test('a sent prompt whose pictures are unknown keeps Claude Code’s own row', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  const row = await $.ui.mount({
    plugin: 'paste-preview',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text: '[Image #42] look', origin: { kind: 'composer' }, isExpanded: false },
  })
  expect(await row.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await row.unmount()
})

// Three pastes of about 1 MiB each: under the one-picture limit, past the engine's 2 MiB
// of Image source per tree together. Off macOS a thumbnail is the paste itself, so the
// band must still draw all three, their bytes within what the engine takes.
test('three large pictures in the box still draw the band', async ($, on) => {
  const shots = [1, 2, 3].map(n => ({ n, file: `/p/${n}.png`, thumb: `/p/${n}.png`, gen: 0, width: 1600, height: 900, isEdited: false, ratio: 16 / 9, isLarge: false, session: SESSION }))
  const state = stateOf(shots, [1, 2, 3])
  on('session.id', () => ({ value: SESSION }))
  on('state.get', ($, e) => ({ value: { value: state(e), version: 1 } }))
  // A PNG's first 33 bytes (signature and header), then zeros: about 1 MiB as base64.
  const big = PIXEL.slice(0, 44) + 'A'.repeat(1_000_000 - 44)
  on('fs.read', () => ({ value: { base64: big } }))
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', viewport: { columns: 105, rows: 46, isFullscreen: true } })
  const images = await band.findAll({ type: 'Image' })
  expect(images.length).toBe(3)
  const embedded = images.reduce((sum, image) => {
    const source = image.props.source as { png?: string }
    return sum + (source.png?.length ?? 0)
  }, 0)
  expect(embedded).toBeLessThanOrEqual(2 * 1024 * 1024)
  await band.unmount()
})

// Folded away by the person (newer Claude Code), the band is not on screen: it names its
// pastes and reads none of their pictures.
test('a folded band reads no picture', async ($, on) => {
  const state = stateOf([SHOT], [1])
  let reads = 0
  on('session.id', () => ({ value: SESSION }))
  on('state.get', ($, e) => ({ value: { value: state(e), version: 1 } }))
  on('fs.read', () => {
    reads += 1
    return { value: { base64: PIXEL } }
  })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, isCollapsed: true }, viewport: { columns: 105, rows: 46, isFullscreen: true } })
  expect(await band.find({ type: 'Image' })).toBeUndefined()
  expect((await band.find({ type: 'Text', text: /^Image #1/ }))?.text).toBe('Image #1')
  expect(reads).toBe(0)
  await band.unmount()
})

// A thumbnail's bytes are read once per version and kept while they fit in 8 MiB, the
// least recently drawn let go first: off macOS a thumbnail is the paste itself, 2 MiB at
// most, and a long session pastes many.
test('thumbnails are read once per version, and kept to 8 MiB', async ($, on) => {
  // Five pastes of about 2.7 MB as base64: three fit, the oldest go.
  const shots = [1, 2, 3, 4, 5].map(n => ({ ...SHOT, n, file: `/p/${n}.png`, thumb: `/p/${n}.png` }))
  let gen = 0
  const state = (e: { key: string; id?: string }) => (e.key === 'shot' ? shots.map(s => ({ ...s, gen })).find(s => String(s.n) === e.id) : e.key === 'inBox' ? [] : undefined)
  const reads: string[] = []
  on('session.id', () => ({ value: SESSION }))
  on('state.get', ($, e) => ({ value: { value: state(e), version: 1 } }))
  const big = PIXEL.slice(0, 44) + 'A'.repeat(2_700_000)
  on('fs.read', ($, e) => {
    reads.push(e.path)
    return { value: { base64: big } }
  })
  const row = (n: number) => $.ui.mount({ plugin: 'paste-preview', surface: 'terminal', component: 'UserMessage', requestId: `row-${n}`, props: { text: `[Image #${n}] look`, origin: { kind: 'composer' }, isExpanded: false } })
  for (const n of [1, 1, 2, 3]) await (await row(n)).unmount()
  expect(reads).toEqual(['/p/1.png', '/p/2.png', '/p/3.png'])
  // A new version of #3 (an edit) is read again.
  gen = 1
  await (await row(3)).unmount()
  expect(reads.at(-1)).toBe('/p/3.png')
  expect(reads).toHaveLength(4)
  // Two more pastes: #1 and #2, drawn longest ago, are let go; #3 is still held.
  gen = 0
  reads.length = 0
  for (const n of [4, 5]) await (await row(n)).unmount()
  gen = 1
  await (await row(3)).unmount()
  expect(reads).toEqual(['/p/4.png', '/p/5.png'])
  gen = 0
  await (await row(1)).unmount()
  expect(reads).toEqual(['/p/4.png', '/p/5.png', '/p/1.png'])
})

// Drawn twice at the same moment (a sent prompt and the band, a recalled prompt), a
// thumbnail is counted once: the 8 MiB still holds three.
test('one thumbnail drawn twice at once is counted once', async ($, on) => {
  const shots = [1, 2, 3].map(n => ({ ...SHOT, n, file: `/p/${n}.png`, thumb: `/p/${n}.png` }))
  const state = (e: { key: string; id?: string }) => (e.key === 'shot' ? shots.find(s => String(s.n) === e.id) : e.key === 'inBox' ? [1] : undefined)
  const reads: string[] = []
  on('session.id', () => ({ value: SESSION }))
  on('state.get', ($, e) => ({ value: { value: state(e), version: 1 } }))
  const big = PIXEL.slice(0, 44) + 'A'.repeat(2_700_000)
  // The first read is answered once the second has come: both drawings read at once.
  let bothAsked = () => {}
  const both = new Promise<void>(resolve => (bothAsked = resolve))
  on('fs.read', async ($, e) => {
    reads.push(e.path)
    if (reads.length === 2) bothAsked()
    if (reads.length === 1) await both
    return { value: { base64: big } }
  })
  const row = (n: number, id: string) => $.ui.mount({ plugin: 'paste-preview', surface: 'terminal', component: 'UserMessage', requestId: id, props: { text: `[Image #${n}] look`, origin: { kind: 'composer' }, isExpanded: false } })
  const drawings = await Promise.all([row(1, 'sent'), $.ui.mount({ ...BAND, surface: 'terminal', viewport: { columns: 105, rows: 46, isFullscreen: true } })])
  for (const drawn of drawings) await drawn.unmount()
  for (const n of [2, 3]) await (await row(n, `row-${n}`)).unmount()
  reads.length = 0
  await (await row(1, 'again')).unmount()
  expect(reads).toEqual([])
})

