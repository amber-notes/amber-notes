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

    /// Two documents typing at once at the same spot, merged both ways round, end the same; the
    /// offsets are UTF-16, the editor's.
    @Test func concurrentTypingConverges() throws {
        let a = Document(textEncoding: .utf16)
        let body = try a.putObject(obj: .ROOT, key: "body", ty: .Text)
        try a.spliceText(obj: body, start: 0, delete: 0, value: "Agenda 👋\n- Lunch\n")
        let b = Document(textEncoding: .utf16)
        try b.applyEncodedChanges(encoded: a.save())
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
