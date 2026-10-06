<div align="center">
  <img src="docs/assets/icon.svg" width="112" height="112" alt="paste-preview icon">
  <h1>paste-preview</h1>
  <p>붙여넣은 이미지가 보이고, 중요한 곳엔 동그라미를 쳐서 Claude에게</p>
  <p><a href="README.md">English</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a> | <strong>한국어</strong></p>
</div>

https://github.com/user-attachments/assets/7098c51e-ce1e-43ad-9fe3-5189ef1fdb88

[Claude Code](https://claude.com/claude-code)용 mod로, 붙여넣은 이미지를 다룹니다. 터미널에서는 붙여넣은 이미지가 `[Image #1]`로만 표시되어서, 세 번쯤 붙여넣고 나면 어느 것이 어느 것인지 알 수 없게 됩니다. 이 mod를 설치하면 다음과 같이 됩니다.

- **붙여넣은 이미지가 보입니다.** 입력창의 `[Image #N]`마다 입력창 위에 썸네일이 표시되고, 전송한 프롬프트도 대화 기록에 썸네일이 표시되며, 각각 `Image #N` 라벨이 붙습니다.
- **전송하기 전에 이미지에 표시할 수 있습니다.** 붙여넣는 즉시 편집기가 열립니다. 펜, 타원, 사각형, 화살표, 텍스트, 자르기, 회전, 7가지 색, 실행 취소를 쓸 수 있습니다. 끝나면 Enter를 누르고, 붙여넣은 그대로 두려면 Esc를 누릅니다.
- **Claude는 표시를 추가한 이미지를 받습니다.** Enter를 누르면 처음 붙여넣은 원본은 메시지에서 빠지고, Claude에게는 편집한 이미지의 위치가 전달됩니다.
- **macOS에서는 전체 화면에서도 됩니다.** 편집기는 네이티브 플로팅 패널로, Spotlight처럼 전체 화면 터미널 위에 뜹니다. Space가 전환되지 않고, 패널을 닫으면 키 입력이 프롬프트로 돌아옵니다. 패널은 백그라운드에서 대기하고 있어서 붙여넣는 즉시 나타납니다(대기 중에는 약 100 MB를 사용하고, 20분 동안 쓰지 않으면 종료되며, 입력을 시작하면 다시 실행됩니다). Linux와 Windows에서는 브라우저 앱 창으로 열립니다.

## 요구 사항

- macOS, Linux 또는 Windows
- Claude Code 2.1.291 이상(mod는 얼리 액세스 기능입니다)
- 썸네일을 보려면 [Ghostty](https://ghostty.org)나 [kitty](https://sw.kovidgoyal.net/kitty/)처럼 kitty 그래픽 프로토콜을 지원하는 터미널이 필요합니다. 그 밖의 터미널(Windows Terminal 포함)에서는 이미지 대신 `Image #N`과 "편집" 버튼이 표시됩니다.

| | 편집기 | 클립보드(Claude Code가 보관한 붙여넣기 사본을 찾을 수 없을 때만) |
|---|---|---|
| macOS | Xcode Command Line Tools(`xcode-select --install`). 패널은 처음 사용할 때 한 번 컴파일되며, 몇 초 걸립니다. 설치되어 있지 않으면 편집기가 Google Chrome 앱 창으로 열리는데, 이 경우 Node.js와 Chrome이 필요합니다. | 선택 사항: [`pngpaste`](https://github.com/jcsalterego/pngpaste)(`brew install pngpaste`) |
| Linux | Node.js 18 이상(`node`가 `PATH`에 있어야 합니다). Chrome, Chromium, Edge, Brave 중 하나가 설치되어 있으면 그 앱 창으로 편집기가 열리고, 없으면 기본 브라우저(`xdg-open`)로 열립니다. | `wl-clipboard`(Wayland) 또는 `xclip`(X11). Claude Code가 이미지를 붙여넣을 때 쓰는 도구입니다 |
| Windows | Node.js 18 이상(`node.exe`가 `PATH`에 있어야 합니다). 편집기는 Microsoft Edge 앱 창으로 열리고(Edge가 없으면 Chrome), 그것도 없으면 기본 브라우저로 열립니다. | 필요 없음: 기본 제공되는 PowerShell을 사용합니다 |

빠진 것이 있으면 mod가 토스트 알림으로 어떤 도구가 없는지 알려 주며, 썸네일은 그대로 표시됩니다.

## 설치

터미널에서 실행 중인 Claude Code 세션의 프롬프트에 입력합니다.

```
/plugin install paste-preview --marketplace alan890104/claude-code-paste-preview
```

마켓플레이스를 추가하려면 `y`로 답하고, scope를 선택합니다(user scope를 선택하면 모든 세션에서 로드됩니다). 바로 실행되며, 재시작은 필요 없습니다.

## 사용법

평소처럼 이미지를 붙여넣습니다. Ctrl+V를 누르며, Windows와 WSL에서는 Alt+V입니다. Claude Code가 이미지 붙여넣기에 직접 할당한 키(`chat:imagePaste`)입니다. 편집기는 자동으로 열립니다.

| 키 | |
|---|---|
| `P` `O` `B` `A` `T` | 펜, 타원, 사각형, 화살표, 텍스트 |
| `C` | 자르기: 영역을 드래그한 다음 Enter |
| `R` | 90° 회전 |
| `1`–`7` | 색 |
| `⌘Z`(Linux와 Windows에서는 Ctrl+Z) | 실행 취소 |
| 그리는 동안 Shift | 원 또는 정사각형 |
| Enter | 완료 |
| Esc | 취소하고 붙여넣은 그대로 유지 |

이미지를 다시 편집하려면 입력창 위 썸네일 아래의 **편집**을 누릅니다(또는 `ctrl+x tab`을 누른 뒤 해당 번호를 누릅니다).

편집기와 썸네일 라벨은 시스템 언어를 따릅니다(macOS는 첫 번째 기본 설정 언어, Linux는 `LC_ALL`, 없으면 `LC_MESSAGES`, 그것도 없으면 `LANG`, Windows는 UI 언어). 지원하는 언어는 영어, 번체 중국어(`zh-Hant`, 그리고 `zh-TW`, `zh-HK`, `zh-MO`), 간체 중국어(`zh-Hans`, 그리고 그 밖의 모든 `zh`: `zh-CN`, `zh-SG`, `zh` 단독), 일본어(`ja`), 한국어(`ko`)의 다섯 가지입니다. 그 밖의 언어는 영어로 표시됩니다. 이 README도 같은 다섯 가지 언어로 제공되며, 링크는 페이지 맨 위에 있습니다.

일반 브라우저 탭에서는(Linux나 Windows에서 Chromium 계열 브라우저가 설치되어 있지 않을 때의 기본 브라우저) 페이지가 스스로 닫히지 않습니다. "완료" 또는 "취소"를 누르면 "이 탭은 닫아도 됩니다"라고 표시됩니다.

## 동작 방식

- Claude Code는 붙여넣을 때마다 이미지를 `<tmp>/claude-<uid>/<project>/<session>/images/<N>.png`에 저장합니다(`<tmp>`는 macOS에서는 `/tmp`, Linux에서는 `$TMPDIR` 또는 `/tmp`). Windows에서는 `%TEMP%\claude\<project>\<session>\images\<N>.png`이며, 세 운영체제 모두 `CLAUDE_CODE_TMPDIR`로 위치를 바꿀 수 있습니다. mod는 이 사본을 읽기 때문에, 썸네일과 편집기에는 붙여넣은 이미지가 그대로 표시됩니다. 이 폴더는 Claude Code 내부의 구조일 뿐 API가 아닙니다. 위치가 바뀌면 mod는 클립보드를 읽는 방식으로 대체합니다.
- 편집한 이미지는 macOS에서는 `/private/tmp/paste-preview/<session>/<N>.png`에, Linux에서는 `/tmp/paste-preview-<uid>/<session>/<N>.png`(본인만 읽을 수 있는 폴더)에, Windows에서는 `%TEMP%\paste-preview\<session>\<N>.png`에 저장됩니다. 일주일이 지난 폴더는 삭제됩니다.
- Linux와 Windows에는 모든 시스템에 기본으로 들어 있는 썸네일 생성 도구가 없습니다. 그래서 썸네일 띠는 이미지 헤더에서 크기를 읽고, 이미지 축소는 터미널이 직접 처리합니다. 편집한 이미지는 편집기에서 띠에 쓸 480 px 사본과 함께 돌아옵니다.
- 플러그인은 메시지 안의 이미지를 바꾸거나 추가할 수 없고, 제거만 할 수 있습니다. 그래서 Enter를 누르는 시점에 mod는 원본 붙여넣기의 image block을 제거하고(`session.append`), 입력 내용 옆에 편집된 파일을 알려 주는 Claude용 메모(`prompt.submit` context)를 덧붙입니다. Claude는 그 파일을 읽습니다. 이 읽기는 대화 기록에서 볼 수 있습니다. 입력창과 대화 기록에는 계속 `[Image #N]`이 표시됩니다.
- 올바른 block을 찾기 위해 mod는 메시지 안에서 이미지의 위치와 가로세로 비율을 확인합니다. 둘 다 맞지 않으면 아무것도 제거하지 않습니다. 그러면 Claude는 원본과 편집본을 모두 받게 되고, 엉뚱한 이미지가 제거되는 일은 없습니다.

## 제한 사항

- Linux와 Windows에서 편집기는 패널이 아니라 브라우저 창입니다. 전체 화면 터미널 위에서는 다른 데스크톱으로 전환될 수 있고, 키 입력은 창이 닫혀야(또는 터미널을 클릭해야) 터미널로 돌아옵니다.
- WSL에서 mod는 Linux와 똑같이 동작합니다. 편집기는 Linux 브라우저가 설치되어 있으면 그것으로 열고, 없으면 `wslview` 또는 Windows의 `explorer.exe`를 통해 엽니다.
- 대화 기록의 썸네일은 현재 세션에만 적용됩니다. 재시작하면 이전 메시지는 예전처럼 `[Image #N]`으로 표시됩니다.
- 편집기의 텍스트 도구는 시스템 입력기를 사용합니다. 플로팅 패널에 중국어나 일본어를 입력할 때 문제가 있으면 issue를 열어 주시기 바랍니다.

## 개발

```sh
git clone https://github.com/alan890104/claude-code-paste-preview
cd claude-code-paste-preview
claude --plugin-dir .            # run Claude Code with the mod loaded from this folder
claude plugin validate .         # what the engine will load and refuse
claude plugin test .             # hooks/*.test.tsx: the band, the send, and a paste on each system
node test/e2e.mjs [--clipboard]  # the mod's own commands for real on this machine (Node 22.6+)
node test/live.mjs               # Linux, Windows: a live session pasted into, offline
```

`test/e2e.mjs`는 클립보드에 이미지를 넣고 mod가 실행하는 명령으로 다시 읽어 옵니다. 그다음 mod와 같은 방식으로 편집기 서버를 시작하고, 헤드리스 브라우저로 페이지에 그림을 그린 뒤, 편집된 이미지가 mod가 읽는 위치에 저장되는지 확인합니다. `playwright-core`(`PLAYWRIGHT_DIR`에는 그 `node_modules`가 들어 있는 폴더를 지정합니다)와 Chrome이 필요합니다. `test/live.mjs`는 mod를 로드한 Claude Code 자체를 의사 터미널(`@lydell/node-pty`, 같은 폴더에 있음)에서 실행하고, Claude Code의 붙여넣기 키로 붙여넣은 뒤, mod가 연 편집기에서 그림을 그리고, Enter를 눌러 대화 기록을 읽습니다. 사용하는 API 키는 임의로 만든 것이고 API 주소는 닫힌 로컬 포트이므로, 아무것도 전송되지 않습니다. CI(`.github/workflows/test.yml`)는 macOS, Linux, Windows에서 플러그인 테스트와 함께 이들을 실행합니다(라이브 세션은 Linux와 Windows에서).

이 폴더를 한 번 로드하면 엔진의 타입 선언이 `.claude-plugin/types/`에 기록됩니다. 그 후에는 `tsc -p .`로 mod를 타입 검사할 수 있습니다.

| 경로 | |
|---|---|
| `hooks/register.tsx` | mod 본체: 붙여넣기 감지, 썸네일, 편집기 큐, Enter 시 동작 |
| `hooks/platform.ts` | macOS, Linux, Windows에서 달라지는 부분: 폴더, 클립보드 명령, 편집기 실행 명령 |
| `editor/editor.html` | 편집기(canvas) |
| `editor/panel.swift` | 편집기를 담는 플로팅 패널 |
| `editor/server.mjs` | 브라우저 창 안의 편집기: Linux와 Windows, 그리고 Swift가 없는 Mac용 |

## 라이선스

[MIT](LICENSE)
