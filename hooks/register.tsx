import { atom, read, update } from 'claude-code'
import type { EngineInterface, ImageSource, Register } from 'claude-code'

import type { Shot } from '../types'
import { clipboardSteps, editorArgv, editsRoot, engineRoot, fromBase64, headStep, isMissing, isNewer, join, LANGUAGE_PS, langOf, localeOf, osOf, sizeOf, sweepStep, thumbOf } from './platform'
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

// Each paste is a value of its own, by its number: a drawing reads only the pictures it
// shows, so a paste redraws the band, not every sent prompt that has a picture.
const SHOT = { plugin: 'paste-preview', key: 'shot' } as const
const inBox = atom({ plugin: 'paste-preview', key: 'inBox' } as const, [])
// What 0.2 kept: every paste in one list, read once after an update in a running session.
const legacy = atom({ plugin: 'paste-preview', key: 'shots' } as const, [])

const PLACEHOLDER = /\[Image #(\d+)\]/g
// A terminal cell is about twice as tall as it is wide.
const CELL = 2
// A thumbnail's height in rows, above the prompt as in the transcript.
const ROWS = 8
const THUMB_PX = '480'
// What $.fs.read hands over at most, and what an Image takes as bytes at most.
const READABLE = 4 * 1024 * 1024
const DRAWABLE = 2 * 1024 * 1024

// What holds for the process (Paths), and what holds for one conversation: /clear and
// /resume start another in the same process, under another session id and with no
// session.start, and Claude Code keeps its pastes in a folder named by that id.
type Paths = { os: Os; root: string; tmp: string; terminal: string; panel: string | undefined; lang: Lang; env: Env }
type Conversation = { session: string; edits: string; images?: string }

// The words follow the system's language (./platform says how it is read): Traditional
// or Simplified Chinese, Japanese, Korean, or English. The terms follow macOS Preview.
const WORDS = {
  'zh-Hant': {
    edit: '編輯', edited: '已編輯', noEditor: '編輯器沒有打開', noTools: '編輯器沒有打開：找不到 Swift 或 node', noNode: '編輯器沒有打開：找不到 node',
    noBrowser: '編輯器沒有打開：找不到瀏覽器', noClipboard: { linux: '讀不到剪貼簿：請安裝 wl-clipboard 或 xclip', windows: '讀不到剪貼簿：找不到 PowerShell' },
    update: (latest: string, own: string) => `paste-preview ${latest} 已推出（你目前是 ${own}）。到 /plugin 更新，並在那裡開啟自動更新，之後就會自動保持最新。`,
  },
  'zh-Hans': {
    edit: '编辑', edited: '已编辑', noEditor: '编辑器没有打开', noTools: '编辑器没有打开：找不到 Swift 或 node', noNode: '编辑器没有打开：找不到 node',
    noBrowser: '编辑器没有打开：找不到浏览器', noClipboard: { linux: '读不到剪贴板：请安装 wl-clipboard 或 xclip', windows: '读不到剪贴板：找不到 PowerShell' },
    update: (latest: string, own: string) => `paste-preview ${latest} 已发布（你现在是 ${own}）。到 /plugin 更新，并在那里开启自动更新，之后就会自动保持最新。`,
  },
  ja: {
    edit: '編集', edited: '編集済み', noEditor: 'エディタを開けませんでした', noTools: 'エディタを開けませんでした：Swift も node も見つかりません', noNode: 'エディタを開けませんでした：node が見つかりません',
    noBrowser: 'エディタを開けませんでした：ブラウザが見つかりません', noClipboard: { linux: 'クリップボードを読み取れませんでした：wl-clipboard か xclip をインストールしてください', windows: 'クリップボードを読み取れませんでした：PowerShell が見つかりません' },
    update: (latest: string, own: string) => `paste-preview ${latest} が出ました（現在は ${own}）。/plugin で更新できます。そこで自動更新をオンにすると、常に最新に保たれます。`,
  },
  ko: {
    edit: '편집', edited: '편집됨', noEditor: '편집기를 열지 못했습니다', noTools: '편집기를 열지 못했습니다: Swift도 node도 찾을 수 없습니다', noNode: '편집기를 열지 못했습니다: node를 찾을 수 없습니다',
    noBrowser: '편집기를 열지 못했습니다: 브라우저를 찾을 수 없습니다', noClipboard: { linux: '클립보드를 읽지 못했습니다: wl-clipboard 또는 xclip을 설치하세요', windows: '클립보드를 읽지 못했습니다: PowerShell을 찾을 수 없습니다' },
    update: (latest: string, own: string) => `paste-preview ${latest}이(가) 나왔습니다(현재 ${own}). /plugin에서 업데이트하고, 거기서 자동 업데이트를 켜 두면 항상 최신으로 유지됩니다.`,
  },
  en: {
    edit: 'Edit', edited: 'edited', noEditor: 'The editor did not open', noTools: 'The editor did not open: neither Swift nor node was found', noNode: 'The editor did not open: node was not found',
    noBrowser: 'The editor did not open: no browser was found', noClipboard: { linux: 'Could not read the clipboard: install wl-clipboard or xclip', windows: 'Could not read the clipboard: PowerShell was not found' },
    update: (latest: string, own: string) => `paste-preview ${latest} is out (you have ${own}). Update it in /plugin, and turn on auto-update there to stay current.`,
  },
}
let lang: Lang = 'en'

// Module variables start over on a hot reload; everything a drawing reads is in $.state.
let paths: Promise<Paths> | undefined
let retryAt = 0
let conversation: Promise<Conversation> | undefined
let swept: Promise<unknown> | undefined
let migrated: Promise<void> | undefined
let queue: Promise<void> = Promise.resolve()
let warm: Promise<Warm | undefined> | undefined
let isTicking = false
let isStarted = false
let isClipboardToldOff = false
// Pastes being looked for, by number; pastes already known, as `<session>:<N>`, so a known
// one costs a keystroke no read of state.
const capturing = new Set<number>()
const known = new Set<string>()
// The thumbnails' bytes, one per file, the least recently drawn let go first past this
// much: off macOS a thumbnail is the paste itself, up to 2 MiB, and sessions paste many.
const thumbs = new Map<string, { gen: number; png: string }>()
const THUMBS_BYTES = 8 * 1024 * 1024
let thumbsHeld = 0

// The images a text holds, in order.
const numbersIn = (text: string) => [...new Set([...text.matchAll(PLACEHOLDER)].map(m => Number(m[1])))]


const isSame = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i])

const run = async ($: EngineInterface, argv: string[]) => (await $.process.run(argv)).stdout.trim()
const runStep = ($: EngineInterface, step: Step, timeoutMs?: number) => $.process.run(step.argv, { ...(step.env === undefined ? {} : { env: step.env }), ...(timeoutMs === undefined ? {} : { timeoutMs }) })

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
  const [HOME, CLAUDE_CODE_TMPDIR, TMPDIR, TMP, TEMP, SystemRoot, WAYLAND_DISPLAY] = await Promise.all([
    $.env.get('HOME'), $.env.get('CLAUDE_CODE_TMPDIR'), $.env.get('TMPDIR'), $.env.get('TMP'), $.env.get('TEMP'), $.env.get('SystemRoot'), $.env.get('WAYLAND_DISPLAY'),
  ])
  return { HOME, CLAUDE_CODE_TMPDIR, TMPDIR, TMP, TEMP, SystemRoot, WAYLAND_DISPLAY }
}

const languageOf = async ($: EngineInterface, os: Os) => {
  if (os === 'mac') return run($, ['defaults', 'read', '-g', 'AppleLanguages']).catch(() => '')
  if (os === 'windows') return run($, ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', LANGUAGE_PS]).catch(() => '')
  const [LC_ALL, LC_MESSAGES, LANG] = await Promise.all([$.env.get('LC_ALL'), $.env.get('LC_MESSAGES'), $.env.get('LANG')])
  return localeOf({ LC_ALL, LC_MESSAGES, LANG })
}

// A set-up that failed (a command it needs is missing) is tried again after a while, not
// on every half-second look.
const RETRY_MS = 10_000
const setUp = async ($: EngineInterface) => {
  if (paths === undefined && retryAt > 0 && (await $.clock.now()) < retryAt) throw new Error('paste-preview: set-up failed a moment ago')
  paths ??= (async () => {
    const osVariable = await $.env.get('OS')
    const os = osOf($.plugin.root, osVariable, osVariable === 'Windows_NT' ? '' : await run($, ['uname', '-s']).catch(() => ''))
    const env = await readEnv($)
    const uid = os === 'windows' ? '' : await run($, ['id', '-u'])
    const userTemp = os === 'mac' ? await run($, ['getconf', 'DARWIN_USER_TEMP_DIR']).catch(() => '') : ''
    let root = editsRoot(os, env, uid, userTemp || undefined)
    // The user's alone before anything is put in it (Windows' temp folder already is).
    // mkdir -p takes a folder that is there already, whoever made it: one this user does
    // not own alone (theirs, 0700, not a link) is left be, for a fresh one of the mod's.
    if (os !== 'windows') {
      await $.process.run(['mkdir', '-p', '-m', '700', root])
      const isOwn = (await run($, ['find', root, '-maxdepth', '0', '-type', 'd', '-user', uid, '-perm', '700']).catch(() => '')) === root
      if (!isOwn) root = await run($, ['mktemp', '-d', `${root}.XXXXXX`])
    }
    // 0.2 kept macOS edits in /private/tmp/paste-preview: nothing new goes there, and what
    // it holds goes as the rest does, a week on, where the folder is this user's.
    if (os === 'mac') {
      const old = '/private/tmp/paste-preview'
      if ((await run($, ['find', old, '-maxdepth', '0', '-type', 'd', '-user', uid]).catch(() => '')) === old) {
        void runStep($, { argv: ['find', old, '-mindepth', '1', '-maxdepth', '1', '-mtime', '+7', '-exec', 'rm', '-rf', '{}', '+'] }, 10_000).catch(() => undefined)
      }
    }
    // Old sessions' edits are no use to anyone after a week. A conversation's folder is
    // made once this is done, so a resumed old one's is not swept away under it; a sweep
    // that hangs is cut off.
    swept = runStep($, sweepStep(os, root), 10_000).catch(() => undefined)
    const terminal = (await $.env.get('TERM_PROGRAM')) ?? ''
    // Claude Code's own temp folder, as it resolves it (./platform says how, per system).
    const base = engineRoot(os, env, uid)
    const tmp = (await $.fs.stat(base, { resolve: true }).catch(() => undefined))?.realPath ?? (os === 'mac' ? `/private/tmp/claude-${uid}` : base)
    lang = langOf(os, await languageOf($, os))
    return { os, root, tmp, terminal, panel: os === 'mac' ? await buildPanel($, root) : undefined, lang, env }
  })()
  const made = paths
  made.catch(async () => {
    const now = await $.clock.now().catch(() => 0)
    if (paths !== made) return
    retryAt = now + RETRY_MS
    paths = undefined
  })
  return made
}

// The conversation the box belongs to now, asked of the engine each time (a paste, the
// half-second look), since nothing tells the mod first; its folder made once.
const conversationNow = async ($: EngineInterface) => {
  const session = await $.session.id()
  const held = conversation === undefined ? undefined : await conversation.catch(() => undefined)
  if (held !== undefined && held.session === session) return held
  const made = (async (): Promise<Conversation> => {
    const { os, root } = await setUp($)
    await swept
    const edits = join(os, root, session.slice(0, 8))
    // Windows has no mkdir to run; a file written there makes the folders on the way.
    if (os === 'windows') await $.fs.write(join(os, edits, '.keep'), '')
    else {
      await $.process.run(['mkdir', '-p', '-m', '700', root, edits])
      // A resumed conversation's folder may be a week old: marked in use, so the sweep of
      // another Claude Code starting meanwhile leaves it.
      await $.process.run(['touch', edits])
    }
    return { session, edits }
  })()
  conversation = made
  made.catch(() => conversation === made && (conversation = undefined))
  return made
}

// The conversation as last asked, for a keystroke, which should not wait on the engine.
const lastConversation = ($: EngineInterface) => conversation ?? conversationNow($)
const sessionOf = ($: EngineInterface) => $.session.id().catch(() => undefined)

// Claude Code's own copy of paste N; it lands a moment after the placeholder does, and
// the editor waits on it, so it is looked for often (a listing costs next to nothing).
const engineCopy = async ($: EngineInterface, n: number, at: Conversation) => {
  const { os, tmp } = await setUp($)
  for (let attempt = 0; attempt < 120; attempt++) {
    at.images ??= await imagesOf($, os, tmp, at.session)
    if (at.images !== undefined) {
      const entry = (await $.fs.list(at.images).catch(() => [])).find(e => new RegExp(`^${n}\\.[a-z]+$`).test(e.name))
      if (entry !== undefined) return join(os, at.images, entry.name)
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
const clipboardCopy = async ($: EngineInterface, n: number, at: Conversation) => {
  const { os, env } = await setUp($)
  const file = join(os, at.edits, `${n}.paste.png`)
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
const look = async ($: EngineInterface, n: number, at: Conversation, file: string, small?: string): Promise<Look | undefined> => {
  const { os } = await setUp($)
  const { edits } = at
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

// Paste N as it now is, for the conversation it was pasted in. An edit that finishes
// after the number went to another conversation's paste is that one's no longer.
const refresh = async ($: EngineInterface, n: number, at: Conversation, file: string, isEdited: boolean, small?: string) => {
  const seen = file === '' ? undefined : await look($, n, at, file, small).catch(() => undefined)
  const { session } = at
  await update($, { ...SHOT, id: String(n) }, held => {
    if (isEdited && held !== undefined && held.session !== session) return held
    const was = held?.session === session ? held : undefined
    const gen = (held?.gen ?? -1) + 1
    return seen === undefined
      ? { n, file: '', thumb: '', gen, width: 0, height: 0, isEdited, ratio: 0, isLarge: false, session }
      : { n, file, thumb: seen.thumb, gen, width: seen.width, height: seen.height, isEdited, ratio: isEdited && was !== undefined ? was.ratio : seen.width / seen.height, isLarge: seen.isLarge, session }
  })
  known.add(`${session}:${n}`)
}

// The pictures of these numbers pasted in this conversation, in that order. A number the
// process gave a picture in another conversation is not this one's.
const shotsOf = async ($: EngineInterface, ns: readonly number[], session: string | undefined) => {
  if (session === undefined) return []
  const held = await Promise.all(ns.map(n => read($, { ...SHOT, id: String(n) })))
  return held.filter((s): s is Shot => s !== undefined && s.session === session)
}

// The panel kept warm (macOS): started with the session, and again on the next keystroke
// after it quit unused, so by the time a paste lands it only has to show. Each edit is a
// file in its requests folder, answered by a line on its output: SAVED or CANCELLED and
// the request's id. Gone (quit, or failed to start), the edit falls back to a panel of
// its own.
type Warm = { requests: string; waiting: Map<string, (word: string) => void>; isUsed: boolean }

const keepWarm = ($: EngineInterface) => {
  warm ??= (async () => {
    const { os, panel } = await setUp($)
    if (os !== 'mac' || panel === undefined) return undefined
    // Each request names its picture and its output in full, so the folder of the
    // conversation the panel started in serves the next ones too.
    const requests = `${(await lastConversation($)).edits}/requests`
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
  })().catch(() => {
    // A set-up that failed: asked again with the next edit.
    warm = undefined
    return undefined
  })
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

const edit = async ($: EngineInterface, n: number, at: Conversation, file?: string) => {
  const picture = file ?? (await read($, { ...SHOT, id: String(n) }))?.file
  if (picture === undefined || picture === '') return
  const { os, terminal, panel } = await setUp($)
  const words = WORDS[lang]
  const out = join(os, at.edits, `${n}.png`)
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
  if (said.includes('SAVED')) await refresh($, n, at, out, true, panel === undefined ? thumbOf(out) : undefined)
}

// One editor at a time: three pastes in a row open one after another. Each edit is the
// conversation's it was asked in: the paste's, or the band's when Edit was pressed.
const enqueue = ($: EngineInterface, n: number, at: Conversation, file?: string) => {
  queue = queue.then(() => edit($, n, at, file)).catch(() => undefined)
}

// The editor opens on the file as soon as it is found; the band's thumbnail is made
// beside it, not before it. The conversation is asked again as the paste lands, so a
// paste after /clear or /resume is looked for in that conversation's folder.
const capture = async ($: EngineInterface, n: number) => {
  const at = await conversationNow($)
  const file = (await engineCopy($, n, at)) ?? (await clipboardCopy($, n, at)) ?? ''
  if (file !== '') {
    enqueue($, n, at, file)
    // Its editor is on its way: should its picture not be kept in state, it is not
    // looked for, and opened, again.
    known.add(`${at.session}:${n}`)
  }
  await refresh($, n, at, file, false)
}

// An update to this version applied with /reload-plugins runs it in the same session,
// with the state 0.2 kept. Its pastes are carried over, as the conversation's now, before
// any is looked for: none is taken for new, and an edit made before goes with it.
const migrate = ($: EngineInterface) => {
  migrated ??= (async () => {
    const old = await read($, legacy)
    if (old.length === 0) return
    const { session } = await conversationNow($)
    for (const shot of old) await update($, { ...SHOT, id: String(shot.n) }, held => held ?? { ...shot, session })
  })().catch(() => undefined)
  return migrated
}

// Within a conversation a known N is the same picture coming back (undo, a recalled
// prompt), and only an unknown one is a new paste.
const sync = async ($: EngineInterface, text: string) => {
  const ns = numbersIn(text)
  if (!isSame(ns, await read($, inBox))) await update($, inBox, () => ns)
  if (ns.length === 0) return
  await migrate($)
  const { session } = await lastConversation($)
  for (const n of ns) {
    if (capturing.has(n) || known.has(`${session}:${n}`)) continue
    // Claimed before the read, so a second look meanwhile does not look for it too; a
    // read that fails is taken as unknown, and the paste looked for.
    capturing.add(n)
    if ((await read($, { ...SHOT, id: String(n) }).catch(() => undefined))?.session === session) {
      known.add(`${session}:${n}`)
      capturing.delete(n)
      continue
    }
    void capture($, n)
      .catch(() => undefined)
      .finally(() => capturing.delete(n))
  }
}

const tick = async ($: EngineInterface) => {
  if (isTicking) return
  isTicking = true
  try {
    // Notices a /clear or /resume within half a second, before the next paste needs it.
    await conversationNow($)
    await sync($, (await $.prompt.read()).text)
  } finally {
    isTicking = false
  }
}

// The half-second look at the box, and the warm panel, from whichever comes first: a
// session's start, or the first edit of the box where no start reached the mod.
const start = ($: EngineInterface) => {
  if (isStarted) return
  isStarted = true
  void setUp($).then(() => keepWarm($)).catch(() => undefined)
  $.clock.every(500, () => void tick($).catch(() => undefined))
}

// What an Image draws: the thumbnail's bytes, read once per version, or for a picture
// past what bytes may carry (2 MiB), its file's name, which the terminal reads itself.
const picture = async ($: EngineInterface, shot: Shot): Promise<ImageSource> => {
  if (shot.isLarge) return { file: shot.thumb, format: 'png', generation: shot.gen }
  const held = thumbs.get(shot.thumb)
  if (held !== undefined) {
    thumbs.delete(shot.thumb)
    thumbsHeld -= held.png.length
  }
  const png = held !== undefined && held.gen === shot.gen ? held.png : (await $.fs.read(shot.thumb, { as: 'bytes' })).base64
  // Another drawing may have read and kept it meanwhile: it is counted once.
  const raced = thumbs.get(shot.thumb)
  if (raced !== undefined) {
    thumbs.delete(shot.thumb)
    thumbsHeld -= raced.png.length
  }
  thumbs.set(shot.thumb, { gen: shot.gen, png })
  thumbsHeld += png.length
  for (const [file, kept] of thumbs) {
    if (thumbsHeld <= THUMBS_BYTES || file === shot.thumb) break
    thumbs.delete(file)
    thumbsHeld -= kept.png.length
  }
  return { png }
}

// The engine refuses a drawn tree past 2 MiB of Image source in all, and off macOS a
// thumbnail is the paste itself, so three screenshots can pass it and take the whole band
// (buttons too) away. Pictures are carried as bytes until this budget is spent; the rest
// go by their file name, as a large one does.
const TREE_BYTES = 1536 * 1024

const picturesOf = async ($: EngineInterface, drawn: Shot[]): Promise<(ImageSource | undefined)[]> => {
  let used = 0
  const out: (ImageSource | undefined)[] = []
  for (const shot of drawn) {
    const source = await picture($, shot).catch(() => undefined)
    if (source !== undefined && 'png' in source) {
      if (used + source.png.length > TREE_BYTES) {
        out.push({ file: shot.thumb, format: 'png', generation: shot.gen })
        continue
      }
      used += source.png.length
    }
    out.push(source)
  }
  return out
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

// ——— a newer version ———
//
// Claude Code updates a plugin from a marketplace like this one only where the person has
// turned on that marketplace's auto-update (/plugin, Marketplaces). Elsewhere a fix
// reaches nobody until they look. So, once a day, the mod asks GitHub for its manifest,
// and where a newer version is out says so, once per version.
//
// The request is a plain GET of a public file: no cookie, no key, nothing about the
// person. It is not made where Claude Code is told to keep to essential traffic, or where
// the plugin's "updateCheck" option is off.

const LATEST = 'https://raw.githubusercontent.com/alan890104/claude-code-paste-preview/main/.claude-plugin/plugin.json'
const DAY = 24 * 60 * 60 * 1000

// What the store keeps across sessions: when GitHub last answered, and the version the
// person was last told of.
type Checked = { at: number; told?: string }

const versionIn = (text: string) => {
  try {
    const { version } = JSON.parse(text) as { version?: unknown }
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

// `say` words the notice in the person's language. Only a version number is shown from
// what GitHub answers, so a file that held anything else says nothing.
async function checkForUpdate($: EngineInterface, say: (latest: string, own: string) => string) {
  if (await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')) return
  const now = await $.clock.now()
  const last = (await $.store.get('update')) as Checked | undefined
  if (last !== undefined && now - last.at < DAY) return
  const own = versionIn(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) ?? ''
  const answer = await $.http.fetch(LATEST)
  if (!answer.ok) return
  const latest = versionIn(answer.text) ?? ''
  const isNews = isNewer(latest, own) && last?.told !== latest
  await $.store.set('update', { at: now, told: isNews ? latest : last?.told } satisfies Checked)
  if (isNews) $.ui.toast(say(latest, own), { timeoutMs: 15_000 })
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    start($)
    // A newer version, said a few seconds in, once set-up has found the person's language.
    if (e.isInteractive && options.updateCheck !== false) {
      void setUp($)
        .then(() => $.clock.sleep(5000))
        .then(() => checkForUpdate($, WORDS[lang].update))
        .catch(() => undefined)
    }
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    start($)
    void keepWarm($)
    // Only the band's list is awaited; finding the picture runs on behind it.
    await sync($, box.text).catch(() => undefined)
    return box
  })

  // At Enter: an edited paste's original is left out and Claude is pointed at the edit.
  on('prompt.submit', async ($, e, next) => {
    toDrop = []
    const ns = numbersIn(e.text)
    const edited = (await shotsOf($, ns, await sessionOf($))).filter(s => s.isEdited && s.file !== '')
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
    const drawn = (await shotsOf($, ns, await sessionOf($))).filter(s => s.thumb !== '')
    if (drawn.length === 0) return next(e)
    const { Box, Text, Image } = $.ui.resolve(e)
    const columns = e.viewport?.columns ?? 80
    const sizes = fit(drawn, columns - 4, ROWS)
    const pictures = await picturesOf($, drawn)
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
    const all = await shotsOf($, ns, await sessionOf($))
    const { Box, Text, Button, Image } = $.ui.resolve(e)
    // Folded away by the person (newer Claude Code), nothing of the band is on screen:
    // its names stand in, and no picture is read for it.
    const isFolded = 'isCollapsed' in e.props && e.props.isCollapsed === true
    // A number whose copy is still being found shows as #N alone until it lands.
    const drawn = isFolded ? [] : all.filter(s => s.thumb !== '')
    const sizes = fit(drawn, e.props.bodyColumns, bandRows(e.viewport?.rows))
    const pictures = await picturesOf($, drawn)

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
                {shot !== undefined && shot.file !== '' && <Button key={`edit-${n}`} label={WORDS[lang].edit} plain {...hotkey} onPress={() => conversationNow($).then(at => enqueue($, n, at, shot.file)).catch(() => undefined)} />}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
