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
        /// Where their caret and selection end are, as stable positions in the document; resolved
        /// against the text here whenever it changes.
        var caret: Anchor?
        var end: Anchor?
        var typingUntil: Date?
        /// When their caret last moved or they last typed: the name flag shows for a moment after.
        var movedAt: Date = .now
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
    private(set) var epoch: Int
    let me: UUID
    let myName: String
    private var nk: SymmetricKey
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
            try absorb(saved, into: doc)
            last = s.upto
        }
        for u in pull.updates {
            try absorb(try CollabCrypto.open(.update, u.ct, nk: nk, note: note, extra: u.author_id.uuidString), into: doc)
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

    /// The note has a new key (someone was removed): everything from here on is
    /// sealed with it. The document itself doesn't change.
    func reseal(nk: SymmetricKey, epoch: Int) {
        self.nk = nk
        self.epoch = epoch
        sendPresence()
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
            if peer.caret != p.caret || peer.end != p.end { peer.movedAt = .now }
            peer.caret = p.caret
            peer.end = p.end
            if p.typing == true { peer.typingUntil = .now.addingTimeInterval(1.6); peer.movedAt = .now }
            peers[user] = peer
            resolvePeers()
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
            try Self.absorb(change, into: doc)
        } catch {
            log.error("a change didn't open or apply: \(String(describing: error), privacy: .public)")
            return
        }
        let merged = (try? doc.text(obj: body)) ?? text
        guard merged != text else { resolvePeers(); return }
        text = merged
        onRemoteText?(merged)
        resolvePeers()
        settle()
    }

    // MARK: Your edits

    /// The editor's text after a keystroke: the difference goes into the document and up.
    func local(_ new: String, selection: NSRange?) {
        guard let edit = TextDiff.edit(from: text, to: new) else { if let selection { mySelection = selection }; return }
        // Your caret is right after what you typed. The text view's own selection can still be the
        // one from before the keystroke at this point, which would put your caret a character
        // behind on everyone else's screen; the 0.1 s check corrects anything else (a selection).
        mySelection = NSRange(location: edit.range.location + (edit.replacement as NSString).length, length: 0)
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
        resolvePeers()
        outbox.append(doc.encodeNewChanges())
        typingAt = .now
        flush()
        sendPresence()
        settle()
    }

    /// Your caret, or nil while you aren't editing (then nobody sees a caret for you).
    func selectionChanged(_ selection: NSRange?) {
        guard selection != mySelection else { return }
        // While you type, your caret goes with each keystroke (local); the text view's own
        // selection can trail it there, so it isn't taken until you pause.
        if selection != nil, Date.now.timeIntervalSince(typingAt) < 0.6 { return }
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

    /// A stable position: an Automerge cursor (hex) on the character after the caret, or, at the end
    /// of the text, on the last character with `after` set. Edits anywhere, merges included, move it
    /// with its character, so it resolves to the same place on every device.
    struct Anchor: Codable, Equatable {
        var c: String
        var after: Bool?
    }

    private struct Presence: Codable {
        var name: String
        var caret: Anchor?
        var end: Anchor?
        var typing: Bool?
    }

    /// The anchor for a UTF-16 offset in this document's text.
    func anchor(at offset: Int) -> Anchor? { Self.anchor(in: doc, body, at: offset) }

    /// Where an anchor is in this document now (UTF-16), or nil when it names a character that
    /// hasn't arrived here yet (their presence can outrun their change).
    func offset(of a: Anchor?) -> Int? { Self.offset(of: a, in: doc, body) }

    nonisolated static func anchor(in doc: Document, _ body: ObjId, at offset: Int) -> Anchor? {
        let length = doc.length(obj: body)
        guard length > 0 else { return nil }
        if offset < Int(length), let c = try? doc.cursor(obj: body, position: UInt64(max(0, offset))) { return Anchor(c: c.description) }
        guard let c = try? doc.cursor(obj: body, position: length - 1) else { return nil }
        return Anchor(c: c.description, after: true)
    }

    nonisolated static func offset(of a: Anchor?, in doc: Document, _ body: ObjId) -> Int? {
        guard let a else { return doc.length(obj: body) == 0 ? 0 : nil }
        guard let c = Cursor(hex: a.c), let p = try? doc.position(obj: body, cursor: c) else { return nil }
        return Int(p) + (a.after == true ? 1 : 0)
    }

    /// Takes changes (or a whole saved document) into `doc`. Into an empty document automerge-swift
    /// swaps in a freshly loaded one, which counts text in Unicode scalars instead of UTF-16, and
    /// every splice after that lands in the wrong place next to an emoji. Merging keeps the encoding.
    nonisolated static func absorb(_ bytes: Data, into doc: Document) throws {
        if doc.heads().isEmpty { try doc.merge(other: try Document(bytes)) } else { try doc.applyEncodedChanges(encoded: bytes) }
    }

    /// Every peer's caret against the text as it is now. One that can't resolve yet keeps where it was.
    private func resolvePeers() {
        for (id, p) in peers {
            // Not editing: no caret to show.
            guard p.caret != nil else { if p.selection != nil { peers[id]?.selection = nil }; continue }
            guard let start = offset(of: p.caret) else { continue }
            let end = p.end.flatMap { offset(of: $0) } ?? start
            let range = NSRange(location: min(start, end), length: abs(end - start))
            if peers[id]?.selection != range { peers[id]?.selection = range }
        }
    }

    private func sendPresence() {
        guard let channel else { return }
        let sel = mySelection
        let p = Presence(name: myName, caret: sel.flatMap { anchor(at: $0.location) },
                         end: sel.flatMap { $0.length > 0 ? anchor(at: NSMaxRange($0)) : nil },
                         typing: Date.now.timeIntervalSince(typingAt) < 1.2)
        guard let data = try? JSONEncoder().encode(p),
              let ct = try? CollabCrypto.seal(.presence, data, nk: nk, note: noteID, epoch: epoch, extra: me.uuidString) else { return }
        channel.send(presence: ct)
    }

    // MARK: Showing people

    /// Each person keeps one colour everywhere: six muted, earthy tones that sit beside the amber
    /// brand without competing with it (clay, sage, dusk blue, plum, teal, olive). Amber itself is
    /// you, and AI edits. All take white initials at 4.5:1 or better.
    static func color(for user: UUID) -> Color {
        let h = user.uuidString.unicodeScalars.reduce(UInt32(7)) { ($0 &* 31) &+ $1.value }
        return color(at: Int(h % UInt32(palette.count)))
    }

    static let palette: [UInt32] = [0xA85A3C, 0x5E7A5A, 0x4F6B87, 0x7E5878, 0x3F7774, 0x7A6F3A]

    static func color(at i: Int) -> Color {
        let rgb = palette[i % palette.count]
        return Color(red: Double(rgb >> 16 & 0xFF) / 255, green: Double(rgb >> 8 & 0xFF) / 255, blue: Double(rgb & 0xFF) / 255)
    }

    /// Other people's carets and selections for the editor to draw.
    var remoteCarets: [RemoteCaret] {
        peers.values.compactMap { p in
            guard let s = p.selection else { return nil }
            return RemoteCaret(id: p.id, name: p.name.split(separator: " ").first.map(String.init) ?? p.name, color: Self.color(for: p.id), range: s,
                               showsName: Date.now.timeIntervalSince(p.movedAt) < 2.5)
        }.sorted { $0.id.uuidString < $1.id.uuidString }
    }
}

/// Someone else's caret (or selection) in the open note.
struct RemoteCaret: Equatable, Identifiable {
    let id: UUID
    let name: String
    let color: Color
    let range: NSRange
    /// The name flag shows while they type or just after their caret moves, then fades.
    var showsName = true
}
