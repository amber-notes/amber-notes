import CryptoKit
import Foundation
import SwiftData

/// Share (prototype): one link per note, View or Edit (ShareSheet).
///
/// The link is `<site>/s/<id>#<secret>`. From the secret come:
/// - the key the read-only copy is sealed under (`SealedLink`), for View and Edit alike;
/// - with Edit on, the join answer (the server keeps its SHA-256) and the key the note key is sealed
///   under for whoever joins (`note_invite_links`). Neither leaves the device except inside the link.
extension CollabStore {
    /// The values an Edit link's secret gives: what proves you hold it, and the key that opens the
    /// note key. The same derivation as `linkKeys` in supabase/functions/_shared/collab.ts.
    nonisolated static func linkKeys(_ secret: Data, link: String) -> (answer: String, answerHash: String, key: SymmetricKey) {
        let base = SymmetricKey(data: secret)
        let answer = HKDF<SHA256>.deriveKey(inputKeyMaterial: base, salt: E2EE.hkdfSalt, info: Data("invite answer \(link.lowercased())".utf8), outputByteCount: 32)
        let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: base, salt: E2EE.hkdfSalt, info: Data("invite key \(link.lowercased())".utf8), outputByteCount: 32)
        let raw = E2EE.bytes(answer)
        return (E2EE.hex(raw), E2EE.hex(SHA256.hash(data: raw)), key)
    }

    func linkURL(_ note: Note) -> URL? {
        guard let l = links[note.id] else { return nil }
        return URL(string: "\(Self.site)/s/\(l.id)#\(SealedLink.base64url(l.secret))")
    }

    func access(_ note: Note) -> ShareState.Access { editable.contains(note.id) ? .edit : .view }

    /// A link for the note, View to start with. Publishing again refreshes the read-only copy.
    func ensureLink(_ note: Note) async throws {
        _ = try await publishLink(note)
    }

    func setAccess(_ access: ShareState.Access, for note: Note) async throws {
        guard let relay else { throw CollabRelay.Problem(message: "Not connected") }
        switch access {
        case .off:
            // The link stops working at once. Turning it on again makes a new one.
            try await stopSharing(note)
            linkOff.insert(note.id)
        case .view:
            linkOff.remove(note.id)
            if links[note.id] == nil { _ = try await publishLink(note) }
            if sessions[note.id] != nil, editable.contains(note.id) { try await relay.rpc("collab_stop_link", [note.id.uuidString.lowercased()]) }
            editable.remove(note.id)
        case .edit:
            linkOff.remove(note.id)
            // The note becomes a shared note (its own key) if it isn't one yet.
            if sessions[note.id] == nil { try await share(note) }
            if links[note.id] == nil { _ = try await publishLink(note) }
            try await publishEditLink(note)
            editable.insert(note.id)
        }
    }

    private func publishEditLink(_ note: Note) async throws {
        guard let relay, let l = links[note.id], let k = keys[note.id] else { return }
        let lk = Self.linkKeys(l.secret, link: l.id)
        let wrap = try NoteCrypto.seal(E2EE.bytes(k.nk).base64EncodedString(), key: lk.key, keyID: E2EE.keyID(of: k.nk), context: "invite:\(l.id.lowercased())")
        try await relay.rpc("collab_create_link", [l.id, note.id.uuidString.lowercased(), "editor", k.epoch, lk.answerHash, wrap])
    }

    /// Removes someone: quietly, a new key for everyone else and a new link (the old one would let
    /// them back in). The new link reaches people when it's shared again.
    func remove(_ user: UUID, from note: Note) async throws {
        try await rotate(note, removing: user)
        guard !linkOff.contains(note.id) else { return }
        _ = try await publishLink(note, rotate: true)
        if editable.contains(note.id) { try await publishEditLink(note) }
    }

    func stopSharing(_ note: Note) async throws {
        try await stopLink(note)
        if sessions[note.id] != nil { try? await relay?.rpc("collab_stop_link", [note.id.uuidString.lowercased()]) }
        editable.remove(note.id)
    }

    /// A new note key, sealed from this device to every member who stays, in one call; then the
    /// document re-sealed under it, so devices that join later start from there.
    private func rotate(_ note: Note, removing user: UUID?) async throws {
        guard let relay, let me, let session = sessions[note.id], let old = keys[note.id] else { return }
        let members = try await relay.rpc("collab_members", [note.id.uuidString.lowercased()], as: [CollabRelay.Member].self)
        let epoch = old.epoch + 1
        let nk = SymmetricKey(size: .bits256)
        var wraps: [[String: String]] = []
        for m in members where m.user_id != user {
            guard let key = m.public_key.flatMap({ Data(base64Encoded: $0) }) else { continue }
            wraps.append(["user_id": m.user_id.uuidString.lowercased(),
                          "key_wrap": try CollabCrypto.sealNoteKey(nk, from: identity, to: key, party: .init(note: note.id, epoch: epoch, from: me, to: m.user_id))])
        }
        let json = String(decoding: try JSONSerialization.data(withJSONObject: wraps), as: UTF8.self)
        try await relay.rpc("collab_remove", [note.id.uuidString.lowercased(), user.map { $0.uuidString.lowercased() } ?? NSNull(), epoch, json])
        try await relay.rpc("collab_accept", [note.id.uuidString.lowercased(), try CollabCrypto.selfWrap(nk, dataKey: dataKey.key, note: note.id, epoch: epoch)])
        keys[note.id] = (nk, epoch)
        session.reseal(nk: nk, epoch: epoch)
        _ = try? await relay.post("snapshots", ["note_id": note.id.uuidString.lowercased(), "upto": session.lastSeen, "epoch": epoch,
                                                "ct": try session.sealedSnapshot(upto: session.lastSeen)], as: CollabRelay.AnyRow.self)
        await session.refreshMembers()
    }

    /// Who's in the note, for the Share sheet: you first, then the others in the order they joined.
    func people(in note: Note) -> [ShareState.Person] {
        guard let session = sessions[note.id] else { return [] }
        return session.members.map { m in
            ShareState.Person(id: m.id, name: m.name, isMe: m.id == session.me, role: m.role,
                              safetyCode: m.id == session.me ? nil : m.publicKey.map { CollabCrypto.safetyCode(identity.publicRaw, $0) })
        }.sorted { ($0.isMe ? 0 : 1, $0.role == "owner" ? 0 : 1) < ($1.isMe ? 0 : 1, $1.role == "owner" ? 0 : 1) }
    }

    // MARK: Opening a link

    /// A link's id and secret, from `…/s/<id>#<secret>` (or ambernotes://s/<id>#<secret>).
    nonisolated static func parseLink(_ url: URL) -> (id: String, secret: Data)? {
        let parts = url.path.split(separator: "/").map(String.init)
        let id: String
        if url.scheme == AppIdentity.scheme, url.host == "s", let first = parts.first { id = first }
        else if let i = parts.firstIndex(of: "s"), i + 1 < parts.count { id = parts[i + 1] }
        else { return nil }
        guard id.range(of: #"^[A-Za-z0-9_-]{22}$"#, options: .regularExpression) != nil, let frag = url.fragment,
              frag.range(of: #"^[A-Za-z0-9_-]{22}$"#, options: .regularExpression) != nil else { return nil }
        var b64 = frag.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let secret = Data(base64Encoded: b64) else { return nil }
        return (id, secret)
    }

    /// An Edit link opened in the app: joins the note as an editor and opens it. A View link (or one
    /// whose Edit was turned off) says so; the product would open its read-only copy here too.
    @discardableResult
    func join(_ url: URL) async -> Bool {
        guard let relay, let me, let context, let (id, secret) = Self.parseLink(url) else { return false }
        let lk = Self.linkKeys(secret, link: id)
        struct Opened: Decodable { let note_id: UUID; let role: String; let epoch: Int; let key_wrap: String }
        guard let opened = (try? await relay.rpc("collab_open_link", [id, lk.answer], as: [Opened].self))?.first else {
            joinProblem = "This link is view only. Ask for a link that lets you edit."
            return false
        }
        do {
            guard let text = try? NoteCrypto.open(opened.key_wrap, key: lk.key, context: "invite:\(id.lowercased())"),
                  let raw = Data(base64Encoded: text), raw.count == 32 else { throw CollabCrypto.Failure.wrongKey }
            let nk = SymmetricKey(data: raw)
            let toSelf = try CollabCrypto.sealNoteKey(nk, from: identity, to: identity.publicRaw, party: .init(note: opened.note_id, epoch: opened.epoch, from: me, to: me))
            try await relay.rpc("collab_join_link", [id, lk.answer, toSelf, try CollabCrypto.selfWrap(nk, dataKey: dataKey.key, note: opened.note_id, epoch: opened.epoch)])
            handled.insert(opened.note_id)
            let session = try await CollabSession.load(note: opened.note_id, epoch: opened.epoch, nk: nk, relay: relay, me: me, name: name)
            keys[opened.note_id] = (nk, opened.epoch)
            let note = context.note(opened.note_id) ?? {
                let n = Note(body: session.text)
                n.id = opened.note_id
                context.insert(n)
                return n
            }()
            note.body = session.text
            note.updatedAt = .now
            try? context.save()
            openSession(session, note: note)
            NoteOpener.shared.open(note.id)
            return true
        } catch {
            joinProblem = "This link didn't open. Ask for a new one."
            return false
        }
    }

    /// Your memberships, checked now and then: a new key (someone was removed, or the link was
    /// reset) is opened and taken; a note you were removed from stops syncing.
    func followKeys(_ rows: [CollabRelay.Membership]) async {
        for (id, session) in sessions {
            guard let row = rows.first(where: { $0.note_id == id }) else {
                session.disconnect()
                sessions[id] = nil
                removedFrom.insert(id)
                continue
            }
            guard row.epoch > session.epoch, let opened = try? await openKey(row) else { continue }
            try? await relay?.rpc("collab_accept", [id.uuidString.lowercased(), try CollabCrypto.selfWrap(opened.nk, dataKey: dataKey.key, note: id, epoch: row.epoch)])
            keys[id] = (opened.nk, row.epoch)
            session.reseal(nk: opened.nk, epoch: row.epoch)
        }
    }
}
