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
}
#endif
