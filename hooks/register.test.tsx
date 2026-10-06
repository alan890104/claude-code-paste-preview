import { expect, test } from 'claude-code/testing'

// prompt.edit is the engine's alone to raise, so the paste itself is checked in a
// live session; these hold what the band and the send do around it.

const BAND = {
  plugin: 'paste-preview',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
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
