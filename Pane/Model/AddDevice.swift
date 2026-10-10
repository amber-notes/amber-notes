import CommonCrypto
import CryptoKit
import Foundation

// Add a device: a signed-in device without the account's key gets it from one that has it
// (docs/Evidence/add-device-threat-model.md). The new device shows a QR code and a typed code;
// a device with the key reads one of them inside Amber Notes and seals the key to the new
// device. The formats are in supabase/functions/_shared/e2ee.ts, pinned by e2ee-vectors.json.

extension E2EE {
    static let addDeviceQRPrefix = "amber-notes add-device v1 "
    static let addDeviceSealedPrefix = "amb2d."
    /// PBKDF2 rounds for the typed code: guessing it costs this much per try.
    static let addDeviceRounds: UInt32 = 600_000

    // MARK: The pairing secrets the new device shows

    /// What the new device's QR code says. Not a link: only the scanner in the app acts on it.
    static func addDeviceQR(secret: Data) -> String { addDeviceQRPrefix + ConnectScan.base64url(secret) }

    /// The 16 bytes a scanned code carries, or nil when it isn't an add-device code.
    static func readAddDeviceQR(_ text: String) -> Data? {
        guard text.hasPrefix(addDeviceQRPrefix) else { return nil }
        let s = String(text.dropFirst(addDeviceQRPrefix.count))
        guard s.count == 22, s.unicodeScalars.allSatisfy({ $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_") }),
              let data = Data(base64Encoded: s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "=="),
              data.count == 16 else { return nil }
        return data
    }

    /// The typed code for 60 bits (the first 60 of 8 bytes): 12 Crockford characters in three
    /// groups of four.
    static func addDeviceCodeText(_ bytes: Data) -> String {
        precondition(bytes.count == 8, "an add-device code is made from 8 bytes")
        let bits = bytes.reduce(UInt64(0)) { $0 << 8 | UInt64($1) } >> 4
        let chars = (0 ..< 12).map { crockford[Int(bits >> UInt64((11 - $0) * 5) & 31)] }
        return stride(from: 0, to: 12, by: 4).map { String(chars[$0 ..< $0 + 4]) }.joined(separator: "-")
    }

    /// The canonical form of a typed code: its 12 characters, or nil when it can't be one.
    static func canonicalAddDeviceCode(_ typed: String) -> String? { canonicalCrockford(typed, count: 12) }

    /// The typed code stretched (PBKDF2-HMAC-SHA256, 600 000 rounds, salted with the account), so
    /// each guess at it costs. About a third of a second on a recent iPhone.
    static func addDeviceCodePrk(_ canonical: String, user: UUID) -> Data {
        let pw = Array(canonical.utf8CString.dropLast()), salt = Array("amber-notes/add-device|\(user.uuidString.lowercased())".utf8)
        var out = [UInt8](repeating: 0, count: 32)
        let status = CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pw, pw.count, salt, salt.count,
                                          CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), addDeviceRounds, &out, out.count)
        precondition(status == kCCSuccess, "PBKDF2 failed: \(status)")
        return Data(out)
    }

    /// What a pairing secret gives both devices: the answer the approving device shows the
    /// server (which holds only its hash), and the bind, which is never sent.
    struct AddDevicePairing: Sendable {
        let answer: String
        let bind: SymmetricKey
    }

    /// From the QR's 16 bytes, or the stretched typed code.
    static func addDevicePairing(prk: Data, user: UUID) -> AddDevicePairing {
        func derive(_ what: String) -> SymmetricKey {
            HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: prk), salt: hkdfSalt,
                                   info: Data("add-device \(what) \(user.uuidString.lowercased())".utf8), outputByteCount: 32)
        }
        return AddDevicePairing(answer: hex(bytes(derive("answer"))), bind: derive("bind"))
    }

    /// hex SHA-256 of the answer's 32 bytes: what the server keeps.
    static func addDeviceAnswerHash(_ answer: String) -> String { hex(SHA256.hash(data: fromHex(answer) ?? Data())) }

    /// The new device's public key and kind, vouched for by the pairing secret:
    /// hex HMAC-SHA256(bind, "amber-notes add-device|<request id>|<platform>|" ‖ key).
    static func addDeviceTag(bind: SymmetricKey, requestID: UUID, platform: String, publicKey: Data) -> String {
        let msg = Data("amber-notes add-device|\(requestID.uuidString.lowercased())|\(platform)|".utf8) + publicKey
        return hex(HMAC<SHA256>.authenticationCode(for: msg, using: bind))
    }

    // MARK: The new device's name, which the server never reads
    //
    // "amb2n." + base64(nonce 12 ‖ ciphertext ‖ tag 16), key HKDF-SHA256(bind, info "add-device
    // name"), AAD "amb2n|<request id>|<platform>".

    static let addDeviceNamePrefix = "amb2n."

    private static func addDeviceNameKey(_ bind: SymmetricKey) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: bind, salt: hkdfSalt, info: Data("add-device name".utf8), outputByteCount: 32)
    }

    private static func addDeviceNameAAD(_ request: UUID, _ platform: String) -> Data {
        Data("amb2n|\(request.uuidString.lowercased())|\(platform)".utf8)
    }

    /// `nonce` is for the test vector only.
    static func sealDeviceName(_ name: String, bind: SymmetricKey, requestID: UUID, platform: String, nonce: AES.GCM.Nonce = .init()) throws -> String {
        let box = try AES.GCM.seal(Data(name.utf8), using: addDeviceNameKey(bind), nonce: nonce, authenticating: addDeviceNameAAD(requestID, platform))
        guard let combined = box.combined else { throw Failure.malformed }
        return addDeviceNamePrefix + combined.base64EncodedString()
    }

    static func openDeviceName(_ sealed: String, bind: SymmetricKey, requestID: UUID, platform: String) throws -> String {
        guard sealed.hasPrefix(addDeviceNamePrefix), let all = Data(base64Encoded: String(sealed.dropFirst(addDeviceNamePrefix.count))),
              let box = try? AES.GCM.SealedBox(combined: all) else { throw Failure.malformed }
        guard let plain = try? AES.GCM.open(box, using: addDeviceNameKey(bind), authenticating: addDeviceNameAAD(requestID, platform)),
              let name = String(data: plain, encoding: .utf8) else { throw Failure.wrongKey }
        return name
    }

    // MARK: Sealing the key to the new device
    //
    // "amb2d." + base64(approving device's ephemeral public key, raw 65 ‖ nonce 12 ‖ ciphertext ‖
    // tag 16). Key: HKDF-SHA256 of the ECDH secret ‖ bind, salt "amber-notes/e2ee", info
    // "add-device <request id>"; AAD "amb2d|<request id>|<user id>". The bind in the key works both
    // ways: only someone who read the new device's screen can seal something it accepts, and
    // nobody who swapped its public key can open what was sealed.

    private static func addDeviceKey(_ secret: SharedSecret, bind: SymmetricKey, request: UUID) -> SymmetricKey {
        let ikm = secret.withUnsafeBytes { Data($0) } + bytes(bind)
        return HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: ikm), salt: hkdfSalt,
                                      info: Data("add-device \(request.uuidString.lowercased())".utf8), outputByteCount: 32)
    }

    private static func addDeviceAAD(_ request: UUID, _ user: UUID) -> Data {
        Data("amb2d|\(request.uuidString.lowercased())|\(user.uuidString.lowercased())".utf8)
    }

    /// The stored key (`StoredKey.encoded`) sealed to the new device's public key (raw
    /// uncompressed, 65 bytes). `ephemeral` and `nonce` are for the test vector only.
    static func sealDeviceKey(_ stored: Data, to publicKey: Data, bind: SymmetricKey, requestID: UUID, user: UUID,
                              ephemeral: P256.KeyAgreement.PrivateKey = .init(), nonce: AES.GCM.Nonce = .init()) throws -> String {
        guard publicKey.count == 65, publicKey.first == 4,
              let new = try? P256.KeyAgreement.PublicKey(x963Representation: publicKey) else { throw Failure.malformed }
        let key = addDeviceKey(try ephemeral.sharedSecretFromKeyAgreement(with: new), bind: bind, request: requestID)
        let box = try AES.GCM.seal(stored, using: key, nonce: nonce, authenticating: addDeviceAAD(requestID, user))
        guard let combined = box.combined else { throw Failure.malformed }
        return addDeviceSealedPrefix + (ephemeral.publicKey.x963Representation + combined).base64EncodedString()
    }

    static func openDeviceKey(_ sealed: String, privateKey: P256.KeyAgreement.PrivateKey, bind: SymmetricKey, requestID: UUID, user: UUID) throws -> Data {
        guard sealed.hasPrefix(addDeviceSealedPrefix), let all = Data(base64Encoded: String(sealed.dropFirst(addDeviceSealedPrefix.count))),
              all.count >= 65 + 12 + 16,
              let device = try? P256.KeyAgreement.PublicKey(x963Representation: all.prefix(65)),
              let box = try? AES.GCM.SealedBox(combined: all.dropFirst(65)) else { throw Failure.malformed }
        let key = addDeviceKey(try privateKey.sharedSecretFromKeyAgreement(with: device), bind: bind, request: requestID)
        guard let plain = try? AES.GCM.open(box, using: key, authenticating: addDeviceAAD(requestID, user)) else { throw Failure.wrongKey }
        return plain
    }

    // MARK: The devices that hold the key
    //
    // Each device with the key lists itself (key_devices). A row counts only when its tag, made
    // with a subkey of the key, verifies, and a removal only when its removal tag does: nobody
    // without the key can add a device to the list, or make one throw its key away. The device's
    // name is sealed like a folder's name (an amb2 box, context "device:<device id>"). Both tags
    // name the device's epoch: 16 random bytes it makes when it comes to hold the key.

    static func device(_ id: UUID) -> String { "device:" + id.uuidString.lowercased() }

    private static func devicesKey(_ key: SymmetricKey) -> SymmetricKey {
        HKDF<SHA256>.deriveKey(inputKeyMaterial: key, salt: hkdfSalt, info: Data("devices".utf8), outputByteCount: 32)
    }

    /// hex HMAC-SHA256(HKDF(DK, "devices"), "device|<user>|<device>|<platform>|<how>|<1 or 0>|<epoch>").
    static func keyDeviceTag(_ key: SymmetricKey, user: UUID, device: UUID, platform: String, how: String, backedUp: Bool, epoch: String) -> String {
        let msg = "device|\(user.uuidString.lowercased())|\(device.uuidString.lowercased())|\(platform)|\(how)|\(backedUp ? 1 : 0)|\(epoch)"
        return hex(HMAC<SHA256>.authenticationCode(for: Data(msg.utf8), using: devicesKey(key)))
    }

    /// hex HMAC-SHA256(HKDF(DK, "devices"), "remove|<user>|<device>|<epoch>"). The epoch is the
    /// one the device made when it came to hold the key, so a removal from before it was added
    /// again is worth nothing.
    static func keyDeviceRemovalTag(_ key: SymmetricKey, user: UUID, device: UUID, epoch: String) -> String {
        let msg = "remove|\(user.uuidString.lowercased())|\(device.uuidString.lowercased())|\(epoch)"
        return hex(HMAC<SHA256>.authenticationCode(for: Data(msg.utf8), using: devicesKey(key)))
    }

    /// Two hex tags, compared in constant time.
    static func tagsMatch(_ a: String, _ b: String?) -> Bool {
        guard let b else { return false }
        let x = Array(a.utf8), y = Array(b.lowercased().utf8)
        guard x.count == y.count, !x.isEmpty else { return false }
        var diff: UInt8 = 0
        for (p, q) in zip(x, y) { diff |= p ^ q }
        return diff == 0
    }
}

// MARK: The server's side

/// A request as the new device files it (`device_add_request`).
struct AddDeviceRequest: Encodable, Equatable, Sendable {
    var p_id: UUID
    var p_device: UUID
    var p_platform: String
    var p_public_key: String
    var p_scan_hash: String
    var p_scan_tag: String
    var p_scan_name: String
    var p_code_hash: String
    var p_code_tag: String
    var p_code_name: String
    var p_pickup_hash: String
}

/// What the new device hears when it asks whether it was answered (`device_add_pickup`).
struct AddDevicePickup: Decodable, Equatable, Sendable {
    enum State: String, Decodable, Sendable { case waiting, answered, taken, expired, gone }
    var state: State
    var sealed: String?
    var via: String?
}

/// The request a pairing secret belongs to (`device_add_find`), before its tag is checked.
struct AddDeviceFound: Decodable, Equatable, Sendable {
    var id: UUID
    var device_id: UUID
    var platform: String
    /// The device's name, sealed under the pairing secret that found it (amb2n).
    var name: String
    var public_key: String
    var tag: String
    var via: String
    var created_at: Date
}

enum AddDeviceAnswer: String, Decodable, Sendable { case added, wrong, expired }

/// `device_adds`, through its functions only. Every call throws when the server can't be
/// reached, and `AddDeviceError.tooMany` when the account is over its rate limit.
protocol AddDeviceServer: Sendable {
    func request(_ r: AddDeviceRequest) async throws -> Date
    func pickup(id: UUID, pickup: String) async throws -> AddDevicePickup
    /// The new device has the key (or gave up on this answer): the server drops the sealed copy.
    func done(id: UUID, pickup: String) async throws
    func find(answer: String) async throws -> AddDeviceFound?
    func answer(id: UUID, answer: String, sealed: String, device: UUID) async throws -> AddDeviceAnswer
}

enum AddDeviceError: LocalizedError, Equatable {
    /// Not an Amber Notes add-device code at all (some other QR code).
    case notACode
    /// The typed code isn't 12 letters and numbers.
    case typo
    /// No open request for this account has that code: wrong, expired, used, or another account's.
    case notFound
    /// The request's public key, name or kind isn't what the new device vouched for.
    case changed
    case expired
    case tooMany
    case offline
    /// This device can't hand the key over right now (it isn't open, or not confirmed yet).
    case notReady
    /// No Face ID, Touch ID or passcode on this device, so nobody is asked: it can't add one.
    case noDeviceLock

    var errorDescription: String? {
        switch self {
        case .notACode: "That isn't a Pinto Notes code. Scan the code on the screen that says \u{201C}Open your notes on this device\u{201D}."
        case .typo: "That code has a typo. It's 12 letters and numbers."
        case .notFound: "That code isn't waiting on your account. Check that both devices are signed in to the same account, then use the code the new device shows now."
        case .changed: "Something changed this request on the way. Nothing was sent. Show a new code on the new device and try again."
        case .expired: "That code expired. Use the code the new device shows now."
        case .tooMany: "Too many attempts. Wait a few minutes and try again."
        case .offline: "You're offline. Connect to the internet and try again."
        case .notReady: "Your notes aren't open on this device yet."
        case .noDeviceLock: "Set a passcode on this device first. Adding a device asks for it."
        }
    }
}

// MARK: The new device

/// What the new device holds while its code shows: its private key and both pairing secrets, in
/// memory only. `request` is what it files; nothing in it opens anything.
struct NewDeviceOffer: Sendable {
    let id: UUID
    let user: UUID
    /// This device's half of the key agreement; never leaves its memory.
    let agreement: P256.KeyAgreement.PrivateKey
    let qrText: String
    let codeText: String
    let scan: E2EE.AddDevicePairing
    let code: E2EE.AddDevicePairing
    let pickup: String
    let request: AddDeviceRequest

    /// Makes the key pair and the secrets. Stretches the typed code, so call it off the main actor.
    static func make(user: UUID, device: UUID, platform: String, name: String) -> NewDeviceOffer {
        let id = UUID(), agreement = P256.KeyAgreement.PrivateKey()
        let publicKey = agreement.publicKey.x963Representation
        let secret = E2EE.randomBytes(16), codeText = E2EE.addDeviceCodeText(E2EE.randomBytes(8))
        let scan = E2EE.addDevicePairing(prk: secret, user: user)
        let code = E2EE.addDevicePairing(prk: E2EE.addDeviceCodePrk(codeText.replacingOccurrences(of: "-", with: ""), user: user), user: user)
        let pickup = E2EE.randomHex()
        let name = AddDeviceNames.clean(name)
        func tag(_ p: E2EE.AddDevicePairing) -> String {
            E2EE.addDeviceTag(bind: p.bind, requestID: id, platform: platform, publicKey: publicKey)
        }
        func sealed(_ p: E2EE.AddDevicePairing) -> String {
            (try? E2EE.sealDeviceName(name, bind: p.bind, requestID: id, platform: platform)) ?? ""
        }
        let request = AddDeviceRequest(p_id: id, p_device: device, p_platform: platform, p_public_key: publicKey.base64EncodedString(),
                                       p_scan_hash: E2EE.addDeviceAnswerHash(scan.answer), p_scan_tag: tag(scan), p_scan_name: sealed(scan),
                                       p_code_hash: E2EE.addDeviceAnswerHash(code.answer), p_code_tag: tag(code), p_code_name: sealed(code),
                                       p_pickup_hash: E2EE.addDeviceAnswerHash(pickup))
        return NewDeviceOffer(id: id, user: user, agreement: agreement, qrText: E2EE.addDeviceQR(secret: secret), codeText: codeText,
                              scan: scan, code: code, pickup: pickup, request: request)
    }

    /// The key another device sealed for this offer. Throws unless it opens with the bind of the
    /// secret that device read. Whether it's the account's key is checked next (`AccountCrypto.adopt`).
    func open(_ answer: AddDevicePickup) throws -> StoredKey {
        guard answer.state == .answered, let sealed = answer.sealed else { throw E2EE.Failure.malformed }
        let bind = answer.via == "code" ? code.bind : scan.bind
        let plain = try E2EE.openDeviceKey(sealed, privateKey: agreement, bind: bind, requestID: id, user: user)
        guard let key = StoredKey(encoded: plain) else { throw E2EE.Failure.malformed }
        return key
    }
}

// MARK: The device that has the key

enum AddDeviceApproval {
    /// What was read off the new device's screen.
    enum Input: Equatable, Sendable {
        /// The QR code's text, from the scanner in the app.
        case scanned(String)
        /// The code, typed.
        case typed(String)
    }

    /// The new device, once its request was found and its tag checked: safe to show and to seal to.
    struct Candidate: Equatable, Sendable, Identifiable {
        let id: UUID
        let name: String
        let platform: String
        let publicKey: Data
        let askedAt: Date
        let answer: String
        let bind: Data

        /// "Mac", "iPhone" or "iPad". An iPad asks under the name "iPad" (iOS gives apps the model,
        /// not the name its owner chose), so "Add this iPad?" names the device being added.
        var kind: String { platform == "macos" ? "Mac" : name == "iPad" ? "iPad" : "iPhone" }
    }

    /// Reads the secret, finds this account's request for it, checks the new device's public
    /// key and kind against the tag only that device's screen could vouch for, and opens its name. Stretches a
    /// typed code, so it runs off the main actor.
    static func find(_ input: Input, user: UUID, server: AddDeviceServer) async throws -> Candidate {
        let prk: Data
        switch input {
        case .scanned(let text):
            guard let secret = E2EE.readAddDeviceQR(text) else { throw AddDeviceError.notACode }
            prk = secret
        case .typed(let text):
            guard let canonical = E2EE.canonicalAddDeviceCode(text) else { throw AddDeviceError.typo }
            prk = E2EE.addDeviceCodePrk(canonical, user: user)
        }
        let pairing = E2EE.addDevicePairing(prk: prk, user: user)
        let found: AddDeviceFound?
        do { found = try await server.find(answer: pairing.answer) } catch let e as AddDeviceError { throw e } catch { throw AddDeviceError.offline }
        guard let found else { throw AddDeviceError.notFound }
        guard let publicKey = Data(base64Encoded: found.public_key), publicKey.count == 65,
              E2EE.tagsMatch(E2EE.addDeviceTag(bind: pairing.bind, requestID: found.id, platform: found.platform, publicKey: publicKey), found.tag),
              let name = try? E2EE.openDeviceName(found.name, bind: pairing.bind, requestID: found.id, platform: found.platform)
        else { throw AddDeviceError.changed }
        return Candidate(id: found.id, name: AddDeviceNames.clean(name), platform: found.platform, publicKey: publicKey, askedAt: found.created_at,
                         answer: pairing.answer, bind: E2EE.bytes(pairing.bind))
    }

    /// Seals this device's key to the new device and stores it for pickup.
    static func approve(_ c: Candidate, key: StoredKey, user: UUID, device: UUID, server: AddDeviceServer) async throws {
        let sealed = try E2EE.sealDeviceKey(key.encoded, to: c.publicKey, bind: SymmetricKey(data: c.bind), requestID: c.id, user: user)
        let result: AddDeviceAnswer
        do { result = try await server.answer(id: c.id, answer: c.answer, sealed: sealed, device: device) } catch let e as AddDeviceError { throw e } catch { throw AddDeviceError.offline }
        // "wrong" can't happen for an answer that just found the request; treated like a request that's over.
        guard result == .added else { throw AddDeviceError.expired }
    }
}

/// What a device calls itself in a request and in the list of devices: its name where the system
/// gives one (a Mac's computer name), otherwise its kind.
enum AddDeviceNames {
    static func clean(_ name: String) -> String {
        let s = String(name.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }.map(Character.init))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return s.isEmpty ? InstallID.kind : String(s.prefix(60))
    }

    static var thisDevice: String {
        #if os(macOS)
        clean(Host.current().localizedName ?? "Mac")
        #else
        // iOS gives apps the model ("iPhone"), not the name its owner chose.
        InstallID.kind
        #endif
    }
}

extension InstallID {
    /// "iPhone", "iPad" or "Mac": what the screens call this device.
    static var kind: String { platform == "macos" ? "Mac" : isPad ? "iPad" : "iPhone" }

    /// From the hardware's model name ("iPad14,3"), so it can be read off the main actor; the
    /// simulator gives its model in the environment.
    private static let isPad: Bool = {
        var system = utsname()
        uname(&system)
        let machine = withUnsafeBytes(of: &system.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
        return (ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine).hasPrefix("iPad")
    }()
}
