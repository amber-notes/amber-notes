import Foundation
import Observation

/// A page's own data (prototype; see NotePage): anything the page wants to keep that isn't the
/// note's text, such as workouts, settings, a flashcard schedule. One JSON document per note, next to
/// the page in the database (note_pages.data_ct, sealed with the account key), never in the markdown:
///
///     { "values": { "goal": 4 },
///       "collections": { "workouts": [{ "id": "…", "created": "…", "updated": "…", "km": 5.2 }] } }
///
/// Files (photos, recordings) live in the encrypted file storage; records point at them with
/// `{"$file": "<attachment id>"}`. Up to 4 MB of JSON.
enum NotePageData {
    typealias Doc = [String: Any]
    static let maxBytes = 4 * 1024 * 1024

    static func empty() -> Doc { ["values": Doc(), "collections": Doc()] }

    static func encode(_ doc: Doc) -> Data {
        (try? JSONSerialization.data(withJSONObject: doc, options: [.sortedKeys, .fragmentsAllowed])) ?? Data("{}".utf8)
    }

    static func decode(_ data: Data?) -> Doc {
        guard let data, let d = (try? JSONSerialization.jsonObject(with: data)) as? Doc else { return empty() }
        return ["values": d["values"] as? Doc ?? Doc(), "collections": d["collections"] as? Doc ?? Doc()]
    }

    /// Two JSON values are the same when they encode the same.
    static func same(_ a: Any?, _ b: Any?) -> Bool {
        switch (a, b) {
        case (nil, nil): true
        case (nil, _), (_, nil): false
        case let (x?, y?): (try? JSONSerialization.data(withJSONObject: [x], options: .sortedKeys)) == (try? JSONSerialization.data(withJSONObject: [y], options: .sortedKeys))
        }
    }

    /// What a text note held, for its new app to start from (once, when the note becomes an app):
    /// its tables as rows keyed by column, its checklists, under their headings, and the text.
    static func imported(from body: String) -> Doc {
        let lines = body.components(separatedBy: "\n")
        var tables = Doc(), checklists = Doc()
        for (i, t) in NotePage.tables(in: lines).enumerated() {
            let name = (NotePage.heading(above: t.header, in: lines) as? String) ?? "Table \(i + 1)"
            tables[name] = t.rows.map { r in Dictionary(t.columns.enumerated().map { ($1.name, $0 < r.count ? r[$0] : "") }, uniquingKeysWith: { a, _ in a }) }
        }
        for (i, line) in lines.enumerated() {
            guard let p = ListPrefix(line: line), let checked = p.checkbox else { continue }
            let name = (NotePage.heading(above: i, in: lines) as? String) ?? "Checklist"
            var list = checklists[name] as? [Doc] ?? []
            list.append(["text": (line as NSString).substring(from: p.length), "checked": checked])
            checklists[name] = list
        }
        return ["tables": tables, "checklists": checklists, "text": body]
    }

    // MARK: Changes a page can ask for

    indirect enum Op {
        case set(key: String, value: Any?)
        /// Several changes as one (amber.batch): one Undo.
        case batch([Op])
        case patch(Doc)
        case add(collection: String, fields: Doc)
        case update(collection: String, id: String, patch: Doc)
        case remove(collection: String, id: String)

        init(_ message: Any) throws {
            guard let m = message as? Doc, let op = m["op"] as? String else { throw NotePage.OpError("Send { op, … }.") }
            func string(_ k: String) throws -> String {
                guard let s = m[k] as? String, !s.isEmpty, s.count <= 200 else { throw NotePage.OpError("\(k) must be a short string.") }
                return s
            }
            func object(_ k: String) throws -> Doc {
                guard let d = m[k] as? Doc else { throw NotePage.OpError("\(k) must be an object.") }
                return d
            }
            switch op {
            case "store.set": self = .set(key: try string("key"), value: m["value"] is NSNull ? nil : m["value"])
            case "store.patch": self = .patch(try object("patch"))
            case "collection.add": self = .add(collection: try string("name"), fields: try object("fields"))
            case "collection.update": self = .update(collection: try string("name"), id: try string("id"), patch: try object("patch"))
            case "collection.remove": self = .remove(collection: try string("name"), id: try string("id"))
            case "batch":
                guard let ops = m["ops"] as? [Any], !ops.isEmpty, ops.count <= 500 else { throw NotePage.OpError("ops must be a list of up to 500 changes.") }
                self = .batch(try ops.map { try Op($0) })
            default: throw NotePage.OpError("Unknown op \(op).")
            }
        }
    }

    /// The document after `op`, and the new record's id for an add. Throws past the size limit.
    static func apply(_ op: Op, to doc: Doc, now: Date = .now, newID: () -> String = { UUID().uuidString.lowercased() }) throws -> (Doc, String?) {
        var d = decode(encode(doc))
        var values = d["values"] as? Doc ?? Doc()
        var collections = d["collections"] as? Doc ?? Doc()
        let stamp = ISO8601DateFormatter().string(from: now)
        var made: String?
        if case .batch(let ops) = op {
            var doc = d
            for o in ops { let r = try apply(o, to: doc, now: now, newID: newID); doc = r.0; made = r.1 ?? made }
            return (doc, made)
        }
        switch op {
        case .batch: break
        case .set(let key, let value):
            values[key] = value
        case .patch(let patch):
            let merged = mergePatch(["values": values, "collections": collections], patch)
            values = merged["values"] as? Doc ?? Doc()
            collections = merged["collections"] as? Doc ?? Doc()
        case .add(let name, var fields):
            var list = collections[name] as? [Doc] ?? []
            let id = (fields["id"] as? String).flatMap { id in list.contains { $0["id"] as? String == id } ? nil : id } ?? newID()
            fields["id"] = id
            fields["created"] = fields["created"] ?? stamp
            fields["updated"] = stamp
            list.append(fields)
            collections[name] = list
            made = id
        case .update(let name, let id, let patch):
            var list = collections[name] as? [Doc] ?? []
            guard let i = list.firstIndex(where: { $0["id"] as? String == id }) else { throw NotePage.OpError("No record \(id) in \(name).") }
            var r = mergePatch(list[i], patch)
            r["id"] = id
            r["updated"] = stamp
            list[i] = r
            collections[name] = list
        case .remove(let name, let id):
            var list = collections[name] as? [Doc] ?? []
            guard let i = list.firstIndex(where: { $0["id"] as? String == id }) else { throw NotePage.OpError("No record \(id) in \(name).") }
            list.remove(at: i)
            collections[name] = list
        }
        d = ["values": values, "collections": collections]
        let bytes = encode(d).count
        if bytes > maxBytes {
            throw NotePage.OpError(String(format: "This app's data would be %.1f MB; the limit is 4 MB. Keep photos and recordings as files.", Double(bytes) / 1_048_576))
        }
        return (d, made)
    }

    /// RFC 7386: objects merge, null removes a key, anything else replaces.
    static func mergePatch(_ target: Doc, _ patch: Doc) -> Doc {
        var out = target
        for (k, v) in patch {
            if v is NSNull { out[k] = nil }
            else if let p = v as? Doc { out[k] = mergePatch(out[k] as? Doc ?? Doc(), p) }
            else { out[k] = v }
        }
        return out
    }

    // MARK: Two devices at once

    /// Combines this device's changes since `base` with the server's. Values merge by key and
    /// records by id (then by field), so different keys, records or fields never overwrite each
    /// other. When both sides changed the same field, this device's write wins. A record removed on
    /// one side stays removed unless the other side changed it.
    static func merge(base: Doc, mine: Doc, theirs: Doc) -> Doc {
        func three(_ b: Doc, _ m: Doc, _ t: Doc, records: Bool = false) -> Doc {
            var out = Doc()
            for k in Set(b.keys).union(m.keys).union(t.keys) {
                let bv = b[k], mv = m[k], tv = t[k]
                if same(mv, bv) { if let tv { out[k] = tv } }
                else if same(tv, bv) { if let mv { out[k] = mv } }
                else if records, let bd = bv as? Doc, let md = mv as? Doc, let td = tv as? Doc { out[k] = three(bd, md, td) }
                else if mv == nil, tv != nil, records { out[k] = tv }   // removed here, changed there: kept
                else if let mv { out[k] = mv }
            }
            return out
        }
        let b = decode(encode(base)), m = decode(encode(mine)), t = decode(encode(theirs))
        let values = three(b["values"] as! Doc, m["values"] as! Doc, t["values"] as! Doc)
        var collections = Doc()
        let bc = b["collections"] as! Doc, mc = m["collections"] as! Doc, tc = t["collections"] as! Doc
        for name in Set(bc.keys).union(mc.keys).union(tc.keys) {
            func byID(_ x: Any?) -> Doc { Dictionary(((x as? [Doc]) ?? []).compactMap { r in (r["id"] as? String).map { ($0, r as Any) } }, uniquingKeysWith: { a, _ in a }) }
            let merged = three(byID(bc[name]), byID(mc[name]), byID(tc[name]), records: true)
            // In the order they were made.
            let list = merged.values.compactMap { $0 as? Doc }.sorted {
                (($0["created"] as? String) ?? "", ($0["id"] as? String) ?? "") < (($1["created"] as? String) ?? "", ($1["id"] as? String) ?? "")
            }
            if !list.isEmpty || mc[name] != nil || tc[name] != nil { collections[name] = list }
        }
        return ["values": values, "collections": collections]
    }
}

/// The page data this device has, per note: the current document, the one last synced (the base for
/// merging), and which have changes to push. Kept beside the library in its own file.
@MainActor
@Observable
final class NotePageDataStore {
    static let shared = NotePageDataStore(file: PaneApp.isUnitTestHost || ProcessInfo.processInfo.arguments.contains("-uitest") ? nil : defaultFile)

    private(set) var docs: [UUID: Data] = [:]
    private(set) var synced: [UUID: Data] = [:]
    private(set) var dirty: Set<UUID> = []
    @ObservationIgnored private let file: URL?

    private struct Saved: Codable { var docs: [UUID: Data]; var synced: [UUID: Data]; var dirty: Set<UUID> }

    init(file: URL?) {
        self.file = file
        if let file, let data = try? Data(contentsOf: file), let s = try? JSONDecoder().decode(Saved.self, from: data) {
            docs = s.docs; synced = s.synced; dirty = s.dirty
        }
    }

    static var defaultFile: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Pane/note-page-data.json")
    }

    func doc(_ id: UUID) -> NotePageData.Doc { NotePageData.decode(docs[id]) }

    /// A change from the page (or Undo): kept here and pushed with the next sync.
    func set(_ id: UUID, _ doc: NotePageData.Doc?) {
        docs[id] = doc.map(NotePageData.encode)
        dirty.insert(id)
        save()
        SyncSignal.changed()
    }

    /// The server's copy arrived. Changes made here since the last sync are merged in, not lost.
    func take(_ id: UUID, server: Data?) {
        let theirs = NotePageData.decode(server)
        if dirty.contains(id) {
            let merged = NotePageData.merge(base: NotePageData.decode(synced[id]), mine: doc(id), theirs: theirs)
            docs[id] = NotePageData.encode(merged)
            if NotePageData.same(merged, theirs) { dirty.remove(id) }
        } else {
            docs[id] = server.map { NotePageData.encode(NotePageData.decode($0)) }
        }
        synced[id] = server
        save()
    }

    /// Pushed: what the server now holds is the new base.
    func pushed(_ id: UUID, _ sent: Data) {
        synced[id] = sent
        if docs[id] == sent { dirty.remove(id) }
        save()
    }

    func forgetAll() {
        docs = [:]; synced = [:]; dirty = []
        if let file { try? FileManager.default.removeItem(at: file) }
    }

    private func save() {
        guard let file, let data = try? JSONEncoder().encode(Saved(docs: docs, synced: synced, dirty: dirty)) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
