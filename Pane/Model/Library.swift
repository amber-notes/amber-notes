import Foundation
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

/// What the sidebar has selected.
enum Scope: Hashable, Codable {
    case all
    case folder(UUID)
    case trash

    /// Where the sidebar should point, given the folders that exist. A folder that's gone
    /// (deleted here, with a parent, or on another device) falls back to All Notes, and with a
    /// single folder there's no All Notes row, so that folder stands in. No scope (the iPhone
    /// folder list is showing) stays that way: selecting a row there without pushing it
    /// leaves the row marked and deaf to taps.
    static func settled(_ scope: Scope?, liveFolders: [UUID]) -> Scope? {
        var s = scope
        if case .folder(let id)? = s, !liveFolders.contains(id) { s = .all }
        if s == .all, liveFolders.count == 1 { s = .folder(liveFolders[0]) }
        return s
    }
}

extension Scope {
    /// The list a note is shown in when it's opened from the iPhone folder list: its folder.
    static func opening(_ note: Note) -> Scope {
        note.folder.map { .folder($0.id) } ?? .all
    }
}

extension UTType {
    static let paneItem = UTType(exportedAs: "dev.emilwagman.pane.item")
}

/// A note, folder or file being dragged inside the app.
struct PaneDragItem: Codable, Transferable {
    enum Kind: String, Codable { case note, folder, file }
    var kind: Kind
    var id: UUID
    /// The rest of a multi-selection dragged together with `id` (notes only).
    var others: [UUID]? = nil

    /// Every item this drag carries, `id` first.
    var ids: [UUID] { [id] + (others ?? []) }

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .paneItem)
    }
}

/// Mutations on the library. Every change bumps `updatedAt` so sync can find it.
@MainActor
extension ModelContext {
    func allFolders() -> [Folder] {
        ((try? fetch(FetchDescriptor<Folder>())) ?? []).filter { $0.deletedAt == nil }
    }

    func folder(_ id: UUID) -> Folder? {
        try? fetch(FetchDescriptor<Folder>(predicate: #Predicate { $0.id == id })).first
    }

    func note(_ id: UUID) -> Note? {
        try? fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.id == id })).first
    }

    /// The folder new notes go into when "All Notes" is selected.
    func defaultFolder() -> Folder {
        if let f = allFolders().filter({ $0.parent == nil }).min(by: { $0.sortIndex < $1.sortIndex }) { return f }
        let f = Folder(name: "Notes")
        insert(f)
        return f
    }

    @discardableResult
    func createNote(in scope: Scope, body: String = "") -> Note {
        let target: Folder
        if case .folder(let id) = scope, let f = folder(id), f.deletedAt == nil { target = f } else { target = defaultFolder() }
        let n = Note(body: body, folder: target)
        insert(n)
        try? save()
        return n
    }

    @discardableResult
    /// True when an Apple note was imported before and hasn't changed since:
    /// a live note with its title, dated to its last edit (imports keep that date).
    func hasImported(title: String, modified: Date) -> Bool {
        let stamp = modified.timeIntervalSinceReferenceDate.rounded()
        return ((try? fetch(FetchDescriptor<Note>())) ?? []).contains {
            $0.trashedAt == nil && $0.deletedAt == nil && $0.title == title
                && $0.createdAt.timeIntervalSinceReferenceDate.rounded() == stamp
        }
    }

    func createFolder(named name: String, parent: Folder? = nil) -> Folder {
        let siblings = allFolders().filter { $0.parent?.id == parent?.id }
        let f = Folder(name: name, parent: parent, sortIndex: (siblings.map(\.sortIndex).max() ?? 0) + 1)
        insert(f)
        try? save()
        return f
    }

    /// The note to open at launch: the one you were on, otherwise the one edited last. A blank
    /// note you left open (the app was closed before you typed) is discarded, as leaving it
    /// would have done, instead of opening on an empty page.
    func noteToReopen(last: UUID?) -> Note? {
        func blank(_ n: Note) -> Bool { !n.isLocked && n.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if let last, let n = note(last), n.deletedAt == nil, n.trashedAt == nil {
            guard blank(n) else { return n }
            purge(n)
        }
        var newest = FetchDescriptor<Note>(sortBy: [SortDescriptor(\.updatedAt, order: .reverse)])
        newest.fetchLimit = 20
        return ((try? fetch(newest)) ?? []).first { $0.deletedAt == nil && $0.trashedAt == nil && !blank($0) && !isNested($0) }
    }

    /// A note's sub-notes (those that name it as their parent).
    func subNotes(of note: Note) -> [Note] {
        let id = note.id
        return ((try? fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.parentID == id }))) ?? []).filter { $0.deletedAt == nil }
    }

    /// Creates a sub-note of `parent`, in the same folder.
    func createSubNote(of parent: Note, body: String = "") -> Note {
        let n = Note(body: body, folder: parent.folder)
        n.parentID = parent.id
        insert(n)
        try? save()
        return n
    }

    /// Sub-notes made before the parent was recorded (older builds, imports) get it from the link
    /// in their parent's text, so every device and the AI see the same tree (notes.parent_id).
    /// Only a missing parent is filled in; one already set is never changed. Returns how many.
    @discardableResult
    func backfillSubNoteParents() -> Int {
        // The store picks the notes whose text links a note, and then the few notes they link:
        // reading every note's text here held up each return to the app (and launch), about
        // 1.5 s with 20,000 notes.
        let linking = (try? fetch(FetchDescriptor<Note>(predicate: #Predicate { $0.deletedAt == nil && $0.body.contains("pane-note:") }))) ?? []
        var parentOf: [UUID: UUID] = [:]
        for parent in linking where !parent.isLocked {
            for m in parent.body.matches(of: /pane-note:([0-9a-fA-F-]{36})/) {
                guard let id = UUID(uuidString: String(m.1)), id != parent.id, parentOf[id] == nil else { continue }
                parentOf[id] = parent.id
            }
        }
        guard !parentOf.isEmpty else { return 0 }
        let ids = Array(parentOf.keys)
        let orphans = (try? fetch(FetchDescriptor<Note>(predicate: #Predicate { ids.contains($0.id) && $0.deletedAt == nil && $0.parentID == nil }))) ?? []
        var filled = 0
        for child in orphans {
            guard let parent = parentOf[child.id] else { continue }
            child.parentID = parent
            child.dirty = true
            filled += 1
        }
        if filled > 0 { try? save(); SyncSignal.changed() }
        return filled
    }

    /// True when a sub-note is still linked from its parent, so it lives there, not in the list.
    func isNested(_ note: Note) -> Bool {
        guard let pid = note.parentID, let parent = self.note(pid), parent.deletedAt == nil else { return false }
        return parent.body.contains("pane-note:\(note.id.uuidString.lowercased())")
    }

    func trash(_ note: Note) {
        // Marked before its sub-notes, so a loop of sub-notes (A under B under A) ends.
        note.trashedAt = .now
        note.isPinned = false
        note.touch()
        // A parent takes its sub-notes with it.
        for child in subNotes(of: note) where child.trashedAt == nil { trash(child) }
        try? save()
    }

    func restore(_ note: Note) {
        note.trashedAt = nil
        if note.folder == nil || note.folder?.deletedAt != nil { note.folder = defaultFolder() }
        note.touch()
        for child in subNotes(of: note) where child.trashedAt != nil { restore(child) }
        try? save()
    }

    func purge(_ note: Note) {
        note.deletedAt = .now
        note.body = ""
        note.lockedBody = nil
        note.touch()
        try? save()
    }

    /// Deletes several notes the way one is deleted: live notes go to Recently Deleted
    /// (sub-notes with them), notes already there are deleted for good.
    func remove(_ notes: [Note]) {
        for n in notes where n.deletedAt == nil {
            if n.trashedAt == nil { trash(n) } else { purge(n) }
        }
    }

    func move(_ notes: [Note], to folder: Folder) {
        for n in notes { move(n, to: folder) }
    }

    func togglePin(_ note: Note) {
        note.isPinned.toggle()
        note.touch()
        try? save()
    }

    func move(_ note: Note, to folder: Folder) {
        guard note.folder?.id != folder.id else { return }
        note.folder = folder
        note.trashedAt = nil
        note.touch()
        try? save()
    }

    /// Nests `folder` inside `parent` (nil = top level), refusing cycles.
    func move(_ folder: Folder, into parent: Folder?) {
        var cursor = parent
        while let c = cursor {
            if c.id == folder.id { return }
            cursor = c.parent
        }
        folder.parent = parent
        folder.touch()
        try? save()
    }

    /// Deleting a folder sends its notes and files (and sub-folders') to Recently Deleted, and the
    /// deletion goes up with the next sync.
    func trash(_ folder: Folder) {
        // Marked first, so a loop of folders can't recurse forever.
        folder.deletedAt = .now
        folder.touch()
        for child in folder.liveChildren { trash(child) }
        for note in folder.liveNotes { trash(note) }
        for file in files(in: folder.id) { trash(file) }
        try? save()
    }

    /// Removes a folder from this device for good, without telling the server (SwiftData's delete).
    func erase(_ folder: Folder) {
        func remove<T: PersistentModel>(_ m: T) { delete(m) }
        remove(folder)
    }

    /// Apple Notes keeps deleted notes for 30 days.
    func purgeExpiredTrash() {
        let cutoff = Date.now.addingTimeInterval(-30 * 24 * 3600)
        let old = ((try? fetch(FetchDescriptor<Note>())) ?? []).filter { ($0.trashedAt ?? .distantFuture) < cutoff && $0.deletedAt == nil }
        old.forEach(purge)
        purgeExpiredTrashedFiles()
    }

    /// Imports dropped files: markdown and text become notes; anything else (PDFs,
    /// spreadsheets, images…) is kept in the folder as a file of its own. Returns what was made.
    @discardableResult
    func importFiles(_ urls: [URL], into scope: Scope) -> [UUID] {
        var made: [UUID] = []
        for url in urls {
            let ext = url.pathExtension.lowercased()
            // A folder from Finder: a folder here, with its files.
            if (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true, !FileKinds.isPackageDocument(url) {
                let parent: Folder? = { if case .folder(let id) = scope { return folder(id) } else { return nil } }()
                made += addFolder(url, into: parent).map(\.id)
                continue
            }
            if ["md", "markdown", "txt", "text"].contains(ext) {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
                let name = url.deletingPathExtension().lastPathComponent
                let body = NoteText.title(of: text) == name || text.hasPrefix("# ") ? text : "# \(name)\n\n\(text)"
                made.append(createNote(in: scope, body: body).id)
            } else {
                made += addFiles([url], to: folderForFiles(scope)).map(\.id)
            }
        }
        try? save()
        return made
    }

    /// Turns a spreadsheet's first sheet into a note with a typed table.
    func importSpreadsheet(_ url: URL, into scope: Scope) throws -> Note {
        let (title, table) = try XLSXImporter.table(from: url)
        let note = createNote(in: scope, body: "\(title)\n\n\(table.markdown)\n")
        return note
    }

    func attachment(_ id: UUID) -> Attachment? {
        try? fetch(FetchDescriptor<Attachment>(predicate: #Predicate { $0.id == id })).first
    }

    /// Copies files into Pane for embedding in a note (kinds the app can't show are refused).
    func addAttachments(_ urls: [URL]) -> [Attachment] {
        let files = FileKinds.accept(urls).compactMap { try? FileStore.importFile(at: $0) }
        files.forEach(insert)
        try? save()
        SyncSignal.changed()
        return files
    }
}

/// What the list groups by date: notes, and files kept in folders.
protocol DatedListItem {
    var listDate: Date { get }
    var pinnedInList: Bool { get }
}

extension Note: DatedListItem {
    var listDate: Date { updatedAt }
    var pinnedInList: Bool { isPinned && trashedAt == nil }
}

extension Attachment: DatedListItem {
    var pinnedInList: Bool { false }
}

/// Grouping of the note list by recency, like Apple Notes.
enum DateBucket {
    /// Notes in order, newest first, with files merged in where their dates fall. The notes keep
    /// their order and are read once; only the few files are sorted. With files in the library
    /// the list used to wrap and sort every note again on each update (20,000 at launch).
    static func merged(notes: [Note], files: [Attachment]) -> [(ListItem, Date)] {
        let sortedFiles = files.map { ($0, $0.listDate) }.sorted { $0.1 > $1.1 }
        var out: [(ListItem, Date)] = []
        out.reserveCapacity(notes.count + sortedFiles.count)
        var f = 0
        for n in notes {
            let d = n.updatedAt
            while f < sortedFiles.count, sortedFiles[f].1 > d {
                out.append((.file(sortedFiles[f].0), sortedFiles[f].1))
                f += 1
            }
            out.append((.note(n), d))
        }
        while f < sortedFiles.count {
            out.append((.file(sortedFiles[f].0), sortedFiles[f].1))
            f += 1
        }
        return out
    }

    static func sections<Item: DatedListItem>(_ notes: [Item], now: Date = .now, calendar: Calendar = .current) -> [(String, [Item])] {
        // Each date read once: model properties aren't free, and a sort reads them often.
        sections(newestFirst: notes.map { ($0, $0.listDate) }.sorted { $0.1 > $1.1 }, now: now, calendar: calendar)
    }

    /// The same, for items already in order, newest first, each with its date: nothing is sorted
    /// or read again (the list hands over its notes in this order already).
    static func sections<Item: DatedListItem>(newestFirst dated: [(Item, Date)], now: Date = .now, calendar: Calendar = .current) -> [(String, [Item])] {
        var pinned: [Item] = []
        var groups: [(key: String, order: Date, notes: [Item])] = []
        var index: [String: Int] = [:]
        let today = calendar.startOfDay(for: now)
        func daysBack(_ n: Int) -> Date { calendar.date(byAdding: .day, value: -n, to: today) ?? today.addingTimeInterval(Double(-n) * 86400) }
        // Day boundaries once, then plain date comparisons per note.
        let yesterday = daysBack(1), week = daysBack(7), month30 = daysBack(30)
        var monthKeys: [Int: (String, Date)] = [:]
        let thisYear = calendar.component(.year, from: now)
        for (n, d) in dated {
            if n.pinnedInList { pinned.append(n); continue }
            let key: String
            let order: Date
            if d >= today { key = "Today"; order = today }
            else if d >= yesterday { key = "Yesterday"; order = yesterday }
            else if d >= week { key = "Previous 7 Days"; order = daysBack(2) }
            else if d >= month30 { key = "Previous 30 Days"; order = daysBack(8) }
            else {
                let comps = calendar.dateComponents([.year, .month], from: d)
                let k = (comps.year ?? 0) * 100 + (comps.month ?? 0)
                if let known = monthKeys[k] { (key, order) = known } else {
                    let month = calendar.date(from: comps) ?? d
                    let label = comps.year == thisYear ? month.formatted(.dateTime.month(.wide).locale(locale)) : month.formatted(.dateTime.month(.wide).year().locale(locale))
                    monthKeys[k] = (label, month)
                    (key, order) = (label, month)
                }
            }
            if let i = index[key] { groups[i].notes.append(n) } else { index[key] = groups.count; groups.append((key, order, [n])) }
        }
        var result: [(String, [Item])] = []
        if !pinned.isEmpty { result.append(("Pinned", pinned)) }
        result += groups.sorted { $0.order > $1.order }.map { ($0.key, $0.notes) }
        return result
    }

    /// The locale dates are written in: the person's own. Captures pin it (en_US) so every picture reads the same.
    nonisolated(unsafe) static var locale: Locale = .autoupdatingCurrent {
        didSet { rowDates = [:] }
    }

    nonisolated(unsafe) private static var rowDates: [Int: String] = [:]
    nonisolated(unsafe) private static var rowDatesDay = Date.distantPast

    /// Row date: time today, "Yesterday", weekday this week, else a short date.
    /// Remembered per minute (today) or per day, since the list asks for every row.
    static func rowDate(_ d: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let today = calendar.startOfDay(for: now)
        if today != rowDatesDay { rowDates = [:]; rowDatesDay = today }
        let isToday = d >= today && d < today.addingTimeInterval(86400 + 3600)
        let key = isToday ? Int(d.timeIntervalSince1970 / 60) : -Int(calendar.startOfDay(for: d).timeIntervalSince1970 / 86400) - 1
        if let s = rowDates[key] { return s }
        let s: String
        if calendar.isDateInToday(d) { s = d.formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(locale)) }
        else if calendar.isDateInYesterday(d) { s = "Yesterday" }
        else {
            let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: d), to: today).day ?? 99
            s = days < 7 ? d.formatted(.dateTime.weekday(.wide).locale(locale)) : d.formatted(Date.FormatStyle(date: .numeric, time: .omitted).locale(locale))
        }
        rowDates[key] = s
        return s
    }

    /// Editor header: "27 September 2026 at 16:02".
    static func header(_ d: Date) -> String {
        d.formatted(.dateTime.day().month(.wide).year().hour().minute().locale(locale))
    }
}
