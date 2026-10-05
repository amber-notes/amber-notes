import Foundation
import SwiftData
import UniformTypeIdentifiers

/// Note apps (prototype), the best-apps set for recordings: `-bestApps <dir>` seeds the notes in
/// <dir>/seed.json, each from <app>/note.md, <app>/app.html and <app>/data.json. Dates in those files
/// are written relative to today, so the demo data is never stale:
///   {{d}} today, {{d-3}} three days ago, {{d+2}}; {{t-3}} and {{t-3@08:15}} for ISO timestamps.
/// A note's body can link another seeded note with {{link:<dir>}}; an app note linked like that
/// shows as a widget.
extension Capture {
    struct BestSeed: Decodable {
        var dir: String?
        var body: String?
        var pinned: Bool?
        var minutesAgo: Double?
    }

    @MainActor static func bestAppsFromArguments(_ context: ModelContext) {
        guard ProcessInfo.processInfo.arguments.contains("-uitest"), let dir = argument("-bestApps") else { return }
        bestApps(context, dir: URL(fileURLWithPath: dir))
    }

    static func bestTokens(_ s: String, today: Date = .now) -> String {
        let cal = Calendar.current
        let day = { (n: Int) in TypedTable.day(cal.date(byAdding: .day, value: n, to: today)!) }
        var out = s
        let re = try! NSRegularExpression(pattern: #"\{\{(d|t)([+-]\d+)?(?:@(\d\d):(\d\d))?\}\}"#)
        for m in re.matches(in: s, range: NSRange(s.startIndex..., in: s)).reversed() {
            let g = { (i: Int) in Range(m.range(at: i), in: s).map { String(s[$0]) } }
            let n = Int(g(2) ?? "0") ?? 0
            var value = day(n)
            if g(1) == "t" {
                let base = cal.startOfDay(for: cal.date(byAdding: .day, value: n, to: today)!)
                let at = cal.date(bySettingHour: Int(g(3) ?? "12") ?? 12, minute: Int(g(4) ?? "00") ?? 0, second: 0, of: base)!
                value = ISO8601DateFormatter().string(from: at)
            }
            out.replaceSubrange(Range(m.range, in: out)!, with: value)
        }
        return out
    }

    /// {"$seedFile": "photos/x.jpg"} in seeded data becomes a file of the note's account, {"$file": id},
    /// as a photo the person picked would be.
    @MainActor static func seedFiles(_ value: Any, in dir: URL, context: ModelContext) -> Any {
        if let list = value as? [Any] { return list.map { seedFiles($0, in: dir, context: context) } }
        guard let d = value as? [String: Any] else { return value }
        if let path = d["$seedFile"] as? String {
            let url = dir.appending(path: path)
            guard let bytes = try? Data(contentsOf: url), let type = UTType(filenameExtension: url.pathExtension),
                  let a = try? FileStore.importData(bytes, filename: url.lastPathComponent, type: type) else { return NSNull() }
            context.insert(a)
            return ["$file": a.id.uuidString.lowercased()]
        }
        return d.mapValues { seedFiles($0, in: dir, context: context) }
    }

    /// Captures only (`-inlineLibs <AppLibraries dir>`): for a build without bundled libraries yet,
    /// the declared libraries go into the page itself, so a 3D app can be recorded meanwhile.
    static func inlineLibs(_ html: String) -> String {
        guard let dir = argument("-inlineLibs") ?? ProcessInfo.processInfo.environment["AMBER_INLINE_LIBS"].flatMap({ $0.isEmpty ? nil : $0 }),
              let r = html.range(of: #"<meta[^>]*name=["']amber-libs["'][^>]*content=["']([^"']*)["'][^>]*>"#, options: .regularExpression) else { return html }
        let tag = String(html[r])
        let names = tag.replacingOccurrences(of: #"^.*content=["']([^"']*)["'].*$"#, with: "$1", options: .regularExpression).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        let scripts = names.compactMap { try? String(contentsOfFile: "\(dir)/\($0).js", encoding: .utf8) }.map { "<script>\($0)</script>" }.joined()
        return html.replacingCharacters(in: r, with: scripts)
    }

    @MainActor static func bestApps(_ context: ModelContext, dir: URL) {
        guard let json = try? Data(contentsOf: dir.appending(path: "seed.json")),
              let seeds = try? JSONDecoder().decode([BestSeed].self, from: json) else { return }
        var made: [String: Note] = [:]
        var links: [(Note, String)] = []
        for (i, seed) in seeds.enumerated() {
            var body = seed.body ?? ""
            if let d = seed.dir, let md = try? String(contentsOf: dir.appending(path: "\(d)/note.md"), encoding: .utf8) { body = bestTokens(md) }
            let n = context.createNote(in: .all, body: body)
            n.isPinned = seed.pinned ?? false
            n.updatedAt = .now.addingTimeInterval(-60 * (seed.minutesAgo ?? Double(i * 7)))
            if let d = seed.dir {
                made[d] = n
                if let html = try? String(contentsOf: dir.appending(path: "\(d)/app.html"), encoding: .utf8) {
                    NotePageStore.shared[n.id] = .init(html: inlineLibs(html), by: "Claude", at: .now.addingTimeInterval(-86400))
                }
                if let raw = try? String(contentsOf: dir.appending(path: "\(d)/data.json"), encoding: .utf8),
                   let doc = try? JSONSerialization.jsonObject(with: Data(bestTokens(raw).utf8)) as? NotePageData.Doc,
                   let seeded = seedFiles(doc, in: dir.appending(path: d), context: context) as? NotePageData.Doc {
                    NotePageDataStore.shared.set(n.id, NotePageData.decode(NotePageData.encode(seeded)))
                }
            }
            if body.contains("{{link:") { links.append((n, body)) }
        }
        for (n, body) in links {
            var b = body
            for (d, target) in made { b = b.replacingOccurrences(of: "{{link:\(d)}}", with: "[\(target.title)](pane-note:\(target.id.uuidString.lowercased()))") }
            n.body = b
        }
        try? context.save()
    }
}
