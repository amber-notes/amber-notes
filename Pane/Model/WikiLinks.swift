import Foundation
import SwiftData

/// Obsidian's wiki links, `[[Title]]`, `[[Folder/Title]]`, `[[Title|shown text]]` and
/// `[[Title#Heading]]`, kept in the note's markdown exactly as written and resolved by title when
/// they're shown or followed. The text stays readable, goes back to Obsidian unchanged, and an AI
/// links notes by writing the title it already knows. Links in code are left alone.
enum WikiLinks {
    struct Link: Equatable {
        /// The whole `[[…]]` (or `![[…]]` for an embed).
        var range: NSRange
        var embed: Bool
        /// The note part as written: "Projects/Kitchen remodel".
        var target: String
        var heading: String?
        var alias: String?
        /// Where `target` sits in the text.
        var targetRange: NSRange
        /// Where `#heading` sits, with its `#`.
        var headingRange: NSRange?
        /// Where the alias sits, after its `|`.
        var aliasRange: NSRange?

        /// The note's name, without the folders in front of it.
        var name: String { WikiLinks.name(of: target) }
        /// The folders written in front of the name ("Projects/Kitchen remodel" → ["Projects"]).
        var folders: [String] { WikiLinks.folders(of: target) }
    }

    private static let pattern = try! NSRegularExpression(pattern: #"(!?)\[\[([^\[\]\n]+?)\]\]"#)
    private static let inlineCode = try! NSRegularExpression(pattern: #"(`+)(?:(?!\1).)+?\1"#)

    /// Every wiki link in `text`, outside fenced code blocks and inline code.
    static func links(in text: String) -> [Link] {
        guard text.contains("[[") else { return [] }
        let ns = text as NSString
        var out: [Link] = []
        var fence: String?
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: .byLines) { s, line, _, _ in
            guard let s else { return }
            let trimmed = s.trimmingCharacters(in: .whitespaces)
            if let f = fence {
                if trimmed.hasPrefix(f) { fence = nil }
                return
            }
            if trimmed.hasPrefix("```") { fence = "```"; return }
            if trimmed.hasPrefix("~~~") { fence = "~~~"; return }
            guard s.contains("[[") else { return }
            let code = inlineCode.matches(in: text, range: line).map(\.range)
            for m in pattern.matches(in: text, range: line) {
                if code.contains(where: { NSLocationInRange(m.range.location, $0) }) { continue }
                if let link = parse(m, in: ns) { out.append(link) }
            }
        }
        return out
    }

    private static func parse(_ m: NSTextCheckingResult, in ns: NSString) -> Link? {
        let embed = m.range(at: 1).length > 0
        let inner = m.range(at: 2)
        let innerText = ns.substring(with: inner)
        var targetPart = NSRange(location: inner.location, length: inner.length)
        var aliasRange: NSRange?
        if let bar = innerText.firstIndex(of: "|") {
            let offset = innerText.utf16.distance(from: innerText.startIndex, to: bar)
            targetPart.length = offset
            aliasRange = NSRange(location: inner.location + offset + 1, length: inner.length - offset - 1)
        }
        let targetText = ns.substring(with: targetPart)
        var headingRange: NSRange?
        var nameRange = targetPart
        if let hash = targetText.firstIndex(of: "#") {
            let offset = targetText.utf16.distance(from: targetText.startIndex, to: hash)
            nameRange.length = offset
            headingRange = NSRange(location: targetPart.location + offset, length: targetPart.length - offset)
        }
        let target = ns.substring(with: nameRange).trimmingCharacters(in: .whitespaces)
        let heading = headingRange.map { ns.substring(with: $0).dropFirst().trimmingCharacters(in: .whitespaces) }
        let alias = aliasRange.map { ns.substring(with: $0).trimmingCharacters(in: .whitespaces) }
        // `[[#Heading]]` points inside this note; `[[ ]]` at nothing.
        guard !target.isEmpty else { return nil }
        return Link(range: m.range, embed: embed, target: target, heading: heading.flatMap { $0.isEmpty ? nil : $0 },
                    alias: alias.flatMap { $0.isEmpty ? nil : $0 }, targetRange: nameRange, headingRange: headingRange, aliasRange: aliasRange)
    }

    /// A link as markdown: `[[Title#Heading|shown]]`.
    static func markdown(target: String, heading: String? = nil, alias: String? = nil) -> String {
        var s = "[[" + target
        if let heading, !heading.isEmpty { s += "#" + heading }
        if let alias, !alias.isEmpty { s += "|" + alias }
        return s + "]]"
    }

    /// The last part of a link's target, without a `.md` ending.
    static func name(of target: String) -> String {
        let last = target.split(separator: "/", omittingEmptySubsequences: true).last.map(String.init) ?? target
        return stripExtension(last).trimmingCharacters(in: .whitespaces)
    }

    static func folders(of target: String) -> [String] {
        Array(target.split(separator: "/", omittingEmptySubsequences: true).dropLast().map { $0.trimmingCharacters(in: .whitespaces) })
    }

    static func stripExtension(_ s: String) -> String {
        let ext = (s as NSString).pathExtension.lowercased()
        return ["md", "markdown"].contains(ext) ? (s as NSString).deletingPathExtension : s
    }

    /// How titles are compared: case and spacing don't matter, nor markdown's backslash escapes
    /// (an imported title "a\_b" is the note "a_b").
    static func key(_ title: String) -> String {
        let unescaped = title.replacingOccurrences(of: #"\\([!-/:-@\[-`{-~])"#, with: "$1", options: .regularExpression)
        return unescaped.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
    }

    /// The text a link shows: its alias, else its name.
    static func display(_ link: Link) -> String { link.alias ?? link.name }

    /// `text` with every link that `pointsAt` picks retargeted to `newTitle`. Folders written in
    /// front of the name, the heading and the alias stay as they were.
    static func retarget(_ text: String, to newTitle: String, where pointsAt: (Link) -> Bool) -> String {
        let ns = text as NSString
        var out = text
        // From the end, so earlier ranges stay put.
        for link in links(in: text).reversed() where pointsAt(link) {
            let written = ns.substring(with: link.targetRange)
            let lead = written.prefix { $0 == " " }
            let prefix = link.folders.isEmpty ? "" : link.folders.joined(separator: "/") + "/"
            out = (out as NSString).replacingCharacters(in: link.targetRange, with: lead + prefix + newTitle)
        }
        return out
    }

    /// While a link is being typed: what's typed after `[[` up to the caret, when the caret is
    /// in an unfinished link on its line.
    static func typingQuery(in text: String, caret: Int) -> NSRange? {
        let ns = text as NSString
        guard caret >= 2, caret <= ns.length else { return nil }
        let line = ns.lineRange(for: NSRange(location: caret, length: 0))
        let start = max(line.location, caret - 80)
        let before = ns.substring(with: NSRange(location: start, length: caret - start))
        guard let open = before.range(of: "[[", options: .backwards) else { return nil }
        let typed = before[open.upperBound...]
        guard !typed.contains(where: { "[]|#\n".contains($0) }) else { return nil }
        let at = caret - typed.utf16.count
        return NSRange(location: at, length: caret - at)
    }

    /// Links read as plain text, for previews and summaries: `[[Page|Alias]]` → "Alias".
    static func plain(_ line: String) -> String {
        guard line.contains("[[") else { return line }
        var out = line
        for link in links(in: line).reversed() {
            out = (out as NSString).replacingCharacters(in: link.range, with: display(link))
        }
        return out
    }
}

/// Every note's title and folder, to resolve wiki links the way Obsidian does: by name, case
/// aside; folders written in front narrow it down; among notes with the same title the one
/// nearest the linking note wins (same folder, then the most folders in common, then the one
/// edited last).
struct WikiIndex {
    struct Entry: Equatable {
        var id: UUID
        var title: String
        /// Folder names from the top.
        var folders: [String]
        var updated: Date
    }

    private(set) var entries: [Entry]
    private var byKey: [String: [Int]] = [:]

    init(_ entries: [Entry]) {
        self.entries = entries
        for (i, e) in entries.enumerated() { byKey[WikiLinks.key(e.title), default: []].append(i) }
    }

    /// Notes with this title.
    func titled(_ title: String) -> [Entry] { (byKey[WikiLinks.key(title)] ?? []).map { entries[$0] } }

    /// The note a link's target points at, seen from a note in `from` (its folder names).
    func resolve(_ target: String, from: [String] = []) -> UUID? {
        // A title can have a slash in it ("Q1/Q2 plan").
        var hits = titled(WikiLinks.stripExtension(target.trimmingCharacters(in: .whitespaces)))
        let folders = WikiLinks.folders(of: target).map { $0.lowercased() }
        if hits.isEmpty {
            hits = titled(WikiLinks.name(of: target))
            if !folders.isEmpty {
                let narrowed = hits.filter { $0.folders.map { $0.lowercased() }.ends(with: folders) }
                // Folders that don't match (the note was moved) don't lose the link.
                if !narrowed.isEmpty { hits = narrowed }
            }
        }
        guard hits.count > 1 else { return hits.first?.id }
        let here = from.map { $0.lowercased() }
        func shared(_ e: Entry) -> Int {
            let f = e.folders.map { $0.lowercased() }
            var n = 0
            while n < f.count, n < here.count, f[n] == here[n] { n += 1 }
            return n
        }
        return hits.max { a, b in
            let sa = a.folders.map { $0.lowercased() } == here, sb = b.folders.map { $0.lowercased() } == here
            if sa != sb { return !sa }
            if shared(a) != shared(b) { return shared(a) < shared(b) }
            return a.updated < b.updated
        }?.id
    }

    /// Same index with one note's title swapped (to resolve links as they were before a rename).
    func with(title: String, for id: UUID) -> WikiIndex {
        WikiIndex(entries.map { $0.id == id ? Entry(id: $0.id, title: title, folders: $0.folders, updated: $0.updated) : $0 })
    }
}

private extension Array where Element: Equatable {
    func ends(with suffix: [Element]) -> Bool {
        suffix.count <= count && Array(self[(count - suffix.count)...]) == suffix
    }
}

/// The library's titles as a `WikiIndex`, built once and again after the store saves, so styling
/// a note on every keystroke doesn't fetch every note.
@MainActor
enum WikiDirectory {
    private static var cached: WikiIndex?
    private static var observer: NSObjectProtocol?
    /// Goes up each time a title or folder changes.
    private(set) static var generation = 0
    private static var lastSignature: [String] = []

    static func index(_ context: ModelContext) -> WikiIndex {
        if let cached { return cached }
        if observer == nil {
            observer = NotificationCenter.default.addObserver(forName: ModelContext.didSave, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { WikiDirectory.cached = nil }
            }
        }
        let notes = ((try? context.fetch(FetchDescriptor<Note>())) ?? []).filter { $0.deletedAt == nil && $0.trashedAt == nil }
        let index = WikiIndex(notes.map { WikiIndex.Entry(id: $0.id, title: $0.title, folders: context.folderPath($0.folder), updated: $0.updatedAt) })
        cached = index
        // Most saves are typing: the editor recolours only when a title or folder changed.
        let signature = index.entries.map { "\($0.id)\u{1F}\(WikiLinks.key($0.title))\u{1F}\($0.folders.joined(separator: "/"))" }.sorted()
        if signature != lastSignature {
            lastSignature = signature
            generation += 1
        }
        return index
    }

    static func invalidate() { cached = nil }

    /// Titles to offer after `[[`: those starting with what's typed, then those containing it,
    /// each edited last first. Every title once; never the note being written.
    static func suggestions(_ typed: String, excluding id: UUID, in context: ModelContext, limit: Int = 5) -> [String] {
        let q = WikiLinks.key(typed)
        let entries = index(context).entries.filter { $0.id != id && !$0.title.isEmpty }.sorted { $0.updated > $1.updated }
        let starts = entries.filter { q.isEmpty || WikiLinks.key($0.title).hasPrefix(q) }
        let contains = q.isEmpty ? [] : entries.filter { e in let k = WikiLinks.key(e.title); return !k.hasPrefix(q) && k.contains(q) }
        var seen = Set<String>()
        return (starts + contains).map(\.title).filter { seen.insert(WikiLinks.key($0)).inserted }.prefix(limit).map { $0 }
    }

    /// The index as the editor of `note` sees it.
    static func scope(for note: Note, in context: ModelContext) -> WikiScope {
        let index = index(context)
        return WikiScope(index: index, from: context.folderPath(note.folder), generation: generation)
    }
}

@MainActor
extension ModelContext {
    /// Folder names from the top down to `folder`.
    func folderPath(_ folder: Folder?) -> [String] {
        var parts: [String] = []
        var f = folder
        var seen = Set<UUID>()
        while let x = f, seen.insert(x.id).inserted { parts.insert(x.name, at: 0); f = x.parent }
        return parts
    }

    /// The note a wiki link in `note` leads to, if there is one.
    func resolveWikiLink(_ target: String, from note: Note) -> Note? {
        WikiDirectory.index(self).resolve(target, from: folderPath(note.folder)).flatMap { self.note($0) }
    }

    /// Notes that link to `note`, with a wiki link or a note link, newest first. Its parent's link
    /// to a sub-note isn't counted: the sub-note already leads back to it.
    func backlinks(to note: Note) -> [Note] {
        let index = WikiDirectory.index(self)
        let noteLink = "pane-note:\(note.id.uuidString.lowercased())"
        let key = WikiLinks.key(note.title)
        let notes = ((try? fetch(FetchDescriptor<Note>(sortBy: [SortDescriptor(\.updatedAt, order: .reverse)]))) ?? [])
        return notes.filter { other in
            guard other.id != note.id, other.deletedAt == nil, other.trashedAt == nil, !other.isLocked else { return false }
            if other.id != note.parentID, other.body.contains(noteLink) { return true }
            guard other.body.contains("[["), other.body.lowercased().contains(key.split(separator: " ").first.map(String.init) ?? key) else { return false }
            let from = folderPath(other.folder)
            return WikiLinks.links(in: other.body).contains { index.resolve($0.target, from: from) == note.id }
        }
    }

    /// After `note` was renamed from `oldTitle`, points the wiki links that led to it under its
    /// old title at its new one, as Obsidian does when a file is renamed. Returns how many notes
    /// changed. Locked notes can't be read here and keep their links.
    @discardableResult
    func retargetWikiLinks(to note: Note, renamedFrom oldTitle: String) -> Int {
        let newTitle = note.title
        guard !oldTitle.isEmpty, !newTitle.isEmpty, WikiLinks.key(oldTitle) != WikiLinks.key(newTitle) else { return 0 }
        let before = WikiDirectory.index(self).with(title: oldTitle, for: note.id)
        let oldKey = WikiLinks.key(oldTitle)
        var changed = 0
        for other in (try? fetch(FetchDescriptor<Note>())) ?? [] where other.id != note.id && other.deletedAt == nil && !other.isLocked && other.body.contains("[[") {
            let from = folderPath(other.folder)
            let updated = WikiLinks.retarget(other.body, to: newTitle) { link in
                WikiLinks.key(link.name) == oldKey && before.resolve(link.target, from: from) == note.id
            }
            guard updated != other.body else { continue }
            other.body = updated
            other.dirty = true
            changed += 1
        }
        if changed > 0 {
            try? save()
            SyncSignal.changed()
        }
        return changed
    }
}

/// What the editor needs to colour wiki links: the library's titles, seen from the open note's
/// folder. Equal while neither changes, so the editor restyles only when they do.
struct WikiScope: Equatable {
    var index: WikiIndex
    var from: [String]
    var generation: Int

    func resolves(_ target: String) -> Bool { index.resolve(target, from: from) != nil }

    static func == (a: WikiScope, b: WikiScope) -> Bool { a.generation == b.generation && a.from == b.from }
}
