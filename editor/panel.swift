// The editor as a panel that floats over whatever is in front, a full-screen terminal
// included: a window of another app would switch Spaces and slide the terminal away. A
// non-activating panel that joins every Space, as Spotlight does, so nothing moves and
// the terminal stays the active app; when the panel closes, the keys are the terminal's
// again.
//
//   panel <editor.html> <picture> <out.png> <label> [lang]
//   panel serve <editor.html> <requests> [lang]
//
// One picture: prints SAVED or CANCELLED and exits. Served, for a session: the panel and
// its page are made once and kept hidden, so a paste only has to show them. Started
// cold, a process, AppKit, a web view and its page take a third of a second or more,
// and that wait was the stutter between a paste and the editor. Each <id>.json written
// into <requests>, { "picture", "out", "label" }, opens one picture and ends in a line
// "SAVED <id>" or "CANCELLED <id>". It quits after a while unused, or once the process
// that started it is gone.

import AppKit
import ImageIO
import WebKit

let args = CommandLine.arguments
let isServed = args.count > 1 && args[1] == "serve"
guard args.count >= 4 else { exit(2) }
let page = URL(fileURLWithPath: isServed ? args[2] : args[1])
let requests = isServed ? URL(fileURLWithPath: args[3], isDirectory: true) : nil
let lang = isServed ? (args.count > 4 ? args[4] : "en") : (args.count > 5 ? args[5] : "en")

struct Job { let id: String; let picture: URL; let out: URL; let label: String }
var job: Job? = isServed ? nil : Job(id: "", picture: URL(fileURLWithPath: args[2]), out: URL(fileURLWithPath: args[3]), label: args.count > 4 ? args[4] : "")

// Unused this long, the served panel quits; the next paste starts it cold again.
let IDLE: TimeInterval = 20 * 60
// A picture left open and forgotten keeps the original.
let FORGOTTEN: TimeInterval = 30 * 60
// The panel fades in and out rather than popping, as the system's own panels do.
let FADE_IN = 0.14, FADE_OUT = 0.1

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

// A picture's size from its header alone, so the panel takes its shape before the page
// has decoded a pixel.
func pixels(_ url: URL) -> (Double, Double)? {
  guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let w = (info[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
        let h = (info[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue, w > 0, h > 0 else { return nil }
  return (w, h)
}

func quoted(_ s: String) -> String {
  let data = try? JSONSerialization.data(withJSONObject: [s])
  return data.flatMap { String(data: $0, encoding: .utf8) }.map { String($0.dropFirst().dropLast()) } ?? "\"\""
}

// The page and the picture come from one origin of their own, so the canvas the page
// draws the picture on is not tainted and can be read back as a PNG.
final class Files: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let isImage = url.path == "/image"
    guard let file = isImage ? job?.picture : page, let data = try? Data(contentsOf: file) else {
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
  var web: WKWebView!
  let files = Files()
  var isPageReady = !isServed
  var isShown = false
  var lastUsed = Date()
  var forgotten: DispatchWorkItem?
  var watcher: DispatchSourceFileSystemObject?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let screen = NSScreen.main ?? NSScreen.screens[0]
    let room = screen.visibleFrame
    let frame = NSRect(x: room.midX - 480, y: room.midY - 320, width: 960, height: 640)
    panel = Panel(contentRect: frame, styleMask: [.titled, .closable, .resizable, .fullSizeContentView, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.titleVisibility = .hidden
    panel.titlebarAppearsTransparent = true
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    panel.backgroundColor = NSColor(red: 0.055, green: 0.055, blue: 0.063, alpha: 1)
    panel.appearance = NSAppearance(named: .darkAqua)
    panel.animationBehavior = .none
    panel.alphaValue = 0
    panel.delegate = self

    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(files, forURLScheme: "editor")
    config.userContentController.add(self, name: "editor")
    web = WKWebView(frame: panel.contentView!.bounds, configuration: config)
    web.autoresizingMask = [.width, .height]
    web.setValue(false, forKey: "drawsBackground")
    panel.contentView = web

    if isServed {
      web.load(URLRequest(url: URL(string: "editor://local/?warm=1&lang=\(lang)")!))
      watch()
      Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { _ in
        if getppid() == 1 || (job == nil && Date().timeIntervalSince(self.lastUsed) > IDLE) { exit(0) }
      }
    } else {
      panel.title = job!.label
      let n = job!.label.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
      web.load(URLRequest(url: URL(string: "editor://local/?n=\(n)&lang=\(lang)")!))
      // Shown once the page knows the picture's size, so the panel does not jump; at the
      // latest after a moment.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.reveal() }
      later(FORGOTTEN) { self.say("CANCELLED") }
    }
  }

  func later(_ seconds: TimeInterval, _ work: @escaping () -> Void) {
    let item = DispatchWorkItem(block: work)
    forgotten?.cancel()
    forgotten = item
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
  }

  // ——— served: the requests folder ———

  func watch() {
    guard let dir = requests else { return }
    let fd = open(dir.path, O_EVTONLY)
    guard fd >= 0 else { exit(1) }
    let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: .write, queue: .main)
    source.setEventHandler { [weak self] in self?.take() }
    source.setCancelHandler { close(fd) }
    source.resume()
    watcher = source
  }

  // The oldest request, once the page can take it and no picture is open. One the mod
  // gave up on (its panel had gone) is stale by now and only removed.
  func take() {
    guard isPageReady, job == nil, let dir = requests else { return }
    let found = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    for file in found.filter({ $0.pathExtension == "json" }).sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
      let made = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
      let age = Date().timeIntervalSince(made)
      guard let data = try? Data(contentsOf: file),
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: String],
            let picture = body["picture"], let out = body["out"], age < 5 else {
        // Still being written: look again in a moment; never finished, or stale: gone.
        if age >= 5 { try? FileManager.default.removeItem(at: file) } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) { self.take() } }
        continue
      }
      try? FileManager.default.removeItem(at: file)
      begin(Job(id: file.deletingPathExtension().lastPathComponent, picture: URL(fileURLWithPath: picture), out: URL(fileURLWithPath: out), label: body["label"] ?? ""))
      return
    }
  }

  func begin(_ next: Job) {
    job = next
    lastUsed = Date()
    panel.title = next.label
    if let (w, h) = pixels(next.picture) { fit(w, h, andShow: false) }
    // Ordered in, still clear and letting clicks through, so the page draws the picture
    // before anyone sees it; the keys stay the terminal's until it shows.
    panel.alphaValue = 0
    panel.ignoresMouseEvents = true
    panel.orderFrontRegardless()
    web.evaluateJavaScript("openPicture(\(quoted(next.id)), \(quoted(next.label)))")
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { if job?.id == next.id { self.reveal() } }
    later(FORGOTTEN) { if job?.id == next.id { self.say("CANCELLED") } }
  }

  // ——— both ———

  func reveal() {
    if isShown || job == nil { return }
    isShown = true
    panel.ignoresMouseEvents = false
    panel.makeKeyAndOrderFront(nil)
    panel.makeFirstResponder(web)
    NSAnimationContext.runAnimationGroup { context in
      context.duration = FADE_IN
      context.timingFunction = CAMediaTimingFunction(name: .easeOut)
      panel.animator().alphaValue = 1
    }
  }

  func say(_ word: String) {
    guard let done = job else { return }
    job = nil
    forgotten?.cancel()
    if !isServed {
      print(word)
      fflush(stdout)
      NSApp.terminate(nil)
      return
    }
    // Answered at once; the fade is the panel's own business.
    print("\(word) \(done.id)")
    fflush(stdout)
    lastUsed = Date()
    isShown = false
    panel.ignoresMouseEvents = true
    NSAnimationContext.runAnimationGroup({ context in
      context.duration = FADE_OUT
      context.timingFunction = CAMediaTimingFunction(name: .easeIn)
      panel.animator().alphaValue = 0
    }, completionHandler: {
      // A paste that came in during the fade has the panel already.
      if job == nil {
        self.panel.orderOut(nil)
        self.web.evaluateJavaScript("closePicture()")
      }
      self.take()
    })
  }

  // The panel takes the picture's shape: at most most of the screen, never larger than
  // the picture at its own size (a screenshot stays as sharp as it was taken).
  func fit(_ width: Double, _ height: Double, andShow: Bool = true) {
    let screen = NSScreen.main ?? NSScreen.screens[0]
    let room = screen.visibleFrame
    let dots = Double(screen.backingScaleFactor)
    let bar = 70.0, top = 40.0, sides = 48.0
    let w = width / dots, h = height / dots
    let s = min((room.width * 0.86 - sides) / w, (room.height * 0.86 - bar - top) / h, 1)
    let pw = max(760, w * s + sides), ph = max(480, h * s + bar + top)
    let frame = panel.frameRect(forContentRect: NSRect(x: 0, y: 0, width: pw, height: ph))
    let target = NSRect(x: room.midX - frame.width / 2, y: room.midY - frame.height / 2, width: frame.width, height: frame.height).integral
    if panel.frame != target { panel.setFrame(target, display: true) }
    if andShow { reveal() }
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
    switch kind {
    case "warm":
      isPageReady = true
      take()
    case "size":
      fit(body["width"] as? Double ?? 960, body["height"] as? Double ?? 640)
    case "save":
      guard let out = job?.out, let text = body["png"] as? String, let data = Data(base64Encoded: text) else { return say("CANCELLED") }
      // Written beside and renamed, so nothing reads a half-written picture.
      let part = out.appendingPathExtension("part")
      do {
        try data.write(to: part)
        say(rename(part.path, out.path) == 0 ? "SAVED" : "CANCELLED")
      } catch {
        say("CANCELLED")
      }
    default:
      say("CANCELLED")
    }
  }

  // The red button: the original stays. Served, the panel is only hidden, never closed.
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    say("CANCELLED")
    return false
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = App()
app.delegate = delegate
app.run()
