// The editor in a browser window, for Linux, Windows and a Mac without Swift: a page on
// 127.0.0.1 that loads one picture, lets the person draw on it, and posts the edited PNG
// back, with a small copy of it for the band above the prompt (<out>.thumb.png, beside
// <out>.png). Opened as an app window of a Chromium browser where there is one (no tabs,
// no address bar), so it reads as a dialog that pops up on paste; else in the default
// browser. Prints SAVED or CANCELLED (UNOPENED when no window could be opened), puts a
// Mac's terminal back in front, and exits.
//
//   node server.mjs <picture> <out.png> <label> [TERM_PROGRAM] [lang]

import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { delimiter, extname, join } from 'node:path'

const [src, out, label = '', terminal = '', lang = 'en'] = process.argv.slice(2)
const thumb = `${out.replace(/\.png$/i, '')}.thumb.png`
const token = randomBytes(12).toString('hex')
const page = readFileSync(new URL('./editor.html', import.meta.url))
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const APPS = { ghostty: 'Ghostty', 'iTerm.app': 'iTerm', Apple_Terminal: 'Terminal', WezTerm: 'WezTerm', WarpTerminal: 'Warp', vscode: 'Visual Studio Code', kitty: 'kitty' }

let isDone = false
const finish = word => {
  if (isDone) return
  isDone = true
  console.log(word)
  const app = process.platform === 'darwin' ? APPS[terminal] : undefined
  if (app === undefined) process.exit(0)
  execFile('open', ['-a', app], () => process.exit(0))
}

// Written beside and renamed, so nothing reads a half-written picture.
const save = (path, parts) => {
  writeFileSync(`${path}.part`, Buffer.concat(parts))
  renameSync(`${path}.part`, path)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://editor')
  // Only the window this run opened may load the picture or write the file.
  if (url.searchParams.get('t') !== token) return res.writeHead(403).end()
  if (req.method === 'GET' && url.pathname === '/') {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page)
  }
  if (req.method === 'GET' && url.pathname === '/image') {
    res.writeHead(200, { 'content-type': TYPES[extname(src).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    return createReadStream(src).pipe(res)
  }
  if (req.method === 'POST' && (url.pathname === '/save' || url.pathname === '/thumb')) {
    const parts = []
    req.on('data', part => parts.push(part))
    req.on('end', () => {
      // The small copy comes first; the picture itself ends the run.
      if (url.pathname === '/thumb') {
        save(thumb, parts)
        return res.writeHead(204).end()
      }
      save(out, parts)
      res.writeHead(204).end()
      finish('SAVED')
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/cancel') {
    res.writeHead(204).end()
    return finish('CANCELLED')
  }
  res.writeHead(404).end()
})

// The first of these on PATH (Linux) or at its usual place (Windows) opens the page as an
// app window; Edge comes with every Windows.
const CHROMIUMS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser']
const onPath = name => (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir, name)).find(existsSync)
const windowsBrowsers = () => {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)
  const apps = [['Microsoft', 'Edge', 'Application', 'msedge.exe'], ['Google', 'Chrome', 'Application', 'chrome.exe']]
  return apps.flatMap(app => roots.map(root => join(root, ...app))).filter(existsSync)
}

// Each way to open the page, in order: an app window, else whatever opens a link.
const openers = at => {
  if (process.platform === 'darwin') return [{ argv: ['open', '-na', 'Google Chrome', '--args', `--app=${at}`], waits: true }]
  const app = path => ({ argv: [path, `--app=${at}`], waits: false })
  if (process.platform === 'win32') {
    // rundll32 hands the link to the default browser with no shell to read its "&".
    return [...windowsBrowsers().map(app), { argv: ['rundll32.exe', 'url.dll,FileProtocolHandler', at], waits: true }]
  }
  const wsl = process.env.WSL_DISTRO_NAME ? [{ argv: ['wslview', at], waits: true }, { argv: ['explorer.exe', at], waits: false }] : []
  return [...CHROMIUMS.map(onPath).filter(Boolean).map(app), { argv: ['xdg-open', at], waits: true }, ...wsl]
}

// A browser lives on after this run, so it is let go at once, in a group of its own, and
// writes to nothing of ours; a launcher (open, xdg-open) is waited for, its exit saying
// whether it worked.
const tryOpen = ({ argv: [command, ...args], waits }) =>
  new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'ignore', detached: process.platform !== 'darwin' || !waits })
    child.on('error', () => resolve(false))
    if (waits) return child.on('exit', code => resolve(code === 0))
    child.on('spawn', () => {
      child.unref()
      resolve(true)
    })
  })

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address()
  const at = `http://127.0.0.1:${port}/?t=${token}&n=${encodeURIComponent(label)}&lang=${lang}`
  // For a check of the page alone: say where it is instead of opening a window.
  if (process.env.EDITOR_URL_ONLY) return console.log(`URL ${at}`)
  for (const opener of openers(at)) if (await tryOpen(opener)) return
  finish('UNOPENED')
})

// A window left open and forgotten keeps the original picture.
setTimeout(() => finish('CANCELLED'), 30 * 60 * 1000).unref()
