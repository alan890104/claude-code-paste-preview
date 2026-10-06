<div align="center">
  <img src="docs/assets/icon.svg" width="112" height="112" alt="paste-preview icon">
  <h1>paste-preview</h1>
  <p>贴的图看得到，重点圈给 Claude 看</p>
  <p><a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <strong>简体中文</strong> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a></p>
</div>

https://github.com/user-attachments/assets/d68fe9a9-9179-4e3e-868f-2049647287cb

这是一个 [Claude Code](https://claude.com/claude-code) 的 mod，专门处理你粘贴的图片。在终端里，粘贴的图片只会显示成 `[Image #1]`，粘贴三张之后，就分不清哪张是哪张了。装上这个 mod 之后：

- **看得到粘贴了什么**：输入框里的每个 `[Image #N]` 都会在输入框上方显示缩略图；发送出去的消息在对话记录里也有缩略图，各自标着 `Image #N`。
- **发送前可以标注**：一粘贴，编辑器就自动弹出来，有画笔、圈、框、箭头、文字、裁剪、旋转、七种颜色和撤销。改完按 Enter，不想改就按 Esc，保留粘贴时的原图。
- **Claude 收到的是标注后的图**：按 Enter 发送时，粘贴的原图会从消息里去掉，并告诉 Claude 去读改过的那张。
- **macOS 上全屏也能用**：编辑器是原生的浮动面板，像 Spotlight 一样浮在全屏的终端上，不会切换 Space，关掉之后按键会回到输入框。面板平时在后台待命，所以一粘贴就立刻出现（待命时约占 100 MB 内存；闲置 20 分钟会自动退出，你一开始打字它就会重新待命）。Linux 和 Windows 上，编辑器是浏览器的应用窗口。

## 环境要求

- macOS、Linux 或 Windows
- Claude Code 2.1.291 或更高版本（mod 目前是抢先体验功能）
- 要显示缩略图，终端需要支持 kitty 图形协议，例如 [Ghostty](https://ghostty.org) 或 [kitty](https://sw.kovidgoyal.net/kitty/)。其他终端（包括 Windows Terminal）会显示 `Image #N`，不显示图片，旁边附有“编辑”按钮。

| | 编辑器 | 剪贴板，只在找不到 Claude Code 自己保存的那份粘贴图片时才会用到 |
|---|---|---|
| macOS | Xcode Command Line Tools（`xcode-select --install`）。面板会在第一次使用时编译一次，只要几秒钟。没有的话，编辑器会改用 Google Chrome 的应用窗口打开，这时需要 Node.js 和 Chrome。 | 可选：[`pngpaste`](https://github.com/jcsalterego/pngpaste)（`brew install pngpaste`） |
| Linux | Node.js 18 或更高版本（`node` 要在 `PATH` 里）。装有 Chrome、Chromium、Edge 或 Brave 时，用它的应用窗口打开编辑器，否则用默认浏览器（`xdg-open`）。 | `wl-clipboard`（Wayland）或 `xclip`（X11），也就是 Claude Code 自己粘贴图片用的工具 |
| Windows | Node.js 18 或更高版本（`node.exe` 要在 `PATH` 里）。编辑器用 Microsoft Edge 的应用窗口打开（没有 Edge 时用 Chrome），再不然用默认浏览器。 | 不用另外装：系统自带的 PowerShell 就够了 |

缺了什么，mod 会弹出提示（toast），告诉你缺的是哪个工具，缩略图照样会显示。

## 安装

在终端里 Claude Code 会话的输入框中输入：

```
/plugin install paste-preview --marketplace alan890104/claude-code-paste-preview
```

按 `y` 添加 marketplace，再选一个 scope（选 user scope 会在每个会话里加载）。安装后立即生效，无需重启。

## 使用

照常粘贴图片即可：Ctrl+V，Windows 和 WSL 下是 Alt+V，这是 Claude Code 自己粘贴图片用的快捷键（`chat:imagePaste`）。编辑器会自动打开。

| 按键 | |
|---|---|
| `P` `O` `B` `A` `T` | 画笔、圈、框、箭头、文字 |
| `C` | 裁剪：拖出选区，再按 Enter |
| `R` | 旋转 90° |
| `1`–`7` | 颜色 |
| `⌘Z`（Linux 和 Windows 上是 Ctrl+Z） | 撤销 |
| 绘制时按住 Shift | 正圆或正方形 |
| Enter | 完成 |
| Esc | 取消，保留粘贴时的原图 |

要再编辑一次，点击输入框上方缩略图下的**编辑**（或按 `ctrl+x tab`，再按它的编号）。

编辑器和缩略图标签的文字会跟随系统语言（macOS 取第一个首选语言；Linux 依次看 `LC_ALL`、`LC_MESSAGES`、`LANG`；Windows 取界面语言），支持五种：英文、繁体中文（`zh-Hant`，以及 `zh-TW`、`zh-HK`、`zh-MO`）、简体中文（`zh-Hans`，以及其他所有 `zh`：`zh-CN`、`zh-SG`、单独的 `zh`）、日文（`ja`）和韩文（`ko`）。其他语言一律显示英文。这份 README 也有同样五种语言的版本，链接在页面最上方。

在普通的浏览器标签页里（Linux 或 Windows 上没有安装 Chromium 系浏览器时的默认浏览器），页面无法自己关闭：点击“完成”或“取消”之后，页面会提示可以关掉这个标签页。

## 工作原理

- Claude Code 会把每次粘贴的图片保存到 `<tmp>/claude-<uid>/<project>/<session>/images/<N>.png`（`<tmp>` 在 macOS 上是 `/tmp`，在 Linux 上是 `$TMPDIR` 或 `/tmp`），Windows 上是 `%TEMP%\claude\<project>\<session>\images\<N>.png`；三个系统都可以用 `CLAUDE_CODE_TMPDIR` 改位置。mod 读的就是这一份，所以缩略图和编辑器里显示的，正是你粘贴的那张。这个文件夹是 Claude Code 内部的存放方式，不是 API；如果以后位置变了，mod 会改为读取剪贴板。
- 改过的图会保存到 macOS 的 `/private/tmp/paste-preview/<session>/<N>.png`、Linux 的 `/tmp/paste-preview-<uid>/<session>/<N>.png`（只有你自己能读取的文件夹），以及 Windows 的 `%TEMP%\paste-preview\<session>\<N>.png`。超过一周的文件夹会被自动清理。
- Linux 和 Windows 上，并不是每个系统都自带能生成缩略图的工具，所以缩略图栏直接从图片文件开头读出图片尺寸，再由终端自己缩放图片；编辑完成时，编辑器会顺带送回一份 480 px 的副本，供缩略图栏使用。
- 插件无法修改或新增消息里的图片，只能去掉。所以按 Enter 时，mod 会去掉原图的 image block（`session.append`），并在输入框内容旁附上一条给 Claude 的说明（`prompt.submit` context），指明改过的文件，让 Claude 去读。你会在对话记录里看到这次读文件。输入框和对话记录里仍然显示 `[Image #N]`。
- 为了找出该去掉哪一个 block，mod 会比对图片在消息里的位置和长宽比。两者都对不上时，就什么也不去掉：这时 Claude 会同时收到原图和修改后的图，而不会拿错张。

## 限制

- 在 Linux 和 Windows 上，编辑器是浏览器窗口，不是浮动面板：开在全屏的终端上方时，可能会切换到别的桌面，而且要等窗口关闭（或你点一下终端）之后，按键才会回到终端。
- 在 WSL 下，mod 的行为和 Linux 相同；装有 Linux 浏览器时，编辑器用它打开，否则通过 `wslview` 或 Windows 的 `explorer.exe`。
- 对话记录里的缩略图只覆盖当前会话。重启之后，较早的消息会像以前一样只显示 `[Image #N]`。
- 编辑器的文字工具使用系统输入法。如果在浮动面板里输入中文或日文时出现问题，请提交一个 issue。

## 开发

```sh
git clone https://github.com/alan890104/claude-code-paste-preview
cd claude-code-paste-preview
claude --plugin-dir .            # run Claude Code with the mod loaded from this folder
claude plugin validate .         # what the engine will load and refuse
claude plugin test .             # hooks/*.test.tsx: the band, the send, and a paste on each system
node test/e2e.mjs [--clipboard]  # the mod's own commands for real on this machine (Node 22.6+)
node test/live.mjs               # Linux, Windows: a live session pasted into, offline
```

`test/e2e.mjs` 会把一张图片放进剪贴板，再用 mod 自己执行的命令读回来；接着像 mod 一样启动编辑器的服务器，用无头浏览器在页面上作画，并检查编辑后的图片有保存到 mod 读取的位置。它需要 `playwright-core`（用 `PLAYWRIGHT_DIR` 指向一个 `node_modules` 里有它的文件夹）和 Chrome。`test/live.mjs` 会在伪终端（`@lydell/node-pty`，在同一个文件夹里）中启动加载了 mod 的 Claude Code 本体，用 Claude Code 自己的快捷键粘贴图片，在 mod 打开的编辑器里作画，按 Enter，再读取对话记录；它用的 API key 是随便编的，API 地址是一个没有监听的本地端口，所以不会发送任何东西。CI（`.github/workflows/test.yml`）会在 macOS、Linux 和 Windows 上连同插件测试一起运行它们（live 会话只在 Linux 和 Windows 上运行）。

加载过这个文件夹一次之后，引擎的类型声明会写入 `.claude-plugin/types/`；之后用 `tsc -p .` 就能对 mod 做类型检查。

| 路径 | |
|---|---|
| `hooks/register.tsx` | mod 本体：找出粘贴的图片、缩略图、编辑器的队列、按 Enter 时的处理 |
| `hooks/platform.ts` | macOS、Linux 和 Windows 之间的差异：文件夹、剪贴板命令、启动编辑器的命令 |
| `editor/editor.html` | 编辑器（canvas） |
| `editor/panel.swift` | 承载编辑器的浮动面板 |
| `editor/server.mjs` | 浏览器窗口里的编辑器：用于 Linux 和 Windows，以及没有 Swift 的 Mac |

## 许可证

[MIT](LICENSE)
