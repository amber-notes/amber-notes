import Foundation
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

/// What the sidebar has selected.
enum Scope: Hashable, Codable {
    case all
    case folder(UUID)
    case trash
}

extension UTType {
    static let paneItem = UTType(exportedAs: "dev.emilwagman.pane.item")
}

/// A note or folder being dragged inside the app.
struct PaneDragItem: Codable, Transferable {
    enum Kind: String, Codable { case note, folder }
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
        if case .folder(let id) = scope, let f = folder(id) { target = f } else { target = defaultFolder() }
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

    /// True when a sub-note is still linked from its parent, so it lives there, not in the list.
    func isNested(_ note: Note) -> Bool {
        guard let pid = note.parentID, let parent = self.note(pid), parent.deletedAt == nil else { return false }
        return parent.body.contains("pane-note:\(note.id.uuidString.lowercased())")
    }

    func trash(_ note: Note) {
        // A parent takes its sub-notes with it.
        for child in subNotes(of: note) where child.trashedAt == nil { trash(child) }
        note.trashedAt = .now
        note.isPinned = false
        note.touch()
        try? save()
    }

    func restore(_ note: Note) {
        for child in subNotes(of: note) where child.trashedAt != nil { restore(child) }
        note.trashedAt = nil
        if note.folder == nil || note.folder?.deletedAt != nil { note.folder = defaultFolder() }
        note.touch()
        try? save()
    }

    func purge(_ note: Note) {
        note.deletedAt = .now
        note.body = ""
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

    /// Deleting a folder sends its notes (and sub-folders' notes) to Recently Deleted.
    func delete(_ folder: Folder) {
        for child in folder.liveChildren { delete(child) }
        for note in folder.liveNotes { trash(note) }
        folder.deletedAt = .now
        folder.touch()
        try? save()
    }

    /// Apple Notes keeps deleted notes for 30 days.
    func purgeExpiredTrash() {
        let cutoff = Date.now.addingTimeInterval(-30 * 24 * 3600)
        let old = ((try? fetch(FetchDescriptor<Note>())) ?? []).filter { ($0.trashedAt ?? .distantFuture) < cutoff && $0.deletedAt == nil }
        old.forEach(purge)
    }

    /// Imports dropped files: markdown and text become notes; anything else
    /// (PDFs, spreadsheets, images…) becomes a note holding the file.
    @discardableResult
    func importFiles(_ urls: [URL], into scope: Scope) -> [Note] {
        var made: [Note] = []
        for url in urls {
            let ext = url.pathExtension.lowercased()
            if ["md", "markdown", "txt", "text"].contains(ext) {
                let access = url.startAccessingSecurityScopedResource()
                defer { if access { url.stopAccessingSecurityScopedResource() } }
                guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
                let name = url.deletingPathExtension().lastPathComponent
                let body = NoteText.title(of: text) == name || text.hasPrefix("# ") ? text : "# \(name)\n\n\(text)"
                made.append(createNote(in: scope, body: body))
            } else if let a = try? FileStore.importFile(at: url) {
                insert(a)
                let title = (a.filename as NSString).deletingPathExtension
                made.append(createNote(in: scope, body: "\(title)\n\n\(a.markdown)\n"))
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

    /// Copies files into Pane for embedding in a note.
    func addAttachments(_ urls: [URL]) -> [Attachment] {
        let files = urls.compactMap { try? FileStore.importFile(at: $0) }
        files.forEach(insert)
        try? save()
        SyncSignal.changed()
        return files
    }
}

/// Grouping of the note list by recency, like Apple Notes.
enum DateBucket {
    static func sections(_ notes: [Note], now: Date = .now, calendar: Calendar = .current) -> [(String, [Note])] {
        var pinned: [Note] = []
        var groups: [(key: String, order: Date, notes: [Note])] = []
        var index: [String: Int] = [:]
        let today = calendar.startOfDay(for: now)
        func daysBack(_ n: Int) -> Date { calendar.date(byAdding: .day, value: -n, to: today) ?? today.addingTimeInterval(Double(-n) * 86400) }
        // Day boundaries once, then plain date comparisons per note.
        let yesterday = daysBack(1), week = daysBack(7), month30 = daysBack(30)
        var monthKeys: [Int: (String, Date)] = [:]
        let thisYear = calendar.component(.year, from: now)
        // Each date read once: model properties aren't free, and a sort reads them often.
        let dated = notes.map { ($0, $0.updatedAt) }.sorted { $0.1 > $1.1 }
        for (n, d) in dated {
            if n.isPinned && n.trashedAt == nil { pinned.append(n); continue }
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
                    let label = comps.year == thisYear ? month.formatted(.dateTime.month(.wide)) : month.formatted(.dateTime.month(.wide).year())
                    monthKeys[k] = (label, month)
                    (key, order) = (label, month)
                }
            }
            if let i = index[key] { groups[i].notes.append(n) } else { index[key] = groups.count; groups.append((key, order, [n])) }
        }
        var result: [(String, [Note])] = []
        if !pinned.isEmpty { result.append(("Pinned", pinned)) }
        result += groups.sorted { $0.order > $1.order }.map { ($0.key, $0.notes) }
        return result
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
        if calendar.isDateInToday(d) { s = d.formatted(date: .omitted, time: .shortened) }
        else if calendar.isDateInYesterday(d) { s = "Yesterday" }
        else {
            let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: d), to: today).day ?? 99
            s = days < 7 ? d.formatted(.dateTime.weekday(.wide)) : d.formatted(date: .numeric, time: .omitted)
        }
        rowDates[key] = s
        return s
    }

    /// Editor header: "27 September 2026 at 16:02".
    static func header(_ d: Date) -> String {
        d.formatted(.dateTime.day().month(.wide).year().hour().minute())
    }
}
