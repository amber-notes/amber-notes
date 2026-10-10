import Foundation
#if COLLAB_AUTOMERGE
import Automerge
#endif

/// A shared note's text as an Automerge document: the parts of collaboration that touch Automerge.
///
/// Collaboration is a prototype that only starts with `-collab` (CollabStore.fromArguments), and
/// Automerge's Rust core was 4.6 MB of each architecture of the app. So the app doesn't link it:
/// in the app this file is built against the stand-ins below, which throw, and no session can be
/// made. The test target links Automerge and builds this same file with COLLAB_AUTOMERGE, so
/// CollabCryptoTests run it for real in CI.
///
/// To put collaboration back in the app when it ships: add `- package: Automerge` to the app
/// targets' dependencies in project.yml, add COLLAB_AUTOMERGE to their
/// SWIFT_ACTIVE_COMPILATION_CONDITIONS, and delete the stand-ins.
enum CollabText {
    #if COLLAB_AUTOMERGE
    typealias Document = Automerge.Document
    typealias ObjId = Automerge.ObjId
    typealias Cursor = Automerge.Cursor
    #else
    typealias Document = StandIn.Document
    typealias ObjId = StandIn.ObjId
    typealias Cursor = StandIn.Cursor
    #endif

    /// A stable position: an Automerge cursor (hex) on the character after the caret, or, at the end
    /// of the text, on the last character with `after` set. Edits anywhere, merges included, move it
    /// with its character, so it resolves to the same place on every device.
    struct Anchor: Codable, Equatable {
        var c: String
        var after: Bool?
    }

    static func anchor(in doc: Document, _ body: ObjId, at offset: Int) -> Anchor? {
        let length = doc.length(obj: body)
        guard length > 0 else { return nil }
        if offset < Int(length), let c = try? doc.cursor(obj: body, position: UInt64(max(0, offset))) { return Anchor(c: c.description) }
        guard let c = try? doc.cursor(obj: body, position: length - 1) else { return nil }
        return Anchor(c: c.description, after: true)
    }

    /// Where an anchor is in the document now (UTF-16), or nil when it names a character that
    /// hasn't arrived here yet (their presence can outrun their change).
    static func offset(of a: Anchor?, in doc: Document, _ body: ObjId) -> Int? {
        guard let a else { return doc.length(obj: body) == 0 ? 0 : nil }
        guard let c = Cursor(hex: a.c), let p = try? doc.position(obj: body, cursor: c) else { return nil }
        return Int(p) + (a.after == true ? 1 : 0)
    }

    /// Takes changes (or a whole saved document) into `doc`. Into an empty document automerge-swift
    /// swaps in a freshly loaded one, which counts text in Unicode scalars instead of UTF-16, and
    /// every splice after that lands in the wrong place next to an emoji. Merging keeps the encoding.
    static func absorb(_ bytes: Data, into doc: Document) throws {
        if doc.heads().isEmpty { try doc.merge(other: try Document(bytes)) } else { try doc.applyEncodedChanges(encoded: bytes) }
    }

    #if !COLLAB_AUTOMERGE
    /// The few Automerge types collaboration uses, for the app, which doesn't link Automerge.
    enum StandIn {
        enum Unavailable: Error { case notInThisBuild }

        struct ObjId: Equatable {
            static let ROOT = ObjId()
        }

        enum ObjType { case Text }

        enum Value { case Object(ObjId, ObjType) }

        struct Cursor: CustomStringConvertible {
            init?(hex: String) { nil }
            var description: String { "" }
        }

        final class Document {
            enum TextEncoding { case utf16 }
            init(textEncoding: TextEncoding) {}
            init(_ bytes: Data) throws { throw Unavailable.notInThisBuild }
            func putObject(obj: ObjId, key: String, ty: ObjType) throws -> ObjId { throw Unavailable.notInThisBuild }
            func spliceText(obj: ObjId, start: UInt64, delete: Int64, value: String?) throws { throw Unavailable.notInThisBuild }
            func get(obj: ObjId, key: String) throws -> Value? { throw Unavailable.notInThisBuild }
            func text(obj: ObjId) throws -> String { throw Unavailable.notInThisBuild }
            func save() -> Data { Data() }
            func encodeNewChanges() -> Data { Data() }
            func length(obj: ObjId) -> UInt64 { 0 }
            func cursor(obj: ObjId, position: UInt64) throws -> Cursor { throw Unavailable.notInThisBuild }
            func position(obj: ObjId, cursor: Cursor) throws -> UInt64 { throw Unavailable.notInThisBuild }
            func heads() -> Set<Int> { [] }
            func merge(other: Document) throws { throw Unavailable.notInThisBuild }
            func applyEncodedChanges(encoded: Data) throws { throw Unavailable.notInThisBuild }
        }
    }
    #endif
}
