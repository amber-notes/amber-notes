import CoreImage
import CryptoKit
import Foundation
import Testing
@testable import Pane

private final class AddDeviceVectorsToken {}

/// The add-device formats against the vectors the server tests too
/// (supabase/functions/_shared/e2ee-vectors.json), byte for byte.
@Suite struct AddDeviceVectorTests {
    struct Vectors: Decodable {
        struct Side: Decodable {
            var answer: String; var answer_hash: String; var bind: String; var tag: String; var name_sealed: String; var sealed: String
            var secret: String?; var text: String?
            var bytes: String?; var canonical: String?; var typed: String?; var prk: String?
        }
        struct AddDevice: Decodable {
            var request_id: String; var name: String; var platform: String; var stored: String
            var new_device_private: String; var new_device_public: String; var approving_ephemeral_private: String
            var qr: Side; var code: Side
        }
        struct KeyDevice: Decodable {
            var device_id: String; var platform: String; var how: String; var backed_up: Bool; var name: String; var epoch: String
            var name_context: String; var name_sealed: String; var tag: String; var removal_tag: String
        }
        var data_key: String
        var nonce: String
        var user_id: String
        var verifier: String
        var recovery: Recovery
        struct Recovery: Decodable { var bytes: String; var wrap: String }
        var add_device: AddDevice
        var key_device: KeyDevice
    }

    let v: Vectors
    let user: UUID
    let request: UUID
    let nonce: AES.GCM.Nonce
    let newDevice: P256.KeyAgreement.PrivateKey
    let approving: P256.KeyAgreement.PrivateKey

    init() throws {
        let url = try #require(Bundle(for: AddDeviceVectorsToken.self).url(forResource: "e2ee-vectors", withExtension: "json"))
        v = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        user = UUID(uuidString: v.user_id)!
        request = UUID(uuidString: v.add_device.request_id)!
        nonce = try AES.GCM.Nonce(data: Data(base64Encoded: v.nonce)!)
        newDevice = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(base64Encoded: v.add_device.new_device_private)!)
        approving = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(base64Encoded: v.add_device.approving_ephemeral_private)!)
    }

    private func b64(_ s: String) -> Data { Data(base64Encoded: s)! }

    @Test func theQRAndTheTypedCodeDeriveTheSameThingsAsTheServerSide() throws {
        let a = v.add_device
        #expect(newDevice.publicKey.x963Representation == b64(a.new_device_public))
        // The QR: its text, its secret back, and what the secret derives.
        let secret = b64(a.qr.secret!)
        #expect(E2EE.addDeviceQR(secret: secret) == a.qr.text)
        #expect(E2EE.readAddDeviceQR(a.qr.text!) == secret)
        let scan = E2EE.addDevicePairing(prk: secret, user: user)
        #expect(scan.answer == a.qr.answer && E2EE.bytes(scan.bind) == b64(a.qr.bind))
        #expect(E2EE.addDeviceAnswerHash(scan.answer) == a.qr.answer_hash)
        // The typed code: its text, read back however it's typed, stretched the same.
        #expect(E2EE.addDeviceCodeText(b64(a.code.bytes!)) == a.code.text)
        #expect(E2EE.canonicalAddDeviceCode(a.code.typed!) == a.code.canonical)
        #expect(E2EE.canonicalAddDeviceCode(a.code.text!) == a.code.canonical)
        let prk = E2EE.addDeviceCodePrk(a.code.canonical!, user: user)
        #expect(prk == b64(a.code.prk!))
        let code = E2EE.addDevicePairing(prk: prk, user: user)
        #expect(code.answer == a.code.answer && E2EE.bytes(code.bind) == b64(a.code.bind))
        #expect(E2EE.addDeviceAnswerHash(code.answer) == a.code.answer_hash)
        #expect(scan.answer != code.answer)
    }

    @Test func theTagAndTheSealedKeyAndNameMatchByteForByte() throws {
        let a = v.add_device
        for side in [a.qr, a.code] {
            let bind = SymmetricKey(data: b64(side.bind))
            #expect(E2EE.addDeviceTag(bind: bind, requestID: request, platform: a.platform, publicKey: b64(a.new_device_public)) == side.tag)
            #expect(try E2EE.sealDeviceName(a.name, bind: bind, requestID: request, platform: a.platform, nonce: nonce) == side.name_sealed)
            #expect(try E2EE.openDeviceName(side.name_sealed, bind: bind, requestID: request, platform: a.platform) == a.name)
            let sealed = try E2EE.sealDeviceKey(b64(a.stored), to: b64(a.new_device_public), bind: bind, requestID: request, user: user,
                                                ephemeral: approving, nonce: nonce)
            #expect(sealed == side.sealed)
            #expect(try E2EE.openDeviceKey(side.sealed, privateKey: newDevice, bind: bind, requestID: request, user: user) == b64(a.stored))
        }
    }

    @Test func aSealedKeyOpensOnlyForTheDeviceTheSecretTheRequestAndTheAccount() throws {
        let a = v.add_device
        let bind = SymmetricKey(data: b64(a.qr.bind)), other = SymmetricKey(data: b64(a.code.bind))
        func opens(_ sealed: String = a.qr.sealed, key: P256.KeyAgreement.PrivateKey? = nil, bind b: SymmetricKey? = nil, request r: UUID? = nil, user u: UUID? = nil) -> Bool {
            (try? E2EE.openDeviceKey(sealed, privateKey: key ?? newDevice, bind: b ?? bind, requestID: r ?? request, user: u ?? user)) != nil
        }
        #expect(opens())
        #expect(!opens(key: approving), "another device's private key")
        #expect(!opens(bind: other), "the typed code's bind doesn't open what the QR sealed")
        #expect(!opens(request: UUID()) && !opens(user: UUID()))
        #expect(!opens("amb2h." + a.qr.sealed.dropFirst(6)), "a connect handoff is a different box")
        // Someone who swapped the public key on the way (the server) holds that private key, but not the bind.
        let swapped = P256.KeyAgreement.PrivateKey()
        let sealedToSwapped = try E2EE.sealDeviceKey(b64(a.stored), to: swapped.publicKey.x963Representation, bind: bind, requestID: request, user: user)
        #expect(!opens(sealedToSwapped, key: swapped, bind: SymmetricKey(size: .bits256)))
        // And nobody without the bind seals something the new device accepts.
        let forged = try E2EE.sealDeviceKey(b64(a.stored), to: b64(a.new_device_public), bind: SymmetricKey(size: .bits256), requestID: request, user: user)
        #expect(!opens(forged))
        // The tag changes with the key, the kind and the request; the name opens only for this request and kind.
        let tag = a.qr.tag
        #expect(E2EE.addDeviceTag(bind: bind, requestID: request, platform: a.platform, publicKey: swapped.publicKey.x963Representation) != tag)
        #expect(E2EE.addDeviceTag(bind: bind, requestID: request, platform: "ios", publicKey: b64(a.new_device_public)) != tag)
        #expect(E2EE.addDeviceTag(bind: other, requestID: request, platform: a.platform, publicKey: b64(a.new_device_public)) != tag)
        #expect((try? E2EE.openDeviceName(a.qr.name_sealed, bind: other, requestID: request, platform: a.platform)) == nil)
        #expect((try? E2EE.openDeviceName(a.qr.name_sealed, bind: bind, requestID: request, platform: "ios")) == nil)
    }

    @Test func theQRTextIsNotALinkAndOnlyAnExactCodeReads() throws {
        let text = try #require(v.add_device.qr.text)
        #expect(text.contains(" "), "spaces: no camera or browser treats it as an address")
        #expect(ConnectLink.requestID(from: URL(string: "ambernotes://connect?request=\(request)")!) != nil, "the connect link is a link; this isn't")
        #expect(URL(string: text)?.scheme == nil || URL(string: text) == nil)
        #expect(E2EE.readAddDeviceQR(text + " ") == nil)
        #expect(E2EE.readAddDeviceQR(text.replacingOccurrences(of: "v1", with: "v2")) == nil)
        #expect(E2EE.readAddDeviceQR("https://ambernotes.app/open/connect?request=\(request)#s=AbCdEfGhIjKlMnOpQrSt_-") == nil)
        #expect(E2EE.readAddDeviceQR(String(text.dropLast())) == nil)
        #expect(E2EE.canonicalAddDeviceCode("J699-754N-JTB") == nil && E2EE.canonicalAddDeviceCode("J699-754N-JTBU") == nil)
    }

    @Test func theQRCodeImageReadsBackAsItsText() throws {
        let text = try #require(v.add_device.qr.text)
        let small = try #require(QRCodeImage.make(text))
        // As a camera sees it: scaled up, no smoothing.
        let big = CIImage(cgImage: small).transformed(by: CGAffineTransform(scaleX: 8, y: 8)).samplingNearest()
        let detector = try #require(CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh]))
        let found = detector.features(in: big).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
        #expect(found == [text])
    }

    @Test func theDeviceListTagsNeedTheKey() throws {
        let k = v.key_device, key = SymmetricKey(data: b64(v.data_key)), device = UUID(uuidString: k.device_id)!
        #expect(E2EE.keyDeviceTag(key, user: user, device: device, platform: k.platform, how: k.how, backedUp: k.backed_up, epoch: k.epoch) == k.tag)
        #expect(E2EE.keyDeviceRemovalTag(key, user: user, device: device, epoch: k.epoch) == k.removal_tag)
        #expect(E2EE.device(device) == k.name_context)
        #expect(try NoteCrypto.seal(k.name, key: key, keyID: E2EE.keyID(of: key), context: k.name_context, nonce: nonce) == k.name_sealed)
        #expect(try NoteCrypto.open(k.name_sealed, key: key, context: E2EE.device(device)) == k.name)
        #expect(E2EE.keyDeviceTag(SymmetricKey(size: .bits256), user: user, device: device, platform: k.platform, how: k.how, backedUp: k.backed_up, epoch: k.epoch) != k.tag)
        #expect(E2EE.keyDeviceTag(key, user: user, device: device, platform: k.platform, how: k.how, backedUp: true, epoch: k.epoch) != k.tag)
        // A removal is for one epoch only.
        #expect(E2EE.keyDeviceRemovalTag(key, user: user, device: device, epoch: String(repeating: "c", count: 32)) != k.removal_tag)
        #expect(E2EE.tagsMatch(k.tag, k.tag) && !E2EE.tagsMatch(k.tag, k.removal_tag) && !E2EE.tagsMatch(k.tag, nil) && !E2EE.tagsMatch("", ""))
    }
}

/// `device_adds` as the migration's functions behave (the server's own tests are
/// supabase/functions/mcp/device_add.pglite.test.ts), for one account.
final class FakeAddDeviceServer: AddDeviceServer, @unchecked Sendable {
    struct Row {
        var request: AddDeviceRequest
        var expires: Date
        var attempts = 0
        var sealed: String?
        var via: String?
        var answered = false
    }
    private let lock = NSLock()
    private var rows: [UUID: Row] = [:]
    var offline = false
    var tooMany = false
    /// The server, or someone who can write its tables, replaces the new device's public key.
    var swapPublicKey: Data?
    /// The server answers a request itself, with a key of its own choosing.
    var forgeAnswer: ((AddDeviceRequest) -> String)?
    var losePickups = 0
    private(set) var pickups = 0
    private(set) var requests = 0
    private(set) var finds = 0
    private(set) var answers: [(device: UUID, sealed: String)] = []

    func all() -> [Row] { lock.withLock { Array(rows.values) } }
    func expireAll() { lock.withLock { for id in rows.keys { rows[id]!.expires = .distantPast } } }

    private func check() throws {
        if offline { throw URLError(.notConnectedToInternet) }
        if tooMany { throw AddDeviceError.tooMany }
    }

    func request(_ r: AddDeviceRequest) async throws -> Date {
        try check()
        return lock.withLock {
            requests += 1
            // One live request per new device.
            for (id, row) in rows where row.request.p_device == r.p_device { rows[id] = nil }
            let expires = Date.now.addingTimeInterval(300)
            rows[r.p_id] = Row(request: r, expires: expires)
            return expires
        }
    }

    func pickup(id: UUID, pickup: String) async throws -> AddDevicePickup {
        // Asking whether it was answered isn't rate-limited.
        if offline { throw URLError(.notConnectedToInternet) }
        return lock.withLock {
            guard var row = rows[id], E2EE.addDeviceAnswerHash(pickup) == row.request.p_pickup_hash else { return AddDevicePickup(state: .gone) }
            if let forge = forgeAnswer, !row.answered {
                row.answered = true
                row.sealed = forge(row.request)
                row.via = "scan"
            }
            if row.answered {
                rows[id] = row
                guard let sealed = row.sealed else { return AddDevicePickup(state: .taken) }
                pickups += 1
                // The answer is lost on the way this many times before it gets through.
                if losePickups > 0 { losePickups -= 1; return AddDevicePickup(state: .waiting) }
                return AddDevicePickup(state: .answered, sealed: sealed, via: row.via)
            }
            if row.expires <= .now || row.attempts >= 5 { return AddDevicePickup(state: .expired) }
            return AddDevicePickup(state: .waiting)
        }
    }

    func done(id: UUID, pickup: String) async throws {
        if offline { throw URLError(.notConnectedToInternet) }
        lock.withLock {
            guard var row = rows[id], row.answered, E2EE.addDeviceAnswerHash(pickup) == row.request.p_pickup_hash else { return }
            row.sealed = nil
            rows[id] = row
        }
    }

    func find(answer: String) async throws -> AddDeviceFound? {
        try check()
        return lock.withLock {
            finds += 1
            let h = E2EE.addDeviceAnswerHash(answer)
            guard let row = rows.values.first(where: { ($0.request.p_scan_hash == h || $0.request.p_code_hash == h) && !$0.answered && $0.expires > .now && $0.attempts < 5 })
            else { return nil }
            let scan = row.request.p_scan_hash == h
            return AddDeviceFound(id: row.request.p_id, device_id: row.request.p_device, platform: row.request.p_platform,
                                  name: scan ? row.request.p_scan_name : row.request.p_code_name,
                                  public_key: swapPublicKey?.base64EncodedString() ?? row.request.p_public_key,
                                  tag: scan ? row.request.p_scan_tag : row.request.p_code_tag, via: scan ? "scan" : "code", created_at: .now)
        }
    }

    func answer(id: UUID, answer: String, sealed: String, device: UUID) async throws -> AddDeviceAnswer {
        try check()
        return lock.withLock {
            guard var row = rows[id], !row.answered, row.expires > .now, row.attempts < 5 else { return .expired }
            let h = E2EE.addDeviceAnswerHash(answer)
            guard h == row.request.p_scan_hash || h == row.request.p_code_hash else {
                row.attempts += 1
                rows[id] = row
                return .wrong
            }
            row.answered = true
            row.sealed = sealed
            row.via = h == row.request.p_scan_hash ? "scan" : "code"
            rows[id] = row
            answers.append((device, sealed))
            return .added
        }
    }
}

/// Add a device, end to end between two `AccountCrypto`s: the new device's session and the
/// approving device's find and approve, over a fake server.
@MainActor @Suite(.serialized) struct AddDeviceFlowTests {
    typealias FakeKeychain = KeyStartupTests.FakeKeychain
    let user = UUID()
    let keyServer = KeyStartupTests.FakeServer()
    let server = FakeAddDeviceServer()
    let defaults = UserDefaults(suiteName: "add-device-\(UUID())")!
    let phone = UUID(), mac = UUID()

    /// The account's first device, with the key.
    func firstDevice() async -> (AccountCrypto, FakeKeychain) {
        let keychain = FakeKeychain(cloud: KeyStartupTests.Cloud())
        let crypto = AccountCrypto(store: keychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await crypto.attach(account: user, server: keyServer)
        return (crypto, keychain)
    }

    /// A second device signed in to the same account, with no iCloud Keychain to bring the key.
    func newDevice() async -> (AccountCrypto, FakeKeychain) {
        let keychain = FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
        keychain.syncs = false
        let crypto = AccountCrypto(store: keychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await crypto.attach(account: user, server: keyServer)
        return (crypto, keychain)
    }

    func session(_ crypto: AccountCrypto, offers: Int = 6) -> NewDeviceSession {
        NewDeviceSession(crypto: crypto, server: server, device: mac, platform: "macos", name: "Sara\u{2019}s MacBook Air", poll: .milliseconds(5), offers: offers)
    }

    /// Runs the session until its code shows.
    func showCode(_ s: NewDeviceSession) async throws -> (task: Task<Void, Never>, qr: String, code: String) {
        let task = Task { await s.run() }
        for _ in 0 ..< 2000 {
            if case .showing(let qr, let code) = s.state { return (task, qr, code) }
            try await Task.sleep(for: .milliseconds(5))
        }
        task.cancel()
        throw CancellationError()
    }

    @Test func scanningTheCodeOpensTheNotesOnTheNewDeviceAndTheKeyStaysOnItAlone() async throws {
        let (a, _) = await firstDevice()
        let (b, keychainB) = await newDevice()
        #expect(a.phase == .ready && b.phase == .waiting)
        let s = session(b)
        let shown = try await showCode(s)
        // The device with the key reads the code inside the app, finds the request and checks it.
        let c = try await AddDeviceApproval.find(.scanned(shown.qr), user: user, server: server)
        #expect(c.name == "Sara\u{2019}s MacBook Air" && c.kind == "Mac")
        try await AddDeviceApproval.approve(c, key: try #require(a.keyToHandOver), user: user, device: phone, server: server)
        await shown.task.value
        #expect(b.phase == .ready && b.keyID == a.keyID && b.recoveryKeyText == a.recoveryKeyText)
        #expect(b.arrivedHow == .added && !b.backedUp)
        // On this device only: never the synced slot, so removing the device removes exactly this copy.
        #expect(keychainB.local[user] != nil && keychainB.synced[user] == nil && keychainB.cloud.keys[user] == nil)
        // What the server held was only ciphertext, and it's gone once the new device has the key.
        for _ in 0 ..< 2000 where server.all().contains(where: { $0.sealed != nil }) { try await Task.sleep(for: .milliseconds(5)) }
        let rows = server.all()
        #expect(rows.count == 1 && rows[0].sealed == nil && rows[0].answered)
        let dump = server.answers.map(\.sealed).joined()
        let stored = try #require(a.keyToHandOver)
        #expect(!dump.contains(stored.dataKey.base64EncodedString()) && !dump.contains(stored.encoded.base64EncodedString()))
        // The request never names the device in the clear.
        #expect(!"\(rows[0].request)".contains("MacBook"))
        // Next launch: the key is found where it was kept.
        let again = AccountCrypto(store: keychainB, defaults: defaults, sleep: { _ in throw CancellationError() })
        await again.attach(account: user, server: keyServer)
        #expect(again.phase == .ready && again.keyID == a.keyID && again.arrivedHow == nil && !again.backedUp)
        for c in [a, b, again] { c.signedOut() }
    }

    @Test func typingTheCodeOnAMacDoesTheSame() async throws {
        let (a, _) = await firstDevice()
        let (b, _) = await newDevice()
        let s = session(b)
        let shown = try await showCode(s)
        // Typed sloppily.
        let c = try await AddDeviceApproval.find(.typed(shown.code.lowercased().replacingOccurrences(of: "-", with: " ")), user: user, server: server)
        try await AddDeviceApproval.approve(c, key: try #require(a.keyToHandOver), user: user, device: phone, server: server)
        await shown.task.value
        #expect(b.phase == .ready && b.keyID == a.keyID)
        for c in [a, b] { c.signedOut() }
    }

    @Test func aCodeIsReadOnlyFromItsOwnScreen() async throws {
        let (a, _) = await firstDevice()
        let (b, _) = await newDevice()
        let s = session(b)
        let shown = try await showCode(s)
        await #expect(throws: AddDeviceError.notACode) { try await AddDeviceApproval.find(.scanned("https://ambernotes.app/open/connect?request=\(UUID())"), user: user, server: server) }
        await #expect(throws: AddDeviceError.typo) { try await AddDeviceApproval.find(.typed("J699-754N"), user: user, server: server) }
        // A well-formed code that isn't on screen anywhere: nothing to find.
        await #expect(throws: AddDeviceError.notFound) { try await AddDeviceApproval.find(.typed("0000-0000-0000"), user: user, server: server) }
        // Another account's device reading this code derives another answer: nothing to find either.
        await #expect(throws: AddDeviceError.notFound) { try await AddDeviceApproval.find(.scanned(shown.qr), user: UUID(), server: server) }
        server.offline = true
        await #expect(throws: AddDeviceError.offline) { try await AddDeviceApproval.find(.scanned(shown.qr), user: user, server: server) }
        server.offline = false
        server.tooMany = true
        await #expect(throws: AddDeviceError.tooMany) { try await AddDeviceApproval.find(.scanned(shown.qr), user: user, server: server) }
        server.tooMany = false
        // Used once: a second device scanning the same code finds nothing.
        let c = try await AddDeviceApproval.find(.scanned(shown.qr), user: user, server: server)
        try await AddDeviceApproval.approve(c, key: try #require(a.keyToHandOver), user: user, device: phone, server: server)
        await #expect(throws: AddDeviceError.notFound) { try await AddDeviceApproval.find(.scanned(shown.qr), user: user, server: server) }
        await #expect(throws: AddDeviceError.expired) { try await AddDeviceApproval.approve(c, key: a.keyToHandOver!, user: user, device: phone, server: server) }
        await shown.task.value
        for c in [a, b] { c.signedOut() }
    }

    @Test func aPublicKeySwappedOnTheWayIsCaughtBeforeAnythingIsSealed() async throws {
        let (a, _) = await firstDevice()
        let (b, _) = await newDevice()
        let s = session(b)
        let shown = try await showCode(s)
        server.swapPublicKey = P256.KeyAgreement.PrivateKey().publicKey.x963Representation
        await #expect(throws: AddDeviceError.changed) { try await AddDeviceApproval.find(.scanned(shown.qr), user: user, server: server) }
        await #expect(throws: AddDeviceError.changed) { try await AddDeviceApproval.find(.typed(shown.code), user: user, server: server) }
        #expect(server.answers.isEmpty, "nothing was sealed to the swapped key")
        shown.task.cancel()
        await shown.task.value
        #expect(b.phase == .waiting)
        for c in [a, b] { c.signedOut() }
    }

    @Test func theNewDeviceUsesOnlyTheAccountsOwnKeySealedBySomeoneWhoReadItsScreen() async throws {
        let (a, _) = await firstDevice()
        let (b, keychainB) = await newDevice()
        // The server answers by itself with a key it made: it can seal to the public key, but it never saw the code.
        let planted = StoredKey.generate()
        server.forgeAnswer = { r in
            (try? E2EE.sealDeviceKey(planted.encoded, to: Data(base64Encoded: r.p_public_key)!, bind: SymmetricKey(size: .bits256), requestID: r.p_id, user: self.user)) ?? ""
        }
        let s = session(b, offers: 2)
        let task = Task { await s.run() }
        for _ in 0 ..< 2000 where s.problem == nil { try await Task.sleep(for: .milliseconds(5)) }
        #expect(s.problem == AddDeviceCopy.notAccountsKey && b.phase == .waiting && keychainB.local[user] == nil)
        server.forgeAnswer = nil
        task.cancel()
        await task.value
        // Someone who did read the screen, but holds a different key (another account's, or a made-up one):
        // it opens, and is refused against the account's verifier.
        let shown = try await showCode(session(b))
        let c = try await AddDeviceApproval.find(.scanned(shown.qr), user: user, server: server)
        try await AddDeviceApproval.approve(c, key: planted, user: user, device: phone, server: server)
        for _ in 0 ..< 2000 where server.pickups == 0 { try await Task.sleep(for: .milliseconds(5)) }
        try await Task.sleep(for: .milliseconds(50))
        #expect(b.phase == .waiting && keychainB.local[user] == nil, "a key that isn't the account's is never kept")
        shown.task.cancel()
        await shown.task.value
        // The right data key with a recovery key that doesn't open the account's wrap is refused too.
        let real = try #require(a.keyToHandOver)
        let half = try #require(StoredKey(dataKey: real.dataKey, recovery: E2EE.randomBytes(16)))
        #expect(throws: KeyError.notAccountsKey) { try b.adopt(added: half) }
        #expect(throws: KeyError.notAccountsKey) { try b.adopt(added: planted) }
        try b.adopt(added: real)
        #expect(b.phase == .ready)
        // A device that already opens its notes takes nothing.
        #expect(throws: KeyError.notReady) { try a.adopt(added: planted) }
        for c in [a, b] { c.signedOut() }
    }

    @Test func aCodeIsReplacedWhenItExpiresAndStopsAfterAFewUnusedOnes() async throws {
        let (a, _) = await firstDevice()
        let (b, _) = await newDevice()
        let s = session(b, offers: 2)
        let first = try await showCode(s)
        server.expireAll()
        // The same run replaces the code by itself.
        var second: (qr: String, code: String)?
        for _ in 0 ..< 2000 where second == nil {
            if case .showing(let qr, let code) = s.state, qr != first.qr { second = (qr, code) } else { try await Task.sleep(for: .milliseconds(5)) }
        }
        let next = try #require(second)
        #expect(server.requests == 2 && next.code != first.code)
        // The first code is dead on the server too (one live request per device).
        await #expect(throws: AddDeviceError.notFound) { try await AddDeviceApproval.find(.scanned(first.qr), user: user, server: server) }
        server.expireAll()
        await first.task.value
        #expect(s.state == .expired, "after a few unused codes it waits to be asked")
        // "Show a new code".
        s.again()
        #expect(s.round == 1)
        let third = try await showCode(s)
        let c = try await AddDeviceApproval.find(.scanned(third.qr), user: user, server: server)
        try await AddDeviceApproval.approve(c, key: try #require(a.keyToHandOver), user: user, device: phone, server: server)
        await third.task.value
        #expect(b.phase == .ready)
        for c in [a, b] { c.signedOut() }
    }

    @Test func theCodeOnScreenCarriesOverWhenTheScreenComesBack() async throws {
        let (a, _) = await firstDevice()
        let (b, _) = await newDevice()
        let s = session(b)
        let first = try await showCode(s)
        first.task.cancel()
        await first.task.value
        // Recovery key and back: the same code, no new request.
        let second = try await showCode(s)
        #expect(second.qr == first.qr && server.requests == 1)
        // Too many codes for this account: said, and no loop.
        second.task.cancel()
        await second.task.value
        server.expireAll()
        server.tooMany = true
        await s.run()
        #expect(s.state == .failed(AddDeviceError.tooMany.localizedDescription))
        for c in [a, b] { c.signedOut() }
    }

    @Test func iCloudKeychainBringingTheKeyStillWinsWhileTheCodeShows() async throws {
        let (a, keychainA) = await firstDevice()
        let keychainB = FakeKeychain(cloud: keychainA.cloud, autoReceive: false)
        let b = AccountCrypto(store: keychainB, defaults: defaults, sleep: { _ in throw CancellationError() })
        await b.attach(account: user, server: keyServer)
        #expect(b.phase == .waiting)
        let s = session(b)
        let shown = try await showCode(s)
        keychainB.receive()
        #expect(b.pollKeychain() && b.phase == .ready && b.arrivedHow == .keychain && b.backedUp)
        await shown.task.value
        for c in [a, b] { c.signedOut() }
    }

    @Test func anAnswerLostOnTheWayIsAskedForAgain() async throws {
        let (a, _) = await firstDevice()
        let (b, _) = await newDevice()
        let s = session(b)
        let shown = try await showCode(s)
        server.losePickups = 2
        let c = try await AddDeviceApproval.find(.scanned(shown.qr), user: user, server: server)
        try await AddDeviceApproval.approve(c, key: try #require(a.keyToHandOver), user: user, device: phone, server: server)
        await shown.task.value
        #expect(b.phase == .ready && b.keyID == a.keyID && server.pickups == 3 && server.requests == 1, "the same code, no new request")
        for c in [a, b] { c.signedOut() }
    }

    @Test func startupFindsTheHandedOverKeyAndNeverPutsItInICloudKeychain() throws {
        let key = StoredKey.generate(), other = StoredKey.generate()
        let row = try key.serverRow(user: user)
        typealias D = KeyStartup
        #expect(D.decide(user: user, synced: nil, pending: nil, local: key, server: .key(row)) == .ready(key, verified: true, promote: false))
        #expect(D.decide(user: user, synced: other, pending: nil, local: key, server: .key(row)) == .ready(key, verified: true, promote: false),
                "a stale iCloud Keychain item beside it doesn't get in the way")
        #expect(D.decide(user: user, synced: nil, pending: nil, local: other, server: .key(row)) == .wait, "a handed-over key that isn't the account's is never used")
        #expect(D.decide(user: user, synced: other, pending: nil, local: other, server: .key(row)) == .mismatch)
        #expect(D.decide(user: user, synced: nil, pending: nil, local: key, server: .unreachable) == .ready(key, verified: false, promote: false))
        #expect(D.decide(user: user, synced: nil, pending: nil, local: key, server: .none(generation: 0)) == .reregister(key),
                "the server lost the row: the same key goes back")
        #expect(D.decide(user: user, synced: nil, pending: nil, local: key, server: .none(generation: 1)) == .replace(previous: key, generation: 1))
        // A stale iCloud Keychain item from before a reset, beside the current key that was handed
        // over: with the server's row gone (or the device offline), the current key is the one that
        // counts, never the stale one, and it's never thrown away.
        let stale = StoredKey.generate(generation: 0), current = StoredKey.generate(generation: 1)
        #expect(D.decide(user: user, synced: stale, pending: nil, local: current, server: .none(generation: 1)) == .reregister(current))
        #expect(D.decide(user: user, synced: stale, pending: nil, local: current, server: .unreachable) == .ready(current, verified: false, promote: false))
        // The other way round: the account started fresh elsewhere and iCloud Keychain brought the new key.
        #expect(D.decide(user: user, synced: current, pending: nil, local: stale, server: .none(generation: 1)) == .reregister(current))
        #expect(D.decide(user: user, synced: current, pending: nil, local: stale, server: .unreachable) == .ready(current, verified: false, promote: false))
    }

    @Test func aResetNeverDeletesAHandedOverKeyThatIsntTheOneKeptAside() async throws {
        // This device holds a stale synced item (generation 0) and the account's current key, handed over (generation 1).
        let stale = StoredKey.generate(generation: 0), current = StoredKey.generate(generation: 1)
        let keychain = FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
        keychain.synced[user] = stale
        keychain.local[user] = current
        // The server's row is gone though the account's generation says the current key is right.
        keyServer.generation = 1
        let crypto = AccountCrypto(store: keychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await crypto.attach(account: user, server: keyServer)
        #expect(crypto.phase == .ready && crypto.keyID == current.keyID, "the same key goes back to the server")
        #expect(keychain.local[user] == current && keyServer.row?.key_id == current.keyID)
        // A real reset later (generation 2): the current key is kept aside, and only then leaves the local slot.
        crypto.signedOut()
        keyServer.row = nil
        keyServer.generation = 2
        let again = AccountCrypto(store: keychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await again.attach(account: user, server: keyServer)
        #expect(again.phase == .ready && keychain.previous[user] == current && keychain.local[user] == nil)
        again.signedOut()
    }

    @Test func theNoticeIsntNewsOnTheTwoDevicesThatJustDidIt() {
        let ledger = NoticeLedger(account: user, defaults: defaults)
        let n = AccountNotice(id: 7, kind: .deviceAdded, created_at: .now)
        #expect(ledger.unseen([n]).map(\.id) == [7], "every other device says it")
        #expect(n.text().title == "A device was added to your account" && n.text().message.contains("remove it in Settings"))
        #expect(ledger.unseen([n], addedHere: .now.addingTimeInterval(-5)).isEmpty)
        #expect(ledger.unseen([n]).isEmpty, "and it stays said")
        let later = AccountNotice(id: 8, kind: .deviceAdded, created_at: .now)
        #expect(ledger.unseen([later], addedHere: .now.addingTimeInterval(-600)).map(\.id) == [8], "a device added by someone else, later")
    }
}

/// Where the key is kept: the list, this device's own row, removal, and the nudge.
@MainActor @Suite(.serialized) struct KeyDevicesTests {
    final class FakeList: KeyDeviceServer, @unchecked Sendable {
        var rows: [KeyDeviceRow] = []
        private(set) var checkIns = 0
        private(set) var forgotten: [UUID] = []
        var keyID = ""

        func list() async throws -> [KeyDeviceRow] { rows }

        func checkIn(device: UUID, platform: String, nameCT: String, how: String, backedUp: Bool, keyID: String, epoch: String, tag: String) async throws {
            checkIns += 1
            let old = rows.first { $0.device_id == device }
            rows.removeAll { $0.device_id == device }
            rows.append(KeyDeviceRow(device_id: device, platform: platform, name_ct: nameCT, how: how, backed_up: backedUp, key_id: keyID, epoch: epoch, tag: tag,
                                     added_at: old?.removed_at == nil ? old?.added_at ?? .now : .now, seen_at: .now))
        }

        func remove(device: UUID, removalTag: String) async throws -> Bool {
            guard let i = rows.firstIndex(where: { $0.device_id == device }) else { return false }
            rows[i].removed_at = .now
            rows[i].removal_tag = removalTag
            return true
        }

        func forget(device: UUID) async throws {
            forgotten.append(device)
            rows.removeAll { $0.device_id == device }
        }
    }

    let user = UUID()
    let keyServer = KeyStartupTests.FakeServer()
    let list = FakeList()
    let defaults = UserDefaults(suiteName: "key-devices-\(UUID())")!
    let phone = UUID(), mac = UUID()

    func ready(syncs: Bool = true) async -> (AccountCrypto, KeyStartupTests.FakeKeychain) {
        let keychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud())
        keychain.syncs = syncs
        let crypto = AccountCrypto(store: keychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await crypto.attach(account: user, server: keyServer)
        return (crypto, keychain)
    }

    func row(_ key: StoredKey, device: UUID, platform: String = "macos", name: String = "Sara\u{2019}s MacBook Air", how: KeyHow = .added, backedUp: Bool = false) throws -> KeyDeviceRow {
        let epoch = E2EE.randomHex(bytes: 16)
        return KeyDeviceRow(device_id: device, platform: platform, name_ct: try NoteCrypto.seal(name, key: key.key, keyID: key.keyID, context: E2EE.device(device)),
                     how: how.rawValue, backed_up: backedUp, key_id: key.keyID, epoch: epoch,
                     tag: E2EE.keyDeviceTag(key.key, user: user, device: device, platform: platform, how: how.rawValue, backedUp: backedUp, epoch: epoch),
                     added_at: Date(timeIntervalSince1970: 1_790_000_000), seen_at: .now)
    }

    func devices(_ device: UUID, name: String = "iPhone", platform: String = "ios") -> KeyDevices {
        let d = KeyDevices(device: device, platform: platform, name: name, identity: DeviceIdentity(store: MemoryDeviceIdentityStore()))
        d.attach(account: user, server: list)
        return d
    }

    @Test func aDeviceListsItselfOnceAndShowsTheOthersThatProveTheyHoldTheKey() async throws {
        let (crypto, _) = await ready()
        let key = try #require(crypto.keyToHandOver)
        list.rows = [try row(key, device: mac)]
        // Planted by someone with the password but not the key: a made-up tag, and a row sealed with another key.
        var forged = try row(key, device: UUID(), name: "Someone\u{2019}s PC")
        forged.tag = String(repeating: "a", count: 64)
        let stranger = StoredKey.generate()
        list.rows += [forged, try row(stranger, device: UUID())]
        let d = devices(phone)
        await d.refresh(crypto)
        #expect(d.loaded && d.others.map(\.name) == ["Sara\u{2019}s MacBook Air"], "only rows whose tag the key made")
        #expect(d.others[0].how == .added && d.others[0].canRemove && d.others[0].detail().hasPrefix("Added ") && d.others[0].detail().hasSuffix("last seen today"))
        // This device's own row: made here, kept in iCloud Keychain, named only in ciphertext.
        let mine = try #require(list.rows.first { $0.device_id == phone })
        #expect(mine.how == "made" && mine.backed_up && !mine.name_ct.contains("iPhone"))
        #expect(KeyDeviceList.verified(mine, key: key, user: user)?.name == "iPhone")
        // Looking again writes nothing: the row says what's true.
        await d.refresh(crypto)
        #expect(list.checkIns == 1)
        #expect(d.safety(crypto) == .safe(ways: 1), "the Mac was seen today; the Keychain item alone would prove nothing")
        crypto.signedOut()
    }

    @Test func safeIsSaidOnlyOnEvidenceAndAKeychainItemAloneIsCantConfirm() async throws {
        let now = Date()
        func device(_ id: UUID, how: KeyHow = .added, backedUp: Bool = false, seen days: Double = 0, removing: Bool = false) -> KeyDevice {
            KeyDevice(id: id, name: backedUp ? "iPhone" : "Mac", platform: backedUp ? "ios" : "macos", how: how, backedUp: backedUp,
                      addedAt: now.addingTimeInterval(-90 * 86400), seenAt: now.addingTimeInterval(-days * 86400), removing: removing)
        }
        typealias L = KeyDeviceList
        // Only this device, key on it alone: the warning.
        #expect(L.safety(thisBackedUp: false, others: [], recoverySaved: false, now: now) == .onlyThisDevice)
        // The key is stored for iCloud Keychain and nothing else is known: iCloud Keychain may be off, so it's not "safe".
        #expect(L.safety(thisBackedUp: true, others: [], recoverySaved: false, now: now) == .unconfirmed)
        // Evidence: a saved recovery key, or another device seen in the last 30 days.
        #expect(L.safety(thisBackedUp: false, others: [], recoverySaved: true, now: now) == .safe(ways: 1))
        #expect(L.safety(thisBackedUp: true, others: [], recoverySaved: true, now: now) == .safe(ways: 1), "the Keychain item is never counted")
        #expect(L.safety(thisBackedUp: false, others: [device(mac)], recoverySaved: false, now: now) == .safe(ways: 1))
        #expect(L.safety(thisBackedUp: true, others: [device(phone, how: .keychain, backedUp: true, seen: 29)], recoverySaved: true, now: now) == .safe(ways: 2))
        // A device not seen for 30 days is no way in: it may be lost or wiped.
        let stale = device(mac, seen: 31)
        #expect(L.safety(thisBackedUp: false, others: [stale], recoverySaved: false, now: now) == .onlyThisDevice)
        #expect(L.safety(thisBackedUp: true, others: [stale], recoverySaved: false, now: now) == .unconfirmed)
        #expect(!stale.isRecent(now: now) && stale.detail(now: now).contains("not seen since"))
        #expect(device(mac, seen: 2).detail(now: now).contains("last seen ") && device(mac).detail(now: now).hasSuffix("last seen today"))
        // Nor is one that's being removed.
        let going = device(mac, removing: true)
        #expect(L.safety(thisBackedUp: false, others: [going], recoverySaved: false, now: now) == .onlyThisDevice)
        #expect(!going.canRemove && !device(phone, backedUp: true).canRemove && device(mac).canRemove, "a key in iCloud Keychain can't be taken from one device")
        // What a row says about where the key came from is only what's known.
        #expect(device(phone, how: .made, backedUp: true).detail(now: now).hasPrefix("Made your key on "))
        #expect(device(phone, how: .recovery, backedUp: true).detail(now: now).hasPrefix("Opened with the recovery key on "))
        #expect(device(phone, how: .keychain, backedUp: true).detail(now: now).hasPrefix("Got your key from iCloud Keychain on "))
        #expect(device(phone, how: .unknown, backedUp: true).detail(now: now).hasPrefix("Has had your key since "))
        // The Developer ID Mac, alone, never having saved a recovery key.
        let (crypto, _) = await ready(syncs: false)
        let d = devices(mac, name: "Mac", platform: "macos")
        #expect(d.safety(crypto) == .onlyThisDevice && !d.loaded, "the screen claims nothing before the list has loaded")
        await d.refresh(crypto)
        #expect(d.loaded && d.safety(crypto) == .onlyThisDevice && !crypto.backedUp)
        try await crypto.markRecoveryKeySaved()
        #expect(d.safety(crypto) == .safe(ways: 1))
        crypto.signedOut()
    }

    @Test func anIPhoneWithOnlyAKeychainItemCantConfirmABackup() async throws {
        // The key is in its Keychain as an iCloud Keychain item and nothing else is known.
        let (phoneCrypto, _) = await ready(syncs: true)
        let onPhone = devices(phone)
        await onPhone.refresh(phoneCrypto)
        #expect(phoneCrypto.backedUp && onPhone.safety(phoneCrypto) == .unconfirmed)
        phoneCrypto.signedOut()
    }

    @Test func aDeviceThatAlreadyHadTheKeyDoesntSayWhereItCameFrom() async throws {
        // An install from before the list existed: the key is simply there at launch.
        let (first, keychain) = await ready()
        first.signedOut()
        let crypto = AccountCrypto(store: keychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await crypto.attach(account: user, server: keyServer)
        #expect(crypto.phase == .ready && crypto.arrivedHow == nil)
        let d = devices(phone)
        await d.refresh(crypto)
        #expect(list.rows.first?.how == "unknown")
        crypto.signedOut()
    }

    @Test func anUnreadableKeychainNeverMakesASecondIdentity() async throws {
        // The device has an identity and a row in the list.
        let store = MemoryDeviceIdentityStore()
        let known = DeviceIdentity(store: store)
        let id = try #require(known.id), epoch = try #require(known.epoch(user))
        let (crypto, _) = await ready()
        let first = KeyDevices(platform: "ios", name: "iPhone", identity: known)
        first.attach(account: user, server: list)
        await first.refresh(crypto)
        #expect(list.rows.map(\.device_id) == [id] && first.loaded)
        // Next launch, before the first unlock: the Keychain item can't be read.
        store.unreadable = true
        let locked = DeviceIdentity(store: store)
        #expect(locked.id == nil && locked.epoch(user) == nil && store.saves == 2, "nothing new is made or written")
        let early = KeyDevices(platform: "ios", name: "iPhone", identity: locked)
        early.attach(account: user, server: list)
        await early.refresh(crypto)
        #expect(list.rows.map(\.device_id) == [id] && list.checkIns == 1, "it doesn't list itself under another id")
        #expect(!early.loaded && early.others.isEmpty, "and claims nothing: its own row is not another device")
        await #expect(throws: KeyError.notReady) { try await early.remove(KeyDevice(id: UUID(), name: "Mac", platform: "macos", how: .added, backedUp: false, addedAt: .now, removing: false), crypto: crypto) }
        // Unlocked: the same identity is back, and the list is as it was.
        store.unreadable = false
        await early.refresh(crypto)
        #expect(locked.id == id && locked.epoch(user) == epoch && early.loaded && early.others.isEmpty)
        #expect(list.rows.map(\.device_id) == [id] && early.safety(crypto) == .unconfirmed, "never safe on the strength of its own ghost")
        // The Keychain's answers: only "no such item" means there is none.
        typealias K = KeychainDeviceIdentityStore
        #expect(K.result(errSecItemNotFound, nil) == .none)
        #expect(K.result(errSecInteractionNotAllowed, nil) == .unavailable && K.result(errSecAuthFailed, nil) == .unavailable && K.result(errSecSuccess, nil) == .unavailable)
        #expect(K.result(errSecSuccess, Data([1])) == .found(Data([1])))
        crypto.signedOut()
    }

    @Test func anIdentityThatCouldntBeSavedIsNoIdentity() async throws {
        let store = MemoryDeviceIdentityStore()
        store.failsToSave = true
        let identity = DeviceIdentity(store: store)
        #expect(identity.id == nil && identity.epoch(user) == nil, "an id that wasn't written would be another one next launch")
        let (crypto, _) = await ready()
        let d = KeyDevices(platform: "ios", name: "iPhone", identity: identity)
        d.attach(account: user, server: list)
        await d.refresh(crypto)
        #expect(list.rows.isEmpty && !d.loaded)
        // The save works later: one identity, then one epoch, and they stay.
        store.failsToSave = false
        await d.refresh(crypto)
        let id = try #require(identity.id)
        #expect(list.rows.map(\.device_id) == [id] && DeviceIdentity(store: store).id == id)
        // An epoch that can't be saved isn't used either.
        let other = UUID()
        store.failsToSave = true
        #expect(identity.epoch(other) == nil)
        store.failsToSave = false
        #expect(identity.epoch(other)?.count == 32)
        crypto.signedOut()
    }

    @Test func aRemovalNoticedTwiceAtOnceIsCarriedOutOnce() async throws {
        let (phoneCrypto, _) = await ready()
        let key = try #require(phoneCrypto.keyToHandOver)
        let macKeychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
        macKeychain.syncs = false
        let macCrypto = AccountCrypto(store: macKeychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await macCrypto.attach(account: user, server: keyServer)
        try macCrypto.adopt(added: key)
        let onPhone = devices(phone), onMac = devices(mac, name: "Mac", platform: "macos")
        var removed = 0
        onMac.removedHere = {
            removed += 1
            // The removal takes a while (it pushes, erases, signs out): time for a second notice.
            try? await Task.sleep(for: .milliseconds(150))
            macCrypto.forgetLocalKey()
            await onMac.removalDone(account: user)
        }
        await onMac.refresh(macCrypto)
        await onPhone.refresh(phoneCrypto)
        await onMac.refresh(macCrypto)
        let phoneRow = try #require(onMac.others.first)
        try await onPhone.remove(try #require(onPhone.others.first), crypto: phoneCrypto)
        // The Mac looks at the list and, in the same moment, its person taps Remove on the iPhone's row.
        async let looked: Void = onMac.refresh(macCrypto)
        async let tapped: Void? = try? onMac.remove(phoneRow, crypto: macCrypto)
        _ = await (looked, tapped)
        #expect(removed == 1 && macKeychain.local[user] == nil)
        for c in [phoneCrypto, macCrypto] { c.signedOut() }
    }

    @Test func aTransferredPhoneIsADeviceOfItsOwn() {
        // The id and the epochs live in a Keychain item that stays on the device.
        let store = MemoryDeviceIdentityStore()
        let old = DeviceIdentity(store: store)
        let epoch = old.epoch(user) ?? ""
        #expect(epoch.count == 32 && old.epoch(user) == epoch && old.id != nil)
        // The same device, next launch.
        let again = DeviceIdentity(store: store)
        #expect(again.id == old.id && again.epoch(user) == epoch)
        // A phone set up by transfer: the item didn't come along, so it's another device with another epoch.
        let transferred = DeviceIdentity(store: MemoryDeviceIdentityStore())
        #expect(transferred.id != old.id && transferred.epoch(user) != epoch)
        // After a removal the epoch changes, and it stays changed.
        again.rotateEpoch(user)
        #expect(again.epoch(user) != epoch && DeviceIdentity(store: store).epoch(user) == again.epoch(user))
    }

    @Test func removingADeviceTakesItsKeyOnlyWhenADeviceWithTheKeySaidSo() async throws {
        // The iPhone has the key in iCloud Keychain; the Mac got it from the iPhone and keeps it on itself.
        let (phoneCrypto, _) = await ready()
        let key = try #require(phoneCrypto.keyToHandOver)
        let macKeychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
        macKeychain.syncs = false
        let macCrypto = AccountCrypto(store: macKeychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await macCrypto.attach(account: user, server: keyServer)
        try macCrypto.adopt(added: key)
        let onPhone = devices(phone), onMac = devices(mac, name: "Sara\u{2019}s MacBook Air", platform: "macos")
        var removed = 0
        onMac.removedHere = { removed += 1; macCrypto.forgetLocalKey(); await onMac.removalDone(account: user) }
        await onMac.refresh(macCrypto)
        await onPhone.refresh(phoneCrypto)
        #expect(onPhone.others.map(\.name) == ["Sara\u{2019}s MacBook Air"] && onPhone.others[0].how == .added)
        // Someone with the password but not the key marks the Mac removed: the tag doesn't verify, the Mac keeps its key.
        _ = try await list.remove(device: mac, removalTag: String(repeating: "b", count: 64))
        await onMac.refresh(macCrypto)
        #expect(removed == 0 && macCrypto.phase == .ready && macKeychain.local[user] != nil)
        #expect(list.rows.first { $0.device_id == mac }?.removed_at == nil, "its row is renewed")
        // The iPhone removes it.
        await onPhone.refresh(phoneCrypto)
        try await onPhone.remove(try #require(onPhone.others.first), crypto: phoneCrypto)
        #expect(onPhone.others.first?.removing == true && onPhone.others.first?.canRemove == false)
        #expect(onPhone.safety(phoneCrypto) == .unconfirmed, "only the Keychain item is left, which proves nothing")
        await onMac.refresh(macCrypto)
        #expect(removed == 1 && macKeychain.local[user] == nil && macCrypto.phase != .ready && macCrypto.keyToHandOver == nil)
        #expect(list.forgotten == [mac])
        await onPhone.refresh(phoneCrypto)
        #expect(onPhone.others.isEmpty)
        // A removal aimed at a device whose key is in iCloud Keychain is not obeyed: deleting that
        // item would take the key from every device.
        var phoneRemoved = 0
        onPhone.removedHere = { phoneRemoved += 1 }
        let phoneEpoch = try #require(list.rows.first { $0.device_id == phone }?.epoch)
        _ = try await list.remove(device: phone, removalTag: E2EE.keyDeviceRemovalTag(key.key, user: user, device: phone, epoch: phoneEpoch))
        await onPhone.refresh(phoneCrypto)
        #expect(phoneRemoved == 0 && phoneCrypto.phase == .ready)
        #expect(list.rows.first { $0.device_id == phone }?.removed_at == nil)
        for c in [phoneCrypto, macCrypto] { c.signedOut() }
    }

    @Test func anOldRemovalReplayedAfterTheDeviceWasAddedAgainTakesNothing() async throws {
        let (phoneCrypto, _) = await ready()
        let key = try #require(phoneCrypto.keyToHandOver)
        let macKeychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
        macKeychain.syncs = false
        let macCrypto = AccountCrypto(store: macKeychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await macCrypto.attach(account: user, server: keyServer)
        try macCrypto.adopt(added: key)
        let onPhone = devices(phone), onMac = devices(mac, name: "Mac", platform: "macos")
        var removed = 0
        onMac.removedHere = { removed += 1; macCrypto.forgetLocalKey(); await onMac.removalDone(account: user) }
        await onMac.refresh(macCrypto)
        await onPhone.refresh(phoneCrypto)
        // Removed for real; anyone signed in could read the removal's tag while it was pending.
        try await onPhone.remove(try #require(onPhone.others.first), crypto: phoneCrypto)
        let oldTag = try #require(list.rows.first { $0.device_id == mac }?.removal_tag)
        await onMac.refresh(macCrypto)
        #expect(removed == 1 && macCrypto.phase != .ready)
        // Added again: it lists itself under a new epoch.
        await macCrypto.restart()
        try macCrypto.adopt(added: key)
        await onMac.refresh(macCrypto)
        #expect(macCrypto.phase == .ready && list.rows.first { $0.device_id == mac }?.removed_at == nil)
        // A session with the password but no key replays the old removal.
        _ = try await list.remove(device: mac, removalTag: oldTag)
        await onMac.refresh(macCrypto)
        #expect(removed == 1 && macCrypto.phase == .ready && macKeychain.local[user] != nil, "the old tag names the old epoch: nothing is given up")
        #expect(list.rows.first { $0.device_id == mac }?.removed_at == nil, "and the row is renewed")
        // The iPhone doesn't show it as being removed either, and can still remove it for real.
        await onPhone.refresh(phoneCrypto)
        #expect(onPhone.others.first?.removing == false)
        try await onPhone.remove(try #require(onPhone.others.first), crypto: phoneCrypto)
        await onMac.refresh(macCrypto)
        #expect(removed == 2 && macKeychain.local[user] == nil)
        for c in [phoneCrypto, macCrypto] { c.signedOut() }
    }

    @Test func removingTheDownloadedMacTakesTheKeyItMadeOrRecoveredToo() async throws {
        // The Developer ID Mac: its Keychain doesn't sync, so the key it made sits in the main slot, on this Mac only.
        let (macCrypto, macKeychain) = await ready(syncs: false)
        let key = try #require(macCrypto.keyToHandOver)
        #expect(macKeychain.synced[user] == key && !macCrypto.backedUp)
        let onMac = devices(mac, name: "Mac", platform: "macos")
        var removed = 0
        onMac.removedHere = { removed += 1; macCrypto.forgetLocalKey(); await onMac.removalDone(account: user) }
        await onMac.refresh(macCrypto)
        let row = try #require(list.rows.first { $0.device_id == mac })
        _ = try await list.remove(device: mac, removalTag: E2EE.keyDeviceRemovalTag(key.key, user: user, device: mac, epoch: row.epoch))
        await onMac.refresh(macCrypto)
        #expect(removed == 1 && macKeychain.synced[user] == nil && macKeychain.local[user] == nil && macKeychain.pending[user] == nil,
                "no copy of the key is left on it")
        macCrypto.signedOut()
    }

    @Test func twoDevicesRemovingEachOtherNeverLeaveNobodyWithTheKey() async throws {
        // Two Macs, each holding the key on itself only.
        func localDevice() async throws -> (AccountCrypto, KeyStartupTests.FakeKeychain) {
            let k = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
            k.syncs = false
            let c = AccountCrypto(store: k, defaults: defaults, sleep: { _ in throw CancellationError() })
            await c.attach(account: user, server: keyServer)
            return (c, k)
        }
        let (a, keychainA) = try await localDevice()
        #expect(a.phase == .ready)
        let key = try #require(a.keyToHandOver)
        let (b, keychainB) = try await localDevice()
        try b.adopt(added: key)
        let onA = devices(phone, name: "Mac A", platform: "macos"), onB = devices(mac, name: "Mac B", platform: "macos")
        var removedA = 0, removedB = 0
        onA.removedHere = { removedA += 1; a.forgetLocalKey(); await onA.removalDone(account: user) }
        onB.removedHere = { removedB += 1; b.forgetLocalKey(); await onB.removalDone(account: user) }
        await onA.refresh(a)
        await onB.refresh(b)
        await onA.refresh(a)
        // A removes B. B hasn't looked yet, and its person taps Remove on A.
        try await onA.remove(try #require(onA.others.first), crypto: a)
        let staleViewOfA = try #require(onB.others.first)
        await #expect(throws: KeyError.removedHere) { try await onB.remove(staleViewOfA, crypto: b) }
        // B found out it was removed, acted on that, and never sent its removal of A.
        #expect(removedB == 1 && keychainB.local[user] == nil && b.phase != .ready)
        #expect(list.rows.first { $0.device_id == phone }?.removed_at == nil, "A was not marked")
        await onA.refresh(a)
        #expect(removedA == 0 && a.phase == .ready && keychainA.synced[user] == key, "one device still holds the key")
        for c in [a, b] { c.signedOut() }
    }

    @Test func aRemovalDropsTheKeyBeforeAnythingElseAndAKillMidwayIsFinishedAtLaunch() async throws {
        let flags = UserDefaults(suiteName: "device-removal-\(UUID())")!
        var steps: [String] = []
        var pendingWhen: [String: Bool] = [:]
        func removal(killAt: String? = nil) -> DeviceRemoval {
            func mark(_ step: String) { steps.append(step); pendingWhen[step] = flags.string(forKey: DeviceRemoval.pendingFlag) != nil }
            return DeviceRemoval(defaults: flags,
                                 push: { mark("push") },
                                 dropKey: { _ in mark("dropKey") },
                                 erase: { mark("erase") },
                                 forget: { _ in mark("forget") },
                                 signOut: { mark("signOut") })
        }
        // Start to finish: unsynced edits go up while the key is still here, then the key goes, then the notes.
        await removal().run(account: user)
        #expect(steps == ["push", "dropKey", "erase", "forget", "signOut"])
        #expect(pendingWhen["push"] == false, "pushing needs the key: nothing is marked yet")
        #expect(pendingWhen["dropKey"] == true && pendingWhen["erase"] == true, "written down before the key goes, and while the notes are erased")
        #expect(flags.string(forKey: DeviceRemoval.pendingFlag) == nil && flags.bool(forKey: DeviceRemoval.noticeFlag), "done: said once on the sign-in screen")
        // Nothing is pending: launch does nothing.
        steps = []
        await removal().resumeIfInterrupted()
        #expect(steps.isEmpty)
        // Killed after the mark was written and the key deleted, before the library was erased.
        flags.removeObject(forKey: DeviceRemoval.noticeFlag)
        flags.set(user.uuidString.lowercased(), forKey: DeviceRemoval.pendingFlag)
        await removal().resumeIfInterrupted()
        #expect(steps == ["dropKey", "erase", "forget", "signOut"], "the next launch finishes it, without pushing: the key is gone")
        #expect(flags.string(forKey: DeviceRemoval.pendingFlag) == nil && flags.bool(forKey: DeviceRemoval.noticeFlag))
        // With the real key store: after the first step alone, the device can't open its notes again.
        let keychain = KeyStartupTests.FakeKeychain(cloud: KeyStartupTests.Cloud(), autoReceive: false)
        keychain.syncs = false
        let crypto = AccountCrypto(store: keychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        await crypto.attach(account: user, server: keyServer)
        #expect(crypto.phase == .ready)
        crypto.signedOut()
        let relaunched = AccountCrypto(store: keychain, defaults: defaults, sleep: { _ in throw CancellationError() })
        relaunched.forgetLocalKey(of: user)   // what dropKey does, before the account is even attached
        await relaunched.attach(account: user, server: keyServer)
        #expect(relaunched.phase == .waiting && relaunched.keyToHandOver == nil, "killed right after: it comes back without its key")
        relaunched.signedOut()
    }
}

/// The QR code on "Open your notes on this device": every module the same whole number of
/// screen pixels, so none is blurred or a pixel wider than its neighbour.
@MainActor @Suite struct QRCodeCrispTests {
    @Test func everyModuleIsAWholeNumberOfPixels() throws {
        let image = try #require(QRCodeImage.make(E2EE.addDeviceQR(secret: Data((0x80 ..< 0x90).map { UInt8($0) }))))
        for scale in [1.0, 2.0, 3.0] {
            let side = QRCodeImage.crispSide(176, modules: image.width, scale: scale)
            let perModule = side * scale / CGFloat(image.width)
            #expect(perModule == perModule.rounded(), "scale \(scale): \(perModule) pixels a module")
            #expect(side <= 176 && 176 - side < CGFloat(image.width) / scale, "shrinks by less than one module")
            let k = QRCodeImage.pixelsPerModule(176, modules: image.width, scale: scale)
            let big = try #require(QRCodeImage.make(E2EE.addDeviceQR(secret: Data((0x80 ..< 0x90).map { UInt8($0) })), pixelsPerModule: k))
            #expect(big.width == image.width * k, "made at its final pixel size")
        }
    }
}
