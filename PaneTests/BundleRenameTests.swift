#if os(macOS)
import Foundation
import Testing
@testable import Pane

/// The Mac download renames its own bundle from "Amber Notes.app" to "Pinto Notes.app" after an update.
@Suite struct BundleRenameTests {
    static func destination(_ path: String, existing: Set<String> = []) -> String? {
        BundleRename.destination(for: URL(fileURLWithPath: path, isDirectory: true)) { existing.contains($0.path) }?.path
    }

    @Test func anUpdatedAmberNotesMovesToPintoNotesBesideIt() {
        #expect(Self.destination("/Applications/Amber Notes.app") == "/Applications/Pinto Notes.app")
        #expect(Self.destination("/Users/sara/Applications/Amber Notes.app") == "/Users/sara/Applications/Pinto Notes.app")
    }

    @Test func otherNamesAreLeftAlone() {
        #expect(Self.destination("/Applications/Pinto Notes.app") == nil)
        #expect(Self.destination("/Applications/Amber Notes Beta.app") == nil)
        #expect(Self.destination("/Applications/Amber Notes 2.app") == nil, "a copy the person named themselves")
        #expect(Self.destination("/Users/sara/build/Pane.app") == nil)
    }

    @Test func itNeverReplacesAnAppAlreadyThere() {
        #expect(Self.destination("/Applications/Amber Notes.app", existing: ["/Applications/Pinto Notes.app"]) == nil)
    }

    @Test func itStaysPutWhereItCannotBeMoved() {
        #expect(Self.destination("/Volumes/Amber Notes/Amber Notes.app") == nil, "run from the disk image")
        #expect(Self.destination("/private/var/folders/b8/x/T/AppTranslocation/6F1C/d/Amber Notes.app") == nil, "run by Gatekeeper from a random place")
    }

    /// /Applications that this person can't write to: no move, no prompt, no second launch; the app runs as it is.
    @Test func aFolderThatCannotBeWrittenLeavesTheAppAsItIs() throws {
        let files = FileManager.default
        let dir = files.temporaryDirectory.appendingPathComponent("bundle-rename-\(UUID().uuidString)", isDirectory: true)
        let old = dir.appendingPathComponent(BundleRename.oldName, isDirectory: true)
        try files.createDirectory(at: old.appendingPathComponent("Contents"), withIntermediateDirectories: true)
        try files.setAttributes([.posixPermissions: 0o555], ofItemAtPath: dir.path)
        defer {
            try? files.setAttributes([.posixPermissions: 0o755], ofItemAtPath: dir.path)
            try? files.removeItem(at: dir)
        }
        // Returns (it would end the process had it moved and reopened).
        BundleRename.moveAndReopenIfNeeded(bundle: old, files: files)
        #expect(try files.contentsOfDirectory(atPath: dir.path) == [BundleRename.oldName])
    }

    @Test func aRealBundleMovesAndNothingElseDoes() throws {
        let files = FileManager.default
        let dir = files.temporaryDirectory.appendingPathComponent("bundle-rename-\(UUID().uuidString)", isDirectory: true)
        defer { try? files.removeItem(at: dir) }
        let old = dir.appendingPathComponent(BundleRename.oldName, isDirectory: true)
        try files.createDirectory(at: old.appendingPathComponent("Contents"), withIntermediateDirectories: true)
        try Data("x".utf8).write(to: old.appendingPathComponent("Contents/Info.plist"))
        let to = try #require(BundleRename.destination(for: old) { files.fileExists(atPath: $0.path) })
        try files.moveItem(at: old, to: to)
        #expect(try files.contentsOfDirectory(atPath: dir.path) == [BundleRename.newName])
        #expect(files.fileExists(atPath: to.appendingPathComponent("Contents/Info.plist").path))
        // Once it is Pinto Notes.app there is nothing more to do.
        #expect(BundleRename.destination(for: to) { files.fileExists(atPath: $0.path) } == nil)
    }

    /// The Dock icon and a Login Items entry hold the old path: it keeps opening the app, unseen in Finder.
    @Test func theOldPathStaysAsAHiddenLinkToTheNewName() throws {
        let files = FileManager.default
        let dir = files.temporaryDirectory.appendingPathComponent("bundle-rename-\(UUID().uuidString)", isDirectory: true)
        defer { try? files.removeItem(at: dir) }
        let old = dir.appendingPathComponent(BundleRename.oldName, isDirectory: true)
        let new = dir.appendingPathComponent(BundleRename.newName, isDirectory: true)
        try files.createDirectory(at: new.appendingPathComponent("Contents"), withIntermediateDirectories: true)
        try Data("x".utf8).write(to: new.appendingPathComponent("Contents/Info.plist"))
        BundleRename.leaveLink(at: old, files: files)
        // Relative, so the pair can be moved to another folder together.
        #expect(try files.destinationOfSymbolicLink(atPath: old.path) == BundleRename.newName)
        #expect(files.fileExists(atPath: old.appendingPathComponent("Contents/Info.plist").path), "the old path opens the new bundle")
        #expect(try old.resourceValues(forKeys: [.isHiddenKey, .isSymbolicLinkKey]).isHidden == true)
        #expect(try new.resourceValues(forKeys: [.isHiddenKey]).isHidden == false, "only the link is hidden")
        // Opened through the link, the app is still called Amber Notes.app by path: it must not try to move again.
        #expect(BundleRename.destination(for: old) { files.fileExists(atPath: $0.path) } == nil)
        // Removing the link leaves the app.
        try files.removeItem(at: old)
        #expect(try files.contentsOfDirectory(atPath: dir.path) == [BundleRename.newName])
    }
}
#endif
