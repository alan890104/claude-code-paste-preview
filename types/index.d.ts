// One pasted image: the N of its [Image #N] placeholder, the picture it stands for now
// (Claude Code's copy of the paste, or the edited file once 完成 was pressed) and the
// small PNG the band draws.
export type Shot = {
  n: number
  // '' when no copy of the paste could be found: the band names #N alone.
  file: string
  // '' when there is nothing the terminal can draw (a JPEG, off macOS): #N alone again.
  thumb: string
  // Bumped each time the picture changes, so the thumbnail is read again.
  gen: number
  width: number
  height: number
  isEdited: boolean
  // The paste's width over height as pasted, to find its block in the message at Enter.
  ratio: number
  // The thumbnail is the picture itself and past 2 MiB, more than an Image takes as
  // bytes: the band names its file instead and the terminal reads it.
  isLarge: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'paste-preview': { shots: Shot[]; inBox: number[] }
  }
}
