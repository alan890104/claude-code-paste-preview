// The editor page by itself, in a headless browser: the page the macOS panel keeps warm
// for a whole session (its host stood in for), one picture after another, and what undo
// gives back. What the hooks and the server do around it is test/e2e.mjs's.
//
//   node test/editor.mjs [editor.html]
//
// PLAYWRIGHT_DIR names a folder whose node_modules holds playwright-core; E2E_BROWSER a
// browser to drive (else Chrome).

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decode, encode, pixel } from './png.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PAGE = readFileSync(process.argv[2] ?? joinPath(ROOT, 'editor', 'editor.html'), 'utf8')
const require = createRequire(joinPath(process.env.PLAYWRIGHT_DIR ?? ROOT, 'node_modules', 'x.js'))
const { chromium } = require('playwright-core')
let failed = 0
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (!ok) failed += 1
  return ok
}

// A picture of one color, the gray of no stroke (the editor draws in red first).
const solid = (width, height) => {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) rgba.set([40, 90, 140, 255], i * 4)
  return Buffer.from(encode(width, height, rgba))
}
const pictures = { small: solid(600, 360), tall: solid(360, 600), slow: solid(600, 360), large: solid(4000, 3000), broken: Buffer.from('not a picture') }

const browser = await chromium.launch({ headless: true, ...(process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER } : { channel: 'chrome' }) })

// The page as the warm panel holds it. Every canvas it makes is kept here, so none is
// collected and what each still holds can be read; the host's messages are recorded.
// `bitmaps`: 'yes', 'no' (Safari before 15), or 'plain' (one that takes no options).
// `fetches`: false where the page's fetch of its picture fails (a custom URL scheme
// might). A picture named slow-… comes after a second.
const panel = async ({ bitmaps = 'yes', fetches = true } = {}) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  // Each slow picture served, for a test to wait on rather than on a clock.
  page.served = []
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(bitmaps => {
    window.said = []
    window.webkit = { messageHandlers: { editor: { postMessage: m => {
      window.said.push(m.kind)
      if (m.kind === 'save') window.saved = m.png
    } } } }
    window.canvases = []
    const make = Document.prototype.createElement
    Document.prototype.createElement = function (name, ...rest) {
      const made = make.call(this, name, ...rest)
      if (String(name).toLowerCase() === 'canvas') window.canvases.push(made)
      return made
    }
    window.bitmaps = { made: 0, closed: 0 }
    if (bitmaps === 'no') delete window.createImageBitmap
    else {
      const decode = window.createImageBitmap
      window.createImageBitmap = (...args) => {
        if (bitmaps === 'plain' && args.length > 1) return Promise.reject(new TypeError('options are not supported'))
        return decode(...args).then(b => (window.bitmaps.made++, b))
      }
      const close = ImageBitmap.prototype.close
      ImageBitmap.prototype.close = function () {
        window.bitmaps.closed++
        return close.call(this)
      }
    }
  }, bitmaps)
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/image') return route.fulfill({ body: PAGE, contentType: 'text/html' })
    if (!fetches && route.request().resourceType() === 'fetch') return route.abort()
    const name = url.searchParams.get('id')?.replace(/-\d+$/, '') ?? 'small'
    if (name !== 'slow') return route.fulfill({ body: pictures[name], contentType: 'image/png' })
    await new Promise(resolve => setTimeout(resolve, 1000))
    await route.fulfill({ body: pictures[name], contentType: 'image/png' })
    page.served.push(url.searchParams.get('id'))
  })
  await page.goto('http://editor.local/?warm=1&lang=en')
  await page.waitForFunction(() => window.said.includes('warm'))
  return { page, errors }
}

// One picture, as panel.swift opens it, until the page has drawn it (or given up on it).
const open = async (page, id) => {
  await page.evaluate(id => {
    window.said = []
    window.openPicture(id, `Image #${id}`)
  }, id)
  await page.waitForFunction(() => window.said.includes('size') || window.said.includes('cancel'), null, { timeout: 15_000 })
  return page.evaluate(() => window.said.at(-1))
}
const view = page => page.evaluate(() => {
  const v = document.getElementById('view')
  return { width: v.width, height: v.height }
})
// The picture's own pixel there, as the visible canvas shows it.
const pixelAt = (page, fx, fy) => page.evaluate(([fx, fy]) => {
  const v = document.getElementById('view')
  return [...v.getContext('2d').getImageData(Math.floor(v.width * fx), Math.floor(v.height * fy), 1, 1).data]
}, [fx, fy])
const isRed = ([r, g, b]) => r > 200 && g < 100 && b < 100
// A stroke across the picture at height fy, from left to right.
const stroke = async (page, fy) => {
  const box = await page.locator('#view').boundingBox()
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * fy)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * fy, { steps: 3 })
  await page.mouse.up()
}
const undo = page => page.click('#undo')
const waitUntil = async (test, ms = 15_000) => {
  for (const until = Date.now() + ms; Date.now() < until && !test(); ) await new Promise(resolve => setTimeout(resolve, 50))
}
// Every pixel of the visible canvas, summed: what changes when anything is drawn.
const sum = page => page.evaluate(() => {
  const v = document.getElementById('view')
  return v.getContext('2d').getImageData(0, 0, v.width, v.height).data.reduce((total, x) => (total + x) % 4294967291, 0)
})
const drag = async (page, from, to) => {
  const box = await page.locator('#view').boundingBox()
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 3 })
  await page.mouse.up()
}
// Done, and the picture the host was handed.
const done = async page => {
  await page.click('#done')
  await page.waitForFunction(() => window.said.includes('save') || window.said.includes('cancel'))
  const png = await page.evaluate(() => window.saved)
  return png === undefined ? undefined : decode(Buffer.from(png, 'base64'))
}
// What every canvas but the visible one still holds, in pixels: what is not given back.
const held = page => page.evaluate(() => window.canvases.filter(c => c !== document.getElementById('view')).reduce((sum, c) => sum + c.width * c.height, 0))

try {
  // ——— a session of pictures in the warm panel ———
  {
    const { page, errors } = await panel()
    for (let i = 1; i <= 3; i++) {
      check((await open(page, `small-${i}`)) === 'size', `picture ${i} opens in the warm page`)
      await stroke(page, 0.3)
      await stroke(page, 0.6)
      await page.click('[data-tool="crop"]')
      const box = await page.locator('#view').boundingBox()
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 3 })
      await page.mouse.up()
      await page.click('#apply')
      await page.click('#rotate')
      await page.click('#done')
      await page.waitForFunction(() => window.said.includes('save'))
      await page.evaluate(() => window.closePicture())
      check((await held(page)) <= 1, `after picture ${i} is closed, no canvas holds its pixels (${await held(page)} held)`)
    }
    const { made, closed } = await page.evaluate(() => window.bitmaps)
    check(made === 3 && closed === 3, `each picture was decoded once and its decoded copy let go (${made} made, ${closed} closed)`)
    check(await page.evaluate(() => picture.getAttribute('src') === null), 'no <img> holds a picture')

    // The next picture starts clean: its own size, nothing to undo, Done keeps the paste.
    check((await open(page, 'tall-1')) === 'size', 'a picture of another shape opens after them')
    const size = await view(page)
    check(size.width === 360 && size.height === 600, `at its own size (${size.width}×${size.height})`)
    await undo(page)
    check(JSON.stringify(await view(page)) === JSON.stringify(size), 'with nothing of the last picture to undo')
    await page.click('#done')
    await page.waitForFunction(() => window.said.includes('cancel') || window.said.includes('save'))
    check(await page.evaluate(() => window.said.includes('cancel')), 'and Done with nothing drawn keeps the paste (cancel, not a re-encoded copy)')
    await page.evaluate(() => window.closePicture())

    // A paste that lands while the panel fades out is opened with no close before it.
    await open(page, 'small-4')
    await stroke(page, 0.5)
    check((await open(page, 'tall-2')) === 'size', 'a paste during the fade opens over the last picture')
    check((await held(page)) <= 360 * 600, `and the last picture's canvases were given back (${await held(page)} pixels held, the new picture's own ${360 * 600})`)
    check(!isRed(await pixelAt(page, 0.5, 0.5)), 'with none of the last picture drawn on it')
    check(errors.length === 0, `no error on the page${errors.length ? `: ${errors.join('; ')}` : ''}`)
    await page.close()
  }

  // ——— where pictures cannot be decoded that way, or not at all ———
  {
    const { page, errors } = await panel({ bitmaps: 'no' })
    check((await open(page, 'small-1')) === 'size', 'without createImageBitmap (Safari before 15) the picture still opens')
    const size = await view(page)
    check(size.width === 600 && size.height === 360, `at its size (${size.width}×${size.height})`)
    check(errors.length === 0, `no error on the page${errors.length ? `: ${errors.join('; ')}` : ''}`)
    await page.close()
  }
  {
    // A browser whose createImageBitmap takes no options still decodes and lets go.
    const { page } = await panel({ bitmaps: 'plain' })
    check((await open(page, 'small-1')) === 'size', 'where createImageBitmap takes no options the picture opens')
    check((await page.evaluate(() => window.bitmaps.made)) === 1, 'decoded as a bitmap there too, not kept by an <img>')
    await page.close()
  }
  {
    const { page } = await panel()
    check((await open(page, 'broken-1')) === 'cancel', 'a file that is no picture keeps the paste as it was (cancel)')
    await page.close()
  }

  // ——— undo ———
  {
    const { page, errors } = await panel()
    await open(page, 'small-1')
    const pristine = await pixelAt(page, 0.5, 0.5)
    await undo(page)
    check(JSON.stringify(await view(page)) === JSON.stringify({ width: 600, height: 360 }), 'undo with nothing to undo leaves the picture')
    await stroke(page, 0.5)
    check(isRed(await pixelAt(page, 0.5, 0.5)), 'a stroke after it draws')
    await undo(page)
    check(JSON.stringify(await pixelAt(page, 0.5, 0.5)) === JSON.stringify(pristine), 'undo takes the stroke back, pixel for pixel')

    await page.click('#rotate')
    check(JSON.stringify(await view(page)) === JSON.stringify({ width: 360, height: 600 }), 'rotate turns it')
    await page.click('[data-tool="crop"]')
    const box = await page.locator('#view').boundingBox()
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 3 })
    await page.mouse.up()
    await page.click('#apply')
    const cropped = await view(page)
    check(cropped.width < 360 && cropped.height < 600, `crop cuts it (${cropped.width}×${cropped.height})`)
    await page.click('[data-tool="pen"]')
    await stroke(page, 0.5)
    await undo(page)
    check(JSON.stringify(await view(page)) === JSON.stringify(cropped) && !isRed(await pixelAt(page, 0.5, 0.5)), 'undo: the stroke on the crop goes, the crop stays')
    await undo(page)
    check(JSON.stringify(await view(page)) === JSON.stringify({ width: 360, height: 600 }), 'undo: the crop goes')
    await undo(page)
    check(JSON.stringify(await view(page)) === JSON.stringify({ width: 600, height: 360 }), 'undo: the turn goes')
    check(JSON.stringify(await pixelAt(page, 0.5, 0.5)) === JSON.stringify(pristine), 'back to the paste as it was')
    await stroke(page, 0.5)
    check(isRed(await pixelAt(page, 0.5, 0.5)), 'and it still takes a stroke after undoing it all')
    check(errors.length === 0, `no error on the page${errors.length ? `: ${errors.join('; ')}` : ''}`)
    await page.close()
  }

  // Thirty steps back on a small picture, as always: one stroke more than that, and the
  // first is the one that can no longer be taken back.
  {
    const { page } = await panel()
    await open(page, 'small-1')
    for (let i = 0; i < 31; i++) await stroke(page, 0.05 + i * 0.03)
    for (let i = 0; i < 31; i++) await undo(page)
    check(isRed(await pixelAt(page, 0.5, 0.05)) && !isRed(await pixelAt(page, 0.5, 0.08)), 'a small picture keeps thirty undo steps')
    await page.close()
  }

  // A 4000×3000 picture is 48 MB a copy: undo keeps eleven of them (528 MB, within the
  // 512 MiB of 536.9 MB), not thirty (1.4 GB), and the strokes before those stay.
  {
    const { page, errors } = await panel()
    await open(page, 'large-1')
    for (let i = 0; i < 14; i++) await stroke(page, 0.05 + i * 0.06)
    for (let i = 0; i < 14; i++) await undo(page)
    const rows = []
    for (let i = 0; i < 14; i++) rows.push(isRed(await pixelAt(page, 0.5, 0.05 + i * 0.06)))
    check(rows.map(r => (r ? 'x' : '.')).join('') === 'xxx...........', `a large picture keeps eleven undo steps, the three strokes before them stay (${rows.map(r => (r ? 'x' : '.')).join('')})`)
    await stroke(page, 0.95)
    check(isRed(await pixelAt(page, 0.5, 0.95)), 'and takes a stroke after')
    check(errors.length === 0, `no error on the page${errors.length ? `: ${errors.join('; ')}` : ''}`)
    await page.close()
  }

  // ——— a picture that lands late ———
  {
    const { page, errors } = await panel()
    await page.evaluate(() => {
      window.said = []
      window.openPicture('slow-1', 'Image #1')
      window.openPicture('tall-1', 'Image #2')
    })
    // Once the late picture has been served and had time to be decoded.
    await waitUntil(() => page.served.includes('slow-1'))
    await page.waitForTimeout(500)
    const size = await view(page)
    check(size.width === 360 && size.height === 600, `a paste opened while the last one still loads shows the new one (${size.width}×${size.height})`)
    check((await page.evaluate(() => window.said.filter(k => k === 'size').length)) === 1, 'and the panel is sized once, for it')
    await page.evaluate(() => {
      window.closePicture()
      window.said = []
      window.openPicture('slow-2', 'Image #3')
      window.closePicture()
    })
    await waitUntil(() => page.served.includes('slow-2'))
    await page.waitForTimeout(500)
    check((await held(page)) <= 1 && (await page.evaluate(() => window.said.length)) === 0, `a picture closed before it landed is not kept, nor shown (${await held(page)} pixels held)`)
    check(errors.length === 0, `no error on the page${errors.length ? `: ${errors.join('; ')}` : ''}`)
    await page.close()
  }
  {
    const { page } = await panel({ fetches: false })
    check((await open(page, 'small-1')) === 'size', 'where the page cannot fetch its picture, it opens it as an <img>')
    const size = await view(page)
    check(size.width === 600 && size.height === 360, `at its size (${size.width}×${size.height})`)
    await page.close()
  }

  // ——— what Done hands over, and the other tools ———
  {
    const { page, errors } = await panel()
    await open(page, 'small-1')
    await page.click('#rotate')
    await stroke(page, 0.5)
    const saved = await done(page)
    check(saved?.width === 360 && saved?.height === 600, `Done hands over the picture as it is on screen, turned (${saved?.width}×${saved?.height})`)
    let reds = 0
    for (let y = 0; y < (saved?.height ?? 0); y++) for (let x = 0; x < saved.width; x++) if (isRed(pixel(saved, x, y))) reds += 1
    check(reds > 200, `with the stroke in it (${reds} red pixels in a picture that had none)`)
    await page.evaluate(() => window.closePicture())

    await open(page, 'small-2')
    const pristine = await sum(page)
    for (const tool of ['rect', 'ellipse', 'arrow']) {
      await page.click(`[data-tool="${tool}"]`)
      await drag(page, [0.3, 0.3], [0.7, 0.7])
      check((await sum(page)) !== pristine, `the ${tool} tool draws`)
      await page.keyboard.press('Control+z')
      check((await sum(page)) === pristine, `and Ctrl+Z takes the ${tool} back`)
    }
    await page.click('[data-tool="text"]')
    const box = await page.locator('#view').boundingBox()
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4)
    await page.keyboard.type('Look here')
    await page.keyboard.press('Enter')
    const written = await sum(page)
    check(written !== pristine, 'the text tool writes')
    await undo(page)
    check((await sum(page)) === pristine, 'and undo takes the text back')
    await page.click('[data-tool="text"]')
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.4)
    await page.keyboard.type('Look here')
    await page.keyboard.press('Enter')
    check((await done(page)) !== undefined, 'Done with only text on it hands the picture over (not a cancel)')
    await page.evaluate(() => window.closePicture())

    await open(page, 'small-3')
    await stroke(page, 0.5)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.said.includes('cancel') || window.said.includes('save'))
    check(await page.evaluate(() => window.said.includes('cancel') && !window.said.includes('save')), 'Esc keeps the paste as it was, a stroke or not')
    check(errors.length === 0, `no error on the page${errors.length ? `: ${errors.join('; ')}` : ''}`)
    await page.close()
  }

  // ——— the undo budget, whatever the steps ———
  {
    const { page, errors } = await panel()
    await open(page, 'large-1')
    const within = () => page.evaluate(() => history.length <= 30 && (history.length === 1 || history.reduce((total, c) => total + c.width * c.height * 4, 0) <= 512 * 1024 * 1024))
    let isWithin = true
    const steps = ['stroke', 'crop', 'stroke', 'rotate', 'stroke', 'crop', 'stroke', 'rotate', 'stroke', 'stroke', 'crop', 'stroke', 'rotate', 'stroke']
    for (const [i, step] of steps.entries()) {
      if (step === 'stroke') await stroke(page, 0.1 + (i % 8) * 0.1)
      if (step === 'rotate') await page.click('#rotate')
      if (step === 'crop') {
        await page.click('[data-tool="crop"]')
        await drag(page, [0.01, 0.01], [0.99, 0.99])
        await page.click('#apply')
        await page.click('[data-tool="pen"]')
      }
      isWithin &&= await within()
    }
    check(isWithin, 'undo keeps within 30 steps and 512 MiB through strokes, crops and turns')
    check(errors.length === 0, `no error on the page${errors.length ? `: ${errors.join('; ')}` : ''}`)
    await page.close()
  }

  // A click with a shape tool that draws nothing takes no undo step, and so lets none go.
  {
    const { page } = await panel()
    await open(page, 'large-1')
    for (let i = 0; i < 12; i++) await stroke(page, 0.05 + i * 0.075)
    await page.click('[data-tool="rect"]')
    const box = await page.locator('#view').boundingBox()
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
    for (let i = 0; i < 12; i++) await undo(page)
    const rows = []
    for (let i = 0; i < 12; i++) rows.push(isRed(await pixelAt(page, 0.5, 0.05 + i * 0.075)) ? 'x' : '.')
    check(rows.join('') === 'x...........', `a shape click that draws nothing costs no undo step (${rows.join('')})`)
    await page.close()
  }
  // Undo keeps at most so much; the steps it let go are still in the picture. Done after
  // undoing every step it kept hands that picture over, not the paste as it was.
  {
    const { page } = await panel()
    await open(page, 'large-1')
    for (let i = 0; i < 12; i++) await stroke(page, 0.05 + i * 0.075)
    for (let i = 0; i < 11; i++) await undo(page)
    const saved = await done(page)
    let reds = 0
    for (let y = 0; y < (saved?.height ?? 0); y += 4) for (let x = 0; x < saved.width; x += 4) if (isRed(pixel(saved, x, y))) reds += 1
    check(saved !== undefined && reds > 0, `Done after undoing all that undo kept hands over the strokes it let go (${saved === undefined ? 'cancelled' : `${reds} red samples`})`)
    await page.close()
  }
  {
    const { page } = await panel()
    await open(page, 'small-1')
    for (let i = 0; i < 31; i++) await stroke(page, 0.05 + i * 0.03)
    for (let i = 0; i < 30; i++) await undo(page)
    check((await done(page)) !== undefined, 'so does Done after thirty undos of thirty-one strokes on a small picture')
    await page.close()
  }
} catch (error) {
  check(false, `stopped: ${error.message}`)
} finally {
  await browser.close()
}
console.log(failed === 0 ? 'all passed' : `${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
