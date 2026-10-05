import CryptoKit
import Foundation

/// Collaboration (prototype): the formats for shared notes, the same as
/// `supabase/functions/_shared/collab.ts`. See docs/Technical/collaboration-design.md.
///
/// Every account has an identity key pair (P-256). A shared note has a note key (NK) per epoch,
/// sealed to each member's identity key by whoever made or passed it on (`amb3k`), and once
/// accepted, under the member's own data key. Changes, snapshots, presence and the note's head are
/// sealed with NK (`amb3u`, `amb3s`, `amb3p`, `amb3h`).
enum CollabCrypto {
    enum Failure: Error, Equatable { case malformed, wrongKey }

    static let salt = E2EE.hkdfSalt

    // MARK: Identity

    struct Identity: Sendable {
        let privateKey: P256.KeyAgreement.PrivateKey
        var publicRaw: Data { privateKey.publicKey.x963Representation }
        var publicBase64: String { publicRaw.base64EncodedString() }

        init(_ key: P256.KeyAgreement.PrivateKey = .init()) { privateKey = key }

        /// From the 32-byte scalar kept sealed under the data key.
        init(scalar: Data) throws { privateKey = try P256.KeyAgreement.PrivateKey(rawRepresentation: scalar) }
        var scalar: Data { privateKey.rawRepresentation }
    }

    static func identityContext(_ user: UUID) -> String { "identity:" + user.uuidString.lowercased() }
    static func noteKeyContext(_ note: UUID, epoch: Int) -> String { "notekey:\(note.uuidString.lowercased()):\(epoch)" }

    /// The identity's private half sealed under the data key, for the server (an amb2 box).
    static func wrapIdentity(_ id: Identity, dataKey: SymmetricKey, user: UUID) throws -> String {
        try NoteCrypto.seal(id.scalar.base64EncodedString(), key: dataKey, keyID: E2EE.keyID(of: dataKey), context: identityContext(user))
    }

    static func unwrapIdentity(_ box: String, dataKey: SymmetricKey, user: UUID) throws -> Identity {
        guard let text = try? NoteCrypto.open(box, key: dataKey, context: identityContext(user)), let d = Data(base64Encoded: text) else { throw Failure.wrongKey }
        return try Identity(scalar: d)
    }

    // MARK: The note key between members

    struct Party: Sendable {
        var note: UUID, epoch: Int, from: UUID, to: UUID
        var info: String { "notekey \(note.uuidString.lowercased()) \(epoch) \(from.uuidString.lowercased()) \(to.uuidString.lowercased())" }
        var aad: Data { Data("amb3k|\(note.uuidString.lowercased())|\(epoch)|\(from.uuidString.lowercased())|\(to.uuidString.lowercased())".utf8) }
    }

    private static func wrapKey(ephemeral: SharedSecret, fromStatic: SharedSecret, party: Party) -> SymmetricKey {
        let ikm = ephemeral.withUnsafeBytes { Data($0) } + fromStatic.withUnsafeBytes { Data($0) }
        return HKDF<SHA256>.deriveKey(inputKeyMaterial: SymmetricKey(data: ikm), salt: salt, info: Data(party.info.utf8), outputByteCount: 32)
    }

    /// NK sealed from `sender` to the member whose identity public key is `to`. Both an ephemeral and
    /// the sender's identity take part, so only that sender could have made it.
    static func sealNoteKey(_ nk: SymmetricKey, from sender: Identity, to: Data, party: Party) throws -> String {
        guard let recipient = try? P256.KeyAgreement.PublicKey(x963Representation: to) else { throw Failure.malformed }
        let eph = P256.KeyAgreement.PrivateKey()
        let key = wrapKey(ephemeral: try eph.sharedSecretFromKeyAgreement(with: recipient),
                          fromStatic: try sender.privateKey.sharedSecretFromKeyAgreement(with: recipient), party: party)
        let box = try AES.GCM.seal(E2EE.bytes(nk), using: key, authenticating: party.aad)
        guard let combined = box.combined else { throw Failure.malformed }
        return "amb3k." + (eph.publicKey.x963Representation + combined).base64EncodedString()
    }

    /// Opens a wrap made for `me`, checking it came from the member whose public key is `from`.
    static func openNoteKey(_ sealed: String, me: Identity, from: Data, party: Party) throws -> SymmetricKey {
        guard sealed.hasPrefix("amb3k."), let b = Data(base64Encoded: String(sealed.dropFirst(6))), b.count == 65 + 12 + 32 + 16,
              let eph = try? P256.KeyAgreement.PublicKey(x963Representation: b.prefix(65)),
              let sender = try? P256.KeyAgreement.PublicKey(x963Representation: from),
              let box = try? AES.GCM.SealedBox(combined: b.dropFirst(65)) else { throw Failure.malformed }
        let key = wrapKey(ephemeral: try me.privateKey.sharedSecretFromKeyAgreement(with: eph),
                          fromStatic: try me.privateKey.sharedSecretFromKeyAgreement(with: sender), party: party)
        guard let raw = try? AES.GCM.open(box, using: key, authenticating: party.aad) else { throw Failure.wrongKey }
        return SymmetricKey(data: raw)
    }

    /// NK under the member's own data key (what their other devices and their AI open).
    static func selfWrap(_ nk: SymmetricKey, dataKey: SymmetricKey, note: UUID, epoch: Int) throws -> String {
        try NoteCrypto.seal(E2EE.bytes(nk).base64EncodedString(), key: dataKey, keyID: E2EE.keyID(of: dataKey), context: noteKeyContext(note, epoch: epoch))
    }

    static func openSelfWrap(_ box: String, dataKey: SymmetricKey, note: UUID, epoch: Int) throws -> SymmetricKey {
        guard let text = try? NoteCrypto.open(box, key: dataKey, context: noteKeyContext(note, epoch: epoch)),
              let raw = Data(base64Encoded: text), raw.count == 32 else { throw Failure.wrongKey }
        return SymmetricKey(data: raw)
    }

    // MARK: Boxes under the note key

    enum Kind: String, Sendable { case update = "u", snapshot = "s", presence = "p", head = "h" }

    private static func aad(_ kind: Kind, note: UUID, epoch: Int, extra: String?) -> Data {
        Data("amb3\(kind.rawValue)|\(note.uuidString.lowercased())|\(epoch)\(extra.map { "|" + $0.lowercased() } ?? "")".utf8)
    }

    /// `extra`: the author's id for an update, `upto` for a snapshot, the user's id for presence, nil for the head.
    static func seal(_ kind: Kind, _ data: Data, nk: SymmetricKey, note: UUID, epoch: Int, extra: String? = nil) throws -> String {
        let box = try AES.GCM.seal(data, using: nk, authenticating: aad(kind, note: note, epoch: epoch, extra: extra))
        guard let combined = box.combined else { throw Failure.malformed }
        return "amb3\(kind.rawValue).\(epoch).\(combined.base64EncodedString())"
    }

    static func open(_ kind: Kind, _ sealed: String, nk: SymmetricKey, note: UUID, extra: String? = nil) throws -> Data {
        let parts = sealed.split(separator: ".", maxSplits: 2)
        guard parts.count == 3, parts[0] == "amb3\(kind.rawValue)", let epoch = Int(parts[1]),
              let b = Data(base64Encoded: String(parts[2])), let box = try? AES.GCM.SealedBox(combined: b) else { throw Failure.malformed }
        guard let plain = try? AES.GCM.open(box, using: nk, authenticating: aad(kind, note: note, epoch: epoch, extra: extra)) else { throw Failure.wrongKey }
        return plain
    }

    // MARK: Checking who you share with

    /// Twelve digits two people can compare to know the server gave each of them the other's real
    /// key. The same on both sides, whichever way round.
    static func safetyCode(_ a: Data, _ b: Data) -> String {
        let (x, y) = a.base64EncodedString() < b.base64EncodedString() ? (a, b) : (b, a)
        let d = Array(SHA256.hash(data: Data("amber-notes safety v1".utf8) + x + y))
        return (0..<3).map { i -> String in
            let n = (UInt32(d[i * 4]) << 24 | UInt32(d[i * 4 + 1]) << 16 | UInt32(d[i * 4 + 2]) << 8 | UInt32(d[i * 4 + 3])) % 10000
            return String(format: "%04u", n)
        }.joined(separator: " ")
    }
}
