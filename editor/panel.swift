// The editor as a panel that floats over whatever is in front, a full-screen terminal
// included: a window of another app would switch Spaces and slide the terminal away. A
// non-activating panel that joins every Space, as Spotlight does, so nothing moves and
// the terminal stays the active app; when the panel closes, the keys are the terminal's
// again.
//
//   panel <editor.html> <picture> <out.png> <label> [lang]
//
// Prints SAVED or CANCELLED and exits.

import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 4 else { exit(2) }
let page = URL(fileURLWithPath: args[1])
let picture = URL(fileURLWithPath: args[2])
let out = URL(fileURLWithPath: args[3])
let label = args.count > 4 ? args[4] : ""
let lang = args.count > 5 ? args[5] : "en"

final class Panel: NSPanel {
  override var canBecomeKey: Bool { true }
}

func mime(_ url: URL) -> String {
  switch url.pathExtension.lowercased() {
  case "jpg", "jpeg": return "image/jpeg"
  case "gif": return "image/gif"
  case "webp": return "image/webp"
  default: return "image/png"
  }
}

// The page and the picture come from one origin of their own, so the canvas the page
// draws the picture on is not tainted and can be read back as a PNG.
final class Files: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let isImage = url.path == "/image"
    let file = isImage ? picture : page
    guard let data = try? Data(contentsOf: file) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    task.didReceive(URLResponse(url: url, mimeType: isImage ? mime(file) : "text/html", expectedContentLength: data.count, textEncodingName: isImage ? nil : "utf-8"))
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler {
  var panel: Panel!
  var isSaid = false
  let files = Files()

  func say(_ word: String) {
    if isSaid { return }
    isSaid = true
    print(word)
    fflush(stdout)
    NSApp.terminate(nil)
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let screen = NSScreen.main ?? NSScreen.screens[0]
    let room = screen.visibleFrame
    let frame = NSRect(x: room.midX - 480, y: room.midY - 320, width: 960, height: 640)
    panel = Panel(contentRect: frame, styleMask: [.titled, .closable, .resizable, .fullSizeContentView, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.title = label
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.backgroundColor = NSColor(red: 0.055, green: 0.055, blue: 0.063, alpha: 1)
    panel.appearance = NSAppearance(named: .darkAqua)
    panel.delegate = self

    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(files, forURLScheme: "editor")
    config.userContentController.add(self, name: "editor")
    let web = WKWebView(frame: panel.contentView!.bounds, configuration: config)
    web.autoresizingMask = [.width, .height]
    web.setValue(false, forKey: "drawsBackground")
    panel.contentView = web
    let n = label.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    web.load(URLRequest(url: URL(string: "editor://local/?n=\(n)&lang=\(lang)")!))

    // Shown once the page knows the picture's size, so the panel does not jump; at the
    // latest after a moment.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.show() }
  }

  func show() {
    if panel.isVisible { return }
    panel.makeKeyAndOrderFront(nil)
    panel.makeFirstResponder(panel.contentView)
  }

  // The panel takes the picture's shape: at most most of the screen, never larger than
  // the picture at its own size (a screenshot stays as sharp as it was taken).
  func fit(_ width: Double, _ height: Double) {
    let screen = NSScreen.main ?? NSScreen.screens[0]
    let room = screen.visibleFrame
    let dots = Double(screen.backingScaleFactor)
    let bar = 70.0, top = 40.0, sides = 48.0
    let w = width / dots, h = height / dots
    let s = min((room.width * 0.86 - sides) / w, (room.height * 0.86 - bar - top) / h, 1)
    let pw = max(760, w * s + sides), ph = max(480, h * s + bar + top)
    let frame = panel.frameRect(forContentRect: NSRect(x: 0, y: 0, width: pw, height: ph))
    panel.setFrame(NSRect(x: room.midX - frame.width / 2, y: room.midY - frame.height / 2, width: frame.width, height: frame.height), display: true)
    show()
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
    switch kind {
    case "size":
      fit(body["width"] as? Double ?? 960, body["height"] as? Double ?? 640)
    case "save":
      guard let text = body["png"] as? String, let data = Data(base64Encoded: text) else { return say("CANCELLED") }
      // Written beside and renamed, so nothing reads a half-written picture.
      let part = out.appendingPathExtension("part")
      do {
        try data.write(to: part)
        if rename(part.path, out.path) != 0 { return say("CANCELLED") }
        say("SAVED")
      } catch {
        say("CANCELLED")
      }
    default:
      say("CANCELLED")
    }
  }

  func windowWillClose(_ notification: Notification) { say("CANCELLED") }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = App()
app.delegate = delegate
// A window left open and forgotten keeps the original picture.
DispatchQueue.main.asyncAfter(deadline: .now() + 30 * 60) { delegate.say("CANCELLED") }
app.run()
