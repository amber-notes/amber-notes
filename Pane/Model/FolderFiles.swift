import Foundation
import SwiftData
import UniformTypeIdentifiers

/// Files kept in a folder on their own (PDFs, images, spreadsheets), listed with the folder's notes
/// and apps. Deleting one moves it to Recently Deleted for 30 days, like a note; deleting a folder
/// takes its files there too. The server does the same for every device (20261008100000).
@MainActor
extension ModelContext {
    /// Every file in a folder, live or in Recently Deleted.
    func folderFiles() -> [Attachment] {
        (try? fetch(FetchDescriptor<Attachment>(predicate: #Predicate { $0.folderID != nil && $0.deletedAt == nil }))) ?? []
    }

    /// The live files in one folder.
    func files(in folderID: UUID) -> [Attachment] {
        let id: UUID? = folderID
        return ((try? fetch(FetchDescriptor<Attachment>(predicate: #Predicate { $0.folderID == id && $0.deletedAt == nil }))) ?? [])
            .filter { $0.trashedAt == nil }
    }

    /// Copies files into a folder, on their own (not in a note). Kinds the app can't show, and
    /// files over 100 MB, are refused with a message naming them (FileRefusal).
    @discardableResult
    func addFiles(_ urls: [URL], to folder: Folder) -> [Attachment] {
        let made = FileKinds.accept(urls).compactMap { try? FileStore.importFile(at: $0) }
        for a in made {
            a.folderID = folder.id
            a.modifiedAt = .now
            insert(a)
        }
        try? save()
        SyncSignal.changed()
        return made
    }

    /// A folder dropped from Finder: a folder of the same name in `parent` (made if needed), with
    /// its files, and its sub-folders the same way. Returns the files added.
    @discardableResult
    func addFolder(_ url: URL, into parent: Folder?) -> [Attachment] {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let name = url.lastPathComponent
        let folder = allFolders().first { $0.parent?.id == parent?.id && $0.name == name } ?? createFolder(named: name, parent: parent)
        let items = (try? FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])) ?? []
        var made: [Attachment] = []
        let dirs = items.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true && !FileKinds.isPackageDocument($0) }
        for d in dirs.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) { made += addFolder(d, into: folder) }
        made += addFiles(items.filter { !dirs.contains($0) }.sorted { $0.lastPathComponent < $1.lastPathComponent }, to: folder)
        return made
    }

    /// The folder that "Add File" and drops use for a list scope: the folder, or the default one.
    func folderForFiles(_ scope: Scope) -> Folder {
        if case .folder(let id) = scope, let f = folder(id), f.deletedAt == nil { return f }
        return defaultFolder()
    }

    func trash(_ file: Attachment) {
        file.trashedAt = .now
        file.touch()
        try? save()
    }

    /// Back from Recently Deleted, into its folder, or the default one if that's gone.
    func restore(_ file: Attachment) {
        file.trashedAt = nil
        let home = file.folderID.flatMap { folder($0) }
        if home == nil || home?.deletedAt != nil { file.folderID = defaultFolder().id }
        file.touch()
        try? save()
    }

    /// Gone for good: sync removes the stored copy and the bytes on every device.
    func purge(_ file: Attachment) {
        file.deletedAt = .now
        file.touch()
        FileStore.remove(file)
        try? save()
    }

    /// Like notes: live files go to Recently Deleted, files already there are deleted for good.
    func remove(files: [Attachment]) {
        for f in files where f.deletedAt == nil {
            if f.trashedAt == nil { trash(f) } else { purge(f) }
        }
    }

    func move(_ file: Attachment, to folder: Folder) {
        guard file.folderID != folder.id || file.trashedAt != nil else { return }
        file.folderID = folder.id
        file.trashedAt = nil
        file.touch()
        try? save()
    }

    /// A new name, keeping the file's ending (it says what kind of file it is).
    func rename(_ file: Attachment, to typed: String) {
        let name = FolderFileName.keepingExtension(typed, of: file.filename)
        guard !name.isEmpty, name != file.filename else { return }
        FileStore.rename(file.id, from: file.filename, to: name)
        file.filename = name
        file.touch()
        try? save()
    }

    /// Recently Deleted keeps files for 30 days, like notes.
    func purgeExpiredTrashedFiles() {
        let cutoff = Date.now.addingTimeInterval(-30 * 24 * 3600)
        for f in folderFiles() where (f.trashedAt ?? .distantFuture) < cutoff { purge(f) }
    }
}

enum FolderFileName {
    /// What a rename keeps: the typed name, trimmed, with the old ending put back if it was left off.
    static func keepingExtension(_ typed: String, of old: String) -> String {
        let name = String(typed.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "/", with: "-").prefix(255))
        let ext = (old as NSString).pathExtension
        guard !name.isEmpty, !ext.isEmpty, (name as NSString).pathExtension.lowercased() != ext.lowercased() else { return name }
        return "\(name).\(ext)"
    }

    /// The name without its ending, for the rename field.
    static func stem(_ name: String) -> String { (name as NSString).deletingPathExtension }
}

/// What the app takes as a file of its own, and shows in full: PDF, pictures, text (TXT, CSV,
/// JSON, code), and Office and iWork documents through Quick Look. Audio, video and EPUB come later.
enum FileKinds {
    /// Endings the app takes, the same list the AI's server has (folder_files.ts SUPPORTED).
    static let endings: Set<String> = [
        "pdf", "jpg", "jpeg", "png", "heic", "heif", "gif", "webp",
        "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "html", "css", "js", "ts", "tsx", "jsx", "py", "swift", "sh", "sql", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "m",
        "docx", "xlsx", "pptx", "pages", "numbers", "key",
    ]
    /// One file added in the app: 100 MB (pane_limit 'file_bytes').
    static let maxBytes: Int64 = 100 * 1024 * 1024

    /// The kinds Add File offers.
    static var contentTypes: [UTType] {
        endings.compactMap { UTType(filenameExtension: $0) } + [.pdf, .image, .plainText, .commaSeparatedText, .json, .sourceCode]
    }

    static func isSupported(_ url: URL) -> Bool { endings.contains(url.pathExtension.lowercased()) }

    /// iWork documents can be folders on disk (packages); they're files to a person.
    static func isPackageDocument(_ url: URL) -> Bool { ["pages", "numbers", "key"].contains(url.pathExtension.lowercased()) }

    /// The files that can be added; the rest are named in a refusal the window shows.
    static func accept(_ urls: [URL]) -> [URL] {
        var ok: [URL] = [], unsupported: [String] = [], tooBig: [String] = []
        for u in urls {
            let size = (try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
            if !isSupported(u) { unsupported.append(u.lastPathComponent) }
            else if size > maxBytes { tooBig.append(u.lastPathComponent) }
            else { ok.append(u) }
        }
        if !unsupported.isEmpty || !tooBig.isEmpty { FileRefusal.post(unsupported: unsupported, tooBig: tooBig) }
        return ok
    }
}

/// Files that weren't added, and why, for the window to say once.
struct FileRefusal: Equatable, Identifiable {
    var unsupported: [String]
    var tooBig: [String]
    var id: String { (unsupported + tooBig).joined(separator: "|") }

    static let notification = Notification.Name("pane.filesRefused")

    static func post(unsupported: [String], tooBig: [String]) {
        NotificationCenter.default.post(name: notification, object: FileRefusal(unsupported: unsupported, tooBig: tooBig))
    }

    /// What the refused files are, by ending, for the title.
    enum Kind: Equatable {
        case videos, audio, ebooks, archives, other
        static func of(_ name: String) -> Kind {
            switch (name as NSString).pathExtension.lowercased() {
            case "mov", "mp4", "m4v", "avi", "mkv", "webm", "wmv", "mpg", "mpeg": .videos
            case "mp3", "m4a", "wav", "aac", "flac", "ogg", "aiff", "aif", "caf": .audio
            case "epub", "mobi", "azw", "azw3": .ebooks
            case "zip", "rar", "7z", "gz", "tar", "dmg": .archives
            default: .other
            }
        }
    }

    /// Short, by kind: "Can't add videos yet", "File too large".
    var title: String {
        if unsupported.isEmpty { return tooBig.count == 1 ? "File too large" : "Files too large" }
        let kinds = Set(unsupported.map(Kind.of))
        guard kinds.count == 1, tooBig.isEmpty, let kind = kinds.first else { return "Can't add these files" }
        switch kind {
        case .videos: return "Can't add videos yet"
        case .audio: return "Can't add audio yet"
        case .ebooks: return "Can't add e-books yet"
        case .archives: return unsupported.count == 1 ? "Can't add this archive" : "Can't add archives"
        case .other: return unsupported.count == 1 ? "Can't add this kind of file" : "Can't add these kinds of files"
        }
    }

    /// The files by name, one a line, then one line on what works.
    var message: String {
        var lines = Self.names(unsupported + tooBig)
        if !unsupported.isEmpty { lines.append("Amber Notes takes PDFs, pictures, text, CSV and Office files.") }
        if !tooBig.isEmpty { lines.append("Files can be up to 100 MB.") }
        return lines.joined(separator: "\n")
    }

    static func names(_ names: [String]) -> [String] {
        let shown = names.prefix(names.count > 5 ? 4 : 5).map { "\u{201C}\($0)\u{201D}" }
        return names.count > 5 ? shown + ["and \(names.count - 4) more"] : shown
    }
}
