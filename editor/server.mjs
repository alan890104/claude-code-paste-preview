// The editor's fallback window, for a Mac without Swift: a page on 127.0.0.1 that loads
// one picture, lets the person draw on it, and posts the edited PNG back. Opened as a
// Chrome app window (no tabs, no address bar) so it reads as a dialog that pops up on
// paste. Prints SAVED or CANCELLED, puts the terminal back in front, and exits.
//
//   node server.mjs <picture> <out.png> <label> [TERM_PROGRAM] [lang]

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createReadStream, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname } from 'node:path'

const [src, out, label = '', terminal = '', lang = 'en'] = process.argv.slice(2)
const token = randomBytes(12).toString('hex')
const page = readFileSync(new URL('./editor.html', import.meta.url))
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const APPS = { ghostty: 'Ghostty', 'iTerm.app': 'iTerm', Apple_Terminal: 'Terminal', WezTerm: 'WezTerm', WarpTerminal: 'Warp', vscode: 'Visual Studio Code', kitty: 'kitty' }

let isDone = false
const finish = word => {
  if (isDone) return
  isDone = true
  console.log(word)
  const app = APPS[terminal]
  if (app === undefined) process.exit(0)
  execFile('open', ['-a', app], () => process.exit(0))
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
  if (req.method === 'POST' && url.pathname === '/save') {
    const parts = []
    req.on('data', part => parts.push(part))
    req.on('end', () => {
      // Written beside and renamed, so nothing reads a half-written picture.
      writeFileSync(`${out}.part`, Buffer.concat(parts))
      renameSync(`${out}.part`, out)
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

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  const at = `http://127.0.0.1:${port}/?t=${token}&n=${encodeURIComponent(label)}&lang=${lang}`
  // For a check of the page alone: say where it is instead of opening a window.
  if (process.env.EDITOR_URL_ONLY) return console.log(`URL ${at}`)
  execFile('open', ['-na', 'Google Chrome', '--args', `--app=${at}`], error => {
    if (error) finish('CANCELLED')
  })
})

// A window left open and forgotten keeps the original picture.
setTimeout(() => finish('CANCELLED'), 30 * 60 * 1000).unref()
