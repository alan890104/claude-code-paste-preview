import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shot } from '../types'

// paste-preview: a pasted image is only "[Image #1]" in the prompt box, which says
// nothing about which picture it is. So, as in a chat app, a paste opens an editor at
// once (pen, ellipse, box, arrow, text, crop, rotate); Done (Enter) puts the edited
// picture in the paste's place, Cancel (Esc) keeps the paste, and every image in the box
// shows as a thumbnail above the prompt. The editor is a floating panel
// (editor/panel.swift) that sits over a full-screen terminal without switching Spaces;
// where Swift is missing, a Chrome app window (editor/server.mjs).
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
const THUMB_PX = '480'
const EDITS_ROOT = '/private/tmp/paste-preview'
const KEEP_DAYS = '+7'

type Lang = 'zh' | 'en'
type Paths = { edits: string; tmp: string; session: string; terminal: string; panel: string | undefined; lang: Lang }

// The words follow the Mac's first language: Chinese for zh-*, English otherwise.
const WORDS = {
  zh: { edit: '編輯', edited: '已編輯', noEditor: '編輯器沒有打開', noTools: '編輯器沒有打開：找不到 Swift 或 node' },
  en: { edit: 'Edit', edited: 'edited', noEditor: 'The editor did not open', noTools: 'The editor did not open: neither Swift nor node was found' },
}
let lang: Lang = 'en'

// Module variables start over on a hot reload; everything a drawing reads is in $.state.
let paths: Promise<Paths> | undefined
let edits: string | undefined
let images: string | undefined
let queue: Promise<void> = Promise.resolve()
let isTicking = false
const capturing = new Set<number>()
const thumbs = new Map<string, string>()

// The images a text holds, in order.
const numbersIn = (text: string) => [...new Set([...text.matchAll(PLACEHOLDER)].map(m => Number(m[1])))]


const isSame = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i])

const run = async ($: EngineInterface, argv: string[]) => (await $.process.run(argv)).stdout.trim()

// The panel is compiled once (a few seconds) and again only when its source changes.
const buildPanel = async ($: EngineInterface) => {
  const source = `${$.plugin.root}/editor/panel.swift`
  const binary = `${EDITS_ROOT}/bin/panel`
  const built = await $.fs.stat(binary).catch(() => undefined)
  if (built !== undefined && built.mtimeMs >= (await $.fs.stat(source)).mtimeMs) return binary
  await $.process.run(['mkdir', '-p', `${EDITS_ROOT}/bin`])
  const made = await $.process.run(['xcrun', 'swiftc', '-O', source, '-o', binary], { timeoutMs: 120_000 }).catch(() => undefined)
  return made?.exitCode === 0 ? binary : undefined
}

const setUp = ($: EngineInterface) => {
  paths ??= (async () => {
    const session = await $.session.id()
    const uid = await run($, ['id', '-u'])
    const at = `${EDITS_ROOT}/${session.slice(0, 8)}`
    await $.process.run(['mkdir', '-p', at])
    // Old sessions' edits are no use to anyone after a week.
    void $.process.run(['find', EDITS_ROOT, '-mindepth', '1', '-maxdepth', '1', '-type', 'd', '-not', '-name', 'bin', '-mtime', KEEP_DAYS, '-exec', 'rm', '-rf', '{}', '+']).catch(() => undefined)
    const terminal = await run($, ['printenv', 'TERM_PROGRAM']).catch(() => '')
    // Claude Code's own temp folder: CLAUDE_CODE_TMPDIR when set, else /tmp, as it resolves it.
    const base = (await run($, ['printenv', 'CLAUDE_CODE_TMPDIR']).catch(() => '')) || '/tmp'
    const tmp = (await $.fs.stat(`${base}/claude-${uid}`, { resolve: true }).catch(() => undefined))?.realPath ?? `/private/tmp/claude-${uid}`
    const languages = await run($, ['defaults', 'read', '-g', 'AppleLanguages']).catch(() => '')
    lang = /^[\s(]*"?zh/.test(languages) ? 'zh' : 'en'
    edits = at
    return { edits: at, tmp, session, terminal, panel: await buildPanel($), lang }
  })()
  return paths
}

// Claude Code's own copy of paste N; it lands a moment after the placeholder does.
const engineCopy = async ($: EngineInterface, n: number) => {
  const { tmp, session } = await setUp($)
  for (let attempt = 0; attempt < 15; attempt++) {
    images ??= (await run($, ['find', tmp, '-maxdepth', '3', '-type', 'd', '-path', `*/${session}/images`]).catch(() => '')).split('\n')[0] || undefined
    if (images !== undefined) {
      const entry = (await $.fs.list(images).catch(() => [])).find(e => new RegExp(`^${n}\\.[a-z]+$`).test(e.name))
      if (entry !== undefined) return `${images}/${entry.name}`
    }
    await $.clock.sleep(200)
  }
  return undefined
}

// Only where Claude Code kept no copy: the clipboard still holds what was just pasted.
const clipboardCopy = async ($: EngineInterface, n: number) => {
  const file = `${(await setUp($)).edits}/${n}.paste.png`
  const pasted = await $.process.run(['pngpaste', file]).catch(() => undefined)
  return pasted?.exitCode === 0 ? file : undefined
}

// Size and a small PNG for the band: a screenshot can be 10 MB, the band needs 480 px.
const look = async ($: EngineInterface, n: number, file: string) => {
  const info = await $.process.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', file])
  const width = Number(/pixelWidth: (\d+)/.exec(info.stdout)?.[1] ?? 0)
  const height = Number(/pixelHeight: (\d+)/.exec(info.stdout)?.[1] ?? 0)
  const thumb = `${(await setUp($)).edits}/${n}.thumb.png`
  const made = await $.process.run(['sips', '-s', 'format', 'png', '-Z', THUMB_PX, file, '--out', thumb])
  return made.exitCode === 0 && width > 0 && height > 0 ? { width, height, thumb } : undefined
}

const refresh = async ($: EngineInterface, n: number, file: string, isEdited: boolean) => {
  const seen = file === '' ? undefined : await look($, n, file).catch(() => undefined)
  await update($, shots, list => {
    const was = list.find(s => s.n === n)
    const gen = (was?.gen ?? -1) + 1
    const shot: Shot = seen === undefined
      ? { n, file: '', thumb: '', gen, width: 0, height: 0, isEdited, ratio: 0 }
      : { n, file, thumb: seen.thumb, gen, width: seen.width, height: seen.height, isEdited, ratio: isEdited && was !== undefined ? was.ratio : seen.width / seen.height }
    return [...list.filter(s => s.n !== n), shot]
  })
  return seen !== undefined
}

const edit = async ($: EngineInterface, n: number) => {
  const shot = (await read($, shots)).find(s => s.n === n)
  if (shot === undefined || shot.file === '') return
  const { edits: at, terminal, panel } = await setUp($)
  const words = WORDS[lang]
  const out = `${at}/${n}.png`
  const argv = panel !== undefined
    ? [panel, `${$.plugin.root}/editor/editor.html`, shot.file, out, `Image #${n}`, lang]
    : ['node', `${$.plugin.root}/editor/server.mjs`, shot.file, out, `Image #${n}`, terminal, lang]
  let said = ''
  try {
    for await (const piece of $.process.spawn({ argv })) {
      if ('text' in piece && piece.stream === 'stdout') said += piece.text
    }
  } catch {
    $.ui.toast(panel !== undefined ? words.noEditor : words.noTools)
    return
  }
  if (said.includes('SAVED')) await refresh($, n, out, true)
}

// One editor at a time: three pastes in a row open one after another.
const enqueue = ($: EngineInterface, n: number) => {
  queue = queue.then(() => edit($, n)).catch(() => undefined)
}

const capture = async ($: EngineInterface, n: number) => {
  const file = (await engineCopy($, n)) ?? (await clipboardCopy($, n)) ?? ''
  if (await refresh($, n, file, false)) enqueue($, n)
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

const picture = async ($: EngineInterface, shot: Shot) => {
  const at = `${shot.thumb}:${shot.gen}`
  const held = thumbs.get(at)
  if (held !== undefined) return held
  const { base64 } = await $.fs.read(shot.thumb, { as: 'bytes' })
  thumbs.set(at, base64)
  return base64
}

// Every thumbnail the same height, side by side, as tall as the band allows up to 10 rows.
const fit = (list: readonly Shot[], columns: number, maxRows: number) => {
  const widthAt = (s: Shot, rows: number) => Math.max(4, Math.min(48, Math.round((rows * CELL * s.width) / s.height)))
  let rows = Math.max(3, Math.min(10, maxRows - 2))
  while (rows > 3 && list.reduce((sum, s) => sum + widthAt(s, rows) + 2, 0) > columns) rows -= 1
  return list.map(s => {
    const width = widthAt(s, rows)
    return { columns: width, rows: Math.max(1, Math.min(rows, Math.round((width * s.height) / s.width / CELL))) }
  })
}

// Width over height of an image block, from its header: enough to tell one paste from
// another when Claude Code has scaled it down or turned it into a JPEG.
export const ratioOf = (block: { type: string; [field: string]: unknown }) => {
  const source = block.source as { type?: string; data?: string } | undefined
  if (block.type !== 'image' || source?.type !== 'base64' || typeof source.data !== 'string') return undefined
  const bytes = Uint8Array.from(atob(source.data.slice(0, 87_384)), c => c.charCodeAt(0))
  const at = (i: number) => bytes[i] ?? 0
  if (at(0) === 0x89 && at(1) === 0x50) return ((at(16) << 24) | (at(17) << 16) | (at(18) << 8) | at(19)) / ((at(20) << 24) | (at(21) << 16) | (at(22) << 8) | at(23))
  if (at(0) === 0x47 && at(1) === 0x49) return (at(6) | (at(7) << 8)) / (at(8) | (at(9) << 8))
  if (at(0) === 0xff && at(1) === 0xd8) {
    for (let i = 2; i + 8 < bytes.length; ) {
      if (at(i) !== 0xff) return undefined
      const marker = at(i + 1)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return ((at(i + 7) << 8) | at(i + 8)) / ((at(i + 5) << 8) | at(i + 6))
      i += 2 + ((at(i + 2) << 8) | at(i + 3))
    }
  }
  return undefined
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
    void setUp($).catch(() => undefined)
    $.clock.every(500, () => void tick($).catch(() => undefined))
    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
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
    const sizes = fit(drawn, columns - 4, 10)
    const pictures = await Promise.all(drawn.map(s => picture($, s).catch(() => undefined)))
    return (
      <Box flexDirection="column">
        <Box backgroundColor="userMessageBackground" paddingRight={1}>
          <Text><Text color="inactive">❯</Text> <Text color="text">{e.props.text}</Text></Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={2} marginTop={1}>
          {drawn.map((shot, i) => {
            const png = pictures[i]
            const size = sizes[i]
            return (
              <Box key={`sent-${shot.n}`} flexDirection="column">
                {png !== undefined && size !== undefined && (
                  <Image key={`sent-img-${shot.n}`} source={{ png }} columns={size.columns} rows={size.rows} alt={`Image #${shot.n}`} />
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
    const sizes = fit(drawn, e.props.bodyColumns, e.props.maxRows)
    const pictures = await Promise.all(drawn.map(s => picture($, s).catch(() => undefined)))

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {ns.map((n, i) => {
          const shot = all.find(s => s.n === n)
          const at = shot === undefined ? -1 : drawn.indexOf(shot)
          const png = pictures[at]
          const size = sizes[at]
          const hotkey = i < 9 ? { hotkey: String(i + 1) } : {}
          return (
            <Box key={`shot-${n}`} flexDirection="column">
              {png !== undefined && size !== undefined && (
                <Image key={`img-${n}`} source={{ png }} columns={size.columns} rows={size.rows} alt={`#${n}`} />
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
