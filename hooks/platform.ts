// What differs between macOS, Linux and Windows, as plain data and pure functions: kept
// apart from the hooks so a test reads it without an engine, and so the end-to-end
// checks (test/e2e.mjs, under Node) run the very commands the mod runs. Each table
// follows what Claude Code itself does on that system, read from its own builds: where
// it keeps a paste, how it reads the clipboard, which key pastes (Ctrl+V, Alt+V on
// Windows; the mod only ever sees the "[Image #N]" that lands).

export type Os = 'mac' | 'linux' | 'windows'

// The variables the mod reads; each is passed in, since only the hooks can ask for them.
export type Env = {
  CLAUDE_CODE_TMPDIR?: string
  TMPDIR?: string
  TMP?: string
  TEMP?: string
  SystemRoot?: string
  WAYLAND_DISPLAY?: string
}

// One command, by its argument vector (no shell, as $.process.run runs it), and the
// variables set over the session's own for it.
export type Step = { argv: string[]; env?: Record<string, string> }

// A Windows path starts with a drive or a share; so does the folder the mod runs from.
const isWindowsPath = (path: string) => /^[A-Za-z]:[\\/]|^\\\\/.test(path)

// Windows says so in OS, set for every process there; macOS and Linux by uname. Only
// where neither answers does the plugin's own folder tell, by its drive letter.
export const osOf = (pluginRoot: string, osVariable: string | undefined, uname: string): Os =>
  osVariable === 'Windows_NT' ? 'windows' : /^Darwin/.test(uname.trim()) ? 'mac' : uname.trim() === '' && isWindowsPath(pluginRoot) ? 'windows' : 'linux'

export const separator = (os: Os) => (os === 'windows' ? '\\' : '/')

export const join = (os: Os, first: string, ...rest: string[]) => {
  if (rest.length === 0) return first
  // A folder that already ends in a separator (a drive's root, C:\) takes no other.
  return (/[\\/]$/.test(first) ? first : first + separator(os)) + rest.join(separator(os))
}

// The system's temp folder as Node and Bun's os.tmpdir() read it.
const posixTemp = (env: Env) => (env.TMPDIR || env.TMP || env.TEMP || '/tmp').replace(/(.)\/+$/, '$1')
const windowsTemp = (env: Env) => (env.TEMP || env.TMP || `${env.SystemRoot || 'C:\\Windows'}\\temp`).replace(/([^:])\\+$/, '$1')

// Where Claude Code keeps a session's pastes: <root>/<project>/<session>/images/<N>.png,
// the root being CLAUDE_CODE_TMPDIR or the temp folder as each build resolves it: /tmp
// on macOS (not the per-user $TMPDIR), os.tmpdir() on Linux and Windows; then
// claude-<uid>, or plain "claude" on Windows, which has no uid. An internal layout, not
// an API: where it is not found the clipboard is read instead.
export const engineRoot = (os: Os, env: Env, uid: string) =>
  os === 'windows'
    ? join(os, env.CLAUDE_CODE_TMPDIR || windowsTemp(env), 'claude')
    : join(os, env.CLAUDE_CODE_TMPDIR || (os === 'mac' ? '/tmp' : posixTemp(env)), `claude-${uid}`)

// Where the mod writes edited pictures. On Linux a folder of the user's own, made 0700,
// since /tmp is shared and an edit is often a screenshot; Windows' temp folder is
// already the user's.
export const editsRoot = (os: Os, env: Env, uid: string) =>
  os === 'mac' ? '/private/tmp/paste-preview' : os === 'windows' ? join(os, windowsTemp(env), 'paste-preview') : join(os, posixTemp(env), `paste-preview-${uid}`)

// What Claude Code runs for an image on the clipboard, to a file: pngpaste on macOS (the
// mod's own choice there); on Linux wl-paste for Wayland and xclip for X11, the session's
// own first; on Windows the .NET clipboard through PowerShell, in a single-threaded
// apartment as the clipboard needs. No shell on Windows, so the file's name goes in a
// variable, never into the script's text.
export const CLIPBOARD_PS =
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing; ' +
  '$image = [System.Windows.Forms.Clipboard]::GetImage(); if ($null -eq $image) { exit 1 }; ' +
  '$image.Save($env:PASTE_PREVIEW_OUT, [System.Drawing.Imaging.ImageFormat]::Png)'

export const clipboardSteps = (os: Os, out: string, env: Env): Step[] => {
  if (os === 'mac') return [{ argv: ['pngpaste', out] }]
  if (os === 'windows') return [{ argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Sta', '-Command', CLIPBOARD_PS], env: { PASTE_PREVIEW_OUT: out } }]
  // sh only to point the tool's output at the file; a missing tool is its exit 127.
  const wayland: Step = { argv: ['sh', '-c', 'exec wl-paste --no-newline --type image/png > "$1"', 'sh', out] }
  const x11: Step = { argv: ['sh', '-c', 'exec xclip -selection clipboard -t image/png -o > "$1"', 'sh', out] }
  return env.WAYLAND_DISPLAY ? [wayland, x11] : [x11, wayland]
}

// A step whose tool is not there: it could not start, or sh could not find it.
export const isMissing = (exitCode: number | undefined) => exitCode === undefined || exitCode === 127

// The words follow the system's language: the first of AppleLanguages on macOS, the
// locale for messages on Linux (LC_ALL, else LC_MESSAGES, else LANG), the UI culture on
// Windows. Chinese is Traditional where the tag says Hant or a region that writes it
// (Taiwan, Hong Kong, Macau), Simplified for any other zh (Hans, CN, SG, bare zh);
// Japanese and Korean by their own tags; everything else is English.
export type Lang = 'en' | 'zh-Hant' | 'zh-Hans' | 'ja' | 'ko'
export const LANGUAGE_PS = '(Get-UICulture).Name'
export type Locale = { LC_ALL?: string; LC_MESSAGES?: string; LANG?: string }
export const localeOf = (env: Locale) => env.LC_ALL || env.LC_MESSAGES || env.LANG || ''
export const langOfTag = (tag: string): Lang => {
  // zh_TW.UTF-8, ja_JP@euro, zh-Hant-TW, ko-KR: the encoding and modifier set aside.
  const parts = tag.trim().replace(/[.@].*$/, '').toLowerCase().split(/[-_]/)
  if (parts[0] === 'ja' || parts[0] === 'ko') return parts[0]
  if (parts[0] !== 'zh') return 'en'
  if (parts.includes('hant')) return 'zh-Hant'
  if (parts.includes('hans')) return 'zh-Hans'
  return parts.some(part => part === 'tw' || part === 'hk' || part === 'mo') ? 'zh-Hant' : 'zh-Hans'
}
// macOS answers a list, `(\n    "zh-Hant-TW",\n    en\n)`: its first entry is the language.
export const langOf = (os: Os, said: string): Lang => langOfTag(os === 'mac' ? (/^[\s(]*"?([^",\s)]+)/.exec(said)?.[1] ?? '') : said)

// Folders of old sessions' edits, a week on. find on macOS and Linux; on Windows
// PowerShell, the folder again in a variable.
export const SWEEP_PS =
  "Get-ChildItem -LiteralPath $env:PASTE_PREVIEW_ROOT -Directory | Where-Object { $_.Name -ne 'bin' -and $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -Recurse -Force"
export const sweepStep = (os: Os, root: string): Step =>
  os === 'windows'
    ? { argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', SWEEP_PS], env: { PASTE_PREVIEW_ROOT: root } }
    : { argv: ['find', root, '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-not', '-name', 'bin', '-mtime', '+7', '-exec', 'rm', '-rf', '{}', '+'] }

// The editor: the floating panel where Swift built it (macOS), else the page in a
// browser window that editor/server.mjs serves and opens, under Node. Node is node.exe
// on Windows, named in full so no lookup of extensions is needed to start it.
export type EditorArgs = { root: string; panel: string | undefined; file: string; out: string; label: string; terminal: string; lang: string }
export const editorArgv = (os: Os, a: EditorArgs) =>
  a.panel !== undefined && os === 'mac'
    ? [a.panel, join(os, a.root, 'editor', 'editor.html'), a.file, a.out, a.label, a.lang]
    : [os === 'windows' ? 'node.exe' : 'node', join(os, a.root, 'editor', 'server.mjs'), a.file, a.out, a.label, a.terminal, a.lang]

// Beside an edit, the small copy the browser editor draws for the band: <N>.thumb.png.
export const thumbOf = (out: string) => out.replace(/\.png$/i, '') + '.thumb.png'

// A picture's size from its first bytes: PNG, GIF, JPEG and WebP, the kinds Claude Code
// keeps a paste as.
export const sizeOf = (bytes: Uint8Array): { width: number; height: number; isPng: boolean } | undefined => {
  const at = (i: number) => bytes[i] ?? 0
  const size = (width: number, height: number, isPng = false) => (width > 0 && height > 0 ? { width, height, isPng } : undefined)
  if (at(0) === 0x89 && at(1) === 0x50) return size(((at(16) << 24) | (at(17) << 16) | (at(18) << 8) | at(19)) >>> 0, ((at(20) << 24) | (at(21) << 16) | (at(22) << 8) | at(23)) >>> 0, true)
  if (at(0) === 0x47 && at(1) === 0x49) return size(at(6) | (at(7) << 8), at(8) | (at(9) << 8))
  if (at(0) === 0xff && at(1) === 0xd8) {
    for (let i = 2; i + 8 < bytes.length; ) {
      if (at(i) !== 0xff) return undefined
      const marker = at(i + 1)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return size((at(i + 7) << 8) | at(i + 8), (at(i + 5) << 8) | at(i + 6))
      i += 2 + ((at(i + 2) << 8) | at(i + 3))
    }
    return undefined
  }
  // RIFF....WEBP, then a lossy (VP8 ), lossless (VP8L) or extended (VP8X) header.
  if (at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45) {
    const kind = String.fromCharCode(at(12), at(13), at(14), at(15))
    if (kind === 'VP8 ') return size((at(26) | (at(27) << 8)) & 0x3fff, (at(28) | (at(29) << 8)) & 0x3fff)
    if (kind === 'VP8L') return size(1 + (at(21) | ((at(22) & 0x3f) << 8)), 1 + ((at(22) >> 6) | (at(23) << 2) | ((at(24) & 0x0f) << 10)))
    if (kind === 'VP8X') return size(1 + (at(24) | (at(25) << 8) | (at(26) << 16)), 1 + (at(27) | (at(28) << 8) | (at(29) << 16)))
  }
  return undefined
}

// The first bytes of a file too large for $.fs.read (4 MiB), as base64 text, since a
// command's output reaches the mod as text.
export const HEAD_PS =
  '$f = [IO.File]::OpenRead($env:PASTE_PREVIEW_FILE); $b = New-Object byte[] 65536; $n = $f.Read($b, 0, 65536); $f.Close(); [Convert]::ToBase64String($b, 0, $n)'
export const headStep = (os: Os, file: string): Step =>
  os === 'windows'
    ? { argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', HEAD_PS], env: { PASTE_PREVIEW_FILE: file } }
    : { argv: ['sh', '-c', 'head -c 65536 "$1" | base64', 'sh', file] }

export const fromBase64 = (text: string) => Uint8Array.from(atob(text.replace(/\s+/g, '')), c => c.charCodeAt(0))
