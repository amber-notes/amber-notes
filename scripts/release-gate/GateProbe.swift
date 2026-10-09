#if os(macOS)
import AppKit
import ObjectiveC
import QuartzCore
import SQLite3
import SwiftData

// The release gate's probe (scripts/release-gate.sh, docs/Technical/release-gate.md).
//
// Not part of the app: the gate copies this file into Pane/App of the checkout it builds, adds one
// line to PaneApp.init that calls `GateProbe.attach`, and points AppNetwork at `GateNet.session`.
// The build is otherwise the Release build people get, team-signed, on the staging backend.
//
//   -gateProbe setup     signs in with the account on stdin (JSON: email, password, recovery),
//                        opens its key with the recovery key, waits for the first full sync, quits
//   -gateProbe measure   the signed-in app from a cold launch: launch, sync, idle, then the flows
//
// Everything goes to stdout as lines starting with "GATE ": events while it runs, then
// "GATE RESULT {json}". Nothing posts input events: every action is what the app's own controls do.

/// Counts every request that goes through AppNetwork.session, with its bytes on the wire.
final class GateNet: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    struct Request { var at: CFTimeInterval; var host: String; var path: String; var method: String; var sent: Int64; var received: Int64; var ms: Double; var status: Int; var error: String }

    static let shared = GateNet()
    static let session: URLSession = URLSession(configuration: .default, delegate: GateNet.shared, delegateQueue: nil)

    private let lock = NSLock()
    private var requests: [Request] = []

    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        var sent: Int64 = 0, received: Int64 = 0
        for t in metrics.transactionMetrics {
            sent += t.countOfRequestHeaderBytesSent + t.countOfRequestBodyBytesSent
            received += t.countOfResponseHeaderBytesReceived + t.countOfResponseBodyBytesReceived
        }
        let url = task.originalRequest?.url
        let r = Request(at: CACurrentMediaTime(), host: url?.host ?? "", path: Self.shape(url?.path ?? ""), method: task.originalRequest?.httpMethod ?? "",
                        sent: sent, received: received, ms: metrics.taskInterval.duration * 1000,
                        status: (task.response as? HTTPURLResponse)?.statusCode ?? 0,
                        error: (task.error as? URLError).map { "URLError \($0.code.rawValue)" } ?? task.error.map { "\($0)".prefix(60).description } ?? "")
        lock.withLock { requests.append(r) }
    }

    /// Requests that finished in a window of the media clock.
    func between(_ start: CFTimeInterval, _ end: CFTimeInterval) -> [Request] {
        lock.withLock { requests.filter { $0.at >= start && $0.at <= end } }
    }

    /// The path without ids, so requests group by endpoint: /rest/v1/notes, /functions/v1/mcp.
    static func shape(_ path: String) -> String {
        "/" + path.split(separator: "/").map { $0.count >= 32 && $0.contains("-") ? ":id" : String($0) }.joined(separator: "/")
    }
}

@MainActor
final class GateProbe: NSObject {
    static var shared: GateProbe?

    private let mode: String
    private let backend: Backend
    private let sync: SyncEngine
    private let context: ModelContext
    private var results: [String: Any] = [:]
    private var steps: [[String: Any]] = []
    private var hangs: [[String: Any]] = []
    private var currentStep = "launch"

    // Frames: the main thread's display-link callbacks. A long gap is a frame the window couldn't draw.
    private var link: CADisplayLink?
    private var frames: [CFTimeInterval] = []
    private var refresh: CFTimeInterval = 1.0 / 60

    static func attach(backend: Backend, sync: SyncEngine, container: ModelContainer) {
        let args = ProcessInfo.processInfo.arguments
        guard let i = args.firstIndex(of: "-gateProbe"), args.indices.contains(i + 1) else { return }
        let probe = GateProbe(mode: args[i + 1], backend: backend, sync: sync, context: container.mainContext)
        shared = probe
        probe.results["store"] = container.configurations.first?.url.path ?? ""
        GateWatch.start()
        Task { await probe.run() }
    }

    private init(mode: String, backend: Backend, sync: SyncEngine, context: ModelContext) {
        self.mode = mode
        self.backend = backend
        self.sync = sync
        self.context = context
    }

    private func emit(_ line: String) {
        FileHandle.standardOutput.write(Data(("GATE " + line + "\n").utf8))
    }

    private func run() async {
        // Read now, so the gate can delete the file with the account in it as soon as this line is out.
        _ = creds
        emit("started \(mode) pid \(getpid())")
        do {
            if mode == "setup" { try await setup() } else { try await measure() }
        } catch {
            results["error"] = "\(error)"
            results["state"] = state
        }
        finish()
    }

    // MARK: Setup

    /// The account, from stdin: {email, password, recovery}.
    private lazy var creds: [String: String]? = {
        let input = FileHandle.standardInput.readDataToEndOfFile()
        return (try? JSONSerialization.jsonObject(with: input)) as? [String: String]
    }()

    private func setup() async throws {
        guard let creds, let email = creds["email"], let password = creds["password"], let recovery = creds["recovery"] else {
            throw GateError("no account on stdin")
        }
        let start = CACurrentMediaTime()
        try await until("signed out", seconds: 30) { self.backend.state == .signedOut || self.isSignedIn }
        // What the last account switch left behind: folders marked deleted and still to be pushed.
        // AccountLibrary.adopt calls context.delete(f) on each folder, which resolves to Library's
        // delete(_ folder:) (marked deleted, dirty) instead of SwiftData's. They'd go up to the next
        // account (refused), and back to their own account when it signs in again (all its folders
        // deleted on the server). Counted, then removed for real, so every account starts clean here.
        let leftover = ((try? context.fetch(FetchDescriptor<Folder>())) ?? []).filter { $0.deletedAt != nil && $0.dirty }
        results["leftoverFolders"] = leftover.count
        func remove<T: PersistentModel>(_ m: T) { context.delete(m) }
        for n in (try? context.fetch(FetchDescriptor<Note>())) ?? [] { remove(n) }
        for f in (try? context.fetch(FetchDescriptor<Folder>())) ?? [] { remove(f) }
        try? context.save()
        // With the notes go the memory of where sync was (or signing the same account in twice in a
        // row pulls only what changed since: 3 notes of 20,000) and the store's record of every
        // change so far (or each account's database carries the runs before it).
        for key in UserDefaults.standard.dictionaryRepresentation().keys where key.hasPrefix("syncCursor.") { UserDefaults.standard.removeObject(forKey: key) }
        try? ModelContext(context.container).deleteHistory(HistoryDescriptor<DefaultHistoryTransaction>())
        if !isSignedIn { try await backend.signIn(email: email, password: password) }
        try await until("signed in", seconds: 30) { self.isSignedIn }
        let crypto = AccountCrypto.shared
        try await until("key check", seconds: 60) { [.waiting, .mismatch, .ready].contains(crypto.phase) }
        if crypto.phase != .ready { try await crypto.recover(typed: recovery) }
        try await until("key ready", seconds: 60) { crypto.phase == .ready }
        if crypto.needsWelcome { crypto.welcomeShown() }
        let syncStart = CACurrentMediaTime()
        try await until("first sync", seconds: 900) { self.synced }
        results["firstSyncMs"] = (CACurrentMediaTime() - syncStart) * 1000
        results["setupMs"] = (CACurrentMediaTime() - start) * 1000
        // What the first sync downloaded.
        let net = GateNet.shared.between(syncStart, CACurrentMediaTime())
        results["firstSyncNet"] = summary(net)
        try? await Task.sleep(for: .seconds(3))
        results["notes"] = (try? context.fetchCount(FetchDescriptor<Note>())) ?? -1
        results["storage"] = storage()
    }

    // MARK: Measure

    private func measure() async throws {
        let launch = Self.processStart
        // The first usable window: the notes window is up and the account's key is open.
        var polls = 0
        try await until("window", seconds: 120) {
            polls += 1
            // Launched over ssh the app can start inactive, with its window not yet shown.
            if polls == 100 { NSApp.activate() }
            if polls % 500 == 0 { self.emit("waiting: \(self.state)") }
            return self.window != nil && AccountCrypto.shared.phase == .ready || AccountCrypto.shared.phase == .waiting
        }
        // A build that can't keep the key between launches asks for the recovery key again
        // (the sandboxed Developer ID beta: no data protection keychain, and the synced item fails).
        if AccountCrypto.shared.phase == .waiting {
            results["keyAskedAgainAtLaunch"] = true
            results["launchToKeyAskMs"] = (CACurrentMediaTime() - launch) * 1000
            guard let recovery = creds?["recovery"] else { throw GateError("the key is asked for again at launch, and no account on stdin") }
            try await AccountCrypto.shared.recover(typed: recovery)
            if AccountCrypto.shared.needsWelcome { AccountCrypto.shared.welcomeShown() }
            try await until("window after the key", seconds: 60) { self.window != nil && AccountCrypto.shared.phase == .ready }
        }
        let windowAt = CACurrentMediaTime()
        results["launchToWindowMs"] = (windowAt - launch) * 1000
        emit("window \(Int(results["launchToWindowMs"] as! Double)) ms")
        startLink()
        // The note list shows its first rows (the middle column's table).
        if (try? await until("list", seconds: 120) { (self.noteListTable?.numberOfRows ?? 0) > 0 }) != nil {
            results["launchToListMs"] = (CACurrentMediaTime() - launch) * 1000
        }
        try await until("synced", seconds: 300) { self.synced }
        let syncedAt = CACurrentMediaTime()
        results["launchToSyncedMs"] = (syncedAt - launch) * 1000
        try? await Task.sleep(for: .seconds(2))
        results["launchNet"] = summary(GateNet.shared.between(0, CACurrentMediaTime()))
        results["notes"] = (try? context.fetchCount(FetchDescriptor<Note>())) ?? -1
        results["memoryAfterLaunchMB"] = Self.footprintMB()

        // Nothing may sit on top of the window while it's measured: a sheet or an alert (a notice
        // left on the bench account, a prompt a build added) changes every number after it.
        let covering = NSApp.windows.filter { $0.isVisible && ($0.isSheet || $0 is NSPanel && $0.level == .modalPanel || NSApp.modalWindow === $0) }
        let sheets = NSApp.windows.compactMap { $0.attachedSheet }
        if !covering.isEmpty || !sheets.isEmpty {
            let what = (covering + sheets).map { "\(type(of: $0)) \"\($0.title)\"" }.joined(separator: ", ")
            throw GateError("a sheet or alert is over the window, so nothing was measured: \(what). Settle the bench account (scripts/release-gate/staging.ts ensure) or find what this build shows at launch.")
        }

        // Idle: nothing should be laid out again, and the main thread should sleep.
        GateLayout.install(in: NSApp.windows)
        try? await Task.sleep(for: .seconds(3))
        // Idle begins once launch is over, the same for every account: a small account is synced
        // two seconds in, and the window's last settling pass (six layouts, once) then fell inside
        // its idle window while a large account's had long passed.
        let settle = 15 - (CACurrentMediaTime() - launch)
        if settle > 0 { try? await Task.sleep(for: .seconds(settle)) }
        currentStep = "idle"
        results["idle"] = await idle(seconds: 20)
        if ProcessInfo.processInfo.arguments.contains("-gateIdleTwice") { results["idleAgain"] = await idle(seconds: 20) }

        let notes = (try? context.fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.deletedAt == nil && $0.trashedAt == nil }))) ?? []
        func find(_ title: String) -> Note? { notes.first { $0.title == title } }
        guard let short = find("Gate short note"), let typing = find("Gate typing note"), let long = find("Gate long note") else {
            throw GateError("the account has no Gate notes: scripts/release-gate.sh seeds them")
        }
        let other = notes.first { $0.id != short.id && $0.id != typing.id && $0.id != long.id } ?? typing

        await open(short.id)
        for i in 0..<6 {
            await step("sidebar \(i % 2 == 0 ? "hide" : "show")", group: i % 2 == 0 ? "sidebar hide" : "sidebar show", settle: 0.9, sidebar: true) {
                NSApp.sendAction(#selector(NSSplitViewController.toggleSidebar(_:)), to: nil, from: nil)
            }
            try? await Task.sleep(for: .milliseconds(400))
        }
        for i in 0..<4 {
            let n = i % 2 == 0 ? short : other
            await step("open a short note", group: "open a short note", settle: 0.8) { NoteOpener.shared.request = n.id }
        }
        for _ in 0..<2 {
            await open(short.id)
            await step("open the 5,000-line note", group: "open the 5,000-line note", settle: 1.5) { NoteOpener.shared.request = long.id }
        }

        // Typing: 25 keys at 120 ms, then the save and the push it starts.
        await open(typing.id)
        // Only ever into the typing note: if the window shows another one, no typing at all.
        if let text = editor, !text.string.hasPrefix("Gate typing note") {
            results["typing"] = "the editor didn't show the typing note"
        } else if let text = editor {
            window?.makeFirstResponder(text)
            text.setSelectedRange(NSRange(location: (text.string as NSString).length, length: 0))
            try? await Task.sleep(for: .milliseconds(500))
            currentStep = "typing and saving"
            GateLayout.install(in: NSApp.windows)
            GateLayout.reset()
            frames = []
            let begin = CACurrentMediaTime()
            var keys: [Double] = []
            for _ in 0..<25 {
                let t = CACurrentMediaTime()
                text.insertText("a", replacementRange: text.selectedRange())
                keys.append((CACurrentMediaTime() - t) * 1000)
                try? await Task.sleep(for: .milliseconds(120))
            }
            do { try await until("pushed", seconds: 30) { self.synced && !self.dirty(typing) } } catch { results["typingPushTimedOut"] = true }
            try? await Task.sleep(for: .milliseconds(500))
            var row = summarize("typing and saving", since: begin)
            row["layouts"] = GateLayout.total
            row["layoutsByView"] = GateLayout.top
            row["keyMedianMs"] = keys.sorted()[keys.count / 2]
            row["keyMaxMs"] = keys.max() ?? 0
            row["saveToSyncedMs"] = (CACurrentMediaTime() - begin) * 1000 - 25 * 120 - 500
            steps.append(row)

            // One save on its own, for its requests and bytes: a marker E2EE checks look for on the server.
            try? await Task.sleep(for: .seconds(2))
            let saveStart = CACurrentMediaTime()
            text.insertText(" gate-plaintext-canary", replacementRange: text.selectedRange())
            do { try await until("pushed", seconds: 30) { self.synced && !self.dirty(typing) } } catch { results["savePushTimedOut"] = true }
            try? await Task.sleep(for: .seconds(1))
            results["saveNet"] = summary(GateNet.shared.between(saveStart, CACurrentMediaTime()))
            // The note goes back as it was, so the account doesn't grow run after run.
            if text.string.hasPrefix("Gate typing note") {
                text.setSelectedRange(NSRange(location: 0, length: (text.string as NSString).length))
                text.insertText("Gate typing note\n\nTyped here by the release gate.\n", replacementRange: text.selectedRange())
                try? await until("pushed", seconds: 30) { self.synced && !self.dirty(typing) }
            }
        }

        // Opening a note on its own, for its requests and bytes.
        try? await Task.sleep(for: .seconds(2))
        let openStart = CACurrentMediaTime()
        NoteOpener.shared.request = other.id
        try? await Task.sleep(for: .seconds(2))
        results["openNet"] = summary(GateNet.shared.between(openStart, CACurrentMediaTime()))

        if let outline = sidebarTable {
            for row in [2, 3, 1, 4, 0, 2] where row < outline.numberOfRows {
                await step("folder switch", group: "folder switch", settle: 0.6) { outline.selectRowIndexes([row], byExtendingSelection: false) }
                try? await Task.sleep(for: .milliseconds(300))
            }
        } else {
            results["folderSwitch"] = "no sidebar table found"
        }

        // A note arrives from another device: the gate writes one to the account now.
        await open(short.id)
        let tick = sync.remoteChangeTick
        emit("arrive-ready")
        let waitStart = CACurrentMediaTime()
        currentStep = "a note arrives by sync"
        GateLayout.install(in: NSApp.windows)
        GateLayout.reset()
        frames = []
        try? await until("arrival", seconds: 90) { self.sync.remoteChangeTick != tick }
        if sync.remoteChangeTick != tick {
            let arrived = CACurrentMediaTime()
            try? await Task.sleep(for: .seconds(1))
            var row = summarize("a note arrives by sync", since: max(waitStart, arrived - 0.5))
            row["waitedMs"] = (arrived - waitStart) * 1000
            row["layouts"] = GateLayout.total
            row["layoutsByView"] = GateLayout.top
            steps.append(row)
        } else {
            results["arrive"] = "nothing arrived in 90 s"
        }

        currentStep = "end"
        results["memoryEndMB"] = Self.footprintMB()
        results["storage"] = storage()
    }

    /// What the app shows, for a run that waits too long.
    private var state: String {
        let windows = NSApp.windows.map { "\(type(of: $0)) '\($0.title)' visible \($0.isVisible) split \($0.contentView.flatMap { Self.find(NSSplitView.self, in: $0) } != nil)" }
        return "dataProtection \(KeychainAccountKeyStore.dataProtectionAvailable) backend \(backend.state) crypto \(AccountCrypto.shared.phase) sync \(sync.status) windows [\(windows.joined(separator: "; "))]"
    }

    private var isSignedIn: Bool { if case .signedIn = backend.state { true } else { false } }
    private var synced: Bool { if case .synced = sync.status, sync.hasSynced { true } else { false } }
    private func dirty(_ n: Note) -> Bool { n.dirty }

    private func open(_ id: UUID) async {
        NoteOpener.shared.request = id
        try? await Task.sleep(for: .seconds(1.5))
    }

    private func until(_ what: String, seconds: Double, _ ok: @escaping () -> Bool) async throws {
        let start = CACurrentMediaTime()
        while !ok() {
            if CACurrentMediaTime() - start > seconds { throw GateError("timed out waiting for \(what)") }
            try? await Task.sleep(for: .milliseconds(10))
        }
    }

    // MARK: Idle

    private func idle(seconds: Double) async -> [String: Any] {
        GateLayout.install(in: NSApp.windows)
        // The probe's own clocks stay out of it: the display link stops, and the hang watch's
        // pings (which wake the main thread too) are taken off the count.
        link?.isPaused = true
        defer { link?.isPaused = false }
        try? await Task.sleep(for: .milliseconds(200))
        GateLayout.reset()
        GateWatch.wakeups = 0
        GateWatch.pongs = 0
        let cpu0 = Self.cpuSeconds(), t0 = CACurrentMediaTime()
        let net0 = t0
        try? await Task.sleep(for: .seconds(seconds))
        let elapsed = CACurrentMediaTime() - t0
        let layouts = GateLayout.counts
        return [
            "seconds": elapsed,
            "cpuPercent": (Self.cpuSeconds() - cpu0) / elapsed * 100,
            "wakeupsPerSecond": Double(max(0, GateWatch.wakeups - GateWatch.pongs)) / elapsed,
            "layouts": layouts.values.reduce(0, +),
            "layoutsByView": layouts.filter { $0.value > 0 }.sorted { $0.value > $1.value }.prefix(10).map { "\($0.key) \($0.value)" },
            "hostedViews": GateLayout.hosted,
            "requests": GateNet.shared.between(net0, CACurrentMediaTime()).count,
        ]
    }

    // MARK: Steps

    private func step(_ name: String, group: String, settle: Double, sidebar: Bool = false, _ action: () -> Void) async {
        currentStep = name
        GateLayout.install(in: NSApp.windows)
        GateLayout.reset()
        frames = []
        let begin = CACurrentMediaTime()
        let netStart = begin
        action()
        var extra: [String: Any] = [:]
        if sidebar {
            var last = -1.0, still = 0, settledAt = begin
            while CACurrentMediaTime() - begin < 2 {
                try? await Task.sleep(for: .milliseconds(4))
                let w = Double(sidebarWidth)
                if w == last { still += 1 } else { still = 0; settledAt = CACurrentMediaTime(); last = w }
                if still >= 3 && CACurrentMediaTime() - begin > 0.1 { break }
            }
            extra["settledMs"] = (settledAt - begin) * 1000
        } else {
            try? await Task.sleep(for: .seconds(settle))
        }
        var row = summarize(group, since: begin)
        row.merge(extra) { $1 }
        row["requests"] = GateNet.shared.between(netStart, CACurrentMediaTime()).count
        row["layouts"] = GateLayout.total
        row["layoutsByView"] = GateLayout.top
        steps.append(row)
    }

    private func summarize(_ name: String, since begin: CFTimeInterval) -> [String: Any] {
        var gaps: [Double] = []
        var prev = begin
        for f in frames where f >= begin { gaps.append((f - prev) * 1000); prev = f }
        // A main thread blocked to the end of the step drew nothing after its last frame.
        gaps.append((CACurrentMediaTime() - prev) * 1000)
        let hitches = gaps.filter { $0 > refresh * 1000 * 1.5 }
        return ["step": name, "frames": gaps.count - 1, "longestFrameMs": gaps.max() ?? 0, "hitches": hitches.count,
                "hitchMs": hitches.reduce(0) { $0 + $1 - refresh * 1000 }]
    }

    private func summary(_ rs: [GateNet.Request]) -> [String: Any] {
        var byPath: [String: Int] = [:]
        for r in rs { byPath[r.host + r.path, default: 0] += 1 }
        var failures: [String: Int] = [:]
        for r in rs where r.status >= 400 || r.status == 0 { failures["\(r.method) \(r.path) \(r.status == 0 ? r.error : String(r.status))", default: 0] += 1 }
        return ["requests": rs.count, "bytesSent": rs.reduce(0) { $0 + $1.sent }, "bytesReceived": rs.reduce(0) { $0 + $1.received },
                "failed": rs.filter { $0.status >= 400 || $0.status == 0 }.count,
                "failures": failures.sorted { $0.value > $1.value }.prefix(6).map { "\($0.key) ×\($0.value)" },
                "endpoints": byPath.sorted { $0.value > $1.value }.map { "\($0.key) \($0.value)" }]
    }

    private func finish() {
        results["mode"] = mode
        results["steps"] = steps
        results["hangs"] = GateWatch.hangs
        results["refreshHz"] = (1 / refresh).rounded()
        results["version"] = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        if let data = try? JSONSerialization.data(withJSONObject: results, options: [.sortedKeys]) {
            emit("RESULT " + String(decoding: data, as: UTF8.self))
        }
        // Lets the push and the store finish before quitting.
        Task {
            try? self.context.save()
            try? await Task.sleep(for: .seconds(1))
            NSApp.terminate(nil)
            // The app doesn't always quit when asked from here (seen on the first runs): the store is saved.
            try? await Task.sleep(for: .seconds(4))
            exit(0)
        }
    }

    // MARK: Storage

    /// The app's own files: the store, its caches and everything else in its container.
    private func storage() -> [String: Any] {
        let fm = FileManager.default
        func size(_ url: URL) -> Int64 {
            guard let e = fm.enumerator(at: url, includingPropertiesForKeys: [.totalFileAllocatedSizeKey, .isRegularFileKey]) else { return 0 }
            var total: Int64 = 0
            for case let f as URL in e {
                let v = try? f.resourceValues(forKeys: [.totalFileAllocatedSizeKey, .isRegularFileKey])
                if v?.isRegularFile == true { total += Int64(v?.totalFileAllocatedSize ?? 0) }
            }
            return total
        }
        var out: [String: Any] = [:]
        if let store = results["store"] as? String, !store.isEmpty {
            func bytes(_ suffix: String) -> Int64 { (try? fm.attributesOfItem(atPath: store + suffix)[.size] as? NSNumber)?.int64Value ?? 0 }
            // As found: the write-ahead log holds whatever was written since SQLite last checkpointed,
            // so the total moves with timing. Then checkpointed, which is the size of the data itself.
            out["walBytes"] = bytes("-wal")
            out["shmBytes"] = bytes("-shm")
            out["storeUncheckpointedBytes"] = bytes("")
            var db: OpaquePointer?
            if sqlite3_open_v2(store, &db, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK {
                sqlite3_busy_timeout(db, 2000)
                out["checkpoint"] = sqlite3_exec(db, "PRAGMA wal_checkpoint(TRUNCATE)", nil, nil, nil) == SQLITE_OK ? "truncate" : "failed"
            }
            sqlite3_close(db)
            out["storeBytes"] = bytes("")
            out["walAfterCheckpointBytes"] = bytes("-wal")
        }
        let lib = fm.urls(for: .libraryDirectory, in: .userDomainMask)[0]
        out["applicationSupportBytes"] = size(lib.appending(path: "Application Support"))
        out["cachesBytes"] = size(lib.appending(path: "Caches"))
        out["libraryBytes"] = size(lib)
        return out
    }

    // MARK: The window's parts

    private var window: NSWindow? {
        NSApp.windows.first { $0.isVisible && $0.contentView.flatMap { Self.find(NSSplitView.self, in: $0) } != nil }
    }

    private var sidebarWidth: CGFloat {
        guard let split = window?.contentView.flatMap({ Self.find(NSSplitView.self, in: $0) }), let first = split.arrangedSubviews.first else { return -1 }
        return first.isHidden ? 0 : first.frame.width
    }

    private var editor: PaneTextView? { window?.contentView.flatMap { Self.find(PaneTextView.self, in: $0) } }

    private var sidebarTable: NSTableView? {
        guard let split = window?.contentView.flatMap({ Self.find(NSSplitView.self, in: $0) }), let first = split.arrangedSubviews.first else { return nil }
        return Self.find(NSTableView.self, in: first)
    }

    private var noteListTable: NSTableView? {
        guard let split = window?.contentView.flatMap({ Self.find(NSSplitView.self, in: $0) }), split.arrangedSubviews.count > 1 else { return nil }
        return Self.find(NSTableView.self, in: split.arrangedSubviews[1])
    }

    private static func find<T: NSView>(_ type: T.Type, in view: NSView) -> T? {
        if let v = view as? T { return v }
        for s in view.subviews { if let v = find(type, in: s) { return v } }
        return nil
    }

    // MARK: Clocks

    private func startLink() {
        guard let view = window?.contentView else { return }
        let l = view.displayLink(target: self, selector: #selector(tick(_:)))
        l.add(to: .main, forMode: .common)
        link = l
    }

    @objc private func tick(_ l: CADisplayLink) {
        refresh = max(1.0 / 240, l.targetTimestamp - l.timestamp)
        frames.append(CACurrentMediaTime())
        GateWatch.step = currentStep
    }

    static var processStart: CFTimeInterval {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        sysctl(&mib, 4, &info, &size, nil, 0)
        let start = info.kp_proc.p_starttime
        let started = Double(start.tv_sec) + Double(start.tv_usec) / 1e6
        return CACurrentMediaTime() - (Date().timeIntervalSince1970 - started)
    }

    static func cpuSeconds() -> Double {
        var u = rusage()
        getrusage(RUSAGE_SELF, &u)
        return Double(u.ru_utime.tv_sec) + Double(u.ru_utime.tv_usec) / 1e6 + Double(u.ru_stime.tv_sec) + Double(u.ru_stime.tv_usec) / 1e6
    }

    static func footprintMB() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
    }
}

struct GateError: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

/// Main-thread hangs (no answer for 250 ms or more), from a background thread, and the main run
/// loop's wake-ups.
enum GateWatch {
    nonisolated(unsafe) static var hangs: [[String: Any]] = []
    nonisolated(unsafe) static var wakeups = 0
    nonisolated(unsafe) static var pongs = 0
    nonisolated(unsafe) static var step = "launch"
    nonisolated(unsafe) private static var lastPong = CACurrentMediaTime()
    nonisolated(unsafe) private static var inHang = false
    nonisolated(unsafe) private static var hangStart: CFTimeInterval = 0
    nonisolated(unsafe) private static var timer: DispatchSourceTimer?

    static func start() {
        let observer = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.afterWaiting.rawValue, true, 0) { _, _ in wakeups += 1 }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
        let lock = NSLock()
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .userInteractive))
        t.schedule(deadline: .now(), repeating: .milliseconds(50))
        t.setEventHandler {
            let now = CACurrentMediaTime()
            lock.lock()
            let since = now - lastPong
            let started = since >= 0.25 && !inHang
            if started { inHang = true; hangStart = lastPong }
            lock.unlock()
            // The gate samples the main thread when it reads this (scripts/release-gate/gate.ts).
            if started { FileHandle.standardOutput.write(Data("GATE hang \(step)\n".utf8)) }
            DispatchQueue.main.async {
                let back = CACurrentMediaTime()
                lock.lock()
                if inHang {
                    hangs.append(["ms": (back - hangStart) * 1000, "step": step, "atS": back - GateProbe.processStartNonisolated])
                    inHang = false
                }
                lastPong = back
                pongs += 1
                lock.unlock()
            }
        }
        t.resume()
        timer = t
    }
}

extension GateProbe {
    nonisolated static var processStartNonisolated: CFTimeInterval {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        sysctl(&mib, 4, &info, &size, nil, 0)
        let start = info.kp_proc.p_starttime
        let started = Double(start.tv_sec) + Double(start.tv_usec) / 1e6
        return CACurrentMediaTime() - (Date().timeIntervalSince1970 - started)
    }
}

/// How often each kind of view is laid out. While the app is idle this should stay at zero: a view
/// laid out again and again (a menu bar label that changes its own size, a body that reads
/// something that changes on every read) shows up here by class.
@MainActor
enum GateLayout {
    nonisolated(unsafe) static var counts: [String: Int] = [:]
    private static var swizzled = Set<ObjectIdentifier>()

    /// AppKit views inside SwiftUI hosts that were laid out since the last reset: seconds since the probe attached, and their classes.
    nonisolated(unsafe) static var hosted: [String] = []
    nonisolated(unsafe) static var started = ProcessInfo.processInfo.systemUptime

    static func reset() { counts = [:]; hosted = [] }

    /// Class names, worked out once per class: thousands of layouts can run in one frame.
    nonisolated(unsafe) private static var names: [ObjectIdentifier: String] = [:]
    private static func name(of cls: AnyClass) -> String {
        if let n = names[ObjectIdentifier(cls)] { return n }
        let n = String(describing: cls).components(separatedBy: "<").first ?? "?"
        names[ObjectIdentifier(cls)] = n
        return n
    }

    static var total: Int { counts.values.reduce(0, +) }
    static var top: [String] { counts.sorted { $0.value > $1.value }.prefix(6).map { "\($0.key) \($0.value)" } }

    /// Swizzles `layout` on every class in these windows' view trees that has its own.
    static func install(in windows: [NSWindow]) {
        for w in windows {
            if let v = w.contentView { walk(v) }
            if let frame = w.contentView?.superview { walk(frame) }
        }
    }

    private static func walk(_ view: NSView) {
        hook(type(of: view))
        for s in view.subviews { walk(s) }
    }

    private static func hook(_ cls: AnyClass) {
        let selector = #selector(NSView.layout)
        // Hook the class that actually implements layout, once.
        var owner: AnyClass? = cls
        while let c = owner, let sup = class_getSuperclass(c),
              let m = class_getInstanceMethod(c, selector), let sm = class_getInstanceMethod(sup, selector),
              method_getImplementation(m) == method_getImplementation(sm) {
            owner = sup
        }
        // Plain NSView's layout runs for every view that calls super: only classes with their own count.
        guard let target = owner, target != NSView.self, !swizzled.contains(ObjectIdentifier(target)),
              let method = class_getInstanceMethod(target, selector) else { return }
        swizzled.insert(ObjectIdentifier(target))
        typealias Layout = @convention(c) (AnyObject, Selector) -> Void
        let call = unsafeBitCast(method_getImplementation(method), to: Layout.self)
        let block: @convention(block) (AnyObject) -> Void = { obj in
            let n = name(of: type(of: obj))
            counts[n, default: 0] += 1
            // Which AppKit view a SwiftUI host holds, and when: "AppKitPlatformViewHost" alone doesn't say.
            if n == "AppKitPlatformViewHost", hosted.count < 40, let v = obj as? NSView {
                let inside = v.subviews.map { name(of: type(of: $0)) }.joined(separator: "+")
                hosted.append(String(format: "%.1f s %@", ProcessInfo.processInfo.systemUptime - started, inside.isEmpty ? "(empty)" : inside))
            }
            call(obj, selector)
        }
        method_setImplementation(method, imp_implementationWithBlock(block))
    }
}
#endif
