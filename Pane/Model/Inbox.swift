import Foundation

/// Things shared into Amber Notes from other apps, waiting for the app to file them.
/// The share extension writes items into the shared App Group container; the app
/// turns each into a note the next time it's active.
enum Inbox {
    static let appGroup = AppIdentity.appGroup

    struct Item: Codable {
        var id = UUID()
        var markdown: String
        /// Files copied next to item.json, embedded at the end of the note.
        var files: [String] = []
        var createdAt = Date()
    }

    static var root: URL? {
        if let rootOverride { return rootOverride }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appending(path: "Inbox", directoryHint: .isDirectory)
    }

    /// The share extension has written here at least once, on this device: the folder is made on
    /// its first use and stays after the items in it are filed.
    static var everUsed: Bool {
        guard let root else { return false }
        return FileManager.default.fileExists(atPath: root.path(percentEncoded: false))
    }

    /// Tests point the inbox at a temporary folder (unsigned test builds have no app group).
    nonisolated(unsafe) static var rootOverride: URL?

    /// Writes an item (called by the share extension).
    static func add(markdown: String, files: [URL]) throws {
        guard let root else { throw CocoaError(.fileNoSuchFile) }
        var item = Item(markdown: markdown)
        let dir = root.appending(path: item.id.uuidString, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        for f in files {
            let dest = dir.appending(path: f.lastPathComponent)
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.copyItem(at: f, to: dest)
            item.files.append(f.lastPathComponent)
        }
        try JSONEncoder().encode(item).write(to: dir.appending(path: "item.json"), options: .atomic)
    }

    /// Everything waiting, oldest first, with each item's folder.
    static func pending() -> [(Item, URL)] {
        guard let root, let dirs = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return [] }
        return dirs.compactMap { dir in
            guard let data = try? Data(contentsOf: dir.appending(path: "item.json")),
                  let item = try? JSONDecoder().decode(Item.self, from: data) else { return nil }
            return (item, dir)
        }.sorted { $0.0.createdAt < $1.0.createdAt }
    }

    static func remove(_ dir: URL) { try? FileManager.default.removeItem(at: dir) }
}
