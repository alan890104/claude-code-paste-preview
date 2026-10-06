# paste-preview

A [Claude Code](https://claude.com/claude-code) mod for the images you paste. In the terminal a pasted image is just `[Image #1]`, and three pastes later you can't tell which is which. With this mod:

- **You see what you pasted.** Every `[Image #N]` in the prompt box shows as a thumbnail above the prompt, and sent prompts show theirs in the transcript, each labelled `Image #N`.
- **You can mark it up before sending.** An editor opens the moment you paste: pen, ellipse, box, arrow, text, crop, rotate, seven colours, undo. Press Enter when done, or Esc to keep the picture as pasted.
- **Claude gets the marked-up version.** At Enter the original paste is left out of the message and Claude is pointed at the edited picture.
- **Full screen works on macOS.** There the editor is a native floating panel that sits over a full-screen terminal the way Spotlight does: no Space switch, and the keys return to the prompt when it closes. It waits ready in the background, so it appears the instant you paste (about 100 MB while it waits; after 20 minutes unused it quits, and comes back as you type). On Linux and Windows it opens as a browser app window.

[繁體中文說明](#繁體中文)

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

The editor and the thumbnail labels follow the system's language (macOS's first preferred language; on Linux `LC_ALL`, else `LC_MESSAGES`, else `LANG`; on Windows the UI culture) in five languages: English, Traditional Chinese (`zh-Hant`, and `zh-TW`, `zh-HK`, `zh-MO`), Simplified Chinese (`zh-Hans`, and any other `zh`: `zh-CN`, `zh-SG`, bare `zh`), Japanese (`ja`) and Korean (`ko`). Any other language gets English.

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

---

## 繁體中文

這是一個 Claude Code 的 mod，處理你貼上的圖片。在終端機裡，貼上的圖只會顯示成 `[Image #1]`，貼了幾張之後就分不出哪張是哪張。裝了這個 mod 之後：

- **看得到貼了什麼**：輸入框裡的每個 `[Image #N]` 都會在輸入框上方顯示縮圖；送出的訊息在對話紀錄裡也會顯示縮圖，標「Image #N」。
- **送出前可以標註**：一貼上就自動跳出編輯器，有畫筆、圈、框、箭頭、文字、裁切、旋轉、七種顏色和復原。改完按 Enter，不想改就按 Esc，保留原圖。
- **Claude 收到的是改過的圖**：按 Enter 送出時，原圖會從訊息裡拿掉，並告訴 Claude 改過的圖在哪裡，讓它去讀。
- **macOS 上全螢幕也能用**：編輯器是原生的浮動面板，像 Spotlight 一樣浮在全螢幕的終端機上，不會切換桌面；關掉後游標直接回到輸入框。面板平常在背景待命，一貼上就立刻出現（待命時約佔 100 MB 記憶體，閒置 20 分鐘會自動關掉，打字時再開回來）。Linux 和 Windows 上，編輯器是瀏覽器的 app 視窗。

### 需求

- macOS、Linux 或 Windows
- Claude Code 2.1.291 以上（mod 還是搶先體驗功能）
- 要看到縮圖，終端機必須支援 kitty 圖片協定，例如 Ghostty、kitty；其他終端機（包括 Windows Terminal）會改顯示「Image #N」文字和「編輯」按鈕。

| | 編輯器 | 剪貼簿（只在找不到 Claude Code 自己存的那份圖時才用到） |
|---|---|---|
| macOS | Xcode Command Line Tools（`xcode-select --install`）。第一次使用時會自動編譯面板，只要幾秒。沒有的話會改用 Google Chrome 的 app 視窗開啟，這時需要 Node.js 和 Chrome。 | 選用：`pngpaste`（`brew install pngpaste`） |
| Linux | Node.js 18 以上（`node` 在 `PATH` 裡）。有裝 Chrome、Chromium、Edge 或 Brave 時用它的 app 視窗開啟，否則用預設瀏覽器（`xdg-open`）。 | `wl-clipboard`（Wayland）或 `xclip`（X11），就是 Claude Code 自己貼圖用的工具 |
| Windows | Node.js 18 以上（`node.exe` 在 `PATH` 裡）。用 Microsoft Edge 的 app 視窗開啟（沒有 Edge 時用 Chrome），否則用預設瀏覽器。 | 不用另外裝：用內建的 PowerShell |

缺了什麼，mod 會跳出提示說缺哪一個；縮圖照樣會顯示。

### 安裝

在終端機的 Claude Code 輸入框輸入：

```
/plugin install paste-preview --marketplace alan890104/claude-code-paste-preview
```

出現「Add marketplace?」時按 `y`，再選範圍（選 user 會在每個 session 載入）。裝好就能用，不用重開。

### 使用

照平常一樣貼圖：Ctrl+V，Windows 上是 Alt+V（Claude Code 自己貼圖的按鍵），編輯器就會自動跳出來。快捷鍵見上方英文的表格（復原在 Linux 和 Windows 上是 Ctrl+Z）。要再改一次，按輸入框上方縮圖下的「編輯」（或按 `ctrl+x tab` 後再按編號）。介面文字跟著系統語言（macOS 的第一偏好語言；Linux 依序看 `LC_ALL`、`LC_MESSAGES`、`LANG`；Windows 的介面語言），支援五種：英文、繁體中文（`zh-Hant`，以及 `zh-TW`、`zh-HK`、`zh-MO`）、簡體中文（`zh-Hans`，以及其他的 `zh`：`zh-CN`、`zh-SG`、單獨的 `zh`）、日文（`ja`）、韓文（`ko`）；其他語言顯示英文。在一般的瀏覽器分頁裡（Linux 或 Windows 上沒有 Chromium 系瀏覽器時），頁面沒辦法自己關掉，按完成或取消後會提示可以關掉分頁。

### 原理

- Claude Code 會把每張貼上的圖存到 `<tmp>/claude-<uid>/<專案>/<session>/images/<N>.png`（`<tmp>` 在 macOS 是 `/tmp`，Linux 是 `$TMPDIR` 或 `/tmp`），Windows 上是 `%TEMP%\claude\<專案>\<session>\images\<N>.png`；三者都可以用 `CLAUDE_CODE_TMPDIR` 改位置。mod 讀的就是這一份，所以縮圖和編輯器裡看到的就是你貼上的那張。這個資料夾是 Claude Code 內部的存放方式，不是公開 API；如果之後改了位置，mod 會改從剪貼簿讀。
- 改過的圖存在 macOS 的 `/private/tmp/paste-preview/<session>/<N>.png`、Linux 的 `/tmp/paste-preview-<uid>/<session>/<N>.png`（只有你自己讀得到的資料夾）、Windows 的 `%TEMP%\paste-preview\<session>\<N>.png`，超過一週的資料夾會自動清掉。
- Linux 和 Windows 上不一定有能做縮圖的工具，所以 mod 從圖檔開頭讀出尺寸，由終端機自己縮放圖片；編輯器存檔時會順便送回一張 480 px 的小圖給縮圖列用。
- mod 不能替換或加入訊息裡的圖片，只能刪掉。所以按 Enter 時，mod 會刪掉原圖，再在訊息旁附一句說明告訴 Claude 改過的檔案在哪裡，讓 Claude 去讀。對話紀錄裡會多一行讀檔的紀錄；輸入框和對話紀錄裡還是顯示 `[Image #N]`。
- mod 會依圖片在訊息裡的順序和長寬比，判斷要刪哪一張。兩者都對不上時就不刪：最差是 Claude 同時收到原圖和改過的圖，不會刪錯張。

### 限制

- Linux 和 Windows 上的編輯器是瀏覽器視窗，不是浮動面板：在全螢幕的終端機上可能會切到別的桌面，關掉視窗（或點一下終端機）後按鍵才會回到終端機。
- 在 WSL 裡 mod 當成 Linux 執行；有裝 Linux 的瀏覽器就用它開編輯器，否則用 `wslview` 或 Windows 的 `explorer.exe`。
- 對話紀錄裡的縮圖只限目前這個 session；重開之後，舊訊息會恢復顯示 `[Image #N]`。
- 在浮動面板裡用輸入法打中文或日文時如果有問題，歡迎開 issue。
