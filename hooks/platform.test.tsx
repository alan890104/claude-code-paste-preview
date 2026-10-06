import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { clipboardSteps, editorArgv, editsRoot, engineRoot, isMissing, join, LANGUAGE_PS, langOf, localeOf, osOf, sizeOf, sweepStep, thumbOf } from './platform'
import type { Lang, Os } from './platform'

// The paste on each system, end to end inside the engine: "[Image #1]" lands in the box,
// the mod finds Claude Code's copy where that system keeps it, draws it above the prompt,
// opens the editor that system has, and at Enter points Claude at the edit. Beneath the
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
}

const SYSTEMS: Record<Os, System> = {
  mac: {
    os: 'mac',
    env: { TERM_PROGRAM: 'ghostty', TMPDIR: '/var/folders/xy/T/' },
    engineRoot: '/private/tmp/claude-501',
    edits: '/private/tmp/paste-preview/abcdef12',
    editor: (root, file, out) => ['/private/tmp/paste-preview/bin/panel', `${root}/editor/editor.html`, file, out, 'Image #1', 'zh-Hant'],
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
  runEnvs: Record<string, string>[]
  spawns: string[][]
  toasts: string[]
  files: Map<string, { path: string; size: number; bytes?: Uint8Array }>
  dirs: Map<string, { path: string; names: string[] }>
  context: readonly string[]
}

// A path as the files below are keyed: the engine resolves what the mod names against
// the machine the test runs on (C:\x is relative on macOS, /tmp is on a drive on
// Windows), so both sides are read with the drive and the slashes set aside.
const canon = (path: string) => path.replace(/\\/g, '/').replace(/^.*?([A-Za-z]:\/)/, '$1').replace(/^[A-Za-z]:/, '')

// The system beneath the mod: its variables, its commands and its files. `copy` is where
// Claude Code kept the paste (absent: it kept none); `say` what the editor prints.
const world = (on: On, system: System, options: { copy?: boolean; say?: string; tools?: Record<string, Answer>; pasteSize?: number; spawnFails?: boolean; culture?: string } = {}) => {
  const w: World = { runs: [], runEnvs: [], spawns: [], toasts: [], files: new Map(), dirs: new Map(), context: [] }
  const file = (path: string, size: number, bytes?: Uint8Array) => w.files.set(canon(path), { path, size, bytes })
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
  on('session.id', () => ({ value: SESSION }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    w.runEnvs.push({ ...e.init?.env })
    const line = argv.join(' ')
    const told = Object.entries(options.tools ?? {}).find(([command]) => line.includes(command))?.[1]
    if (told !== undefined) {
      // A clipboard tool that worked leaves the picture where it was told to.
      const out = argv.at(-1) ?? ''
      const target = e.init?.env?.PASTE_PREVIEW_OUT ?? out
      if (told.exitCode === 0 && /paste\.png$/.test(target)) file(target, 50_000, pngBytes(800, 600))
      return { value: { exitCode: told.exitCode, stdout: told.stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const stdout = line === 'uname -s' ? (system.os === 'mac' ? 'Darwin' : 'Linux') : line === 'id -u' ? '501' : line.startsWith('defaults read') ? '(\n    "zh-Hant-TW",\n    en\n)' : line.includes(LANGUAGE_PS) ? (options.culture ?? 'zh-TW') : line.startsWith('sips -g') ? 'pixelWidth: 1600\n  pixelHeight: 900' : ''
    if (line.startsWith('sips -s')) file(argv.at(-1) ?? '', 9000, pngBytes(480, 270))
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* ($, e) {
    w.spawns.push([...e.argv])
    if (options.spawnFails) return { deny: 'ENOENT: no such file or directory' }
    const word = options.say ?? 'SAVED'
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
    const bytes = w.files.get(canon(e.path))?.bytes
    return bytes === undefined ? { deny: `ENOENT: ${e.path}` } : { value: { base64: base64(bytes) } }
  })
  on('fs.list', ($, e) => ({ value: (w.dirs.get(canon(e.path))?.names ?? []).map(name => ({ name, kind: name.includes('.') ? ('file' as const) : ('dir' as const), size: 0, mtimeMs: 0, isLink: false })) }))
  on('fs.exists', ($, e) => ({ value: w.dirs.has(canon(e.path)) || w.files.has(canon(e.path)) }))
  on('fs.write', ($, e) => {
    file(e.path, 0)
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
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return { w, pasted, box }
}

// prompt.edit is the engine's alone to raise; the mod also reads the box on a timer,
// which a test can drive: the session starts, then "[Image #1]" is in the box.
const paste = async ($: Engine, box: { text: string }) => {
  await $.session.start({ cwd: '/home/me/project', surface: 'terminal', isInteractive: true })
  box.text = '[Image #1] '
}

// Lets the work the paste started run on: waits on the mocked clock, then the event loop.
const until = async (clock: { advance: (ms: number) => Promise<void> }, isDone: () => boolean) => {
  for (let i = 0; i < 40 && !isDone(); i++) await clock.advance(250)
}

const BAND = {
  plugin: 'paste-preview',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
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
    const root = w.spawns[0]?.[1]?.replace(/[\\/]editor[\\/](editor\.html|server\.mjs)$/, '') ?? ''
    expect(w.spawns[0]).toEqual(system.editor(root, pasted, out))

    // Where the mod made its folder, and how it clears old ones.
    if (os === 'windows') expect(w.files.has(canon(`${system.edits}\\.keep`))).toBe(true)
    else expect(w.runs).toContainEqual(os === 'mac' ? ['mkdir', '-p', system.edits] : ['mkdir', '-p', '-m', '700', system.edits.replace(/\/abcdef12$/, ''), system.edits])
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
  expect(editsRoot('mac', {}, '501')).toBe('/private/tmp/paste-preview')
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

