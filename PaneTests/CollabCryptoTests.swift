import Automerge
import CryptoKit
import Foundation
import Testing
@testable import Pane

/// Collaboration (prototype): the shared-note formats. A wrap and a change sealed by the server's
/// code (supabase/functions/_shared/collab-vectors.json, made with collab.ts) open here, and the
/// sender is proven, so a key the server made up is refused.
@Suite struct CollabCryptoTests {
    struct Vectors: Decodable {
        var note: String; var epoch: Int; var from: String; var to: String
        var sender_d: String; var sender_public: String; var recipient_d: String; var recipient_public: String
        var note_key: String; var wrap: String; var update: String; var update_plain: String; var safety_code: String
        var link_id: String; var link_secret: String; var link_sealed: String
    }

    let v: Vectors
    let party: CollabCrypto.Party

    init() throws {
        let url = try #require(Bundle(for: CollabVectorsToken.self).url(forResource: "collab-vectors", withExtension: "json"))
        v = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
        party = .init(note: UUID(uuidString: v.note)!, epoch: v.epoch, from: UUID(uuidString: v.from)!, to: UUID(uuidString: v.to)!)
    }

    private func b64(_ s: String) -> Data { Data(base64Encoded: s)! }

    @Test func aWrapFromTheServerCodeOpens() throws {
        let me = try CollabCrypto.Identity(scalar: b64(v.recipient_d))
        #expect(me.publicRaw == b64(v.recipient_public))
        let nk = try CollabCrypto.openNoteKey(v.wrap, me: me, from: b64(v.sender_public), party: party)
        #expect(E2EE.bytes(nk) == b64(v.note_key))
        let plain = try CollabCrypto.open(.update, v.update, nk: nk, note: party.note, extra: v.from)
        #expect(String(decoding: plain, as: UTF8.self) == v.update_plain)
        #expect(CollabCrypto.safetyCode(b64(v.sender_public), b64(v.recipient_public)) == v.safety_code)
        #expect(CollabCrypto.safetyCode(b64(v.recipient_public), b64(v.sender_public)) == v.safety_code)
    }

    @Test func aWrapFromSomeoneElseOrMovedIsRefused() throws {
        let me = try CollabCrypto.Identity(scalar: b64(v.recipient_d))
        let impostor = CollabCrypto.Identity()
        let fake = try CollabCrypto.sealNoteKey(SymmetricKey(size: .bits256), from: impostor, to: me.publicRaw, party: party)
        #expect(throws: CollabCrypto.Failure.wrongKey) { try CollabCrypto.openNoteKey(fake, me: me, from: b64(v.sender_public), party: party) }
        var moved = party
        moved.epoch += 1
        #expect(throws: CollabCrypto.Failure.wrongKey) { try CollabCrypto.openNoteKey(v.wrap, me: me, from: b64(v.sender_public), party: moved) }
        // A change can't be passed off as someone else's.
        let nk = SymmetricKey(data: b64(v.note_key))
        #expect(throws: CollabCrypto.Failure.wrongKey) { try CollabCrypto.open(.update, v.update, nk: nk, note: party.note, extra: v.to) }
    }

    @Test func theIdentityTravelsUnderTheDataKey() throws {
        let dk = SymmetricKey(size: .bits256), user = UUID(), id = CollabCrypto.Identity()
        let box = try CollabCrypto.wrapIdentity(id, dataKey: dk, user: user)
        #expect(try CollabCrypto.unwrapIdentity(box, dataKey: dk, user: user).publicRaw == id.publicRaw)
        #expect(throws: CollabCrypto.Failure.wrongKey) { try CollabCrypto.unwrapIdentity(box, dataKey: dk, user: UUID()) }
    }

    /// A sealed link made by the site's code opens here with the secret from the link, and not without it.
    @Test func aSealedLinkFromTheSiteCodeOpens() throws {
        var b64 = v.link_secret.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        let copy = try SealedLink.open(v.link_sealed, id: v.link_id, secret: Data(base64Encoded: b64)!)
        #expect(copy.title == "Habit tracker" && copy.page == "<p>app</p>" && copy.shared_by?.name == "Emil")
        #expect(throws: CollabCrypto.Failure.wrongKey) { try SealedLink.open(v.link_sealed, id: v.link_id, secret: E2EE.randomBytes(16)) }
        let mine = try SealedLink.seal(copy, id: v.link_id, secret: Data(base64Encoded: b64)!)
        #expect(try SealedLink.open(mine, id: v.link_id, secret: Data(base64Encoded: b64)!) == copy)
    }

    /// A template keeps the headings and columns, never the rows, and names keys only.
    @Test func aTemplateCarriesNoRows() {
        let body = "Habit tracker\n\nA ✓ means done.\n\n| Date | Walk |\n| --- | --- |\n| 2026-10-05 | ✓ |\n\n- [x] Buy shoes\n"
        let page = #"<meta name="amber-needs" content='{"keys":[{"name":"Strava access token","host":"www.strava.com","value":"secret"}],"hosts":[]}'>"#
        let t = SharedTemplate.make(from: body, page: page)
        #expect(t.note == "Habit tracker\n\nA ✓ means done.\n\n| Date | Walk |\n| --- | --- |\n\n- [ ] Buy shoes\n")
        #expect(t.sample == nil)
        #expect(t.layout == [.init(table: 0, columns: ["Date", "Walk"])])
        #expect(t.needs.keys == [.init(name: "Strava access token", host: "www.strava.com")])
    }

    /// Two documents typing at once at the same spot, merged both ways round, end the same; the
    /// offsets are UTF-16, the editor's.
    @Test func concurrentTypingConverges() throws {
        let a = Document(textEncoding: .utf16)
        let body = try a.putObject(obj: .ROOT, key: "body", ty: .Text)
        try a.spliceText(obj: body, start: 0, delete: 0, value: "Agenda 👋\n- Lunch\n")
        let b = Document(textEncoding: .utf16)
        try CollabSession.absorb(a.save(), into: b)
        _ = a.encodeNewChanges()
        let end = UInt64(("Agenda 👋\n- Lunch" as NSString).length)
        try a.spliceText(obj: body, start: end, delete: 0, value: " at noon")
        try b.spliceText(obj: body, start: end, delete: 0, value: " (Tranan)")
        try b.spliceText(obj: body, start: 0, delete: 6, value: "Plan")
        let fromA = a.encodeNewChanges(), fromB = b.encodeNewChanges()
        try a.applyEncodedChanges(encoded: fromB)
        try b.applyEncodedChanges(encoded: fromA)
        let ta = try a.text(obj: body), tb = try b.text(obj: body)
        #expect(ta == tb)
        #expect(ta.hasPrefix("Plan 👋\n- Lunch"))
        #expect(ta.contains(" at noon") && ta.contains(" (Tranan)"))
    }
}
private final class CollabVectorsToken {}

/// Remote carets: a cursor sent from one device resolves to the same insertion point on another,
/// through concurrent edits, at line ends, in lists and tables, and with emoji and CJK (UTF-16).
@Suite struct CollabCursorTests {
    typealias Session = CollabSession

    /// Two replicas of one document.
    func pair(_ text: String) throws -> (Document, Document, ObjId) {
        let a = Document(textEncoding: .utf16)
        let body = try a.putObject(obj: .ROOT, key: "body", ty: .Text)
        try a.spliceText(obj: body, start: 0, delete: 0, value: text)
        let b = Document(textEncoding: .utf16)
        try Session.absorb(a.save(), into: b)
        #expect(b.textEncoding == .utf16)
        _ = a.encodeNewChanges()
        return (a, b, body)
    }

    func sync(_ from: Document, _ to: Document) throws { try to.applyEncodedChanges(encoded: from.encodeNewChanges()) }
    func u16(_ s: String) -> Int { (s as NSString).length }

    @Test func aCaretFollowsItsOwnersTypingAndOthersEdits() throws {
        let start = "Agenda 👋 会议\n- Lunch\n| Day | Plan |\n| --- | --- |\n| Mon | 🍣 寿司 |"
        let (sara, emil, body) = try pair(start)
        // Sara's caret right after "Lunch", at the end of the list line.
        var caret = u16("Agenda 👋 会议\n- Lunch")
        // Emil types before it at the same time (an emoji and CJK at the top).
        try emil.spliceText(obj: body, start: 0, delete: 0, value: "🎉 新 ")
        // Sara types at her caret, then sends where her caret is now.
        try sara.spliceText(obj: body, start: UInt64(caret), delete: 0, value: " at noon")
        caret += u16(" at noon")
        let anchor = try #require(Session.anchor(in: sara, body, at: caret))
        // Her presence reaches Emil before her change: her caret is anchored on the line break after
        // it, which Emil has, so it already sits at the end of her line there.
        #expect(Session.offset(of: anchor, in: emil, body) == u16("🎉 新 Agenda 👋 会议\n- Lunch"))
        // Each side sends what it wrote (as the app does after every splice), then takes the other's.
        let fromSara = sara.encodeNewChanges(), fromEmil = emil.encodeNewChanges()
        try emil.applyEncodedChanges(encoded: fromSara)
        try sara.applyEncodedChanges(encoded: fromEmil)
        let merged = try emil.text(obj: body)
        #expect(try sara.text(obj: body) == merged)
        // On both devices it sits exactly after what she typed.
        let expected = u16("🎉 新 Agenda 👋 会议\n- Lunch at noon")
        #expect(Session.offset(of: anchor, in: emil, body) == expected)
        #expect(Session.offset(of: anchor, in: sara, body) == expected)
        #expect((merged as NSString).substring(to: expected).hasSuffix("Lunch at noon"))
        // (A document that took a saved copy the plain way counts scalars: the bug absorb avoids.)
        let plain = Document(textEncoding: .utf16)
        try plain.applyEncodedChanges(encoded: emil.save())
        #expect(plain.textEncoding != .utf16)
    }

    @Test func aCaretInATableCellAndAtTheEnd() throws {
        let text = "Plan\n| Day | Dish |\n| --- | --- |\n| Mon | 🍣 |"
        let (sara, emil, body) = try pair(text)
        // Inside a cell, just after the emoji.
        let cell = u16("Plan\n| Day | Dish |\n| --- | --- |\n| Mon | 🍣")
        let inCell = try #require(Session.anchor(in: sara, body, at: cell))
        // At the very end of the note.
        let end = try #require(Session.anchor(in: sara, body, at: u16(text)))
        #expect(end.after == true)
        try emil.spliceText(obj: body, start: 0, delete: 4, value: "Weekly plan")
        try sync(emil, sara)
        let now = try sara.text(obj: body)
        #expect((now as NSString).substring(to: try #require(Session.offset(of: inCell, in: sara, body))).hasSuffix("| Mon | 🍣"))
        #expect(Session.offset(of: end, in: sara, body) == u16(now))
    }

    @Test func aDeletedCharacterStillResolves() throws {
        let (sara, emil, body) = try pair("one two three")
        let anchor = try #require(Session.anchor(in: sara, body, at: 4)) // before "two"
        try emil.spliceText(obj: body, start: 4, delete: 4, value: nil) // "two " goes
        try sync(emil, sara)
        // Automerge keeps the deleted character's place: the caret lands where "two " was.
        #expect(Session.offset(of: anchor, in: sara, body) == 4)
    }

    @Test func anEmptyNoteHasItsCaretAtTheStart() throws {
        let a = Document(textEncoding: .utf16)
        let body = try a.putObject(obj: .ROOT, key: "body", ty: .Text)
        #expect(Session.anchor(in: a, body, at: 0) == nil)
        #expect(Session.offset(of: nil, in: a, body) == 0)
    }
}
