import Foundation
import Supabase
import Testing
@testable import Pane

/// What a test's Telemetry would have sent: every batch body, and the answer to give.
final class StubTransport: TelemetryTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var sent: [Data] = []
    var status = 200
    var offline = false

    func send(_ body: Data, to url: URL) async throws -> Int {
        try lock.withLock {
            if offline { throw URLError(.notConnectedToInternet) }
            sent.append(body)
            return status
        }
    }

    var bodies: [Data] { lock.withLock { sent } }
    /// Every event in every batch sent so far.
    var events: [[String: Any]] {
        bodies.flatMap { body in ((try? JSONSerialization.jsonObject(with: body)) as? [String: Any])?["batch"] as? [[String: Any]] ?? [] }
    }
}

private let testContext = TelemetryContext(appVersion: VersionNumber("1.3"), appBuild: VersionNumber("2610101200"), osVersion: VersionNumber("26.1.0"),
                                           platform: .macos, deviceClass: .mac, channel: .release, distribution: .direct)

private func makeTelemetry(_ transport: StubTransport = StubTransport(), store: TelemetryQueueStore = MemoryTelemetryQueue(),
                           defaults: UserDefaults = TestDefaults()) -> (Telemetry, StubTransport) {
    let config = TelemetryConfig(key: "phc_test", host: TelemetryGate.defaultHost, context: testContext)
    return (Telemetry(config: config, transport: transport, store: store, defaults: defaults), transport)
}

private func names(_ events: [[String: Any]]) -> [String] { events.compactMap { $0["event"] as? String } }

// MARK: The privacy line

/// Nothing a person wrote, and nothing that names them, can be in what the app sends.
@Suite struct TelemetryPrivacyTests {
    /// The envelope PostHog's batch format needs, besides the event's own properties.
    static let envelopeKeys: Set<String> = ["api_key", "batch", "event", "distinct_id", "uuid", "timestamp", "properties",
                                            "$process_person_profile", "$geoip_disable", "$lib"]

    static var allowedKeys: Set<String> {
        envelopeKeys.union(TelemetryProperty.allCases.map(\.rawValue)).union(TelemetryContext.Key.allCases.map(\.rawValue))
    }

    /// Every key and every string value under `json`, with where it was found.
    static func strings(in json: Any, at path: String = "") -> (keys: [String], values: [(path: String, value: String)]) {
        var keys: [String] = [], values: [(String, String)] = []
        switch json {
        case let d as [String: Any]:
            for (k, v) in d {
                keys.append(k)
                let inner = strings(in: v, at: path + "/" + k)
                keys += inner.keys
                values += inner.values
            }
        case let a as [Any]:
            for v in a {
                let inner = strings(in: v, at: path)
                keys += inner.keys
                values += inner.values
            }
        case let s as String: values.append((path, s))
        default: break
        }
        return (keys, values)
    }

    static func isAllowed(_ value: String, at path: String) -> Bool {
        if path.hasSuffix("/api_key") { return value == "phc_test" }
        if path.hasSuffix("/timestamp") { return (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value)) != nil }
        if path.hasSuffix("/$lib") { return value == TelemetryBody.library }
        return TelemetryWords.all.contains(value) || UUID(uuidString: value) != nil || VersionNumber(value) != nil
    }

    @Test func thereIsASampleOfEveryEvent() {
        #expect(Set(TelemetryEvent.samples.map(\.name)) == Set(TelemetryEvent.Name.allCases))
    }

    @Test func everyStringInABatchIsOnTheList() async throws {
        let (telemetry, transport) = makeTelemetry()
        telemetry.identify(UUID())
        for event in TelemetryEvent.samples { telemetry.record(event) }
        await telemetry.flush()
        #expect(transport.events.count == TelemetryEvent.samples.count)
        for body in transport.bodies {
            let found = Self.strings(in: try JSONSerialization.jsonObject(with: body))
            for key in found.keys { #expect(Self.allowedKeys.contains(key), "unexpected key \(key)") }
            for (path, value) in found.values { #expect(Self.isAllowed(value, at: path), "\(path) holds “\(value)”") }
        }
    }

    @Test func everyEventSaysNoProfileAndNoLocation() async {
        let (telemetry, transport) = makeTelemetry()
        for event in TelemetryEvent.samples { telemetry.record(event) }
        await telemetry.flush()
        for e in transport.events {
            let p = e["properties"] as? [String: Any]
            #expect(p?["$process_person_profile"] as? Bool == false)
            #expect(p?["$geoip_disable"] as? Bool == true)
            #expect(p?["$set"] == nil && p?["$set_once"] == nil && e["$set"] == nil)
        }
    }

    /// Text as a note holds it, pushed through every place that takes a string from outside the
    /// app's own enums: error messages, server codes and hints, an AI's name, version strings.
    @Test func noteTextNeverReachesABatch() async throws {
        let secrets = ["Groceries for Lisa", "Call the dentist on 070 123 45 67", "passport-scan.pdf", "lisa@example.com",
                       "ABCD-EFGH-IJKL-MNOP", "pane_0123456789abcdef"]
        let (telemetry, transport) = makeTelemetry()
        let response = HTTPURLResponse(url: URL(string: "https://example.com/Groceries")!, statusCode: 422, httpVersion: nil, headerFields: nil)!
        for s in secrets {
            let failures: [Error] = [
                PostgrestError(details: s, hint: s, code: s, message: s),
                StorageError(statusCode: s, message: s, error: s),
                AuthError.api(message: s, errorCode: .init(s), underlyingData: Data(s.utf8), underlyingResponse: response),
                NSError(domain: s, code: 7, userInfo: [NSLocalizedDescriptionKey: s, NSFilePathErrorKey: "/Users/lisa/" + s]),
                CocoaError(.fileWriteNoPermission, userInfo: [NSFilePathErrorKey: s]),
            ]
            for error in failures {
                let summary = FailureSummary(error)
                telemetry.record(.syncFailed(summary, runs: 3))
                telemetry.record(.uploadRefused(.note, summary))
                telemetry.record(.fileDownloadFailed(summary))
                let (domain, code) = ErrorDomain.of(error)
                telemetry.record(.storeSaveFailed(domain, code: code))
                if let f = SignInFailureKind.of(error) { telemetry.record(.signInFailed(.email, f.kind, status: f.status)) }
            }
            telemetry.record(.aiConnected(AIKind(verified: s)))
            telemetry.record(.crash(exceptionType: 1, exceptionCode: nil, signal: 11, version: VersionNumber(s), build: VersionNumber(s),
                                    stack: StackReader.summary(Data("{\"callStacks\":[{\"callStackRootFrames\":[{\"binaryName\":\"\(s)\",\"binaryUUID\":\"\(s)\",\"offsetIntoBinaryTextSegment\":1}]}]}".utf8), binary: s)))
            #expect(ServerCode(s) == .other && ServerHint(s) == .other)
            #expect(VersionNumber(s) == nil)
        }
        await telemetry.flush()
        #expect(!transport.bodies.isEmpty)
        for body in transport.bodies {
            let text = String(decoding: body, as: UTF8.self)
            for s in secrets { #expect(!text.contains(s), "“\(s)” reached a batch") }
            #expect(!text.contains("lisa") && !text.contains("Lisa") && !text.contains("example.com"))
            let found = Self.strings(in: try JSONSerialization.jsonObject(with: body))
            for (path, value) in found.values { #expect(Self.isAllowed(value, at: path), "\(path) holds “\(value)”") }
        }
    }

    @Test func aVersionNumberIsOnlyDigitsAndDots() {
        #expect(VersionNumber("1.3")?.text == "1.3")
        #expect(VersionNumber("2610101200")?.text == "2610101200")
        #expect(VersionNumber("26.1.0")?.text == "26.1.0")
        for bad in ["", "1.3 beta", "v1", "1..2", "1.2.3.4.5", "Budget 2026", "12345678901", "1.3\n"] { #expect(VersionNumber(bad) == nil, "\(bad)") }
        #expect(VersionNumber(nil) == nil)
    }

    /// docs/Technical/app-telemetry.md, copied into the test bundle (project.yml): every event,
    /// property and word the code can send is written there.
    @Test func thePageListsEverythingThatCanBeSent() throws {
        let url = try #require(Bundle(for: TelemetryDocToken.self).url(forResource: "app-telemetry", withExtension: "md"))
        let page = try String(contentsOf: url, encoding: .utf8)
        // frame_1 to frame_6 are written as a range.
        let ranged = Set(TelemetryProperty.frameSlots.dropFirst().dropLast().map(\.rawValue))
        let all = TelemetryWords.all.union(TelemetryProperty.allCases.map(\.rawValue)).union(TelemetryContext.Key.allCases.map(\.rawValue)).subtracting(ranged)
        for word in all.sorted() { #expect(page.contains("`\(word)`"), "docs/Technical/app-telemetry.md doesn't mention `\(word)`") }
    }
}

private final class TelemetryDocToken {}

// MARK: The client

@Suite struct TelemetryClientTests {
    @Test func onlyAReleaseBuildWithAKeySends() {
        func sends(key: String? = "phc_abc", channel: BuildChannel = .release, simulator: Bool = false, arguments: [String] = [],
                   environment: [String: String] = [:]) -> Bool {
            TelemetryGate.sends(key: TelemetryGate.key(key), channel: channel, simulator: simulator, arguments: arguments, environment: environment)
        }
        #expect(sends())
        #expect(sends(channel: .beta))
        #expect(!sends(channel: .debug))
        #expect(!sends(simulator: true))
        #expect(!sends(key: nil) && !sends(key: "") && !sends(key: "$(PANE_POSTHOG_KEY)") && !sends(key: "not-a-key"))
        #expect(!sends(arguments: ["-uitest"]) && !sends(arguments: ["-synctest"]) && !sends(arguments: ["-local"]))
        #expect(!sends(environment: ["XCTestConfigurationFilePath": "/tmp/x"]))
        #expect(TelemetryGate.host(nil) == TelemetryGate.defaultHost && TelemetryGate.host("http://plain.example") == TelemetryGate.defaultHost)
    }

    /// The app's own, in a test run: never started, so nothing is recorded anywhere.
    @Test func theSharedOneIsInertInTests() {
        #expect(!Telemetry.shared.sends && !Telemetry.shared.isOn)
        Telemetry.shared.record(.firstNoteCreated)
        #expect(Telemetry.shared.waiting.isEmpty)
    }

    @Test func aBatchIsPostHogsFormat() async throws {
        let (telemetry, transport) = makeTelemetry()
        let account = UUID()
        telemetry.identify(account)
        telemetry.record(.keychainFailed(item: .keySynced, operation: .save, status: -34018))
        await telemetry.flush()
        let sent = try #require(transport.bodies.first)
        let body = try #require(JSONSerialization.jsonObject(with: sent) as? [String: Any])
        #expect(body["api_key"] as? String == "phc_test")
        let event = try #require((body["batch"] as? [[String: Any]])?.first)
        #expect(event["event"] as? String == "keychain_failed")
        #expect(event["distinct_id"] as? String == account.uuidString.lowercased())
        let p = try #require(event["properties"] as? [String: Any])
        #expect(p["status"] as? Int == -34018 && p["item"] as? String == "key_synced" && p["operation"] as? String == "save")
        #expect(p["app_version"] as? String == "1.3" && p["platform"] as? String == "macos" && p["distribution"] as? String == "direct")
        #expect(telemetry.waiting.isEmpty)
    }

    @Test func offNothingIsKeptOrSent() async {
        let defaults = TestDefaults()
        defaults.set(false, forKey: Telemetry.consentKey)
        let store = MemoryTelemetryQueue([Data("{\"event\":\"left_over\"}".utf8)])
        let (telemetry, transport) = makeTelemetry(store: store, defaults: defaults)
        #expect(!telemetry.isOn && telemetry.sends)
        #expect(store.load().isEmpty, "what an earlier run left is dropped")
        telemetry.record(.appOpened(launch: true, signedIn: false))
        telemetry.syncFinished(seconds: 1, ok: true)
        await telemetry.resigning(quitting: true)
        #expect(telemetry.waiting.isEmpty && transport.bodies.isEmpty)
    }

    @Test func turningItOffDropsWhatWasWaiting() async {
        let store = MemoryTelemetryQueue()
        let (telemetry, transport) = makeTelemetry(store: store)
        telemetry.record(.signedIn(.apple))
        #expect(telemetry.waiting.count == 1 && store.load().count == 1)
        telemetry.consent = false
        #expect(telemetry.waiting.isEmpty && store.load().isEmpty)
        telemetry.record(.signedIn(.apple))
        await telemetry.flush()
        #expect(transport.bodies.isEmpty)
        telemetry.consent = true
        telemetry.record(.signedIn(.google))
        await telemetry.flush()
        #expect(names(transport.events) == ["signed_in"])
    }

    @Test func theQueueHasACapAndDropsTheNewest() {
        let (telemetry, _) = makeTelemetry(StubTransport())
        for i in 0 ..< Telemetry.cap + 25 { telemetry.record(.signInFailed(.email, .other, status: i)) }
        let waiting = telemetry.waiting
        #expect(waiting.count == Telemetry.cap)
        #expect((waiting.last?["properties"] as? [String: Any])?["status"] as? Int == Telemetry.cap - 1)
    }

    @Test func whatCouldNotBeSentWaitsAndWhatWasRefusedGoes() async {
        let transport = StubTransport()
        let (telemetry, _) = makeTelemetry(transport)
        telemetry.record(.signedIn(.email))
        transport.offline = true
        await telemetry.flush()
        #expect(telemetry.waiting.count == 1, "offline: kept")
        transport.offline = false
        transport.status = 503
        await telemetry.flush()
        #expect(telemetry.waiting.count == 1, "the server failed: kept")
        transport.status = 429
        await telemetry.flush()
        #expect(telemetry.waiting.count == 1)
        transport.status = 400
        await telemetry.flush()
        #expect(telemetry.waiting.isEmpty, "refused as malformed: no retry would change that")
        #expect(Telemetry.settled(200) && Telemetry.settled(401) && !Telemetry.settled(408) && !Telemetry.settled(500) && !Telemetry.settled(0))
    }

    @Test func aLongQueueGoesOutInBatches() async {
        let (telemetry, transport) = makeTelemetry()
        for i in 0 ..< Telemetry.batch * 2 + 10 { telemetry.record(.signInFailed(.email, .other, status: i)) }
        await telemetry.flush()
        #expect(transport.bodies.count == 3 && transport.events.count == Telemetry.batch * 2 + 10)
        #expect(telemetry.waiting.isEmpty)
    }

    @Test func whatACrashLeftBehindGoesOutNextLaunch() async {
        let store = MemoryTelemetryQueue(), defaults = TestDefaults()
        let (first, _) = makeTelemetry(store: store, defaults: defaults)
        first.record(.storeOpenFailed(.cocoa, code: 134110))
        // The app stops here; the next launch reads the same file.
        let (second, transport) = makeTelemetry(store: store, defaults: defaults)
        await second.flush()
        #expect(names(transport.events) == ["store_open_failed"])
        #expect(store.load().isEmpty)
    }

    @Test func theFileKeepsOneEventALine() throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "telemetry-\(UUID()).jsonl")
        defer { try? FileManager.default.removeItem(at: url) }
        let file = FileTelemetryQueue(url: url)
        #expect(file.load().isEmpty)
        let events = [TelemetryEvent.firstNoteCreated, .signedIn(.apple)].map { TelemetryBody.event($0, id: "x", at: .now, context: testContext) }
        file.save(events)
        #expect(file.load() == events)
        try Data("not json\n".utf8).write(to: url)
        #expect(file.load().isEmpty, "a damaged line is left out")
        file.save([])
        #expect(!FileManager.default.fileExists(atPath: url.path))
    }

    @Test func aFailureThatRepeatsIsSaidOnceALaunch() {
        let (telemetry, _) = makeTelemetry()
        for _ in 0 ..< 50 { telemetry.record(.keychainFailed(item: .keySynced, operation: .read, status: -25308)) }
        telemetry.record(.keychainFailed(item: .keySynced, operation: .save, status: -34018))
        telemetry.record(.gateShown(.addDevice)); telemetry.record(.gateShown(.addDevice)); telemetry.record(.gateShown(.recovery))
        #expect(names(telemetry.waiting) == ["keychain_failed", "keychain_failed", "gate_shown", "gate_shown"])
    }

    @Test func firstsAreSaidOnceAnInstall() {
        let defaults = TestDefaults(), store = MemoryTelemetryQueue()
        let (telemetry, _) = makeTelemetry(store: store, defaults: defaults)
        telemetry.record(.firstNoteCreated); telemetry.record(.firstNoteCreated); telemetry.record(.firstAIEditSeen)
        #expect(names(telemetry.waiting) == ["first_note_created", "first_ai_edit_seen"])
        // The next launch remembers.
        let (again, _) = makeTelemetry(store: MemoryTelemetryQueue(), defaults: defaults)
        again.record(.firstNoteCreated)
        #expect(again.waiting.isEmpty)
    }

    @Test func eventsAreFromTheInstallUntilSignedInThenFromTheAccount() throws {
        let defaults = TestDefaults()
        let (telemetry, _) = makeTelemetry(defaults: defaults)
        func lastID() -> String? { telemetry.waiting.last?["distinct_id"] as? String }
        telemetry.record(.appOpened(launch: true, signedIn: false))
        let install = try #require(lastID())
        #expect(UUID(uuidString: install) != nil)
        telemetry.record(.signInFailed(.email, .network, status: nil))
        #expect(lastID() == install, "the same install id until sign-in")
        let account = UUID()
        telemetry.identify(account)
        telemetry.record(.signedIn(.email))
        #expect(lastID() == account.uuidString.lowercased())
        telemetry.record(.firstNoteCreated)

        telemetry.signedOut()
        telemetry.record(.appOpened(launch: false, signedIn: false))
        let after = try #require(lastID())
        #expect(after != install && after != account.uuidString.lowercased(), "a new id after signing out")
        #expect(telemetry.waiting.count == 5, "what was waiting still goes out")
        telemetry.record(.firstNoteCreated)
        #expect(telemetry.waiting.count == 6, "the firsts start over with the new id")
        // Signed out already: nothing more to reset.
        telemetry.signedOut()
        telemetry.record(.signInFailed(.email, .network, status: 1))
        #expect(lastID() == after)
    }

    @Test func deletingTheAccountDropsItsWaitingEvents() async throws {
        let store = MemoryTelemetryQueue()
        let (telemetry, transport) = makeTelemetry(store: store)
        let account = UUID()
        telemetry.identify(account)
        telemetry.record(.signedIn(.apple))
        telemetry.record(.firstNoteCreated)
        telemetry.accountDeleted()
        #expect(telemetry.waiting.isEmpty && store.load().isEmpty)
        telemetry.record(.appOpened(launch: false, signedIn: false))
        await telemetry.flush()
        let ids = transport.events.compactMap { $0["distinct_id"] as? String }
        #expect(ids.count == 1 && ids[0] != account.uuidString.lowercased())
        let sent = try #require(transport.bodies.first)
        #expect(!String(decoding: sent, as: UTF8.self).contains(account.uuidString.lowercased()))
    }

    @Test func theLaunchIsTimedOnlyWhenItGoesStraightToTheNotes() {
        let clock = Clock()
        let config = TelemetryConfig(key: "phc_test", host: TelemetryGate.defaultHost, context: testContext)
        let telemetry = Telemetry(config: config, transport: StubTransport(), defaults: TestDefaults(), now: { clock.now })
        telemetry.launched(opensNotes: true)
        clock.advance(0.437)
        telemetry.notesShown()
        telemetry.notesShown()
        #expect(names(telemetry.waiting) == ["cold_launch"])
        #expect((telemetry.waiting[0]["properties"] as? [String: Any])?["duration_ms"] as? Int == 430)

        let gated = Telemetry(config: config, transport: StubTransport(), defaults: TestDefaults(), now: { clock.now })
        gated.launched(opensNotes: false)
        gated.notesShown()
        #expect(gated.waiting.isEmpty, "signing in first isn't a launch time")

        let late = Telemetry(config: config, transport: StubTransport(), defaults: TestDefaults(), now: { clock.now })
        late.launched(opensNotes: true)
        clock.advance(Telemetry.longestLaunch + 1)
        late.notesShown()
        #expect(late.waiting.isEmpty, "started in the background, opened later")
    }

    @Test func appOpenedIsOnceALaunchAndOnceForEachNewDay() {
        let clock = Clock()
        let config = TelemetryConfig(key: "phc_test", host: TelemetryGate.defaultHost, context: testContext)
        let telemetry = Telemetry(config: config, transport: StubTransport(), defaults: TestDefaults(), now: { clock.now })
        telemetry.becameActive(signedIn: true)
        telemetry.becameActive(signedIn: true)
        clock.advance(3600)
        telemetry.becameActive(signedIn: true)
        #expect(telemetry.waiting.count == 1)
        clock.advance(86400)
        telemetry.becameActive(signedIn: true)
        #expect(telemetry.waiting.count == 2)
        let flags = telemetry.waiting.compactMap { ($0["properties"] as? [String: Any])?["launch"] as? Bool }
        #expect(flags == [true, false])
    }

    @Test func syncTimingsGoOutAsOneEvent() async {
        let (telemetry, transport) = makeTelemetry()
        for s in [0.1, 0.2, 0.6, 3, 20] { telemetry.syncFinished(seconds: s, ok: true) }
        telemetry.syncFinished(seconds: 0, ok: false)
        await telemetry.resigning(quitting: false)
        #expect(transport.events.isEmpty, "too few to be worth an event while the app is still running")
        await telemetry.resigning(quitting: true)
        let p = transport.events.first?["properties"] as? [String: Any]
        #expect(names(transport.events) == ["sync_durations"])
        #expect(p?["under_250ms"] as? Int == 2 && p?["under_1s"] as? Int == 1 && p?["under_4s"] as? Int == 1
            && p?["under_15s"] as? Int == 0 && p?["over_15s"] as? Int == 1 && p?["failed"] as? Int == 1)
        await telemetry.resigning(quitting: true)
        #expect(transport.events.count == 1, "counted once")
        for _ in 0 ..< SyncTimings.enough { telemetry.syncFinished(seconds: 0.1, ok: true) }
        await telemetry.resigning(quitting: false)
        #expect(transport.events.count == 2)
    }

    final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var date = Date(timeIntervalSince1970: 1_800_000_000)
        var now: Date { lock.withLock { date } }
        func advance(_ seconds: TimeInterval) { lock.withLock { date += seconds } }
    }
}

// MARK: Errors as codes

@Suite struct TelemetryFailureTests {
    @Test func anErrorBecomesAKindAndCodes() {
        #expect(FailureSummary(URLError(.notConnectedToInternet)) == FailureSummary(kind: .offline, status: -1009))
        #expect(FailureSummary(URLError(.timedOut)) == FailureSummary(kind: .timeout, status: -1001))
        #expect(FailureSummary(URLError(.cannotFindHost)).kind == .network)
        #expect(FailureSummary(URLError(.cancelled)).kind == .cancelled)
        #expect(FailureSummary(PostgrestError(hint: "wrong_key", code: "42501", message: "new row violates policy"))
            == FailureSummary(kind: .database, status: nil, code: .rowSecurity, hint: .wrongKey))
        #expect(FailureSummary(PostgrestError(code: "PT413", message: "“Budget” is too big"))
            == FailureSummary(kind: .database, status: nil, code: .tooBig))
        #expect(FailureSummary(PostgrestError(hint: "something new", code: "XX000", message: "")).code == .other)
        #expect(FailureSummary(StorageError(statusCode: "413", message: "The object exceeded the maximum allowed size", error: "Payload too large"))
            == FailureSummary(kind: .storage, status: 413))
        #expect(FailureSummary(FunctionsError.httpError(code: 503, data: Data())) == FailureSummary(kind: .http, status: 503))
        #expect(FailureSummary(Wire.Unsealable()).kind == .crypto && FailureSummary(E2EE.Failure.wrongKey).kind == .crypto)
        #expect(FailureSummary(CocoaError(.fileWriteOutOfSpace)) == FailureSummary(kind: .file, status: 640))
        #expect(FailureSummary(CancellationError()).kind == .cancelled)
        struct Odd: Error {}
        #expect(FailureSummary(Odd()) == FailureSummary(kind: .other, status: nil))
    }

    @Test func aSignInFailureBecomesAKind() {
        func api(_ code: String, _ status: Int) -> AuthError {
            .api(message: "lisa@example.com isn't allowed", errorCode: .init(code), underlyingData: Data(),
                 underlyingResponse: HTTPURLResponse(url: URL(string: "https://example.com")!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }
        func kind(_ error: Error) -> SignInFailureKind? { SignInFailureKind.of(error)?.kind }
        func status(_ error: Error) -> Int? { SignInFailureKind.of(error)?.status }
        #expect(kind(api("invalid_credentials", 400)) == .wrongCredentials && status(api("invalid_credentials", 400)) == 400)
        #expect(kind(api("email_not_confirmed", 400)) == .emailNotConfirmed)
        #expect(kind(api("over_email_send_rate_limit", 429)) == .rateLimited && status(api("over_email_send_rate_limit", 429)) == 429)
        #expect(kind(api("user_already_exists", 422)) == .alreadyExists)
        #expect(kind(api("otp_expired", 403)) == .badCode)
        #expect(kind(api("unexpected_failure", 500)) == .server)
        #expect(kind(api("something_new", 400)) == .other)
        #expect(kind(URLError(.timedOut)) == .network && status(URLError(.timedOut)) == nil)
        #expect(SignInFailureKind.of(CancellationError()) == nil, "closing the sheet isn't a failure")
    }

    @Test func anAccountMadeJustNowSignedUp() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(Backend.signInEvent(.google, created: now.addingTimeInterval(-20), now: now) == .signedUp(.google))
        #expect(Backend.signInEvent(.apple, created: now.addingTimeInterval(-86400), now: now) == .signedIn(.apple))
    }

    @Test func aFailureIsReportedOnceItLasts() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        var streak = FailureStreak()
        let quick = [0, 1, 2].map { streak.failed(at: start.addingTimeInterval($0)) }
        #expect(quick == [false, false, false], "three tries in two seconds is a tunnel")
        let lasting = streak.failed(at: start.addingTimeInterval(61))
        #expect(lasting && streak.runs == 4)
        let again = streak.failed(at: start.addingTimeInterval(120))
        #expect(!again, "said once")
        streak.succeeded()
        let afterwards = [200, 300].map { streak.failed(at: start.addingTimeInterval($0)) }
        #expect(afterwards == [false, false], "a minute, but two tries")
    }

    @Test func wordsFromOutsideFallBackToOther() {
        #expect(AIKind(verified: "Claude") == .claude && AIKind(verified: "Claude Code") == .claude)
        #expect(AIKind(verified: "ChatGPT") == .chatgpt && AIKind(verified: "Codex") == .chatgpt)
        #expect(AIKind(verified: nil) == .other && AIKind(verified: "Lisa's Notes Bot") == .other && AIKind(verified: "Incredible") == .other)
        #expect(ServerCode(nil) == .none && ServerCode("") == .none && ServerCode("PT429") == .tooFast)
        #expect(ServerHint(nil) == .none && ServerHint("not_yours") == .notYours)
        #expect([0, 1, 10, 11, 100, 101, 1000, 1001].map { LibrarySize(notes: $0) }
            == [.none, .upTo10, .upTo10, .upTo100, .upTo100, .upTo1000, .upTo1000, .over1000])
        #expect(SessionStorage.item("sb-abc-auth-token") == .session && SessionStorage.item("device-identity") == .deviceIdentity)
        #expect(SessionStorage.item("data-key-synced-\(UUID().uuidString.lowercased())") == .keySynced)
        #expect(SessionStorage.item("data-key-local-\(UUID().uuidString.lowercased())") == .keyLocal)
    }

    @Test func aStoreErrorIsItsDomainAndNumber() {
        let migration = ErrorDomain.of(NSError(domain: NSCocoaErrorDomain, code: 134100))
        #expect(migration.domain == .cocoa && migration.code == 134100)
        let disk = ErrorDomain.of(NSError(domain: "NSSQLiteErrorDomain", code: 13))
        #expect(disk.domain == .sqlite && disk.code == 13)
        let odd = ErrorDomain.of(NSError(domain: "Lisa's folder", code: 5))
        #expect(odd.domain == .other && odd.code == 5)
    }

    /// A crash report's stack in MetricKit's JSON: only the app's own frames are kept, as offsets.
    @Test func aStackIsCutDownToTheAppsOwnFrames() throws {
        let id = UUID()
        func frame(_ name: String, _ offset: Int, _ sub: [String: Any]? = nil) -> [String: Any] {
            var f: [String: Any] = ["binaryName": name, "binaryUUID": name == "Pinto Notes" ? id.uuidString : UUID().uuidString,
                                    "offsetIntoBinaryTextSegment": offset, "address": 4_300_000_000 + offset, "sampleCount": 1]
            if let sub { f["subFrames"] = [sub] }
            return f
        }
        let attributed = frame("libswiftCore.dylib", 10, frame("Pinto Notes", 111, frame("SwiftUI", 20, frame("Pinto Notes", 222, frame("AppKit", 30)))))
        let tree: [String: Any] = ["callStackTree": true, "callStacks": [
            ["threadAttributed": false, "callStackRootFrames": [frame("Pinto Notes", 999)]],
            ["threadAttributed": true, "callStackRootFrames": [attributed]],
        ]]
        let summary = StackReader.summary(try JSONSerialization.data(withJSONObject: tree), binary: "Pinto Notes")
        #expect(summary == StackSummary(binary: id, offsets: [111, 222], frames: 2))

        // A deep stack keeps both ends.
        var deep: [String: Any]? = nil
        for i in (1 ... 20).reversed() { deep = frame("Pinto Notes", i, deep) }
        let long = StackReader.summary(try JSONSerialization.data(withJSONObject: ["callStacks": [["callStackRootFrames": [deep!]]]]), binary: "Pinto Notes")
        #expect(long.offsets == [1, 2, 3, 4, 17, 18, 19, 20] && long.frames == 20)
        // Wrapped, as the tree is inside a whole payload.
        let wrapped = StackReader.summary(try JSONSerialization.data(withJSONObject: ["callStackTree": tree]), binary: "Pinto Notes")
        #expect(wrapped == summary)
        #expect(StackReader.summary(Data("nonsense".utf8), binary: "Pinto Notes") == StackSummary())
    }
}

// MARK: The key's startup, reported

/// What the 1.1.2 Mac download did without anyone knowing: the key was made, never kept, and the
/// next launch had none. Now each step says so.
@MainActor @Suite(.serialized) struct KeyReportTests {
    typealias FakeKeychain = KeyStartupTests.FakeKeychain
    typealias FakeServer = KeyStartupTests.FakeServer

    let user = UUID()
    let server = FakeServer()
    let defaults = TestDefaults()

    func crypto(_ keychain: FakeKeychain, _ telemetry: Telemetry) -> AccountCrypto {
        AccountCrypto(store: keychain, defaults: defaults, telemetry: telemetry, sleep: { _ in throw CancellationError() })
    }

    func outcomes(_ telemetry: Telemetry) -> [String] {
        telemetry.waiting.filter { $0["event"] as? String == "key_startup" }
            .compactMap { e in (e["properties"] as? [String: Any]).map { "\($0["outcome"] as? String ?? "")/\($0["had_key"] as? Bool == true ? 1 : 0)" } }
    }

    @Test func aDeviceThatLostItsKeySaysSo() async {
        let cloud = KeyStartupTests.Cloud()
        // First launch: the account's key is made here.
        let (first, _) = makeTelemetry()
        let keychain = FakeKeychain(cloud: cloud, autoReceive: false)
        let a = crypto(keychain, first)
        await a.attach(account: user, server: server)
        #expect(a.phase == .ready)
        #expect(names(first.waiting) == ["key_startup", "key_ready"])
        #expect(outcomes(first) == ["create/0"])
        #expect((first.waiting.last?["properties"] as? [String: Any])?["how"] as? String == "created")

        // The save never stuck (the Mac download's -34018): the next launch has no key.
        keychain.synced = [:]; keychain.pending = [:]; cloud.keys = [:]
        let (second, _) = makeTelemetry()
        let b = crypto(keychain, second)
        await b.attach(account: user, server: server)
        #expect(b.phase == .waiting)
        #expect(outcomes(second) == ["wait/1"], "it had the key before, and now waits for one")
    }

    @Test func howTheKeyArrivedIsSaid() async throws {
        let cloud = KeyStartupTests.Cloud()
        let k = StoredKey.generate()
        server.row = try k.serverRow(user: user)
        let (telemetry, _) = makeTelemetry()
        let c = crypto(FakeKeychain(cloud: cloud, autoReceive: false), telemetry)
        await c.attach(account: user, server: server)
        #expect(outcomes(telemetry) == ["wait/0"])
        try await c.recover(typed: k.recoveryText)
        #expect((telemetry.waiting.last?["properties"] as? [String: Any])?["how"] as? String == "recovery_key")
        #expect(names(telemetry.waiting).last == "key_ready")
    }

    @Test func theOutcomeAndHowHaveAWordEach() {
        let k = StoredKey.generate()
        #expect(AccountCrypto.outcome(.ready(k, verified: true, promote: false)) == .ready)
        #expect(AccountCrypto.outcome(.ready(k, verified: false, promote: false)) == .readyUnverified)
        #expect(AccountCrypto.outcome(.mismatch) == .mismatch && AccountCrypto.outcome(.unreachable) == .unreachable)
        #expect(AccountCrypto.outcome(.reregister(k)) == .reregister && AccountCrypto.outcome(.replace(previous: k, generation: 1)) == .replace)
        #expect(AccountCrypto.readyHow(.made, startingFresh: false) == .created && AccountCrypto.readyHow(.made, startingFresh: true) == .startFresh)
        #expect(AccountCrypto.readyHow(.keychain, startingFresh: false) == .icloudKeychain && AccountCrypto.readyHow(.added, startingFresh: false) == .linked)
        #expect(AccountCrypto.readyHow(.recovery, startingFresh: false) == .recoveryKey && AccountCrypto.readyHow(.unknown, startingFresh: false) == nil)
        for screen in [KeyGateView.Shown.welcome, .addDevice, .noDevice, .waiting, .recovery, .startFresh, .unreachable, .checking] {
            #expect(GateScreen.allCases.contains(GateScreen(screen)))
        }
    }
}
