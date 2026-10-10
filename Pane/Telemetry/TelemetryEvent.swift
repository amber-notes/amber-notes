import Foundation

// What the app may report about itself (docs/Technical/app-telemetry.md): errors, a few product
// events and performance numbers. Everything an event can carry is typed here, and there is no
// way to put text in: a value is a number, a yes or no, a case of a closed enum, a UUID or a
// version number. Note text, titles, names, emails, keys and tokens have no type that fits.

/// A word an event may carry: a case of a closed enum, never text from anywhere else.
protocol TelemetryWord: RawRepresentable, CaseIterable, Sendable where RawValue == String {}

/// One property's value. Only this file can make one from a String, and it does so only from a
/// `TelemetryWord`, a UUID or a `VersionNumber`.
struct TelemetryValue: Equatable, Sendable {
    fileprivate enum Storage: Equatable, Sendable { case number(Int), flag(Bool), text(String) }
    fileprivate let storage: Storage

    static func number(_ n: Int) -> TelemetryValue { .init(storage: .number(n)) }
    static func flag(_ b: Bool) -> TelemetryValue { .init(storage: .flag(b)) }
    static func word<W: TelemetryWord>(_ w: W) -> TelemetryValue { .init(storage: .text(w.rawValue)) }
    static func id(_ id: UUID) -> TelemetryValue { .init(storage: .text(id.uuidString.lowercased())) }
    static func version(_ v: VersionNumber) -> TelemetryValue { .init(storage: .text(v.text)) }

    /// As it goes into the JSON body.
    var json: Any {
        switch storage {
        case .number(let n): n
        case .flag(let b): b
        case .text(let s): s
        }
    }
}

/// A version or build number such as 1.3 or 2610101200: up to four groups of digits with dots
/// between them. Anything else isn't one, and is never sent.
struct VersionNumber: Equatable, Sendable {
    let text: String

    init?(_ raw: String?) {
        guard let raw, raw.wholeMatch(of: /[0-9]{1,10}(\.[0-9]{1,10}){0,3}/) != nil else { return nil }
        text = raw
    }
}

/// The names of everything an event can say about itself.
enum TelemetryProperty: String, CaseIterable, Sendable {
    case method, how, screen, kind, what, item, operation, outcome, store, code, hint, notes, domain
    case status, runs, count, launch
    case hadKey = "had_key"
    case signedIn = "signed_in"
    case durationMS = "duration_ms"
    case exceptionType = "exception_type"
    case exceptionCode = "exception_code"
    case signal, binary, frames
    case frame0 = "frame_0", frame1 = "frame_1", frame2 = "frame_2", frame3 = "frame_3"
    case frame4 = "frame_4", frame5 = "frame_5", frame6 = "frame_6", frame7 = "frame_7"
    case crashedVersion = "crashed_version"
    case crashedBuild = "crashed_build"
    case under250ms = "under_250ms", under1s = "under_1s", under4s = "under_4s", under15s = "under_15s", over15s = "over_15s"
    case failed

    static let frameSlots: [TelemetryProperty] = [.frame0, .frame1, .frame2, .frame3, .frame4, .frame5, .frame6, .frame7]
}

// MARK: Words

enum SignInMethod: String, TelemetryWord { case apple, google, email }

/// How this device came to hold the account's key.
enum KeyReadyHow: String, TelemetryWord {
    case created
    case recoveryKey = "recovery_key"
    /// Another device handed it over (Add a device).
    case linked
    case icloudKeychain = "icloud_keychain"
    case startFresh = "start_fresh"
}

/// The screens between signing in and the notes (KeyGateView.Shown).
enum GateScreen: String, TelemetryWord {
    case welcome, waiting, recovery, unreachable, checking
    case addDevice = "add_device"
    case noDevice = "no_device"
    case startFresh = "start_fresh"
}

extension GateScreen {
    init(_ shown: KeyGateView.Shown) {
        switch shown {
        case .welcome: self = .welcome
        case .addDevice: self = .addDevice
        case .noDevice: self = .noDevice
        case .waiting: self = .waiting
        case .recovery: self = .recovery
        case .startFresh: self = .startFresh
        case .unreachable: self = .unreachable
        case .checking: self = .checking
        }
    }
}

/// Which AI was connected, by where its approval went. Never the name it gave itself or its host.
enum AIKind: String, TelemetryWord {
    case claude, chatgpt, other

    /// `verified`: ConnectTrust's name for a return address it knows, or nil.
    init(verified: String?) {
        switch verified {
        case "Claude", "Claude Code": self = .claude
        case "ChatGPT", "Codex": self = .chatgpt
        default: self = .other
        }
    }
}

/// What the app keeps in the Keychain (or, on builds without one, in its protected file).
enum KeychainItem: String, TelemetryWord {
    case keySynced = "key_synced"
    case keyPending = "key_pending"
    case keyPrevious = "key_previous"
    case keyLocal = "key_local"
    case deviceIdentity = "device_identity"
    case session
    case notesLock = "notes_lock"

    init(_ slot: KeySlot) {
        switch slot {
        case .synced: self = .keySynced
        case .pending: self = .keyPending
        case .previous: self = .keyPrevious
        case .local: self = .keyLocal
        }
    }
}

enum KeychainOperation: String, TelemetryWord {
    case save, read
    /// The read and the write that decide whether the Keychain can hold the key at all.
    case probeRead = "probe_read"
    case probeWrite = "probe_write"
}

/// Where this build keeps the key.
enum KeyStoreKind: String, TelemetryWord { case keychain, file, memory }

/// What startup decided about the account's key (KeyStartup.Decision).
enum KeyStartupOutcome: String, TelemetryWord {
    case ready, create, reregister, replace, wait, mismatch, unreachable
    case readyUnverified = "ready_unverified"
}

enum SyncedThing: String, TelemetryWord { case note, folder, file }

/// The kind of thing that went wrong, from the error's type. Never its description.
enum FailureKind: String, TelemetryWord {
    case offline, timeout, network, cancelled, http, database, storage, auth, decoding, crypto, file, other
}

/// The database's refusal codes the app knows (SyncEngine.refusal). Any other code is `other`.
enum ServerCode: String, TelemetryWord {
    case tooBig = "PT413", tooFast = "PT429", forbidden = "PT403"
    case rowSecurity = "42501", check = "23514", foreignKey = "23503", unique = "23505"
    case tooLong = "22001", badText = "22P02", badEscape = "22P05", badEncoding = "22021", limit = "54000"
    case none, other

    init(_ code: String?) {
        guard let code, !code.isEmpty else { self = .none; return }
        self = ServerCode(rawValue: code) ?? .other
    }
}

/// The hints the server adds to a refusal.
enum ServerHint: String, TelemetryWord {
    case wrongKey = "wrong_key", noKey = "no_key", notYours = "not_yours", none, other

    init(_ hint: String?) {
        guard let hint, !hint.isEmpty else { self = .none; return }
        self = ServerHint(rawValue: hint) ?? .other
    }
}

enum SignInFailureKind: String, TelemetryWord {
    case network, server, other
    case wrongCredentials = "wrong_credentials"
    case emailNotConfirmed = "email_not_confirmed"
    case rateLimited = "rate_limited"
    case notAllowed = "not_allowed"
    case alreadyExists = "already_exists"
    case weakPassword = "weak_password"
    case badCode = "bad_code"
}

/// Where a store error came from (NSError's domain, as one of these).
enum ErrorDomain: String, TelemetryWord { case cocoa, swiftData = "swift_data", sqlite, posix, other }

/// How many notes the library holds, as a range. Never the number.
enum LibrarySize: String, TelemetryWord {
    case none = "0", upTo10 = "1_10", upTo100 = "11_100", upTo1000 = "101_1000", over1000 = "over_1000"

    init(notes: Int) {
        switch notes {
        case ...0: self = .none
        case 1...10: self = .upTo10
        case 11...100: self = .upTo100
        case 101...1000: self = .upTo1000
        default: self = .over1000
        }
    }
}

enum Platform: String, TelemetryWord { case ios, macos }
enum DeviceClass: String, TelemetryWord { case iphone, ipad, mac }
enum BuildChannel: String, TelemetryWord { case release, beta, debug }
/// The App Store and TestFlight build, or the Mac download.
enum Distribution: String, TelemetryWord { case appStore = "app_store", direct }

/// Every enum a word can come from, for the list of words that may appear in a body
/// (TelemetryPrivacyTests) and for the page that documents them.
enum TelemetryWords {
    static let all: Set<String> = {
        var words = Set<String>()
        func add<W: TelemetryWord>(_: W.Type) { words.formUnion(W.allCases.map(\.rawValue)) }
        add(TelemetryEvent.Name.self); add(SignInMethod.self); add(KeyReadyHow.self); add(GateScreen.self); add(AIKind.self)
        add(KeychainItem.self); add(KeychainOperation.self); add(KeyStoreKind.self); add(KeyStartupOutcome.self)
        add(SyncedThing.self); add(FailureKind.self); add(ServerCode.self); add(ServerHint.self); add(SignInFailureKind.self)
        add(ErrorDomain.self); add(LibrarySize.self); add(Platform.self); add(DeviceClass.self); add(BuildChannel.self)
        add(Distribution.self)
        return words
    }()
}

// MARK: Events

/// What a failure was, as far as an event says: its kind and codes (TelemetryFailure.swift).
struct FailureSummary: Equatable, Sendable {
    var kind: FailureKind
    /// An HTTP status, or the system's own error number (URLError, CocoaError).
    var status: Int?
    var code: ServerCode = .none
    var hint: ServerHint = .none
}

/// A crash or hang as MetricKit reports it, cut down to numbers (TelemetryDiagnostics.swift).
struct StackSummary: Equatable, Sendable {
    /// The app binary's build UUID, to find the symbols for the offsets.
    var binary: UUID?
    /// Offsets into the app's own binary, at most eight. Frames of other binaries are left out.
    var offsets: [Int] = []
    /// How many frames of the app's binary the stack had in all.
    var frames = 0
}

enum TelemetryEvent: Equatable, Sendable {
    // Product
    case appOpened(launch: Bool, signedIn: Bool)
    case signedIn(SignInMethod)
    case signedUp(SignInMethod)
    case keyReady(KeyReadyHow)
    case gateShown(GateScreen)
    case firstNoteCreated
    case firstSync(milliseconds: Int)
    case aiConnected(AIKind)
    case firstAIEditSeen

    // Errors
    case keychainFailed(item: KeychainItem, operation: KeychainOperation, status: Int)
    case keyStartup(KeyStartupOutcome, hadKey: Bool, store: KeyStoreKind)
    case syncFailed(FailureSummary, runs: Int)
    case uploadRefused(SyncedThing, FailureSummary)
    case rowUnreadable(SyncedThing)
    case fileDownloadFailed(FailureSummary)
    case signInFailed(SignInMethod, SignInFailureKind, status: Int?)
    case storeOpenFailed(ErrorDomain, code: Int)
    case storeSaveFailed(ErrorDomain, code: Int)
    case crash(exceptionType: Int?, exceptionCode: Int?, signal: Int?, version: VersionNumber?, build: VersionNumber?, stack: StackSummary)
    case hang(milliseconds: Int, version: VersionNumber?, build: VersionNumber?, stack: StackSummary)

    // Performance
    case coldLaunch(milliseconds: Int)
    case syncDurations(SyncTimings)
    case librarySize(LibrarySize)
    case hangs(count: Int)

    enum Name: String, TelemetryWord {
        case appOpened = "app_opened", signedIn = "signed_in", signedUp = "signed_up", keyReady = "key_ready"
        case gateShown = "gate_shown", firstNoteCreated = "first_note_created", firstSync = "first_sync"
        case aiConnected = "ai_connected", firstAIEditSeen = "first_ai_edit_seen"
        case keychainFailed = "keychain_failed", keyStartup = "key_startup", syncFailed = "sync_failed"
        case uploadRefused = "upload_refused", rowUnreadable = "row_unreadable", fileDownloadFailed = "file_download_failed"
        case signInFailed = "sign_in_failed", storeOpenFailed = "store_open_failed", storeSaveFailed = "store_save_failed"
        case crash, hang
        case coldLaunch = "cold_launch", syncDurations = "sync_durations", librarySize = "library_size", hangs
    }

    var name: Name {
        switch self {
        case .appOpened: .appOpened
        case .signedIn: .signedIn
        case .signedUp: .signedUp
        case .keyReady: .keyReady
        case .gateShown: .gateShown
        case .firstNoteCreated: .firstNoteCreated
        case .firstSync: .firstSync
        case .aiConnected: .aiConnected
        case .firstAIEditSeen: .firstAIEditSeen
        case .keychainFailed: .keychainFailed
        case .keyStartup: .keyStartup
        case .syncFailed: .syncFailed
        case .uploadRefused: .uploadRefused
        case .rowUnreadable: .rowUnreadable
        case .fileDownloadFailed: .fileDownloadFailed
        case .signInFailed: .signInFailed
        case .storeOpenFailed: .storeOpenFailed
        case .storeSaveFailed: .storeSaveFailed
        case .crash: .crash
        case .hang: .hang
        case .coldLaunch: .coldLaunch
        case .syncDurations: .syncDurations
        case .librarySize: .librarySize
        case .hangs: .hangs
        }
    }

    typealias Properties = [TelemetryProperty: TelemetryValue]

    var properties: Properties {
        switch self {
        case .appOpened(let launch, let signedIn): [.launch: .flag(launch), .signedIn: .flag(signedIn)]
        case .signedIn(let m), .signedUp(let m): [.method: .word(m)]
        case .keyReady(let how): [.how: .word(how)]
        case .gateShown(let screen): [.screen: .word(screen)]
        case .firstNoteCreated, .firstAIEditSeen: [:]
        case .firstSync(let ms): [.durationMS: .number(Self.rounded(ms))]
        case .aiConnected(let kind): [.kind: .word(kind)]
        case .keychainFailed(let item, let operation, let status):
            [.item: .word(item), .operation: .word(operation), .status: .number(status)]
        case .keyStartup(let outcome, let hadKey, let store):
            [.outcome: .word(outcome), .hadKey: .flag(hadKey), .store: .word(store)]
        case .syncFailed(let f, let runs): Self.failure(f).merging([.runs: .number(min(runs, 1000))]) { a, _ in a }
        case .uploadRefused(let what, let f): Self.failure(f).merging([.what: .word(what)]) { a, _ in a }
        case .rowUnreadable(let what): [.what: .word(what)]
        case .fileDownloadFailed(let f): Self.failure(f)
        case .signInFailed(let method, let kind, let status):
            Self.with([.method: .word(method), .kind: .word(kind)], .status, status)
        case .storeOpenFailed(let domain, let code), .storeSaveFailed(let domain, let code):
            [.domain: .word(domain), .code: .number(code)]
        case .crash(let type, let code, let signal, let version, let build, let stack):
            Self.with(Self.with(Self.with(Self.stack(stack, version, build), .exceptionType, type), .exceptionCode, code), .signal, signal)
        case .hang(let ms, let version, let build, let stack):
            Self.stack(stack, version, build).merging([.durationMS: .number(Self.rounded(ms))]) { a, _ in a }
        case .coldLaunch(let ms): [.durationMS: .number(Self.rounded(ms))]
        case .syncDurations(let t):
            [.under250ms: .number(t.under250ms), .under1s: .number(t.under1s), .under4s: .number(t.under4s),
             .under15s: .number(t.under15s), .over15s: .number(t.over15s), .failed: .number(t.failed)]
        case .librarySize(let size): [.notes: .word(size)]
        case .hangs(let count): [.count: .number(count)]
        }
    }

    /// Errors go out soon after they happen; the rest waits for the next batch.
    var isError: Bool {
        switch self {
        case .keychainFailed, .keyStartup, .syncFailed, .uploadRefused, .rowUnreadable, .fileDownloadFailed, .signInFailed,
             .storeOpenFailed, .storeSaveFailed, .crash, .hang: true
        default: false
        }
    }

    /// Sent once for each launch of the app, however often it happens: a failure that repeats on
    /// every poll or every sync says the same thing each time.
    var oncePerLaunch: Bool {
        switch self {
        case .keychainFailed, .keyStartup, .syncFailed, .uploadRefused, .rowUnreadable, .fileDownloadFailed,
             .storeSaveFailed, .gateShown, .librarySize, .coldLaunch: true
        default: false
        }
    }

    /// Sent once for an install (until sign-out or Delete Account gives it a new identifier).
    var oncePerInstall: Bool {
        switch self {
        case .firstNoteCreated, .firstSync, .firstAIEditSeen: true
        default: false
        }
    }

    /// One of every event, for the tests that read what would be sent.
    static let samples: [TelemetryEvent] = [
        .appOpened(launch: true, signedIn: true), .signedIn(.apple), .signedUp(.email), .keyReady(.recoveryKey),
        .gateShown(.addDevice), .firstNoteCreated, .firstSync(milliseconds: 1234), .aiConnected(.claude), .firstAIEditSeen,
        .keychainFailed(item: .keySynced, operation: .save, status: -34018),
        .keyStartup(.wait, hadKey: true, store: .keychain),
        .syncFailed(FailureSummary(kind: .database, status: nil, code: .rowSecurity, hint: .wrongKey), runs: 3),
        .uploadRefused(.note, FailureSummary(kind: .database, status: nil, code: .tooBig)),
        .rowUnreadable(.note), .fileDownloadFailed(FailureSummary(kind: .storage, status: 404)),
        .signInFailed(.email, .wrongCredentials, status: 400), .storeOpenFailed(.cocoa, code: 134110),
        .storeSaveFailed(.cocoa, code: 133020),
        .crash(exceptionType: 1, exceptionCode: 0, signal: 11, version: VersionNumber("1.3"), build: VersionNumber("2610101200"),
               stack: StackSummary(binary: UUID(), offsets: [4096, 8192], frames: 2)),
        .hang(milliseconds: 2400, version: VersionNumber("1.3"), build: VersionNumber("2610101200"),
              stack: StackSummary(binary: UUID(), offsets: [4096], frames: 1)),
        .coldLaunch(milliseconds: 420), .syncDurations(SyncTimings(under250ms: 4, under1s: 2, failed: 1)),
        .librarySize(.upTo100), .hangs(count: 2),
    ]

    // MARK: Pieces

    /// Durations to the nearest 10 ms, at most ten minutes.
    private static func rounded(_ ms: Int) -> Int { min(max(0, ms), 600_000) / 10 * 10 }

    private static func with(_ p: Properties, _ key: TelemetryProperty, _ n: Int?) -> Properties {
        guard let n else { return p }
        var p = p
        p[key] = .number(n)
        return p
    }

    private static func failure(_ f: FailureSummary) -> Properties {
        with([.kind: .word(f.kind), .code: .word(f.code), .hint: .word(f.hint)], .status, f.status)
    }

    private static func stack(_ s: StackSummary, _ version: VersionNumber?, _ build: VersionNumber?) -> Properties {
        var p: Properties = [.frames: .number(s.frames)]
        if let version { p[.crashedVersion] = .version(version) }
        if let build { p[.crashedBuild] = .version(build) }
        if let binary = s.binary { p[.binary] = .id(binary) }
        for (slot, offset) in zip(TelemetryProperty.frameSlots, s.offsets) { p[slot] = .number(offset) }
        return p
    }
}

/// How long this launch's syncs took, counted into ranges and sent as one event.
struct SyncTimings: Equatable, Sendable {
    var under250ms = 0, under1s = 0, under4s = 0, under15s = 0, over15s = 0, failed = 0

    /// How many make an event of their own while the app is still running.
    static let enough = 20

    var count: Int { under250ms + under1s + under4s + under15s + over15s + failed }
    var isEmpty: Bool { count == 0 }

    mutating func add(seconds: TimeInterval, ok: Bool) {
        guard ok else { failed += 1; return }
        switch seconds {
        case ..<0.25: under250ms += 1
        case ..<1: under1s += 1
        case ..<4: under4s += 1
        case ..<15: under15s += 1
        default: over15s += 1
        }
    }
}
