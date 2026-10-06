<div align="center">
  <img src="docs/assets/icon.svg" width="112" height="112" alt="paste-preview icon">
  <h1>paste-preview</h1>
  <p>貼った画像が見える。大事なところは丸で囲んで Claude へ</p>
  <p><a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <strong>日本語</strong> | <a href="README.ko.md">한국어</a></p>
</div>

## インストール

ターミナルで開いた Claude Code のセッションのプロンプトに、次を入力します。

```
/plugin install paste-preview --marketplace alan890104/claude-code-paste-preview
```

`y` と答えてマーケットプレイスを追加し、スコープを選びます（ユーザースコープなら、すべてのセッションで読み込まれます）。すぐに有効になり、再起動は不要です。

https://github.com/user-attachments/assets/7098c51e-ce1e-43ad-9fe3-5189ef1fdb88

[Claude Code](https://claude.com/claude-code) 用の mod で、貼り付けた画像を扱います。ターミナルでは、貼り付けた画像は `[Image #1]` と表示されるだけで、3 枚貼ると、どれがどれだか分からなくなります。この mod を入れると、次のようになります。

- **貼り付けた画像が見える**：入力欄にある `[Image #N]` が、入力欄の上にサムネイルとして表示されます。送信済みのプロンプトも会話履歴にサムネイルが表示され、それぞれ `Image #N` というラベルが付きます。
- **送る前に書き込める**：貼り付けた瞬間にエディタが開きます。ペン、楕円、四角形、矢印、テキスト、切り取り、回転が使え、色は 7 色から選べて、取り消すこともできます。終わったら Enter を、貼り付けたままの画像を使うなら Esc を押します。
- **Claude には書き込み後の画像が届く**：Enter を押すと、貼り付けた元の画像はメッセージから外され、Claude には編集後の画像の場所が伝わります。
- **macOS ではフルスクリーンでも使える**：エディタはネイティブのフローティングパネルで、Spotlight のようにフルスクリーンのターミナルの上に表示されます。Space は切り替わらず、閉じるとキー入力はプロンプトに戻ります。パネルはバックグラウンドで待機しているので、貼り付けた瞬間に表示されます（待機中は約 100 MB のメモリを使い、20 分間使わないと終了し、入力を始めると再び起動します）。Linux と Windows では、ブラウザのアプリウィンドウとして開きます。

## 必要環境

- macOS、Linux、または Windows
- Claude Code 2.1.291 以降（mod は早期アクセス機能です）
- サムネイルを表示するには、[Ghostty](https://ghostty.org) や [kitty](https://sw.kovidgoyal.net/kitty/) のように kitty graphics protocol に対応したターミナルが必要です。それ以外のターミナル（Windows Terminal を含む）では、画像の代わりに `Image #N` と「編集」ボタンが表示されます。

| | エディタ | クリップボード（Claude Code 自身が保存した貼り付けのコピーが見つからない場合のみ） |
|---|---|---|
| macOS | Xcode Command Line Tools（`xcode-select --install`）。パネルは初回の使用時に一度だけコンパイルされ、数秒で終わります。ない場合、エディタは Google Chrome のアプリウィンドウで開きますが、その場合は Node.js と Chrome が必要です。 | 任意：[`pngpaste`](https://github.com/jcsalterego/pngpaste)（`brew install pngpaste`） |
| Linux | Node.js 18 以降（`node` が `PATH` にあること）。Chrome、Chromium、Edge、Brave のいずれかがインストールされていればそのアプリウィンドウでエディタが開き、なければ既定のブラウザ（`xdg-open`）で開きます。 | `wl-clipboard`（Wayland）または `xclip`（X11）。Claude Code 自身が画像の貼り付けに使うツールです |
| Windows | Node.js 18 以降（`node.exe` が `PATH` にあること）。エディタは Microsoft Edge のアプリウィンドウで開き（Edge がない場合は Chrome）、それもなければ既定のブラウザで開きます。 | 不要：組み込みの PowerShell を使います |

足りないものがあると、mod はトースト通知で、どのツールが足りないかを知らせます。サムネイルは引き続き表示されます。

## 使い方

いつもどおり画像を貼り付けます。Ctrl+V（Windows と WSL では Alt+V）は、Claude Code 自身が画像の貼り付けに割り当てているキー（`chat:imagePaste`）です。エディタは自動で開きます。

| キー | |
|---|---|
| `P` `O` `B` `A` `T` | ペン、楕円、四角形、矢印、テキスト |
| `C` | 切り取り：枠をドラッグして、Enter |
| `R` | 90° 回転 |
| `1`–`7` | 色 |
| `⌘Z`（Linux と Windows では Ctrl+Z） | 取り消す |
| 描画中に Shift | 正円または正方形 |
| Enter | 完了 |
| Esc | キャンセルして、貼り付けたままの画像を残す |

画像をもう一度編集するには、入力欄の上にあるサムネイルの下の**編集**を押します（または `ctrl+x tab` を押してから、その番号を押します）。

エディタとサムネイルのラベルは、システムの言語に合わせて表示されます（macOS では最優先の言語、Linux では `LC_ALL`、なければ `LC_MESSAGES`、それもなければ `LANG`、Windows では UI の言語）。対応するのは、英語、繁体字中国語（`zh-Hant`、および `zh-TW`、`zh-HK`、`zh-MO`）、簡体字中国語（`zh-Hans`、およびそれ以外のすべての `zh`：`zh-CN`、`zh-SG`、`zh` のみの指定）、日本語（`ja`）、韓国語（`ko`）の 5 言語です。それ以外の言語では英語になります。この README も同じ 5 言語で用意されていて、リンクはページの先頭にあります。

通常のブラウザのタブで開く場合（Linux や Windows で Chromium 系のブラウザがインストールされていないときの既定のブラウザ）、ページは自分で閉じることができません。「完了」または「キャンセル」を押すと、「このタブは閉じてかまいません」と表示されます。

## 仕組み

- Claude Code は、貼り付けのたびに画像を `<tmp>/claude-<uid>/<project>/<session>/images/<N>.png` に保存します（`<tmp>` は macOS では `/tmp`、Linux では `$TMPDIR` または `/tmp`）。Windows では `%TEMP%\claude\<project>\<session>\images\<N>.png` です。どの OS でも、`CLAUDE_CODE_TMPDIR` で場所を変えられます。mod はこのコピーを読むので、サムネイルとエディタには、貼り付けたとおりの画像が表示されます。このフォルダは Claude Code の内部的な配置であって、API ではありません。場所が変わった場合、mod はクリップボードを読む方式に切り替わります。
- 編集した画像は、macOS では `/private/tmp/paste-preview/<session>/<N>.png`、Linux では `/tmp/paste-preview-<uid>/<session>/<N>.png`（自分だけが読めるフォルダ）、Windows では `%TEMP%\paste-preview\<session>\<N>.png` に書き込まれます。1 週間より古いフォルダは削除されます。
- Linux と Windows には、どのシステムにも入っているサムネイル作成ツールがありません。そのため、サムネイルの帯は画像のヘッダからサイズを読み取り、画像の縮小はターミナルに任せます。編集した画像は、エディタから帯用の 480 px のコピーと一緒に戻ってきます。
- プラグインはメッセージ内の画像を変更したり追加したりできず、取り除くことしかできません。そのため Enter を押した時点で、mod は元の貼り付け画像の image block を取り除き（`session.append`）、入力欄の隣に、編集後のファイルを示す Claude 向けのメモ（`prompt.submit` の context）を付け加えます。Claude はそのファイルを読みます。この読み込みは会話履歴に表示されます。入力欄と会話履歴には、引き続き `[Image #N]` と表示されます。
- 正しい block を見つけるために、mod はメッセージ内での画像の位置とアスペクト比を調べます。どちらも一致しない場合は、何も取り除きません。その場合、Claude には元の画像と編集後の画像の両方が渡されますが、別の画像を取り除いてしまうことはありません。

## 制限事項

- Linux と Windows のエディタは、パネルではなくブラウザのウィンドウです。フルスクリーンのターミナルの上では別のデスクトップに切り替わることがあり、キー入力がターミナルに戻るのは、ウィンドウを閉じたとき（またはターミナルをクリックしたとき）だけです。
- WSL では、mod は Linux と同じように動作します。エディタは、Linux のブラウザがあればそれで開き、なければ `wslview` か Windows の `explorer.exe` 経由で開きます。
- 会話履歴のサムネイルは、現在のセッション分だけです。再起動すると、以前のメッセージは従来どおり `[Image #N]` と表示されます。
- エディタのテキストツールは、システムの入力方式（IME）を使います。フローティングパネルに中国語や日本語を入力したときに不具合があれば、issue を作成してください。

## 開発

```sh
git clone https://github.com/alan890104/claude-code-paste-preview
cd claude-code-paste-preview
claude --plugin-dir .            # run Claude Code with the mod loaded from this folder
claude plugin validate .         # what the engine will load and refuse
claude plugin test .             # hooks/*.test.tsx: the band, the send, and a paste on each system
node test/e2e.mjs [--clipboard]  # the mod's own commands for real on this machine (Node 22.6+)
node test/live.mjs               # Linux, Windows: a live session pasted into, offline
```

`test/e2e.mjs` は、クリップボードに画像を置き、mod が実行するコマンドで読み戻します。続いて mod と同じようにエディタのサーバーを起動し、ヘッドレスブラウザでページに描画して、編集後の画像が mod の読み取る場所に保存されることを確認します。`playwright-core`（`PLAYWRIGHT_DIR` には、その `node_modules` が入っているフォルダを指定します）と Chrome が必要です。`test/live.mjs` は、mod を読み込んだ Claude Code 自体を疑似端末（`@lydell/node-pty`、同じフォルダ内）で起動し、Claude Code 自身のキーで貼り付け、mod が開いたエディタで描画し、Enter を押して、会話履歴を読み取ります。使う API キーは適当に作ったもので、API のアドレスは閉じたローカルポートなので、何も送信されません。CI（`.github/workflows/test.yml`）は、macOS、Linux、Windows でプラグインのテストと一緒にこれらを実行します（ライブセッションは Linux と Windows）。

このフォルダを一度読み込むと、エンジンの型宣言が `.claude-plugin/types/` に書き出されます。それ以降は、`tsc -p .` で mod を型チェックできます。

| パス | |
|---|---|
| `hooks/register.tsx` | mod 本体：貼り付けの検出、サムネイル、エディタのキュー、Enter 時の処理 |
| `hooks/platform.ts` | macOS、Linux、Windows で異なる部分：フォルダ、クリップボードのコマンド、エディタの起動コマンド |
| `editor/editor.html` | エディタ（canvas） |
| `editor/panel.swift` | エディタを載せるフローティングパネル |
| `editor/server.mjs` | ブラウザのウィンドウ内のエディタ：Linux と Windows、および Swift のない Mac 用 |

## ライセンス

[MIT](LICENSE)
