// The mod's commands run for real on this machine, outside Claude Code, with the very
// argument vectors hooks/platform.ts gives the hooks (run as $.process.run runs them: no
// shell). Run in CI on macOS, Linux and Windows, and in a Linux container.
//
//   node test/e2e.mjs [--clipboard] [--url-only]
//
// --clipboard   put a PNG on the system clipboard, read it back with the mod's commands,
//               and (on Linux) check a missing tool is told apart from an empty clipboard.
// --url-only    have the editor server print its address instead of opening a browser
//               window (for a desktop someone is using); otherwise the window it opens is
//               found among the processes, checked, and closed at the end.
//
// Then, always: the editor server starts as the hooks start it, a headless browser draws
// a stroke and presses Done, and the edited PNG and its small copy must be where the hooks
// read them, the stroke in it; Esc must leave no picture. And the editor in each of its
// five languages at its smallest window, with this system's fonts: no word may wrap, be
// cut or run out of its bar (E2E_SHOTS names a folder to keep a picture of each).
// PLAYWRIGHT_DIR names a folder whose node_modules holds playwright-core; E2E_BROWSER a
// browser to drive (else Chrome).

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { clipboardSteps, editorArgv, editsRoot, isMissing, join, LANGUAGE_PS, langOf, localeOf, thumbOf } from '../hooks/platform.ts'
import { decode, encode, pixel } from './png.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
const flags = new Set(process.argv.slice(2))
let failed = 0
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (!ok) failed += 1
  return ok
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// As $.process.run: the argument vector, the session's variables with the step's over them.
const runStep = step => spawnSync(step.argv[0], step.argv.slice(1), { env: { ...process.env, ...step.env }, encoding: 'utf8', timeout: 30_000 })

// A picture with no red in it, so a red stroke is the editor's.
const W = 600
const H = 360
const rgba = new Uint8Array(W * H * 4)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set([20, Math.round((x / W) * 200), 80 + Math.round((y / H) * 150), 255], (y * W + x) * 4)
const work = mkdtempSync(joinPath(tmpdir(), 'paste-preview-e2e-'))
const fixture = joinPath(work, 'pasted.png')
writeFileSync(fixture, encode(W, H, rgba))

// ——— clipboard ———

const putOnClipboard = () => {
  if (os === 'linux') {
    // xclip stays behind to serve the clipboard, as the app that copied would.
    const tool = process.env.WAYLAND_DISPLAY ? ['wl-copy', ['--type', 'image/png']] : ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', fixture]]
    const child = spawn(tool[0], tool[1], { stdio: [process.env.WAYLAND_DISPLAY ? 'pipe' : 'ignore', 'ignore', 'inherit'], detached: true })
    if (process.env.WAYLAND_DISPLAY) child.stdin.end(readFileSync(fixture))
    child.unref()
    return sleep(500).then(() => true)
  }
  if (os === 'windows') {
    const set = 'Add-Type -AssemblyName System.Windows.Forms, System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile($env:E2E_PICTURE))'
    const done = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-Command', set], { env: { ...process.env, E2E_PICTURE: fixture }, encoding: 'utf8' })
    return Promise.resolve(check(done.status === 0, `PowerShell put the picture on the clipboard ${done.stderr ?? ''}`.trim()))
  }
  const done = spawnSync('osascript', ['-e', `set the clipboard to (read (POSIX file "${fixture}") as «class PNGf»)`], { encoding: 'utf8' })
  return Promise.resolve(check(done.status === 0, `osascript put the picture on the clipboard ${done.stderr ?? ''}`.trim()))
}

const clipboard = async () => {
  if (!(await putOnClipboard())) return
  const out = joinPath(work, '1.paste.png')
  const steps = clipboardSteps(os, out, process.env)
  // As the hook does: the first step that exits 0 and leaves a file with something in it.
  const tried = []
  const read = steps.map(step => ({ step, done: runStep(step) })).find(({ step, done }) => {
    tried.push(`${step.argv.join(' ').slice(0, 80)}: exit ${done.status}, ${existsSync(out) ? statSync(out).size : 'no'} bytes ${(done.stderr ?? '').trim()}`)
    return done.status === 0 && existsSync(out) && statSync(out).size > 0
  })
  if (!check(read !== undefined, `the clipboard read back with ${steps.map(s => s.argv[0] === 'sh' ? s.argv[2].split(' ')[1] : s.argv[0]).join(', then ')}`)) return tried.forEach(line => console.log(`  ${line}`))
  console.log(`  by: ${read.step.argv.join(' ').slice(0, 120)}`)
  const back = decode(readFileSync(out))
  check(back.width === W && back.height === H, `the picture read back is ${W}×${H} (${back.width}×${back.height})`)
  const same = [[0, 0], [W - 1, H - 1], [W >> 1, H >> 1], [123, 45]].every(([x, y]) => pixel(back, x, y).slice(0, 3).join() === [...rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)].join())
  check(same, 'its pixels are the ones put there')

  if (os === 'linux') {
    // A PATH with sh and nothing else: no wl-paste, no xclip, and the hook says so.
    const bin = joinPath(work, 'bin')
    mkdirSync(bin)
    symlinkSync(spawnSync('sh', ['-c', 'command -v sh'], { encoding: 'utf8' }).stdout.trim(), joinPath(bin, 'sh'))
    const bare = steps.map(step => spawnSync(step.argv[0], step.argv.slice(1), { env: { ...process.env, PATH: bin }, encoding: 'utf8' }))
    check(bare.every(done => isMissing(done.status ?? undefined)), `with neither tool installed each step reads as missing (${bare.map(d => d.status).join(', ')})`)
  }
}

// ——— language ———

// The answer the mod reads the system's language from, asked of this system for real.
const language = () => {
  const said = os === 'mac'
    ? spawnSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8' }).stdout ?? ''
    : os === 'windows'
      ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', LANGUAGE_PS], { encoding: 'utf8' }).stdout ?? ''
      : localeOf(process.env)
  const shape = os === 'mac' ? /^\(\s*"?[a-z]{2}/ : os === 'windows' ? /^[a-z]{2,3}(-[A-Za-z0-9]+)*\s*$/ : /^$|^[A-Za-z]/
  check(shape.test(said), `the system's language reads as ${JSON.stringify(said.trim().slice(0, 40))}, so the words are ${langOf(os, said)}`)
}

// ——— editor ———

const uid = os === 'windows' ? '' : spawnSync('id', ['-u'], { encoding: 'utf8' }).stdout.trim()
const at = join(os, editsRoot(os, process.env, uid), 'e2e00000')
mkdirSync(at, { recursive: true })

const browserUrls = () => {
  const listed = os === 'windows'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--app=http://127.0.0.1*' } | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8' }).stdout
    : spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).stdout
  return [...listed.matchAll(/--app=(http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+[^\s"]*)/g)].map(m => m[1])
}

const closeBrowsers = () => {
  if (flags.has('--url-only')) return
  if (os === 'windows') spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--app=http://127.0.0.1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"])
  else spawnSync('pkill', ['-f', '--', '--app=http://127.0.0.1'])
}

// Starts the editor exactly as the hook does and finds the page it put up.
const startEditor = async (n, lang = 'en', urlOnly = flags.has('--url-only')) => {
  const out = join(os, at, `${n}.png`)
  const argv = editorArgv(os, { root: ROOT, panel: undefined, file: fixture, out, label: `Image #${n}`, terminal: '', lang })
  // A browser already running takes the new window into itself and the process started
  // for it leaves at once, its --app with it; so each run here starts with none of ours.
  if (!urlOnly) closeBrowsers()
  const before = new Set(browserUrls())
  const child = spawn(argv[0], argv.slice(1), { env: { ...process.env, ...(urlOnly ? { EDITOR_URL_ONLY: '1' } : {}) }, stdio: ['ignore', 'pipe', 'inherit'] })
  let said = ''
  child.stdout.on('data', piece => (said += piece))
  const ended = new Promise(resolve => child.on('exit', code => resolve(code)))
  let url
  for (let i = 0; i < 100 && url === undefined; i++) {
    await sleep(150)
    url = urlOnly ? /^URL (\S+)/m.exec(said)?.[1] : browserUrls().find(u => !before.has(u))
    if (said.includes('UNOPENED')) break
  }
  if (!urlOnly) check(url !== undefined, `the server opened a browser app window on its page (${said.trim() || 'no word yet'})`)
  return { out, url, ended, said: () => said }
}

const drive = async browser => {
  // Done: a red stroke across the middle, then Done.
  const done = await startEditor(1)
  if (done.url === undefined) return
  const page = await browser.newPage()
  await page.goto(done.url)
  await page.waitForFunction(() => document.getElementById('view').width > 0)
  const box = await page.locator('#view').boundingBox()
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.2 + 0.05 * i), box.y + box.height * 0.5)
  await page.mouse.up()
  await page.click('#done')
  const code = await Promise.race([done.ended, sleep(15_000).then(() => 'timeout')])
  check(code === 0 && done.said().includes('SAVED'), `Done: the server said SAVED and exited (${done.said().trim()}, ${code})`)
  if (check(existsSync(done.out), `the edited picture is where the hook reads it: ${done.out}`)) {
    const edited = decode(readFileSync(done.out))
    check(edited.width === W && edited.height === H, `it keeps the paste's size, ${edited.width}×${edited.height}`)
    const red = [-2, -1, 0, 1, 2].some(dy => {
      const [r, g, b] = pixel(edited, W >> 1, (H >> 1) + dy)
      return r > 200 && g < 120 && b < 120
    })
    check(red, `the stroke is in it (${pixel(edited, W >> 1, H >> 1).join(',')} at the middle)`)
  }
  const small = thumbOf(done.out)
  if (check(existsSync(small), `its small copy for the band is beside it: ${small}`)) {
    const thumb = decode(readFileSync(small))
    check(Math.max(thumb.width, thumb.height) === 480 && Math.abs(thumb.width / thumb.height - W / H) < 0.01, `the small copy is 480 px on its long side, same shape (${thumb.width}×${thumb.height})`)
  }
  await sleep(600)
  const after = await page.evaluate(() => (document.body.classList.contains('closed') ? document.getElementById('closed').textContent : 'still the editor')).catch(() => 'closed itself')
  console.log(`  the page after Done: ${after}`)
  if (!page.isClosed()) await page.close()

  // Esc, in Chinese: nothing written, CANCELLED.
  const cancelled = await startEditor(2, 'zh-Hant')
  if (cancelled.url === undefined) return
  const again = await browser.newPage()
  await again.goto(cancelled.url)
  await again.waitForFunction(() => document.getElementById('view').width > 0)
  const words = [await again.textContent('#done'), await again.textContent('#cancel')]
  check(words.join() === '完成,取消', `with lang=zh the editor speaks Chinese (${words.join(', ')})`)
  await again.keyboard.press('Escape')
  const code2 = await Promise.race([cancelled.ended, sleep(15_000).then(() => 'timeout')])
  check(code2 === 0 && cancelled.said().includes('CANCELLED'), `Esc: the server said CANCELLED (${cancelled.said().trim()})`)
  check(!existsSync(cancelled.out), 'and wrote no picture')
  await again.close()
}

// Each language at the panel's smallest size (760 × 480): every button's word on one
// line and whole, the bar inside the window, a tooltip and the crop's Apply too.
const LANGS = { en: ['Cancel', 'Done'], 'zh-Hant': ['取消', '完成'], 'zh-Hans': ['取消', '完成'], ja: ['キャンセル', '完了'], ko: ['취소', '완료'] }
const layout = async browser => {
  let n = 10
  for (const [lang, [cancelWord, doneWord]] of Object.entries(LANGS)) {
    const editor = await startEditor((n += 1), lang, true)
    const page = await browser.newPage({ viewport: { width: 760, height: 480 } })
    await page.goto(editor.url)
    await page.waitForFunction(() => document.getElementById('view').width > 0)
    const box = await page.locator('#view').boundingBox()
    // A crop frame, so Apply shows, and the pointer over Undo, so its tooltip does.
    await page.keyboard.press('c')
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 5 })
    await page.mouse.up()
    await page.hover('#undo')
    await page.waitForSelector('#gtip.on')
    const seen = await page.evaluate(() => {
      const words = ['#cancel', '#done', '#apply', '#gtip'].map(selector => {
        const el = document.querySelector(selector)
        const r = el.getBoundingClientRect()
        // The lines the words take: one box per line of text inside the element.
        const range = document.createRange()
        range.selectNodeContents(el)
        const lines = new Set([...range.getClientRects()].map(box => Math.round(box.top))).size
        const words = range.getBoundingClientRect()
        return { selector, text: el.textContent, lines, isWhole: el.scrollWidth <= el.clientWidth + 1 && words.left >= r.left - 1 && words.right <= r.right + 1, isOneLine: lines === 1, isInside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }
      })
      const bar = document.getElementById('bar')
      const isBarInside = bar.scrollWidth <= bar.clientWidth + 1 && [...bar.querySelectorAll('button')].every(b => b.getBoundingClientRect().right <= innerWidth && b.getBoundingClientRect().left >= 0)
      return { lang: document.documentElement.lang, title: document.title, words, isBarInside, isTight: document.body.classList.contains('tight') }
    })
    const bad = seen.words.filter(w => !w.isWhole || !w.isOneLine || !w.isInside).map(w => `${w.selector} ${JSON.stringify(w.text)}`)
    check(seen.lang === lang && bad.length === 0 && seen.isBarInside, `${lang}: <html lang=${seen.lang}>, ${seen.words.map(w => w.text).join(' / ')}: nothing wraps, is cut or runs out${seen.isTight ? ', the bar drawn closer' : ''}${bad.length ? ` (but ${bad.join(', ')})` : ''}${seen.isBarInside ? '' : ' (the bar runs out of the window)'}`)
    check((await page.textContent('#cancel')) === cancelWord && (await page.textContent('#done')) === doneWord, `${lang}: Cancel and Done read ${cancelWord} and ${doneWord}`)
    if (process.env.E2E_SHOTS) {
      mkdirSync(process.env.E2E_SHOTS, { recursive: true })
      await page.screenshot({ path: joinPath(process.env.E2E_SHOTS, `editor-${os}-${lang}.png`) })
    }
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await Promise.race([editor.ended, sleep(10_000)])
    await page.close()
  }
}

try {
  language()
  if (flags.has('--clipboard')) await clipboard()
  const require = createRequire(joinPath(process.env.PLAYWRIGHT_DIR ?? ROOT, 'node_modules', 'x.js'))
  const { chromium } = require('playwright-core')
  const browser = await chromium.launch({ headless: true, ...(process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER } : { channel: 'chrome' }) })
  try {
    await drive(browser)
    await layout(browser)
  } finally {
    await browser.close()
  }
} finally {
  closeBrowsers()
  rmSync(at, { recursive: true, force: true })
  rmSync(work, { recursive: true, force: true })
}
console.log(failed === 0 ? 'all passed' : `${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
