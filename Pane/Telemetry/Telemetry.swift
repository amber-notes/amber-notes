import Foundation

/// Error reports, a few product events and performance numbers, sent to PostHog in the EU
/// (docs/Technical/app-telemetry.md). The released app only, and only while Settings › Share
/// diagnostics and usage is on: off, nothing is queued or sent.
///
/// It takes a `TelemetryEvent` and nothing else, so what leaves the device is what that enum can
/// say. Events wait in a small file (at most `cap`; more are dropped) and go out in batches: soon
/// after an error, when the app goes to the background, and at the next launch for whatever a
/// crash or a missing connection left behind.
final class Telemetry: @unchecked Sendable {
    /// The app's own. Inert until `start`, and for good in debug builds, tests and the Simulator.
    static let shared = Telemetry()

    /// Settings › Share diagnostics and usage. On unless it was turned off.
    static let consentKey = "shareDiagnostics"
    static let installKey = "telemetry.installID"
    static let onceKey = "telemetry.once"
    static let cap = 200
    static let batch = 50
    static let longestLaunch: TimeInterval = 20

    private let lock = NSLock()
    private var config: TelemetryConfig?
    private var transport: TelemetryTransport?
    private var store: TelemetryQueueStore?
    private var defaults: UserDefaults = .standard
    private var now: @Sendable () -> Date = { .now }
    /// Each waiting event, as the JSON that goes into a batch.
    private var queue: [Data] = []
    /// Bumped when the queue is emptied from outside a send, so a send that was under way
    /// doesn't remove what came after.
    private var epoch = 0
    private var account: UUID?
    private var saidThisLaunch = Set<String>()
    private var timings = SyncTimings()
    private var flushing = false
    /// Sends on its own a little after an event is recorded. Tests send by hand.
    private var timed = true
    private var pending: Task<Void, Never>?
    private var pendingAt = Date.distantFuture
    private var launchedAt: Date?
    private var openedDay: Int?

    init() {}

    /// Tests: one that sends through `transport`, and only when `flush` is called.
    convenience init(config: TelemetryConfig, transport: TelemetryTransport, store: TelemetryQueueStore = MemoryTelemetryQueue(),
                     defaults: UserDefaults, now: @escaping @Sendable () -> Date = { .now }) {
        self.init()
        timed = false
        start(config, transport: transport, store: store, defaults: defaults, now: now)
    }

    /// Turns reporting on for this run. What the last run left in the file is picked up.
    func start(_ config: TelemetryConfig, transport: TelemetryTransport, store: TelemetryQueueStore, defaults: UserDefaults = .standard,
               now: @escaping @Sendable () -> Date = { .now }) {
        lock.withLock {
            self.config = config
            self.transport = transport
            self.store = store
            self.defaults = defaults
            self.now = now
            queue = consents ? Array(store.load().suffix(Self.cap)) : []
            if !consents { store.save([]) }
        }
    }

    // MARK: Consent

    private var consents: Bool { defaults.object(forKey: Self.consentKey) == nil || defaults.bool(forKey: Self.consentKey) }

    /// The switch in Settings, whatever the build: a build that never sends still keeps the choice.
    var consent: Bool {
        get { lock.withLock { consents } }
        set {
            lock.withLock {
                defaults.set(newValue, forKey: Self.consentKey)
                if !newValue { empty() }
            }
        }
    }

    /// Whether this build sends at all (TelemetryGate), whatever the switch says.
    var sends: Bool { lock.withLock { config != nil } }

    /// Whether anything is recorded at all: a build that sends, with the switch on.
    var isOn: Bool { lock.withLock { config != nil && consents } }

    // MARK: Who

    /// The account, once signed in: its events say which account, so "this account is stuck on the
    /// key screen" can be answered. Before that, a random identifier made for this install.
    func identify(_ account: UUID) {
        lock.withLock { self.account = account }
    }

    /// Signed out: what follows goes under a new random identifier, not the account's and not the
    /// one from before. What's already waiting still goes out as it was recorded.
    func signedOut() {
        lock.withLock {
            guard account != nil else { return }
            account = nil
            forgetInstall()
        }
    }

    /// The account was deleted: its waiting events are dropped unsent, and the identifier is new.
    func accountDeleted() {
        lock.withLock {
            account = nil
            forgetInstall()
            empty()
        }
    }

    private func forgetInstall() {
        defaults.removeObject(forKey: Self.installKey)
        defaults.removeObject(forKey: Self.onceKey)
    }

    private var installID: String {
        if let id = defaults.string(forKey: Self.installKey), UUID(uuidString: id) != nil { return id }
        let id = UUID().uuidString.lowercased()
        defaults.set(id, forKey: Self.installKey)
        return id
    }

    private func empty() {
        queue = []
        epoch += 1
        timings = SyncTimings()
        store?.save([])
    }

    // MARK: Recording

    func record(_ event: TelemetryEvent) {
        lock.withLock {
            guard let config, consents else { return }
            if event.oncePerLaunch, !saidThisLaunch.insert(String(describing: event)).inserted { return }
            if event.oncePerInstall {
                var said = defaults.stringArray(forKey: Self.onceKey) ?? []
                guard !said.contains(event.name.rawValue) else { return }
                said.append(event.name.rawValue)
                defaults.set(said, forKey: Self.onceKey)
            }
            // Full: the newest is dropped, so a failure that floods never pushes out what led to it.
            guard queue.count < Self.cap else { return }
            queue.append(TelemetryBody.event(event, id: account?.uuidString.lowercased() ?? installID, at: now(), context: config.context))
            store?.save(queue)
            schedule(after: event.isError || queue.count >= Self.batch ? 2 : 60)
        }
    }

    /// One sync finished: counted, and sent as one event when the app goes to the background.
    func syncFinished(seconds: TimeInterval, ok: Bool) {
        lock.withLock {
            guard config != nil, consents else { return }
            timings.add(seconds: seconds, ok: ok)
        }
    }

    // MARK: Launch

    /// The app started. `opensNotes`: it launched signed in with the key here, so the next thing
    /// drawn is the notes and the time until then is the cold launch.
    func launched(opensNotes: Bool) {
        lock.withLock { launchedAt = opensNotes ? now() : nil }
    }

    /// The notes are on screen for the first time this launch.
    func notesShown() {
        let started: Date? = lock.withLock {
            defer { launchedAt = nil }
            return launchedAt
        }
        guard let started else { return }
        let seconds = now().timeIntervalSince(started)
        // Longer is something else: the system started the app in the background (a push, a
        // Shortcut) and the notes were drawn when it was opened later.
        if seconds >= 0, seconds < Self.longestLaunch { record(.coldLaunch(milliseconds: Int(seconds * 1000))) }
    }

    /// The app came to the front: "app opened" once at launch, and once more for each new day
    /// (UTC) it's still running, so a Mac app left open for a week counts as used on each day.
    func becameActive(signedIn: Bool) {
        let day = Int(now().timeIntervalSince1970 / 86400)
        let launch: Bool? = lock.withLock {
            defer { openedDay = day }
            return openedDay == nil ? true : openedDay == day ? nil : false
        }
        if let launch { record(.appOpened(launch: launch, signedIn: signedIn)) }
    }

    /// The app left the front (or is quitting): everything waiting goes out. The sync timings are
    /// said once there are enough of them to be worth an event, or when the app quits.
    func resigning(quitting: Bool) async {
        let t: SyncTimings? = lock.withLock {
            guard quitting ? !timings.isEmpty : timings.count >= SyncTimings.enough else { return nil }
            defer { timings = SyncTimings() }
            return timings
        }
        if let t { record(.syncDurations(t)) }
        await flush()
    }

    // MARK: Sending

    /// Lock held. Keeps the earliest of the sends asked for.
    private func schedule(after seconds: TimeInterval) {
        let at = now().addingTimeInterval(seconds)
        guard timed, pending == nil || at < pendingAt else { return }
        pending?.cancel()
        pendingAt = at
        pending = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, let self else { return }
            self.lock.withLock { self.pending = nil; self.pendingAt = .distantFuture }
            await self.flush()
        }
    }

    /// Sends what's waiting, a batch at a time. A batch the server took, or refused as malformed,
    /// leaves the queue; one that couldn't be delivered stays for the next try.
    func flush() async {
        while true {
            let work: (body: Data, count: Int, epoch: Int, url: URL, transport: TelemetryTransport)? = lock.withLock {
                guard !flushing, let config, let transport, consents, !queue.isEmpty else { return nil }
                flushing = true
                let batch = Array(queue.prefix(Self.batch))
                return (TelemetryBody.batch(batch, key: config.key), batch.count, epoch, config.host.appending(path: "batch/"), transport)
            }
            guard let work else { return }
            let status = try? await work.transport.send(work.body, to: work.url)
            let more: Bool = lock.withLock {
                flushing = false
                guard let status, Self.settled(status) else { return false }
                guard work.epoch == epoch else { return !queue.isEmpty }
                queue.removeFirst(min(work.count, queue.count))
                store?.save(queue)
                return !queue.isEmpty
            }
            if !more { return }
        }
    }

    /// Whether an answer ends a batch: taken (2xx), or refused in a way no retry changes (4xx,
    /// except "too many requests" and a timeout).
    static func settled(_ status: Int) -> Bool {
        (200 ..< 300).contains(status) || ((400 ..< 500).contains(status) && status != 408 && status != 429)
    }

    /// Tests: what's waiting, decoded.
    var waiting: [[String: Any]] {
        lock.withLock { queue.compactMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
    }
}

// MARK: The body

/// PostHog's batch format (https://posthog.com/docs/api/capture). No person profile is made or
/// updated for an event, and PostHog is told not to work out a location from the request.
enum TelemetryBody {
    static let library = "pinto-notes-app"

    static func event(_ event: TelemetryEvent, id: String, at: Date, context: TelemetryContext) -> Data {
        var properties = context.properties
        for (key, value) in event.properties { properties[key.rawValue] = value.json }
        properties["distinct_id"] = id
        properties["$process_person_profile"] = false
        properties["$geoip_disable"] = true
        properties["$lib"] = library
        let object: [String: Any] = ["event": event.name.rawValue, "distinct_id": id, "uuid": UUID().uuidString.lowercased(),
                                     "timestamp": at.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)),
                                     "properties": properties]
        return (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])) ?? Data("{}".utf8)
    }

    static func batch(_ events: [Data], key: String) -> Data {
        let quoted = (try? JSONSerialization.data(withJSONObject: key, options: [.fragmentsAllowed])) ?? Data("\"\"".utf8)
        var body = Data("{\"api_key\":".utf8) + quoted + Data(",\"batch\":[".utf8)
        for (i, e) in events.enumerated() {
            if i > 0 { body.append(UInt8(ascii: ",")) }
            body.append(e)
        }
        body.append(Data("]}".utf8))
        return body
    }
}

// MARK: The build

/// What every event says about the app and the device: versions, the kind of device, the kind of
/// build. Not the device's name or model.
struct TelemetryContext: Equatable, Sendable {
    var appVersion: VersionNumber?
    var appBuild: VersionNumber?
    var osVersion: VersionNumber?
    var platform: Platform
    var deviceClass: DeviceClass
    var channel: BuildChannel
    var distribution: Distribution

    enum Key: String, CaseIterable {
        case appVersion = "app_version", appBuild = "app_build", osVersion = "os_version", platform
        case deviceClass = "device_class", channel, distribution
    }

    var properties: [String: Any] {
        var p: [String: Any] = [Key.platform.rawValue: platform.rawValue, Key.deviceClass.rawValue: deviceClass.rawValue,
                                Key.channel.rawValue: channel.rawValue, Key.distribution.rawValue: distribution.rawValue]
        p[Key.appVersion.rawValue] = appVersion?.text
        p[Key.appBuild.rawValue] = appBuild?.text
        p[Key.osVersion.rawValue] = osVersion?.text
        return p
    }

    @MainActor static var current: TelemetryContext {
        let info = Bundle.main.infoDictionary ?? [:]
        let os = ProcessInfo.processInfo.operatingSystemVersion
        #if os(iOS)
        let platform = Platform.ios
        #else
        let platform = Platform.macos
        #endif
        let device: DeviceClass = switch Backend.device {
        case "iPad": .ipad
        case "iPhone": .iphone
        default: .mac
        }
        #if DIRECT
        let distribution = Distribution.direct
        #else
        let distribution = Distribution.appStore
        #endif
        return TelemetryContext(appVersion: VersionNumber(info["CFBundleShortVersionString"] as? String),
                                appBuild: VersionNumber(info["CFBundleVersion"] as? String),
                                osVersion: VersionNumber("\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"),
                                platform: platform, deviceClass: device, channel: TelemetryGate.channel, distribution: distribution)
    }
}

struct TelemetryConfig: Sendable {
    /// The PostHog project key: public and write-only, the same one the website's pages carry.
    var key: String
    var host: URL
    var context: TelemetryContext
}

/// Whether this build sends at all. The released app and Pinto Notes Beta do, when the build was
/// given a project key (PANE_POSTHOG_KEY, Config/Backend.xcconfig). Debug and QA builds, test and
/// capture runs, local-only launches and the Simulator never do.
enum TelemetryGate {
    static let defaultHost = URL(string: "https://eu.i.posthog.com")!

    static let channel: BuildChannel = {
        #if DEBUG || QA
        .debug
        #else
        AppIdentity.keychainPrefix.hasSuffix(".beta") ? .beta : .release
        #endif
    }()

    static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    /// The key as the build settings gave it, or nil when they gave none.
    static func key(_ raw: String?) -> String? {
        guard let k = raw?.trimmingCharacters(in: .whitespacesAndNewlines), k.hasPrefix("phc_"), !k.contains("$(") else { return nil }
        return k
    }

    static func host(_ raw: String?) -> URL {
        guard let raw, raw.hasPrefix("https://"), let u = URL(string: raw) else { return defaultHost }
        return u
    }

    static func sends(key: String?, channel: BuildChannel, simulator: Bool, arguments: [String], environment: [String: String]) -> Bool {
        guard key != nil, channel != .debug, !simulator else { return false }
        if arguments.contains("-uitest") || arguments.contains("-synctest") || arguments.contains("-local") { return false }
        return environment["XCTestConfigurationFilePath"] == nil
    }

    /// Starts `Telemetry.shared` if this build sends. Called first thing at launch.
    @MainActor static func startIfAllowed() {
        let info = Bundle.main
        let key = key(info.object(forInfoDictionaryKey: "PanePostHogKey") as? String)
        guard let key, sends(key: key, channel: channel, simulator: isSimulator, arguments: ProcessInfo.processInfo.arguments,
                             environment: ProcessInfo.processInfo.environment) else { return }
        let config = TelemetryConfig(key: key, host: host(info.object(forInfoDictionaryKey: "PanePostHogHost") as? String), context: .current)
        Telemetry.shared.start(config, transport: URLSessionTelemetryTransport(), store: FileTelemetryQueue())
    }
}

// MARK: Transport and storage

protocol TelemetryTransport: Sendable {
    /// Posts a batch. The HTTP status, or throws when the server couldn't be reached.
    func send(_ body: Data, to url: URL) async throws -> Int
}

/// A session of its own: no cookies, no cache, nothing shared with the rest of the app.
struct URLSessionTelemetryTransport: TelemetryTransport {
    private static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.urlCache = nil
        c.timeoutIntervalForRequest = 15
        return URLSession(configuration: c)
    }()

    func send(_ body: Data, to url: URL) async throws -> Int {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (_, response) = try await Self.session.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }
}

protocol TelemetryQueueStore: Sendable {
    func load() -> [Data]
    func save(_ events: [Data])
}

/// Tests.
final class MemoryTelemetryQueue: TelemetryQueueStore, @unchecked Sendable {
    private var events: [Data] = []
    private let lock = NSLock()
    init(_ events: [Data] = []) { self.events = events }
    func load() -> [Data] { lock.withLock { events } }
    func save(_ events: [Data]) { lock.withLock { self.events = events } }
}

/// The waiting events in the app's own folder, one JSON object a line. Written whole each time:
/// it's at most a couple of hundred short lines.
struct FileTelemetryQueue: TelemetryQueueStore {
    var url: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appending(path: "Pane", directoryHint: .isDirectory).appending(path: "telemetry-queue.jsonl")

    func load() -> [Data] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        return data.split(separator: UInt8(ascii: "\n")).map { Data($0) }
            .filter { (try? JSONSerialization.jsonObject(with: $0)) is [String: Any] }
    }

    func save(_ events: [Data]) {
        guard !events.isEmpty else { try? FileManager.default.removeItem(at: url); return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var data = Data()
        for e in events { data.append(e); data.append(UInt8(ascii: "\n")) }
        try? data.write(to: url, options: .atomic)
    }
}
