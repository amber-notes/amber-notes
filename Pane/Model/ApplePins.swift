#if os(macOS)
import Foundation
import SQLite3

/// Which Apple Notes are pinned. AppleScript can't tell, so this reads the one flag from Notes'
/// own database, which only apps with Full Disk Access may open.
///
/// It copies the database (with its -wal/-shm journal) to a private temporary folder, opens the
/// copy read-only, reads only note ids and the pinned flag, and deletes the copy at once.
/// Nothing else in the database is read. Not offered in the sandboxed App Store build.
enum ApplePins {
    enum Failure: Error, Equatable {
        /// Full Disk Access isn't granted.
        case noAccess
        /// The database isn't laid out the way we expect (a new macOS, for example).
        case schemaUnknown
        case unreadable
    }

    static var store: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite")
    }

    /// Sandboxed builds can't reach another app's container at all, so the option is hidden there.
    static var isAvailable: Bool { ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] == nil }

    /// Whether the database can be opened right now (i.e. Full Disk Access is granted).
    static func hasAccess(at url: URL = store) -> Bool {
        guard let h = try? FileHandle(forReadingFrom: url) else { return false }
        try? h.close()
        return true
    }

    /// System Settings → Privacy & Security → Full Disk Access.
    static let settingsURL = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!

    /// The AppleScript id `x-coredata://<store>/ICNote/p123` names the row whose Z_PK is 123.
    static func primaryKey(fromNoteID id: String) -> Int? {
        guard let range = id.range(of: "/ICNote/p", options: .backwards) else { return nil }
        return Int(id[range.upperBound...])
    }

    /// The primary keys of pinned notes.
    static func pinnedKeys(at url: URL = store) -> Result<Set<Int>, Failure> {
        guard hasAccess(at: url) else { return .failure(.noAccess) }
        let fm = FileManager.default
        let dir = fm.temporaryDirectory.appending(path: "amber-pins-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? fm.removeItem(at: dir) }
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let copy = dir.appending(path: "n.sqlite")
            try fm.copyItem(at: url, to: copy)
            // The journal holds recent changes (like a pin made a minute ago); copy it when present.
            for suffix in ["-wal", "-shm"] {
                let side = URL(fileURLWithPath: url.path + suffix)
                if fm.fileExists(atPath: side.path) { try? fm.copyItem(at: side, to: URL(fileURLWithPath: copy.path + suffix)) }
            }
            return read(copy)
        } catch {
            return .failure((error as NSError).code == NSFileReadNoPermissionError ? .noAccess : .unreadable)
        }
    }

    private static func read(_ copy: URL) -> Result<Set<Int>, Failure> {
        var db: OpaquePointer?
        guard sqlite3_open_v2(copy.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            sqlite3_close(db)
            return .failure(.unreadable)
        }
        defer { sqlite3_close(db) }
        // Check the layout before trusting it.
        let columns = strings(db, "select name from pragma_table_info('ZICCLOUDSYNCINGOBJECT')")
        let entities = strings(db, "select Z_NAME from Z_PRIMARYKEY where Z_NAME = 'ICNote'")
        guard columns.contains("Z_PK"), columns.contains("ZISPINNED"), columns.contains("Z_ENT"), entities == ["ICNote"] else {
            return .failure(.schemaUnknown)
        }
        let sql = """
        select Z_PK from ZICCLOUDSYNCINGOBJECT
        where ZISPINNED = 1 and Z_ENT = (select Z_ENT from Z_PRIMARYKEY where Z_NAME = 'ICNote')
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return .failure(.schemaUnknown) }
        defer { sqlite3_finalize(stmt) }
        var keys = Set<Int>()
        while sqlite3_step(stmt) == SQLITE_ROW { keys.insert(Int(sqlite3_column_int64(stmt, 0))) }
        return .success(keys)
    }

    private static func strings(_ db: OpaquePointer?, _ sql: String) -> [String] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(stmt) }
        var out: [String] = []
        while sqlite3_step(stmt) == SQLITE_ROW, let c = sqlite3_column_text(stmt, 0) { out.append(String(cString: c)) }
        return out
    }
}
#endif
