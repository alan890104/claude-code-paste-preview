# paste-preview

A [Claude Code](https://claude.com/claude-code) mod for the images you paste. In the terminal a pasted image is just `[Image #1]`, and three pastes later you can't tell which is which. With this mod:

- **You see what you pasted.** Every `[Image #N]` in the prompt box shows as a thumbnail above the prompt, and sent prompts show theirs in the transcript, each labelled `Image #N`.
- **You can mark it up before sending.** An editor opens the moment you paste: pen, ellipse, box, arrow, text, crop, rotate, seven colours, undo. Press Enter when done, or Esc to keep the picture as pasted.
- **Claude gets the marked-up version.** At Enter the original paste is left out of the message and Claude is pointed at the edited picture.
- **Full screen works.** The editor is a native floating panel that sits over a full-screen terminal the way Spotlight does: no Space switch, and the keys return to the prompt when it closes.

[繁體中文說明](#繁體中文)

## Requirements

- macOS
- Claude Code 2.1.291 or newer (mods are an early-access feature)
- For thumbnails, a terminal with the kitty graphics protocol, such as [Ghostty](https://ghostty.org) or [kitty](https://sw.kovidgoyal.net/kitty/). Other terminals show `Image #N` in place of the picture.
- For the editor, the Xcode Command Line Tools (`xcode-select --install`). The panel is compiled once, on first use, in a few seconds. Without them the editor opens as a Google Chrome app window instead, which needs Node.js and Chrome.
- Optional: [`pngpaste`](https://github.com/jcsalterego/pngpaste) (`brew install pngpaste`), used only when Claude Code's own copy of a paste can't be found

## Install

At the prompt of a Claude Code session in a terminal:

```
/plugin install paste-preview --marketplace alan890104/claude-code-paste-preview
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). It runs at once, with no restart.

## Use

Paste an image as usual (Ctrl+V). The editor opens on its own.

| Key | |
|---|---|
| `P` `O` `B` `A` `T` | pen, ellipse, box, arrow, text |
| `C` | crop: drag a frame, then Enter |
| `R` | rotate 90° |
| `1`–`7` | colour |
| `⌘Z` | undo |
| Shift while drawing | a circle or square |
| Enter | done |
| Esc | cancel and keep the picture as pasted |

To edit a picture again, press **Edit** under its thumbnail above the prompt (or `ctrl+x tab`, then its number).

The editor and the thumbnail labels follow the Mac's language: Traditional Chinese for a `zh` system, English otherwise.

## How it works

- Claude Code writes each paste to `<tmp>/claude-<uid>/<project>/<session>/images/<N>.png`. The mod reads that copy, so the thumbnail and the editor show exactly what was pasted. That folder is Claude Code's internal layout, not an API; if it moves, the mod falls back to reading the clipboard.
- Edited pictures are written to `/private/tmp/paste-preview/<session>/<N>.png`. Folders older than a week are removed.
- A plugin cannot change or add an image in a message, only drop one. So at Enter the mod drops the original paste's image block (`session.append`) and adds a note for Claude beside the prompt (`prompt.submit` context) naming the edited file, which Claude then reads. You'll see that read in the transcript. The prompt box and the transcript keep showing `[Image #N]`.
- To find the right block, the mod checks the image's place in the message and its aspect ratio. If neither matches, it drops nothing: Claude then gets both the original and the edit, never the wrong one.

## Limits

- macOS only.
- Thumbnails in the transcript cover the current session. After a restart, older messages show `[Image #N]` as before.
- The editor's text tool uses the system input method. If typing Chinese or Japanese into the floating panel misbehaves, please open an issue.

## Development

```sh
git clone https://github.com/alan890104/claude-code-paste-preview
cd claude-code-paste-preview
claude --plugin-dir .            # run Claude Code with the mod loaded from this folder
claude plugin validate .         # what the engine will load and refuse
claude plugin test .             # hooks/*.test.tsx
```

Loading the folder once writes the engine's type declarations to `.claude-plugin/types/`; after that, `tsc -p .` type-checks the mod.

| Path | |
|---|---|
| `hooks/register.tsx` | the mod: finding pastes, thumbnails, the editor queue, what happens at Enter |
| `editor/editor.html` | the editor (canvas) |
| `editor/panel.swift` | the floating panel that hosts the editor |
| `editor/server.mjs` | the fallback: the editor in a Chrome app window |

## License

[MIT](LICENSE)

---

## 繁體中文

這是一個 Claude Code 的 mod，處理你貼上的圖片。在終端機裡，貼上的圖只會顯示成 `[Image #1]`，貼了幾張之後就分不出哪張是哪張。裝了這個 mod 之後：

- **看得到貼了什麼**：輸入框裡的每個 `[Image #N]` 都會在輸入框上方顯示縮圖；送出的訊息在對話紀錄裡也會顯示縮圖，標「Image #N」。
- **送出前可以標註**：一貼上就自動跳出編輯器，有畫筆、圈、框、箭頭、文字、裁切、旋轉、七種顏色和復原。改完按 Enter，不想改就按 Esc，保留原圖。
- **Claude 收到的是改過的圖**：按 Enter 送出時，原圖會從訊息裡拿掉，並告訴 Claude 改過的圖在哪裡，讓它去讀。
- **全螢幕也能用**：編輯器是原生的浮動面板，像 Spotlight 一樣浮在全螢幕的終端機上，不會切換桌面；關掉後游標直接回到輸入框。

### 需求

- macOS
- Claude Code 2.1.291 以上（mod 還是搶先體驗功能）
- 要看到縮圖，終端機必須支援 kitty 圖片協定，例如 Ghostty、kitty；其他終端機會改顯示「Image #N」文字。
- 編輯器需要 Xcode Command Line Tools（`xcode-select --install`）。第一次使用時會自動編譯面板，只要幾秒。沒有的話會改用 Google Chrome 的 app 視窗開啟，這時需要 Node.js 和 Chrome。
- 選用：`pngpaste`（`brew install pngpaste`），只在找不到 Claude Code 自己存的那份圖時才用到。

### 安裝

在終端機的 Claude Code 輸入框輸入：

```
/plugin install paste-preview --marketplace alan890104/claude-code-paste-preview
```

出現「Add marketplace?」時按 `y`，再選範圍（選 user 會在每個 session 載入）。裝好就能用，不用重開。

### 使用

照平常一樣貼圖（Ctrl+V），編輯器就會自動跳出來。快捷鍵見上方英文的表格。要再改一次，按輸入框上方縮圖下的「編輯」（或按 `ctrl+x tab` 後再按編號）。介面文字跟著 macOS 的系統語言：中文系統顯示中文，其他語言顯示英文。

### 原理

- Claude Code 會把每張貼上的圖存到 `<tmp>/claude-<uid>/<專案>/<session>/images/<N>.png`，mod 讀的就是這一份，所以縮圖和編輯器裡看到的就是你貼上的那張。這個資料夾是 Claude Code 內部的存放方式，不是公開 API；如果之後改了位置，mod 會改從剪貼簿讀。
- 改過的圖存在 `/private/tmp/paste-preview/<session>/<N>.png`，超過一週的資料夾會自動清掉。
- mod 不能替換或加入訊息裡的圖片，只能刪掉。所以按 Enter 時，mod 會刪掉原圖，再在訊息旁附一句說明告訴 Claude 改過的檔案在哪裡，讓 Claude 去讀。對話紀錄裡會多一行讀檔的紀錄；輸入框和對話紀錄裡還是顯示 `[Image #N]`。
- mod 會依圖片在訊息裡的順序和長寬比，判斷要刪哪一張。兩者都對不上時就不刪：最差是 Claude 同時收到原圖和改過的圖，不會刪錯張。

### 限制

- 只支援 macOS。
- 對話紀錄裡的縮圖只限目前這個 session；重開之後，舊訊息會恢復顯示 `[Image #N]`。
- 在浮動面板裡用輸入法打中文或日文時如果有問題，歡迎開 issue。
