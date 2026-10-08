<div align="center">
  <img src="docs/assets/icon.svg" width="112" height="112" alt="paste-preview icon">
  <h1>paste-preview</h1>
  <p>貼的圖看得到，重點圈給 Claude 看</p>
  <p><a href="README.md">English</a> | <strong>繁體中文</strong> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a></p>
</div>

## 安裝

在終端機裡 Claude Code session 的輸入框輸入：

```
/plugin install paste-preview --marketplace alan890104/claude-code-paste-preview
```

按 `y` 加入 marketplace，再選一個 scope（選 user scope 會在每個 session 載入）。安裝後立刻生效，不用重開。

https://github.com/user-attachments/assets/d68fe9a9-9179-4e3e-868f-2049647287cb

這是一個 [Claude Code](https://claude.com/claude-code) 的 mod，專門處理你貼上的圖片。在終端機裡，貼上的圖只會顯示成 `[Image #1]`，貼個三張之後，就分不出哪張是哪張了。裝了這個 mod 之後：

- **看得到貼了什麼**：輸入框裡的每個 `[Image #N]` 都會在輸入框上方顯示縮圖；送出的訊息在對話紀錄裡也有縮圖，各自標上 `Image #N`。
- **送出前可以標註**：一貼上，編輯器就自動跳出來，有畫筆、圈、框、箭頭、文字、裁切、旋轉、七種顏色和復原。改完按 Enter，不想改就按 Esc，保留貼上的原圖。
- **Claude 收到的是標註過的圖**：按 Enter 送出時，貼上的原圖會從訊息裡拿掉，並告訴 Claude 去讀改過的那張。
- **macOS 上全螢幕也能用**：編輯器是原生的浮動面板，像 Spotlight 一樣浮在全螢幕的終端機上，不會切換 Space，關掉之後按鍵會回到輸入框。面板平常在背景待命，所以一貼上就立刻出現（待命時約佔 100 MB 記憶體；閒置 20 分鐘會自動結束，你一開始打字就會再啟動）。Linux 和 Windows 上，編輯器是瀏覽器的 app 視窗。

## 需求

- macOS、Linux 或 Windows
- Claude Code 2.1.291 以上（mod 目前是搶先體驗功能）
- 要顯示縮圖，終端機需要支援 kitty 圖形協定，例如 [Ghostty](https://ghostty.org) 或 [kitty](https://sw.kovidgoyal.net/kitty/)。其他終端機（包括 Windows Terminal）會顯示 `Image #N`，不顯示圖片，旁邊附有「編輯」按鈕。

| | 編輯器 | 剪貼簿，只在找不到 Claude Code 自己存的那份貼上圖片時才會用到 |
|---|---|---|
| macOS | Xcode Command Line Tools（`xcode-select --install`）。面板會在第一次使用時編譯一次，只要幾秒。沒有的話，編輯器會改用 Google Chrome 的 app 視窗開啟，這時需要 Node.js 和 Chrome。 | 選用：[`pngpaste`](https://github.com/jcsalterego/pngpaste)（`brew install pngpaste`） |
| Linux | Node.js 18 以上（`node` 要在 `PATH` 裡）。有安裝 Chrome、Chromium、Edge 或 Brave 時，用它的 app 視窗開啟編輯器，否則用預設瀏覽器（`xdg-open`）。 | `wl-clipboard`（Wayland）或 `xclip`（X11），也就是 Claude Code 自己貼圖用的工具 |
| Windows | Node.js 18 以上（`node.exe` 要在 `PATH` 裡）。編輯器用 Microsoft Edge 的 app 視窗開啟（沒有 Edge 時用 Chrome），再不然用預設瀏覽器。 | 不用另外裝：內建的 PowerShell 就夠了 |

缺了什麼，mod 會用提示（toast）告訴你缺的是哪個工具，縮圖照樣會顯示。

## 使用

照平常一樣貼圖：Ctrl+V，Windows 和 WSL 下是 Alt+V，這是 Claude Code 自己貼圖用的按鍵（`chat:imagePaste`）。編輯器會自動打開。

| 按鍵 | |
|---|---|
| `P` `O` `B` `A` `T` | 畫筆、圈、框、箭頭、文字 |
| `C` | 裁切：拖曳出範圍，再按 Enter |
| `R` | 旋轉 90° |
| `1`–`7` | 顏色 |
| `⌘Z`（Linux 和 Windows 上是 Ctrl+Z） | 復原 |
| 繪製時按住 Shift | 正圓或正方形 |
| Enter | 完成 |
| Esc | 取消，保留貼上的原圖 |

要再編輯一次，按輸入框上方縮圖下的**編輯**（或按 `ctrl+x tab`，再按它的編號）。

編輯器和縮圖標籤的文字會跟著系統語言（macOS 取第一個偏好語言；Linux 依序看 `LC_ALL`、`LC_MESSAGES`、`LANG`；Windows 取介面語言），支援五種：英文、繁體中文（`zh-Hant`，以及 `zh-TW`、`zh-HK`、`zh-MO`）、簡體中文（`zh-Hans`，以及其他所有 `zh`：`zh-CN`、`zh-SG`、單獨的 `zh`）、日文（`ja`）和韓文（`ko`）。其他語言一律顯示英文。這份 README 也有同樣五種語言的版本，連結在頁面最上方。

在一般的瀏覽器分頁裡（Linux 或 Windows 上沒有安裝 Chromium 系瀏覽器時的預設瀏覽器），頁面無法自己關閉：按下「完成」或「取消」之後，頁面會提示可以關掉這個分頁。

## 運作原理

- Claude Code 會把每次貼上的圖存到 `<tmp>/claude-<uid>/<project>/<session>/images/<N>.png`（`<tmp>` 在 macOS 是 `/tmp`，在 Linux 是 `$TMPDIR` 或 `/tmp`），Windows 上是 `%TEMP%\claude\<project>\<session>\images\<N>.png`；三個系統都可以用 `CLAUDE_CODE_TMPDIR` 改位置。mod 讀的就是這一份，所以縮圖和編輯器顯示的，正是你貼上的那張。這個資料夾是 Claude Code 內部的存放方式，不是 API；如果之後位置改了，mod 會改讀剪貼簿。
- 改過的圖會存到 macOS 的 `/private/tmp/paste-preview/<session>/<N>.png`、Linux 的 `/tmp/paste-preview-<uid>/<session>/<N>.png`（只有你自己讀得到的資料夾），以及 Windows 的 `%TEMP%\paste-preview\<session>\<N>.png`。超過一週的資料夾會自動清掉。
- Linux 和 Windows 上，不是每個系統都內建能做縮圖的工具，所以縮圖列直接從圖檔開頭讀出圖片尺寸，再由終端機自己縮放圖片；編輯完成時，編輯器會順便送回一份 480 px 的副本，給縮圖列使用。
- 外掛無法修改或新增訊息裡的圖片，只能拿掉。所以按 Enter 時，mod 會拿掉原圖的 image block（`session.append`），並在輸入框的內容旁附上一則給 Claude 的說明（`prompt.submit` context），指明改過的檔案，讓 Claude 去讀。你會在對話紀錄裡看到這次讀檔。輸入框和對話紀錄裡仍然顯示 `[Image #N]`。
- 為了找出該拿掉哪一個 block，mod 會比對圖片在訊息裡的位置和長寬比。兩者都對不上時，就什麼也不拿掉：這時 Claude 會同時收到原圖和修改後的圖，而不會拿錯張。

## 限制

- 在 Linux 和 Windows 上，編輯器是瀏覽器視窗，不是浮動面板：開在全螢幕的終端機上方時，可能會切換到別的桌面，而且要等視窗關閉（或你點一下終端機）之後，按鍵才會回到終端機。
- 在 WSL 下，mod 的行為和 Linux 相同；有安裝 Linux 的瀏覽器時，編輯器用它開啟，否則透過 `wslview` 或 Windows 的 `explorer.exe`。
- 對話紀錄裡的縮圖只涵蓋目前這個 session。重新啟動之後，較早的訊息會像以前一樣只顯示 `[Image #N]`。
- 在 tmux 或 GNU screen 裡看不到縮圖：Claude Code 在這兩者裡不畫圖片，所以輸入框上方和對話紀錄裡只會顯示 `Image #N` 和「編輯」按鈕，跟其他終端機一樣。編輯器照常運作。要看縮圖，請不經過 tmux，直接在 Ghostty 或 kitty 裡執行 Claude Code。
- 編輯器的文字工具使用系統輸入法。如果在浮動面板裡輸入中文或日文時出現問題，請開一個 issue。

## 開發

```sh
git clone https://github.com/alan890104/claude-code-paste-preview
cd claude-code-paste-preview
claude --plugin-dir .            # run Claude Code with the mod loaded from this folder
claude plugin validate .         # what the engine will load and refuse
claude plugin test .             # hooks/*.test.tsx: the band, the send, and a paste on each system
node test/e2e.mjs [--clipboard]  # the mod's own commands for real on this machine (Node 22.6+)
node test/live.mjs               # Linux, Windows: a live session pasted into, offline
```

`test/e2e.mjs` 會把一張圖放進剪貼簿，再用 mod 自己執行的指令讀回來；接著像 mod 一樣啟動編輯器的伺服器，用無頭瀏覽器在頁面上作畫，並檢查編輯後的圖有存到 mod 讀取的位置。它需要 `playwright-core`（用 `PLAYWRIGHT_DIR` 指向一個 `node_modules` 裡有它的資料夾）和 Chrome。`test/live.mjs` 會在偽終端機（`@lydell/node-pty`，在同一個資料夾裡）中啟動載入 mod 的 Claude Code 本體，用 Claude Code 自己的按鍵貼圖，在 mod 打開的編輯器裡作畫，按 Enter，再讀對話紀錄；它用的 API key 是隨便編的，API 位址是一個沒在監聽的本機 port，所以不會送出任何東西。CI（`.github/workflows/test.yml`）會在 macOS、Linux 和 Windows 上連同外掛測試一起執行它們（live session 只在 Linux 和 Windows 上執行）。

載入過這個資料夾一次之後，引擎的型別宣告會寫到 `.claude-plugin/types/`；之後用 `tsc -p .` 就能對 mod 做型別檢查。

| 路徑 | |
|---|---|
| `hooks/register.tsx` | mod 本體：找出貼上的圖、縮圖、編輯器的佇列、按 Enter 時的處理 |
| `hooks/platform.ts` | macOS、Linux 和 Windows 之間的差異：資料夾、剪貼簿指令、啟動編輯器的指令 |
| `editor/editor.html` | 編輯器（canvas） |
| `editor/panel.swift` | 承載編輯器的浮動面板 |
| `editor/server.mjs` | 瀏覽器視窗裡的編輯器：用於 Linux 和 Windows，以及沒有 Swift 的 Mac |

## 授權

[MIT](LICENSE)
