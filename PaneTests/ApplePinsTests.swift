#if os(macOS)
import Foundation
import SQLite3
import Testing
@testable import Pane

/// Reading which Apple Notes are pinned, against synthetic databases only.
@Suite struct ApplePinsTests {
    /// A tiny stand-in for NoteStore.sqlite: notes 12 and 40 pinned, 13 not, 99 is a folder.
    private func fixture(pinnedColumn: Bool = true) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appending(path: "pins-fixture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appending(path: "NoteStore.sqlite")
        var db: OpaquePointer?
        #expect(sqlite3_open(url.path, &db) == SQLITE_OK)
        defer { sqlite3_close(db) }
        let pin = pinnedColumn ? ", ZISPINNED INTEGER" : ""
        let rows = pinnedColumn
            ? "(12, 9, 1), (13, 9, 0), (40, 9, 1), (99, 14, 1)"
            : "(12, 9), (13, 9), (40, 9), (99, 14)"
        let cols = pinnedColumn ? "(Z_PK, Z_ENT, ZISPINNED)" : "(Z_PK, Z_ENT)"
        let sql = """
        create table Z_PRIMARYKEY (Z_ENT INTEGER, Z_NAME TEXT);
        insert into Z_PRIMARYKEY values (9, 'ICNote'), (14, 'ICFolder');
        create table ZICCLOUDSYNCINGOBJECT (Z_PK INTEGER PRIMARY KEY, Z_ENT INTEGER\(pin), ZTITLE1 TEXT);
        insert into ZICCLOUDSYNCINGOBJECT \(cols) values \(rows);
        """
        #expect(sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK)
        return url
    }

    @Test func readsOnlyPinnedNotes() throws {
        let url = try fixture()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        #expect(try ApplePins.pinnedKeys(at: url).get() == [12, 40], "a pinned folder isn't a pinned note")
    }

    @Test func mapsAppleScriptIDsToRows() {
        #expect(ApplePins.primaryKey(fromNoteID: "x-coredata://6F1A2B3C-0000-4000-8000-ABCDEF012345/ICNote/p12") == 12)
        #expect(ApplePins.primaryKey(fromNoteID: "x-coredata://6F1A2B3C/ICFolder/p3") == nil)
        #expect(ApplePins.primaryKey(fromNoteID: "garbage") == nil)
    }

    @Test func unknownLayoutIsReportedNotGuessed() throws {
        let url = try fixture(pinnedColumn: false)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        #expect(ApplePins.pinnedKeys(at: url) == .failure(.schemaUnknown))
    }

    @Test func noAccessWhenTheDatabaseCantBeOpened() throws {
        let url = try fixture()
        let dir = url.deletingLastPathComponent()
        defer {
            try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: url.path)
            try? FileManager.default.removeItem(at: dir)
        }
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: url.path)
        #expect(!ApplePins.hasAccess(at: url))
        #expect(ApplePins.pinnedKeys(at: url) == .failure(.noAccess))
    }

    @Test func theCopyIsDeletedAfterReading() throws {
        let url = try fixture()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let before = try FileManager.default.contentsOfDirectory(atPath: FileManager.default.temporaryDirectory.path).filter { $0.hasPrefix("amber-pins-") }
        _ = ApplePins.pinnedKeys(at: url)
        let after = try FileManager.default.contentsOfDirectory(atPath: FileManager.default.temporaryDirectory.path).filter { $0.hasPrefix("amber-pins-") }
        #expect(after.count == before.count)
    }
}
#endif
