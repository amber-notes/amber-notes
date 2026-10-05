import CryptoKit
import Foundation
import Observation
import SwiftData
import os

private let log = Logger(subsystem: "dev.emilwagman.pane", category: "collab")

/// Collaboration (prototype): this device's side of shared notes. Off unless the app is launched
/// with `-collab <name> -collabRelay <url>` (scripts/collab-demo.sh), against the local relay.
///
/// What's real: the identity key pair, the note key sealed between people (`amb3k`), the sealed
/// Automerge changes, snapshots and presence, the server's membership rules (the migration, under
/// row-level security). What stands in: the account (made by the relay, no sign-in), and the data
/// key, which is made at launch here instead of coming from AccountCrypto.
@MainActor
@Observable
final class CollabStore {
    static var shared: CollabStore?

    struct Invite: Identifiable, Equatable {
        let id: UUID
        let title: String
        let from: String
        let safetyCode: String
    }

    let name: String
    let email: String
    private let relayURL: URL
    private(set) var me: UUID?
    private(set) var relay: CollabRelay?
    private let identity = CollabCrypto.Identity()
    private let dataKey = StoredKey.generate()
    /// Open shared notes, by note id.
    private(set) var sessions: [UUID: CollabSession] = [:]
    /// An invitation waiting for an answer.
    var invite: Invite?
    @ObservationIgnored private var keys: [UUID: (nk: SymmetricKey, epoch: Int)] = [:]
    @ObservationIgnored private var handled: Set<UUID> = []
    @ObservationIgnored var context: ModelContext?
    /// Sealed links by note: the link's id and secret (in the product, kept in a synced Keychain
    /// item so every device can republish the copy).
    @ObservationIgnored var links: [UUID: (id: String, secret: Data)] = [:]
    /// Shared templates by note.
    @ObservationIgnored var templates: [UUID: String] = [:]
    /// Note pages by note: a stand-in for NotePageStore on the note-pages branch.
    var pages: [UUID: String] = [:]
    var relayURLString: String { relayURL.absoluteString.hasSuffix("/") ? String(relayURL.absoluteString.dropLast()) : relayURL.absoluteString }

    static func fromArguments(_ args: [String] = ProcessInfo.processInfo.arguments) -> CollabStore? {
        guard let i = args.firstIndex(of: "-collab"), i + 1 < args.count else { return nil }
        let name = args[i + 1]
        let relay = args.firstIndex(of: "-collabRelay").flatMap { args.indices.contains($0 + 1) ? URL(string: args[$0 + 1]) : nil }
            ?? URL(string: "http://127.0.0.1:56480")!
        let full = args.firstIndex(of: "-collabName").flatMap { args.indices.contains($0 + 1) ? args[$0 + 1] : nil } ?? name.capitalized
        return CollabStore(name: full, email: "\(name.lowercased())@example.com", relay: relay)
    }

    init(name: String, email: String, relay: URL) {
        self.name = name
        self.email = email
        relayURL = relay
    }

    var isReady: Bool { relay != nil }

    func session(for note: UUID) -> CollabSession? { sessions[note] }

    /// The account and its identity key, on the relay.
    func start() async {
        do {
            let me = try await CollabRelay.makeUser(base: relayURL, email: email, name: name)
            let relay = CollabRelay(base: relayURL, user: me)
            let row = try dataKey.serverRow(user: me)
            try await relay.rpc("create_account_key", [row.key_id, row.verifier, row.recovery_wrap, 0])
            try await relay.rpc("collab_publish_identity", [identity.publicBase64, try CollabCrypto.wrapIdentity(identity, dataKey: dataKey.key, user: me)])
            self.me = me
            self.relay = relay
            log.info("collab ready as \(self.name, privacy: .public)")
            pollInvites()
        } catch {
            log.error("collab start failed: \(String(describing: error), privacy: .public)")
        }
    }

    // MARK: Sharing

    /// Makes the note shared: a note key, the owner's membership, the document's first snapshot.
    @discardableResult
    func share(_ note: Note) async throws -> CollabSession {
        if let s = sessions[note.id] { return s }
        guard let relay, let me else { throw CollabRelay.Problem(message: "Not connected") }
        let nk = SymmetricKey(size: .bits256)
        let toSelf = try CollabCrypto.sealNoteKey(nk, from: identity, to: identity.publicRaw, party: .init(note: note.id, epoch: 1, from: me, to: me))
        let head = try CollabCrypto.seal(.head, Data(NoteHead.of(note.body).json.utf8), nk: nk, note: note.id, epoch: 1)
        try await relay.rpc("collab_share", [note.id.uuidString.lowercased(), toSelf,
                                             try CollabCrypto.selfWrap(nk, dataKey: dataKey.key, note: note.id, epoch: 1), head])
        let session = try CollabSession.create(note: note.id, epoch: 1, nk: nk, initial: note.body, relay: relay, me: me, name: name)
        _ = try await relay.post("snapshots", ["note_id": note.id.uuidString.lowercased(), "upto": 0, "epoch": 1,
                                               "ct": try session.sealedSnapshot(upto: 0)], as: CollabRelay.AnyRow.self)
        keys[note.id] = (nk, 1)
        open(session, note: note)
        return session
    }

    /// Who an address belongs to, with the safety code you'd compare with them.
    func find(_ email: String) async throws -> (person: CollabRelay.Person, code: String)? {
        guard let relay else { return nil }
        let found = try await relay.rpc("collab_find_person", [email], as: [CollabRelay.Person].self)
        guard let p = found.first, let key = Data(base64Encoded: p.public_key) else { return nil }
        return (p, CollabCrypto.safetyCode(identity.publicRaw, key))
    }

    func invite(_ person: CollabRelay.Person, to note: UUID, role: String = "editor") async throws {
        guard let relay, let me, let k = keys[note], let key = Data(base64Encoded: person.public_key) else { return }
        let wrap = try CollabCrypto.sealNoteKey(k.nk, from: identity, to: key, party: .init(note: note, epoch: k.epoch, from: me, to: person.user_id))
        try await relay.rpc("collab_invite", [note.uuidString.lowercased(), person.user_id.uuidString.lowercased(), role, wrap, k.epoch])
        await sessions[note]?.refreshMembers()
    }

    // MARK: Being invited

    private func pollInvites() {
        Task { [weak self] in
            while let self, !Task.isCancelled {
                await self.checkInvites()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func checkInvites() async {
        guard let relay, invite == nil,
              let rows = try? await relay.get("memberships", as: [CollabRelay.Membership].self) else { return }
        for row in rows where row.accepted_at == nil && !handled.contains(row.note_id) {
            guard let opened = try? await openKey(row) else { continue }
            let head = row.head_ct.flatMap { try? CollabCrypto.open(.head, $0, nk: opened.nk, note: row.note_id) }
                .flatMap { try? JSONDecoder().decode(NoteHead.self, from: $0) }
            invite = Invite(id: row.note_id, title: head?.title ?? "A note", from: opened.from.display_name ?? "Someone",
                            safetyCode: CollabCrypto.safetyCode(identity.publicRaw, Data(base64Encoded: opened.from.public_key ?? "") ?? Data()))
            return
        }
    }

    /// Opens NK from your membership, checking it was sealed by the member the row names.
    private func openKey(_ row: CollabRelay.Membership) async throws -> (nk: SymmetricKey, from: CollabRelay.Member) {
        guard let relay, let me else { throw CollabRelay.Problem(message: "Not connected") }
        let members = try await relay.rpc("collab_members", [row.note_id.uuidString.lowercased()], as: [CollabRelay.Member].self)
        guard let sealer = members.first(where: { $0.user_id == row.wrapped_by }), let key = sealer.public_key.flatMap({ Data(base64Encoded: $0) }) else {
            throw CollabCrypto.Failure.malformed
        }
        let nk = try CollabCrypto.openNoteKey(row.key_wrap, me: identity, from: key, party: .init(note: row.note_id, epoch: row.epoch, from: row.wrapped_by, to: me))
        let inviter = members.first { $0.user_id == row.invited_by } ?? sealer
        return (nk, inviter)
    }

    /// Accepts: NK under your own data key, the note into your library, opened.
    func accept(_ invite: Invite) async {
        self.invite = nil
        handled.insert(invite.id)
        guard let relay, let me, let context,
              let row = (try? await relay.get("memberships", as: [CollabRelay.Membership].self))?.first(where: { $0.note_id == invite.id }) else { return }
        do {
            let opened = try await openKey(row)
            try await relay.rpc("collab_accept", [row.note_id.uuidString.lowercased(), try CollabCrypto.selfWrap(opened.nk, dataKey: dataKey.key, note: row.note_id, epoch: row.epoch)])
            let session = try await CollabSession.load(note: row.note_id, epoch: row.epoch, nk: opened.nk, relay: relay, me: me, name: name)
            keys[row.note_id] = (opened.nk, row.epoch)
            let note = context.note(row.note_id) ?? {
                let n = Note(body: session.text)
                n.id = row.note_id
                context.insert(n)
                return n
            }()
            note.body = session.text
            note.updatedAt = .now
            try? context.save()
            open(session, note: note)
            NoteOpener.shared.open(note.id)
        } catch {
            log.error("accepting failed: \(String(describing: error), privacy: .public)")
        }
    }

    func decline(_ invite: Invite) {
        self.invite = nil
        handled.insert(invite.id)
    }

    private func open(_ session: CollabSession, note: Note) {
        sessions[note.id] = session
        session.onSettled = { [weak note] text in
            guard let note, note.body != text else { return }
            note.body = text
            note.updatedAt = .now
        }
        session.connect()
    }
}
