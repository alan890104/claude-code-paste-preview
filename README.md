<div align="center">
  <img src="docs/assets/icon.svg" width="112" height="112" alt="paste-preview icon">
  <h1>paste-preview</h1>
  <p>See what you paste. Circle what matters.</p>
  <p><strong>English</strong> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a></p>
</div>

https://github.com/user-attachments/assets/7098c51e-ce1e-43ad-9fe3-5189ef1fdb88

A [Claude Code](https://claude.com/claude-code) mod for the images you paste. In the terminal a pasted image is just `[Image #1]`, and three pastes later you can't tell which is which. With this mod:

- **You see what you pasted.** Every `[Image #N]` in the prompt box shows as a thumbnail above the prompt, and sent prompts show theirs in the transcript, each labelled `Image #N`.
- **You can mark it up before sending.** An editor opens the moment you paste: pen, ellipse, box, arrow, text, crop, rotate, seven colours, undo. Press Enter when done, or Esc to keep the picture as pasted.
- **Claude gets the marked-up version.** At Enter the original paste is left out of the message and Claude is pointed at the edited picture.
- **Full screen works on macOS.** There the editor is a native floating panel that sits over a full-screen terminal the way Spotlight does: no Space switch, and the keys return to the prompt when it closes. It waits ready in the background, so it appears the instant you paste (about 100 MB while it waits; after 20 minutes unused it quits, and comes back as you type). On Linux and Windows it opens as a browser app window.

## Requirements

- macOS, Linux or Windows
- Claude Code 2.1.291 or newer (mods are an early-access feature)
- For thumbnails, a terminal with the kitty graphics protocol, such as [Ghostty](https://ghostty.org) or [kitty](https://sw.kovidgoyal.net/kitty/). Other terminals (Windows Terminal among them) show `Image #N` in place of the picture, with its Edit button.

| | The editor | The clipboard, only when Claude Code's own copy of a paste can't be found |
|---|---|---|
| macOS | The Xcode Command Line Tools (`xcode-select --install`). The panel is compiled once, on first use, in a few seconds. Without them the editor opens as a Google Chrome app window instead, which needs Node.js and Chrome. | Optional: [`pngpaste`](https://github.com/jcsalterego/pngpaste) (`brew install pngpaste`) |
| Linux | Node.js 18 or newer (`node` on `PATH`). The editor opens as an app window of Chrome, Chromium, Edge or Brave when one is installed, else in the default browser (`xdg-open`). | `wl-clipboard` (Wayland) or `xclip` (X11), the tools Claude Code itself pastes images with |
| Windows | Node.js 18 or newer (`node.exe` on `PATH`). The editor opens as a Microsoft Edge app window (Chrome where Edge is missing), else in the default browser. | Nothing: PowerShell, built in |

Where something is missing the mod says so in a toast: which tool, and the thumbnail still shows.

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install paste-preview --marketplace alan890104/claude-code-paste-preview
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). It runs at once, with no restart.

## Use

Paste an image as usual: Ctrl+V, or Alt+V on Windows and under WSL, the keys Claude Code itself binds to pasting an image (`chat:imagePaste`). The editor opens on its own.

| Key | |
|---|---|
| `P` `O` `B` `A` `T` | pen, ellipse, box, arrow, text |
| `C` | crop: drag a frame, then Enter |
| `R` | rotate 90° |
| `1`–`7` | colour |
| `⌘Z` (Ctrl+Z on Linux and Windows) | undo |
| Shift while drawing | a circle or square |
| Enter | done |
| Esc | cancel and keep the picture as pasted |

To edit a picture again, press **Edit** under its thumbnail above the prompt (or `ctrl+x tab`, then its number).

The editor and the thumbnail labels follow the system's language (macOS's first preferred language; on Linux `LC_ALL`, else `LC_MESSAGES`, else `LANG`; on Windows the UI culture) in five languages: English, Traditional Chinese (`zh-Hant`, and `zh-TW`, `zh-HK`, `zh-MO`), Simplified Chinese (`zh-Hans`, and any other `zh`: `zh-CN`, `zh-SG`, bare `zh`), Japanese (`ja`) and Korean (`ko`). Any other language gets English. This README is available in the same five languages, linked at the top.

In a plain browser tab (the default browser on Linux or Windows, where no Chromium browser is installed), the page can't close itself: after Done or Cancel it says the tab can be closed.

## How it works

- Claude Code writes each paste to `<tmp>/claude-<uid>/<project>/<session>/images/<N>.png` (`<tmp>` is `/tmp` on macOS and `$TMPDIR` or `/tmp` on Linux), or `%TEMP%\claude\<project>\<session>\images\<N>.png` on Windows; `CLAUDE_CODE_TMPDIR` moves it on all three. The mod reads that copy, so the thumbnail and the editor show exactly what was pasted. That folder is Claude Code's internal layout, not an API; if it moves, the mod falls back to reading the clipboard.
- Edited pictures are written to `/private/tmp/paste-preview/<session>/<N>.png` on macOS, `/tmp/paste-preview-<uid>/<session>/<N>.png` on Linux (a folder only you can read) and `%TEMP%\paste-preview\<session>\<N>.png` on Windows. Folders older than a week are removed.
- On Linux and Windows no tool for making thumbnails comes with every system, so the band reads the picture's size from its header and the terminal scales the picture itself; an edit comes back from the editor with a 480 px copy for the band.
- A plugin cannot change or add an image in a message, only drop one. So at Enter the mod drops the original paste's image block (`session.append`) and adds a note for Claude beside the prompt (`prompt.submit` context) naming the edited file, which Claude then reads. You'll see that read in the transcript. The prompt box and the transcript keep showing `[Image #N]`.
- To find the right block, the mod checks the image's place in the message and its aspect ratio. If neither matches, it drops nothing: Claude then gets both the original and the edit, never the wrong one.

## Limits

- On Linux and Windows the editor is a browser window, not a panel: over a full-screen terminal it may switch to another desktop, and the keys go back to the terminal only when the window closes (or when you click it).
- Under WSL the mod runs as on Linux; the editor opens in a Linux browser when one is installed, else through `wslview` or Windows' `explorer.exe`.
- Thumbnails in the transcript cover the current session. After a restart, older messages show `[Image #N]` as before.
- The editor's text tool uses the system input method. If typing Chinese or Japanese into the floating panel misbehaves, please open an issue.

## Development

```sh
git clone https://github.com/alan890104/claude-code-paste-preview
cd claude-code-paste-preview
claude --plugin-dir .            # run Claude Code with the mod loaded from this folder
claude plugin validate .         # what the engine will load and refuse
claude plugin test .             # hooks/*.test.tsx: the band, the send, and a paste on each system
node test/e2e.mjs [--clipboard]  # the mod's own commands for real on this machine (Node 22.6+)
node test/live.mjs               # Linux, Windows: a live session pasted into, offline
```

`test/e2e.mjs` puts a picture on the clipboard and reads it back with the commands the mod runs, starts the editor server as the mod does, draws on the page with a headless browser and checks the edited picture lands where the mod reads it. It needs `playwright-core` (`PLAYWRIGHT_DIR` names a folder whose `node_modules` holds it) and Chrome. `test/live.mjs` starts Claude Code itself with the mod in a pseudo-terminal (`@lydell/node-pty`, in the same folder), pastes with Claude Code's own key, draws in the editor the mod opens, presses Enter and reads the transcript; its key is made up and the API's address is a closed local port, so nothing is sent. CI (`.github/workflows/test.yml`) runs them with the plugin tests on macOS, Linux and Windows (the live session on Linux and Windows).

Loading the folder once writes the engine's type declarations to `.claude-plugin/types/`; after that, `tsc -p .` type-checks the mod.

| Path | |
|---|---|
| `hooks/register.tsx` | the mod: finding pastes, thumbnails, the editor queue, what happens at Enter |
| `hooks/platform.ts` | what differs on macOS, Linux and Windows: folders, clipboard commands, the editor's command |
| `editor/editor.html` | the editor (canvas) |
| `editor/panel.swift` | the floating panel that hosts the editor |
| `editor/server.mjs` | the editor in a browser window: on Linux and Windows, and on a Mac without Swift |

## License

[MIT](LICENSE)
