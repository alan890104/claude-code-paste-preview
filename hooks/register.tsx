import { atom, read, update } from 'claude-code'
import type { EngineInterface, ImageSource, Register } from 'claude-code'

import type { Shot } from '../types'
import { clipboardSteps, editorArgv, editsRoot, engineRoot, fromBase64, headStep, isMissing, join, LANGUAGE_PS, langOf, localeOf, osOf, sizeOf, sweepStep, thumbOf } from './platform'
import type { Env, Lang, Os, Step } from './platform'

// paste-preview: a pasted image is only "[Image #1]" in the prompt box, which says
// nothing about which picture it is. So, as in a chat app, a paste opens an editor at
// once (pen, ellipse, box, arrow, text, crop, rotate); Done (Enter) puts the edited
// picture in the paste's place, Cancel (Esc) keeps the paste, and every image in the box
// shows as a thumbnail above the prompt. On macOS the editor is a floating panel
// (editor/panel.swift) that sits over a full-screen terminal without switching Spaces,
// kept warm for the session so a paste shows it at once;
// where Swift is missing, and on Linux and Windows, it is a page in a browser window
// that editor/server.mjs serves and opens, under Node. What differs per system is in
// ./platform.
//
// How the picture travels: Claude Code writes each paste to
// <tmp>/claude-<uid>/<project>/<session>/images/<N>.png (an internal layout, not an API:
// the clipboard is the fallback) and sends the bytes it read at paste time. No plugin can
// change or add an image in a message, only drop one, and an "@file" a hook writes into
// the prompt at Enter is not read. So the box and the transcript keep "[Image #N]"; at
// Enter an edited paste's original is dropped and Claude is told, beside the prompt,
// where the edited picture is, which it then reads.
//
// Sent prompts show their pictures too, each named "Image #N", so the history says which
// picture was which.

const shots = atom({ plugin: 'paste-preview', key: 'shots' } as const, [])
const inBox = atom({ plugin: 'paste-preview', key: 'inBox' } as const, [])

const PLACEHOLDER = /\[Image #(\d+)\]/g
// A terminal cell is about twice as tall as it is wide.
const CELL = 2
// A thumbnail's height in rows, above the prompt as in the transcript.
const ROWS = 8
const THUMB_PX = '480'
// What $.fs.read hands over at most, and what an Image takes as bytes at most.
const READABLE = 4 * 1024 * 1024
const DRAWABLE = 2 * 1024 * 1024

type Paths = { os: Os; edits: string; tmp: string; session: string; terminal: string; panel: string | undefined; lang: Lang; env: Env }

// The words follow the system's language (./platform says how it is read): Traditional
// or Simplified Chinese, Japanese, Korean, or English. The terms follow macOS Preview.
const WORDS = {
  'zh-Hant': {
    edit: '編輯', edited: '已編輯', noEditor: '編輯器沒有打開', noTools: '編輯器沒有打開：找不到 Swift 或 node', noNode: '編輯器沒有打開：找不到 node',
    noBrowser: '編輯器沒有打開：找不到瀏覽器', noClipboard: { linux: '讀不到剪貼簿：請安裝 wl-clipboard 或 xclip', windows: '讀不到剪貼簿：找不到 PowerShell' },
  },
  'zh-Hans': {
    edit: '编辑', edited: '已编辑', noEditor: '编辑器没有打开', noTools: '编辑器没有打开：找不到 Swift 或 node', noNode: '编辑器没有打开：找不到 node',
    noBrowser: '编辑器没有打开：找不到浏览器', noClipboard: { linux: '读不到剪贴板：请安装 wl-clipboard 或 xclip', windows: '读不到剪贴板：找不到 PowerShell' },
  },
  ja: {
    edit: '編集', edited: '編集済み', noEditor: 'エディタを開けませんでした', noTools: 'エディタを開けませんでした：Swift も node も見つかりません', noNode: 'エディタを開けませんでした：node が見つかりません',
    noBrowser: 'エディタを開けませんでした：ブラウザが見つかりません', noClipboard: { linux: 'クリップボードを読み取れませんでした：wl-clipboard か xclip をインストールしてください', windows: 'クリップボードを読み取れませんでした：PowerShell が見つかりません' },
  },
  ko: {
    edit: '편집', edited: '편집됨', noEditor: '편집기를 열지 못했습니다', noTools: '편집기를 열지 못했습니다: Swift도 node도 찾을 수 없습니다', noNode: '편집기를 열지 못했습니다: node를 찾을 수 없습니다',
    noBrowser: '편집기를 열지 못했습니다: 브라우저를 찾을 수 없습니다', noClipboard: { linux: '클립보드를 읽지 못했습니다: wl-clipboard 또는 xclip을 설치하세요', windows: '클립보드를 읽지 못했습니다: PowerShell을 찾을 수 없습니다' },
  },
  en: {
    edit: 'Edit', edited: 'edited', noEditor: 'The editor did not open', noTools: 'The editor did not open: neither Swift nor node was found', noNode: 'The editor did not open: node was not found',
    noBrowser: 'The editor did not open: no browser was found', noClipboard: { linux: 'Could not read the clipboard: install wl-clipboard or xclip', windows: 'Could not read the clipboard: PowerShell was not found' },
  },
}
let lang: Lang = 'en'

// Module variables start over on a hot reload; everything a drawing reads is in $.state.
let paths: Promise<Paths> | undefined
let images: string | undefined
let queue: Promise<void> = Promise.resolve()
let warm: Promise<Warm | undefined> | undefined
let isTicking = false
let isClipboardToldOff = false
const capturing = new Set<number>()
const thumbs = new Map<string, string>()

// The images a text holds, in order.
const numbersIn = (text: string) => [...new Set([...text.matchAll(PLACEHOLDER)].map(m => Number(m[1])))]


const isSame = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i])

const run = async ($: EngineInterface, argv: string[]) => (await $.process.run(argv)).stdout.trim()
const runStep = ($: EngineInterface, step: Step) => $.process.run(step.argv, step.env === undefined ? undefined : { env: step.env })

// The panel is compiled once (a few seconds) for each version of its source, and named
// by it: the mod and the panel talk to each other, so a binary another install of the
// mod built, older or newer, never stands in for this one's. Built aside and moved in, so
// a second session never starts a half-written one.
const buildPanel = async ($: EngineInterface, root: string) => {
  const source = `${$.plugin.root}/editor/panel.swift`
  const text = await $.fs.read(source).catch(() => '')
  const digest = text === '' ? '' : [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('')
  const binary = digest === '' ? `${root}/bin/panel` : `${root}/bin/panel-${digest}`
  const built = await $.fs.stat(binary).catch(() => undefined)
  if (built !== undefined && (digest !== '' || built.mtimeMs >= (await $.fs.stat(source)).mtimeMs)) return binary
  await $.process.run(['mkdir', '-p', `${root}/bin`])
  const part = `${binary}.${crypto.randomUUID().slice(0, 8)}`
  const made = await $.process.run(['xcrun', 'swiftc', '-O', source, '-o', part], { timeoutMs: 120_000 }).catch(() => undefined)
  if (made?.exitCode !== 0) return undefined
  return (await $.process.run(['mv', '-f', part, binary])).exitCode === 0 ? binary : undefined
}

// Each name spelled out: $.env.get takes literals only.
const readEnv = async ($: EngineInterface): Promise<Env> => {
  const [CLAUDE_CODE_TMPDIR, TMPDIR, TMP, TEMP, SystemRoot, WAYLAND_DISPLAY] = await Promise.all([
    $.env.get('CLAUDE_CODE_TMPDIR'), $.env.get('TMPDIR'), $.env.get('TMP'), $.env.get('TEMP'), $.env.get('SystemRoot'), $.env.get('WAYLAND_DISPLAY'),
  ])
  return { CLAUDE_CODE_TMPDIR, TMPDIR, TMP, TEMP, SystemRoot, WAYLAND_DISPLAY }
}

const languageOf = async ($: EngineInterface, os: Os) => {
  if (os === 'mac') return run($, ['defaults', 'read', '-g', 'AppleLanguages']).catch(() => '')
  if (os === 'windows') return run($, ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', LANGUAGE_PS]).catch(() => '')
  const [LC_ALL, LC_MESSAGES, LANG] = await Promise.all([$.env.get('LC_ALL'), $.env.get('LC_MESSAGES'), $.env.get('LANG')])
  return localeOf({ LC_ALL, LC_MESSAGES, LANG })
}

const setUp = ($: EngineInterface) => {
  paths ??= (async () => {
    const session = await $.session.id()
    const osVariable = await $.env.get('OS')
    const os = osOf($.plugin.root, osVariable, osVariable === 'Windows_NT' ? '' : await run($, ['uname', '-s']).catch(() => ''))
    const env = await readEnv($)
    const uid = os === 'windows' ? '' : await run($, ['id', '-u'])
    const root = editsRoot(os, env, uid)
    const at = join(os, root, session.slice(0, 8))
    // Windows has no mkdir to run; a file written there makes the folders on the way.
    if (os === 'windows') await $.fs.write(join(os, at, '.keep'), '')
    else await $.process.run(os === 'mac' ? ['mkdir', '-p', at] : ['mkdir', '-p', '-m', '700', root, at])
    // Old sessions' edits are no use to anyone after a week.
    void runStep($, sweepStep(os, root)).catch(() => undefined)
    const terminal = (await $.env.get('TERM_PROGRAM')) ?? ''
    // Claude Code's own temp folder, as it resolves it (./platform says how, per system).
    const base = engineRoot(os, env, uid)
    const tmp = (await $.fs.stat(base, { resolve: true }).catch(() => undefined))?.realPath ?? (os === 'mac' ? `/private/tmp/claude-${uid}` : base)
    lang = langOf(os, await languageOf($, os))
    return { os, edits: at, tmp, session, terminal, panel: os === 'mac' ? await buildPanel($, root) : undefined, lang, env }
  })()
  return paths
}

// Claude Code's own copy of paste N; it lands a moment after the placeholder does, and
// the editor waits on it, so it is looked for often (a listing costs next to nothing).
const engineCopy = async ($: EngineInterface, n: number) => {
  const { os, tmp, session } = await setUp($)
  for (let attempt = 0; attempt < 120; attempt++) {
    images ??= await imagesOf($, os, tmp, session)
    if (images !== undefined) {
      const entry = (await $.fs.list(images).catch(() => [])).find(e => new RegExp(`^${n}\\.[a-z]+$`).test(e.name))
      if (entry !== undefined) return join(os, images, entry.name)
    }
    await $.clock.sleep(25)
  }
  return undefined
}

// <tmp>/<project>/<session>/images, the project's folder named as Claude Code names it.
const imagesOf = async ($: EngineInterface, os: Os, tmp: string, session: string) => {
  for (const entry of await $.fs.list(tmp).catch(() => [])) {
    if (entry.kind === 'file') continue
    const at = join(os, tmp, entry.name, session, 'images')
    if (await $.fs.exists(at).catch(() => false)) return at
  }
  return undefined
}

// Only where Claude Code kept no copy: the clipboard still holds what was just pasted.
// Where no tool to read it is there at all, the person is told once what to install.
const clipboardCopy = async ($: EngineInterface, n: number) => {
  const { os, edits, env } = await setUp($)
  const file = join(os, edits, `${n}.paste.png`)
  const steps = clipboardSteps(os, file, env)
  let missing = 0
  for (const step of steps) {
    const pasted = await runStep($, step).catch(() => undefined)
    if (isMissing(pasted?.exitCode)) missing += 1
    else if (pasted?.exitCode === 0 && ((await $.fs.stat(file).catch(() => undefined))?.size ?? 0) > 0) return file
  }
  if (os !== 'mac' && missing === steps.length && !isClipboardToldOff) {
    isClipboardToldOff = true
    $.ui.toast(WORDS[lang].noClipboard[os])
  }
  return undefined
}

// A picture's size and first bytes, without a tool where the file is small enough to read.
const header = async ($: EngineInterface, os: Os, file: string) => {
  const { size } = await $.fs.stat(file)
  if (size <= READABLE) {
    const { base64 } = await $.fs.read(file, { as: 'bytes' })
    return { size, seen: sizeOf(fromBase64(base64.slice(0, 87_384))) }
  }
  const head = await runStep($, headStep(os, file))
  return { size, seen: head.exitCode === 0 ? sizeOf(fromBase64(head.stdout)) : undefined }
}

type Look = { width: number; height: number; thumb: string; isLarge: boolean }

// Size and a small PNG for the band: a screenshot can be 10 MB, the band needs 480 px.
// sips makes it on macOS. No tool for it comes with every Linux or Windows, so there
// the size is read from the file's header and the band draws the picture itself, the
// terminal scaling it: as bytes up to 2 MiB, by its name past that. An edit made in the
// browser comes with its own small copy, which stands in for it.
const look = async ($: EngineInterface, n: number, file: string, small?: string): Promise<Look | undefined> => {
  const { os, edits } = await setUp($)
  if (os === 'mac') {
    const info = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', file])
    const width = Number(/pixelWidth: (\d+)/.exec(info.stdout)?.[1] ?? 0)
    const height = Number(/pixelHeight: (\d+)/.exec(info.stdout)?.[1] ?? 0)
    const thumb = `${edits}/${n}.thumb.png`
    const made = await $.process.run(['sips', '-s', 'format', 'png', '-Z', THUMB_PX, file, '--out', thumb])
    return made.exitCode === 0 && width > 0 && height > 0 ? { width, height, thumb, isLarge: false } : undefined
  }
  if (small !== undefined) {
    const { seen } = await header($, os, small).catch(() => ({ seen: undefined }))
    if (seen?.isPng) return { width: seen.width, height: seen.height, thumb: small, isLarge: false }
  }
  const { size, seen } = await header($, os, file)
  if (seen === undefined) return undefined
  // A JPEG (Claude Code keeps a large paste as one) has no picture in the band, only its
  // name; the terminal draws PNG alone.
  return { width: seen.width, height: seen.height, thumb: seen.isPng ? file : '', isLarge: size > DRAWABLE }
}

const refresh = async ($: EngineInterface, n: number, file: string, isEdited: boolean, small?: string) => {
  const seen = file === '' ? undefined : await look($, n, file, small).catch(() => undefined)
  await update($, shots, list => {
    const was = list.find(s => s.n === n)
    const gen = (was?.gen ?? -1) + 1
    const shot: Shot = seen === undefined
      ? { n, file: '', thumb: '', gen, width: 0, height: 0, isEdited, ratio: 0, isLarge: false }
      : { n, file, thumb: seen.thumb, gen, width: seen.width, height: seen.height, isEdited, ratio: isEdited && was !== undefined ? was.ratio : seen.width / seen.height, isLarge: seen.isLarge }
    return [...list.filter(s => s.n !== n), shot]
  })
  return seen !== undefined
}

// The panel kept warm (macOS): started with the session, and again on the next keystroke
// after it quit unused, so by the time a paste lands it only has to show. Each edit is a
// file in its requests folder, answered by a line on its output: SAVED or CANCELLED and
// the request's id. Gone (quit, or failed to start), the edit falls back to a panel of
// its own.
type Warm = { requests: string; waiting: Map<string, (word: string) => void>; isUsed: boolean }

const keepWarm = ($: EngineInterface) => {
  warm ??= (async () => {
    const { os, edits, panel } = await setUp($)
    if (os !== 'mac' || panel === undefined) return undefined
    const requests = `${edits}/requests`
    await $.process.run(['mkdir', '-p', requests])
    const held: Warm = { requests, waiting: new Map(), isUsed: false }
    const mine = warm
    const born = Date.now()
    void (async () => {
      let said = ''
      try {
        for await (const piece of $.process.spawn({ argv: [panel, 'serve', `${$.plugin.root}/editor/editor.html`, requests, lang] })) {
          if (!('text' in piece) || piece.stream !== 'stdout') continue
          said += piece.text
          for (let end = said.indexOf('\n'); end >= 0; end = said.indexOf('\n')) {
            const [word = '', id = ''] = said.slice(0, end).trim().split(' ')
            said = said.slice(end + 1)
            held.waiting.get(id)?.(word)
            held.waiting.delete(id)
          }
        }
      } catch {}
      // Quit unused: the next keystroke starts it again. Gone at once: it will not start
      // here, and each edit has a panel of its own.
      if (warm === mine) warm = Date.now() - born < 10_000 && held.waiting.size === 0 && !held.isUsed ? Promise.resolve(undefined) : undefined
      for (const done of held.waiting.values()) done('GONE')
    })()
    return held
  })().catch(() => undefined)
  return warm
}

// One picture through the warm panel: SAVED, CANCELLED, or undefined where there is none.
const editWarm = async ($: EngineInterface, file: string, out: string, label: string) => {
  const held = await keepWarm($)
  if (held === undefined) return undefined
  const id = `${Date.now().toString(36)}-${label.replace(/\D/g, '')}`
  held.isUsed = true
  const answer = new Promise<string>(resolve => held.waiting.set(id, resolve))
  await $.fs.write(`${held.requests}/${id}.json`, JSON.stringify({ picture: file, out, label }))
  const word = await answer
  return word === 'GONE' ? undefined : word
}

const edit = async ($: EngineInterface, n: number, file?: string) => {
  const picture = file ?? (await read($, shots)).find(s => s.n === n)?.file
  if (picture === undefined || picture === '') return
  const { os, edits: at, terminal, panel } = await setUp($)
  const words = WORDS[lang]
  const out = join(os, at, `${n}.png`)
  let said = (await editWarm($, picture, out, `Image #${n}`).catch(() => undefined)) ?? ''
  if (said === '') {
    const argv = editorArgv(os, { root: $.plugin.root, panel, file: picture, out, label: `Image #${n}`, terminal, lang })
    try {
      for await (const piece of $.process.spawn({ argv })) {
        if ('text' in piece && piece.stream === 'stdout') said += piece.text
      }
    } catch {
      $.ui.toast(panel !== undefined ? words.noEditor : os === 'mac' ? words.noTools : words.noNode)
      return
    }
  }
  // The browser editor says when no window could be opened for it.
  if (said.includes('UNOPENED')) $.ui.toast(words.noBrowser)
  if (said.includes('SAVED')) await refresh($, n, out, true, panel === undefined ? thumbOf(out) : undefined)
}

// One editor at a time: three pastes in a row open one after another.
const enqueue = ($: EngineInterface, n: number, file?: string) => {
  queue = queue.then(() => edit($, n, file)).catch(() => undefined)
}

// The editor opens on the file as soon as it is found; the band's thumbnail is made
// beside it, not before it.
const capture = async ($: EngineInterface, n: number) => {
  const file = (await engineCopy($, n)) ?? (await clipboardCopy($, n)) ?? ''
  if (file !== '') enqueue($, n, file)
  await refresh($, n, file, false)
}

// Numbers run up through a session (#1, #3, #10), so a known N is the same picture coming
// back (undo, a recalled prompt) and only an unknown one is a new paste.
const sync = async ($: EngineInterface, text: string) => {
  await setUp($)
  const ns = numbersIn(text)
  if (!isSame(ns, await read($, inBox))) await update($, inBox, () => ns)
  const known = await read($, shots)
  for (const n of ns) {
    if (capturing.has(n) || known.some(s => s.n === n)) continue
    capturing.add(n)
    void capture($, n).finally(() => capturing.delete(n))
  }
}

const tick = async ($: EngineInterface) => {
  if (isTicking) return
  isTicking = true
  try {
    await sync($, (await $.prompt.read()).text)
  } finally {
    isTicking = false
  }
}

// What an Image draws: the thumbnail's bytes, read once per version, or for a picture
// past what bytes may carry (2 MiB), its file's name, which the terminal reads itself.
const picture = async ($: EngineInterface, shot: Shot): Promise<ImageSource> => {
  if (shot.isLarge) return { file: shot.thumb, format: 'png', generation: shot.gen }
  const at = `${shot.thumb}:${shot.gen}`
  const held = thumbs.get(at)
  if (held !== undefined) return { png: held }
  const { base64 } = await $.fs.read(shot.thumb, { as: 'bytes' })
  thumbs.set(at, base64)
  return { png: base64 }
}

// Every thumbnail the same height, side by side: `tallest` rows, fewer only where they
// would not fit across.
const fit = (list: readonly Shot[], columns: number, tallest: number) => {
  const widthAt = (s: Shot, rows: number) => Math.max(4, Math.min(48, Math.round((rows * CELL * s.width) / s.height)))
  let rows = tallest
  while (rows > 3 && list.reduce((sum, s) => sum + widthAt(s, rows) + 2, 0) > columns) rows -= 1
  return list.map(s => {
    const width = widthAt(s, rows)
    return { columns: width, rows: Math.max(1, Math.min(rows, Math.round((width * s.height) / s.width / CELL))) }
  })
}

// The band's thumbnails are sized by the screen, never by the rows the band has left: in
// fullscreen those are what the prompt leaves, so a thumbnail sized by them shrank with
// every line typed. The bottom slot is half the screen, the prompt's included, so on a
// short terminal a fifth of the screen leaves the prompt its room. A prompt longer than
// the rest scrolls the band, as any tall band does: the picture is cut, never squeezed.
const bandRows = (screenRows: number | undefined) => (screenRows === undefined ? ROWS : Math.max(3, Math.min(ROWS, Math.floor(screenRows / 5))))

// Width over height of an image block, from its header: enough to tell one paste from
// another when Claude Code has scaled it down or turned it into a JPEG.
export const ratioOf = (block: { type: string; [field: string]: unknown }) => {
  const source = block.source as { type?: string; data?: string } | undefined
  if (block.type !== 'image' || source?.type !== 'base64' || typeof source.data !== 'string') return undefined
  const seen = sizeOf(fromBase64(source.data.slice(0, 87_384)))
  return seen === undefined ? undefined : seen.width / seen.height
}

type Wanted = { n: number; rank: number; ratio: number }

// Which originals the prompt being sent should lose: for each edited paste, its place
// among the prompt's images (they go in by number) and its shape, to check the block.
let toDrop: Wanted[] = []

// A shape the header does not tell (a large JPEG's) does not rule a block out.
const isNear = (a: number | undefined, b: number) => a === undefined || Math.abs(a - b) / b < 0.02

export const dropOriginals = <B extends { type: string; [field: string]: unknown }>(content: readonly B[], wanted: readonly Wanted[]) => {
  const images = content.flatMap((block, i) => (block.type === 'image' ? [{ i, ratio: ratioOf(block) }] : []))
  const gone = new Set<number>()
  for (const want of wanted) {
    const ranked = images[want.rank]
    // By place first; if Claude Code ordered them otherwise, the one picture of that shape.
    const alike = images.filter(m => !gone.has(m.i) && m.ratio !== undefined && isNear(m.ratio, want.ratio))
    const pick = ranked !== undefined && !gone.has(ranked.i) && isNear(ranked.ratio, want.ratio) ? ranked : alike.length === 1 ? alike[0] : undefined
    if (pick !== undefined) gone.add(pick.i)
  }
  return content.filter((_, i) => !gone.has(i))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void setUp($).then(() => keepWarm($)).catch(() => undefined)
    $.clock.every(500, () => void tick($).catch(() => undefined))
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    void keepWarm($)
    // Only the band's list is awaited; finding the picture runs on behind it.
    await sync($, box.text).catch(() => undefined)
    return box
  })

  // At Enter: an edited paste's original is left out and Claude is pointed at the edit.
  on('prompt.submit', async ($, e, next) => {
    toDrop = []
    const ns = numbersIn(e.text)
    const edited = (await read($, shots)).filter(s => s.isEdited && s.file !== '' && ns.includes(s.n))
    if (edited.length === 0) return next(e)
    const ranks = [...ns].sort((a, b) => a - b)
    toDrop = edited.map(s => ({ n: s.n, rank: ranks.indexOf(s.n), ratio: s.ratio }))
    const notes = edited.map(s => `The person edited [Image #${s.n}] before sending (drew on, cropped or rotated it). The original paste is not attached; the edited picture is ${s.file}. Read that file and work from it.`)
    return next({ ...e, context: [...(e.context ?? []), ...notes] })
  })

  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    // Only the prompt the hook above saw: its text still names the edited pastes.
    const isOurs = toDrop.length > 0 && e.message.role === 'user' && e.message.content.some(b => b.type === 'text' && typeof b.text === 'string' && toDrop.every(w => (b.text as string).includes(`[Image #${w.n}]`)))
    if (!isOurs) return next(e)
    const content = dropOriginals(e.message.content, toDrop)
    toDrop = []
    return next({ ...e, message: { ...e.message, content } })
  })

  // A sent prompt with pictures: the row as Claude Code draws it, then each picture named
  // as the text names it. ctrl+o shows the engine's own row.
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'composer' } } }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded) return next(e)
    const ns = numbersIn(e.props.text)
    if (ns.length === 0) return next(e)
    const all = await read($, shots)
    const drawn = ns.flatMap(n => all.filter(s => s.n === n && s.thumb !== ''))
    if (drawn.length === 0) return next(e)
    const { Box, Text, Image } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 80
    const sizes = fit(drawn, columns - 4, ROWS)
    const pictures = await Promise.all(drawn.map(s => picture($, s).catch(() => undefined)))
    return (
      <Box flexDirection="column">
        <Box backgroundColor="userMessageBackground" paddingRight={1}>
          <Text><Text color="inactive">❯</Text> <Text color="text">{e.props.text}</Text></Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2} marginTop={1}>
          {drawn.map((shot, i) => {
            const source = pictures[i]
            const size = sizes[i]
            return (
              <Box key={`sent-${shot.n}`} flexDirection="column">
                {source !== undefined && size !== undefined && (
                  <Image key={`sent-img-${shot.n}`} source={source} columns={size.columns} rows={size.rows} alt={`Image #${shot.n}`} />
                )}
                <Text key={`sent-name-${shot.n}`} dimColor>Image #{shot.n}{shot.isEdited ? ` ${WORDS[lang].edited}` : ''}</Text>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const ns = await read($, inBox)
    if (ns.length === 0) return next(e)
    const all = await read($, shots)
    const { Box, Text, Button, Image } = $.ui.resolve(e)
    // A number whose copy is still being found shows as #N alone until it lands.
    const drawn = ns.flatMap(n => all.filter(s => s.n === n && s.thumb !== ''))
    const sizes = fit(drawn, e.props.bodyColumns, bandRows(e.viewport?.rows))
    const pictures = await Promise.all(drawn.map(s => picture($, s).catch(() => undefined)))

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {ns.map((n, i) => {
          const shot = all.find(s => s.n === n)
          const at = shot === undefined ? -1 : drawn.indexOf(shot)
          const source = pictures[at]
          const size = sizes[at]
          const hotkey = i < 9 ? { hotkey: String(i + 1) } : {}
          return (
            <Box key={`shot-${n}`} flexDirection="column">
              {source !== undefined && size !== undefined && (
                <Image key={`img-${n}`} source={source} columns={size.columns} rows={size.rows} alt={`#${n}`} />
              )}
              <Box flexDirection="row" columnGap={1}>
                <Text key={`name-${n}`} dimColor>Image #{n}{shot?.isEdited ? ` ${WORDS[lang].edited}` : ''}</Text>
                {shot !== undefined && shot.file !== '' && <Button key={`edit-${n}`} label={WORDS[lang].edit} plain {...hotkey} onPress={() => enqueue($, n)} />}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
