import Automerge
import CryptoKit
import Foundation
import Observation
import SwiftUI
import os

private let log = Logger(subsystem: "dev.emilwagman.pane", category: "collab")

/// Collaboration (prototype): one shared note while it's open on this device.
///
/// The note's text is an Automerge document (UTF-16 offsets, so they match the editor's NSString
/// ranges). Your typing becomes splices into it; each splice goes up as a sealed change and comes
/// to the others over the note's channel. What arrives is merged by Automerge, and the editor
/// takes the merged text through the same minimal-diff path it uses for sync (your caret stays).
/// Presence (who's here, their cursor, whether they're typing) goes over the same channel, sealed.
@MainActor
@Observable
final class CollabSession {
    struct Peer: Identifiable, Equatable {
        let id: UUID
        var name: String
        var selection: NSRange?
        var typingUntil: Date?
        var isTyping: Bool { (typingUntil ?? .distantPast) > .now }
    }

    struct Member: Identifiable, Equatable {
        let id: UUID
        var name: String
        var role: String
        var publicKey: Data?
        var accepted: Bool
    }

    let noteID: UUID
    let epoch: Int
    let me: UUID
    let myName: String
    private let nk: SymmetricKey
    private let relay: CollabRelay
    private let doc: Document
    private let body: ObjId
    /// The document's text as last given to (or taken from) the editor.
    private(set) var text: String
    /// Who else has the note open right now, by user id.
    private(set) var peers: [UUID: Peer] = [:]
    private(set) var members: [Member] = []
    private(set) var lastSeen: Int64 = 0
    /// Updates already in the document. Ids don't arrive in order (your own come back from the
    /// server before someone else's earlier one reaches you), so this, not `lastSeen`, decides.
    @ObservationIgnored private var applied: Set<Int64> = []
    /// Hands merged text to the open editor.
    @ObservationIgnored var onRemoteText: ((String) -> Void)?
    /// Mirrors the text into the note (list title, search) once it settles.
    @ObservationIgnored var onSettled: ((String) -> Void)?
    @ObservationIgnored private var channel: CollabRelay.Channel?
    @ObservationIgnored private var outbox: [Data] = []
    @ObservationIgnored private var sending = false
    @ObservationIgnored private var mySelection: NSRange?
    @ObservationIgnored private var typingAt = Date.distantPast
    @ObservationIgnored private var presenceTask: Task<Void, Never>?
    @ObservationIgnored private var settleTask: Task<Void, Never>?

    /// A new shared document holding `initial` (the owner, when sharing).
    static func create(note: UUID, epoch: Int, nk: SymmetricKey, initial: String, relay: CollabRelay, me: UUID, name: String) throws -> CollabSession {
        let doc = Document(textEncoding: .utf16)
        let body = try doc.putObject(obj: .ROOT, key: "body", ty: .Text)
        try doc.spliceText(obj: body, start: 0, delete: 0, value: initial)
        return CollabSession(note: note, epoch: epoch, nk: nk, doc: doc, body: body, relay: relay, me: me, name: name)
    }

    /// The document as the server has it: the newest snapshot, then the changes after it.
    static func load(note: UUID, epoch: Int, nk: SymmetricKey, relay: CollabRelay, me: UUID, name: String) async throws -> CollabSession {
        let pull = try await relay.get("updates", query: ["note": note.uuidString.lowercased(), "after": "0"], as: CollabRelay.Pull.self)
        let doc = Document(textEncoding: .utf16)
        var last: Int64 = 0
        if let s = pull.snapshot {
            let saved = try CollabCrypto.open(.snapshot, s.ct, nk: nk, note: note, extra: String(s.upto))
            try doc.applyEncodedChanges(encoded: saved)
            last = s.upto
        }
        for u in pull.updates {
            try doc.applyEncodedChanges(encoded: try CollabCrypto.open(.update, u.ct, nk: nk, note: note, extra: u.author_id.uuidString))
            last = max(last, u.id)
        }
        let loaded = Set(pull.updates.map(\.id))
        guard case .Object(let body, .Text)? = try doc.get(obj: .ROOT, key: "body") else { throw CollabCrypto.Failure.malformed }
        let s = CollabSession(note: note, epoch: epoch, nk: nk, doc: doc, body: body, relay: relay, me: me, name: name)
        s.lastSeen = last
        s.applied = loaded
        return s
    }

    private init(note: UUID, epoch: Int, nk: SymmetricKey, doc: Document, body: ObjId, relay: CollabRelay, me: UUID, name: String) {
        noteID = note
        self.epoch = epoch
        self.nk = nk
        self.doc = doc
        self.body = body
        self.relay = relay
        self.me = me
        myName = name
        text = (try? doc.text(obj: body)) ?? ""
    }

    /// The whole document sealed, for the server to hand to devices starting out.
    func sealedSnapshot(upto: Int64) throws -> String {
        try CollabCrypto.seal(.snapshot, doc.save(), nk: nk, note: noteID, epoch: epoch, extra: String(upto))
    }

    // MARK: Live

    func connect() {
        guard channel == nil else { return }
        channel = relay.join(note: noteID) { [weak self] event in self?.receive(event) }
        Task { await refreshMembers() }
        // Catch up on anything that landed between loading and joining.
        Task { await catchUp() }
        sendPresence()
        // Presence is re-sent now and then, so someone who joins later sees you without waiting.
        presenceTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                self?.sendPresence()
            }
        }
    }

    func disconnect() {
        presenceTask?.cancel()
        channel?.close()
        channel = nil
        peers = [:]
    }

    func refreshMembers() async {
        guard let rows = try? await relay.rpc("collab_members", [noteID.uuidString.lowercased()], as: [CollabRelay.Member].self) else { return }
        members = rows.map { Member(id: $0.user_id, name: $0.display_name ?? "Someone", role: $0.role,
                                    publicKey: $0.public_key.flatMap { Data(base64Encoded: $0) }, accepted: $0.accepted) }
    }

    private func catchUp() async {
        guard let pull = try? await relay.get("updates", query: ["note": noteID.uuidString.lowercased(), "after": String(lastSeen)], as: CollabRelay.Pull.self) else { return }
        for u in pull.updates { apply(u) }
    }

    private func receive(_ event: CollabRelay.Event) {
        switch event {
        case .update(let u):
            apply(u)
        case .presence(let user, let ct):
            guard user != me, let data = try? CollabCrypto.open(.presence, ct, nk: nk, note: noteID, extra: user.uuidString),
                  let p = try? JSONDecoder().decode(Presence.self, from: data) else { return }
            var peer = peers[user] ?? Peer(id: user, name: p.name)
            let wasHere = peers[user] != nil
            peer.name = p.name
            peer.selection = p.loc.map { NSRange(location: $0, length: p.len ?? 0) }
            if p.typing == true { peer.typingUntil = .now.addingTimeInterval(1.6) }
            peers[user] = peer
            if !wasHere { Task { await refreshMembers() }; sendPresence() }
        case .leave(let user):
            peers[user] = nil
        }
    }

    private func apply(_ u: CollabRelay.Update) {
        guard u.note_id == noteID, !applied.contains(u.id) else { return }
        applied.insert(u.id)
        lastSeen = max(lastSeen, u.id)
        guard u.author_id != me else { return }
        do {
            let change = try CollabCrypto.open(.update, u.ct, nk: nk, note: noteID, extra: u.author_id.uuidString)
            try doc.applyEncodedChanges(encoded: change)
        } catch {
            log.error("a change didn't open or apply: \(String(describing: error), privacy: .public)")
            return
        }
        let merged = (try? doc.text(obj: body)) ?? text
        guard merged != text else { return }
        // Their cursor moves with what they typed; ours is mapped by the editor itself.
        text = merged
        onRemoteText?(merged)
        settle()
    }

    // MARK: Your edits

    /// The editor's text after a keystroke: the difference goes into the document and up.
    func local(_ new: String, selection: NSRange?) {
        if let selection { mySelection = selection }
        guard let edit = TextDiff.edit(from: text, to: new) else { return }
        do {
            try doc.spliceText(obj: body, start: UInt64(edit.range.location), delete: Int64(edit.range.length),
                               value: edit.replacement.isEmpty ? nil : edit.replacement)
        } catch {
            log.error("splice failed: \(String(describing: error), privacy: .public)")
            return
        }
        let merged = (try? doc.text(obj: body)) ?? new
        text = merged
        if merged != new { onRemoteText?(merged) }
        // Other people's carets after this point move with the text until their next presence.
        for (id, p) in peers { if let sel = p.selection { peers[id]?.selection = TextDiff.map(sel, through: edit) } }
        outbox.append(doc.encodeNewChanges())
        typingAt = .now
        flush()
        sendPresence()
        settle()
    }

    func selectionChanged(_ selection: NSRange) {
        guard selection != mySelection else { return }
        mySelection = selection
        sendPresence()
    }

    private func flush() {
        guard !sending, !outbox.isEmpty else { return }
        sending = true
        let batch = outbox
        outbox = []
        Task {
            for change in batch where !change.isEmpty {
                do {
                    let ct = try CollabCrypto.seal(.update, change, nk: nk, note: noteID, epoch: epoch, extra: me.uuidString)
                    let row = try await relay.post("updates", ["note_id": noteID.uuidString.lowercased(), "epoch": epoch, "ct": ct], as: CollabRelay.Update.self)
                    applied.insert(row.id)
                } catch {
                    log.error("sending a change failed: \(String(describing: error), privacy: .public)")
                }
            }
            sending = false
            flush()
        }
    }

    private func settle() {
        settleTask?.cancel()
        settleTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(0.4))
            guard let self, !Task.isCancelled else { return }
            self.onSettled?(self.text)
        }
    }

    // MARK: Presence

    private struct Presence: Codable {
        var name: String
        var loc: Int?
        var len: Int?
        var typing: Bool?
    }

    private func sendPresence() {
        guard let channel else { return }
        let p = Presence(name: myName, loc: mySelection?.location, len: mySelection?.length, typing: Date.now.timeIntervalSince(typingAt) < 1.2)
        guard let data = try? JSONEncoder().encode(p),
              let ct = try? CollabCrypto.seal(.presence, data, nk: nk, note: noteID, epoch: epoch, extra: me.uuidString) else { return }
        channel.send(presence: ct)
    }

    // MARK: Showing people

    /// Each person keeps one colour everywhere. Amber stays for AI edits.
    static func color(for user: UUID) -> Color {
        let palette: [UInt32] = [0x2A8C82, 0x3D6FD9, 0x8A5CD6, 0xD6457A, 0x3F9A4A, 0x5B6B7F]
        let h = user.uuidString.unicodeScalars.reduce(UInt32(7)) { ($0 &* 31) &+ $1.value }
        let rgb = palette[Int(h % UInt32(palette.count))]
        return Color(red: Double(rgb >> 16 & 0xFF) / 255, green: Double(rgb >> 8 & 0xFF) / 255, blue: Double(rgb & 0xFF) / 255)
    }

    /// Other people's carets and selections for the editor to draw.
    var remoteCarets: [RemoteCaret] {
        peers.values.compactMap { p in
            guard let s = p.selection else { return nil }
            return RemoteCaret(id: p.id, name: p.name.split(separator: " ").first.map(String.init) ?? p.name, color: Self.color(for: p.id), range: s)
        }.sorted { $0.id.uuidString < $1.id.uuidString }
    }
}

/// Someone else's caret (or selection) in the open note.
struct RemoteCaret: Equatable, Identifiable {
    let id: UUID
    let name: String
    let color: Color
    let range: NSRange
}
