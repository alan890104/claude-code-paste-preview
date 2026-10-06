// A live Claude Code session with the mod loaded from this folder, driven through a
// pseudo-terminal as a person would: paste a picture with Claude Code's own key (Alt+V on
// Windows, Ctrl+V elsewhere), see the band above the prompt, draw on the editor the mod
// opens and press Done, send the prompt, then read what Claude Code stored. What the
// hooks do inside the engine (find the paste, start node or powershell, read the edit)
// is only proven here. Nothing leaves the machine: the key is made up and the API's
// address is a closed local port.
//
// For Linux (under an X server) and Windows, where the editor is a browser window; a
// Mac's is the Swift panel, which a headless browser cannot drive.
//
//   node test/live.mjs
//
// PLAYWRIGHT_DIR names a folder whose node_modules holds playwright-core and
// @lydell/node-pty; E2E_BROWSER a browser to drive (else Chrome).

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'

import { editsRoot, engineRoot } from '../hooks/platform.ts'
import { decode, encode, pixel } from './png.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const os = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
if (os === 'mac') {
  console.log('skipped: on macOS the editor is the Swift panel')
  process.exit(0)
}
let failed = 0
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`)
  if (!ok) failed += 1
  return ok
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const require = createRequire(joinPath(process.env.PLAYWRIGHT_DIR ?? ROOT, 'node_modules', 'x.js'))
const pty = require('@lydell/node-pty')
const { chromium } = require('playwright-core')

// A picture with no red in it, on the clipboard as a screenshot tool would leave it.
const W = 600
const H = 360
const rgba = new Uint8Array(W * H * 4)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba.set([20, Math.round((x / W) * 200), 80 + Math.round((y / H) * 150), 255], (y * W + x) * 4)
const work = realpathSync.native(mkdtempSync(joinPath(tmpdir(), 'paste-preview-live-')))
const fixture = joinPath(work, 'shot.png')
writeFileSync(fixture, encode(W, H, rgba))
if (os === 'windows') {
  const set = 'Add-Type -AssemblyName System.Windows.Forms, System.Drawing; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile($env:E2E_PICTURE))'
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-Command', set], { env: { ...process.env, E2E_PICTURE: fixture } })
} else {
  spawn('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', fixture], { stdio: 'ignore', detached: true }).unref()
  await sleep(500)
}

// A Claude Code of its own: settings in a folder of this run, onboarding done, the made-up
// key accepted, the project trusted.
const config = joinPath(work, 'config')
const project = joinPath(work, 'project')
mkdirSync(config)
mkdirSync(project)
const KEY = `sk-ant-api03-${'0'.repeat(86)}-live-check-not-a-key`
const trusted = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
writeFileSync(joinPath(config, '.claude.json'), JSON.stringify({
  hasCompletedOnboarding: true,
  theme: 'dark',
  numStartups: 5,
  customApiKeyResponses: { approved: [KEY.slice(-20)], rejected: [] },
  projects: { [project]: trusted, [project.replaceAll('\\', '/')]: trusted },
}))
const env = {
  ...process.env,
  CLAUDE_CONFIG_DIR: config,
  CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1',
  ANTHROPIC_API_KEY: KEY,
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
}
const [file, args] = os === 'windows' ? ['cmd.exe', ['/d', '/c', 'claude', '--plugin-dir', ROOT]] : ['claude', ['--plugin-dir', ROOT]]
const term = pty.spawn(file, args, { name: 'xterm-256color', cols: 160, rows: 45, cwd: project, env })
let screen = ''
// The terminal's text with its escapes taken out: enough to find words in.
term.onData(data => (screen += data.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78DEHMNOZc]/g, '')))
const waitFor = async (test, ms) => {
  for (const until = Date.now() + ms; Date.now() < until; await sleep(200)) if (test()) return true
  return test()
}

const browserUrls = () => {
  const listed = os === 'windows'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--app=http://127.0.0.1*' } | ForEach-Object { $_.CommandLine }"], { encoding: 'utf8' }).stdout
    : spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).stdout
  return [...listed.matchAll(/--app=(http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+[^\s"]*)/g)].map(m => m[1])
}
const closeBrowsers = () => {
  if (os === 'windows') spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--app=http://127.0.0.1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"])
  else spawnSync('pkill', ['-f', '--', '--app=http://127.0.0.1'])
}
const filesUnder = (root, end) => (existsSync(root) ? readdirSync(root, { recursive: true }).map(f => joinPath(root, f)).filter(f => f.endsWith(end)) : [])
const uid = os === 'windows' ? '' : spawnSync('id', ['-u'], { encoding: 'utf8' }).stdout.trim()

const browser = await chromium.launch({ headless: true, ...(process.env.E2E_BROWSER ? { executablePath: process.env.E2E_BROWSER } : { channel: 'chrome' }) })
try {
  // The line under the box ("? for shortcuts", "auto mode on", "← for agents") comes with the prompt.
  const ready = await waitFor(() => /for shortcuts|for agents|mode on/.test(screen), 120_000)
  await sleep(2000)
  if (!check(ready, 'Claude Code started with the mod loaded and showed its prompt')) throw new Error(screen.slice(-2000))

  closeBrowsers()
  const pasted = screen.length
  term.write(os === 'windows' ? '\x1bv' : '\x16')
  // The terminal redraws the box in pieces, so the words may come apart.
  check(await waitFor(() => /\[Image[^\]]{0,24}#1\]/.test(screen), 30_000), `${os === 'windows' ? 'Alt+V' : 'Ctrl+V'} pasted the picture: [Image #1] in the box`)
  // Claude Code writes its copy just after the placeholder lands, as the mod allows for.
  let kept = []
  await waitFor(() => (kept = filesUnder(engineRoot(os, process.env, uid), joinPath('images', '1.png'))).length > 0, 10_000)
  check(kept.length > 0, `Claude Code kept the paste where the mod looks for it (${kept[0] ?? engineRoot(os, process.env, uid)})`)

  let url
  await waitFor(() => (url = browserUrls()[0]) !== undefined, 60_000)
  if (!check(url !== undefined, 'the paste opened the editor in a browser window')) throw new Error(screen.slice(-2000))
  check(await waitFor(() => /Edit/.test(screen.slice(pasted)), 15_000), 'the band above the prompt shows the paste, with its Edit button')

  const page = await browser.newPage()
  await page.goto(url)
  await page.waitForFunction(() => document.getElementById('view').width > 0)
  const box = await page.locator('#view').boundingBox()
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.2 + 0.05 * i), box.y + box.height * 0.5)
  await page.mouse.up()
  const before = screen.length
  await page.click('#done')
  check(await waitFor(() => screen.slice(before).includes('edited'), 20_000), 'after Done the band says the paste was edited')
  await page.close().catch(() => {})
  closeBrowsers()

  const edits = filesUnder(editsRoot(os, process.env, uid), `${os === 'windows' ? '\\' : '/'}1.png`).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (check(edits.length > 0, `the edited picture is where the mod keeps it (${edits[0] ?? editsRoot(os, process.env, uid)})`)) {
    const [r, g] = pixel(decode(readFileSync(edits[0])), W >> 1, H >> 1)
    check(r > 200 && g < 120, 'with the stroke in it')
  }

  term.write('what is in this picture')
  await sleep(500)
  term.write('\r')
  const transcript = () => filesUnder(joinPath(config, 'projects'), '.jsonl').flatMap(f => readFileSync(f, 'utf8').trim().split('\n')).map(line => JSON.parse(line))
  await waitFor(() => transcript().some(o => o.attachment?.type === 'hook_additional_context'), 30_000)
  const lines = transcript()
  const told = lines.filter(o => o.attachment?.type === 'hook_additional_context').flatMap(o => o.attachment.content)
  check(edits[0] !== undefined && told.some(text => text.includes(edits[0])), `at Enter Claude is told where the edited picture is: ${JSON.stringify(told[0] ?? '').slice(0, 160)}`)
  const pictures = lines.filter(o => o.type === 'user' && Array.isArray(o.message?.content)).flatMap(o => o.message.content).filter(c => c.type === 'image')
  check(pictures.length === 0, `and the original paste is not sent (${pictures.length} picture${pictures.length === 1 ? '' : 's'} in the message)`)
} catch (error) {
  check(false, `stopped: ${error.message}`)
} finally {
  await browser.close()
  closeBrowsers()
  term.kill()
  if (os === 'linux') spawnSync('pkill', ['-f', '--', fixture])
  await sleep(500)
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
console.log(failed === 0 ? 'all passed' : `${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
