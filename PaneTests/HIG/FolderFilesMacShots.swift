#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
@testable import Pane

/// Files kept in a folder, on the Mac: the real RootView on the demo library with a "To read"
/// folder, in an off-screen window that a shell photographs with `screencapture -l` (so the glass
/// renders; the test host may not capture the screen itself). For each shot the test writes
/// `ready-<name>` (`main <window number>`) and waits for `shot-<name>`, like MacStoreShots.
/// Nothing appears on the display. Runs only when AMBER_FILES_SHOTS is set.
@MainActor @Suite(.serialized) struct FolderFilesMacShots {
    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_FILES_SHOTS"].map { URL(fileURLWithPath: $0) } }

    static func library() throws -> ModelContainer {
        let c = try AppSnapshotTests.container()
        DemoData.loadFolderFiles(into: c.mainContext)
        try c.mainContext.save()
        return c
    }

    /// Opens `item` (a note title or a file name) in its folder, then photographs the window.
    func shoot(_ name: String, item: String, dark: Bool) async throws {
        guard let dir = Self.dir else { return }
        let c = try Self.library()
        let ctx = c.mainContext
        let file = ctx.folderFiles().first { $0.filename == item }
        let note = ((try? ctx.fetch(FetchDescriptor<Note>())) ?? []).first { $0.title == item }
        let id = file?.id ?? note?.id
        let folder = file?.folderID ?? note?.folder?.id
        let d = UserDefaults.standard
        let keep = (d.object(forKey: "lastNote"), d.object(forKey: "lastScope"))
        defer {
            if let v = keep.0 { d.set(v, forKey: "lastNote") } else { d.removeObject(forKey: "lastNote") }
            if let v = keep.1 { d.set(v, forKey: "lastScope") } else { d.removeObject(forKey: "lastScope") }
        }
        if let folder { d.set(try JSONEncoder().encode(Scope.folder(folder)), forKey: "lastScope") }
        if let id { d.set(id.uuidString, forKey: "lastNote") }
        let w = MacStoreShots.root(c, dark: dark)
        defer { w.orderOut(nil); w.close() }
        MacStoreShots.columns(w)
        try? await Task.sleep(for: .seconds(0.6))
        try? await Task.sleep(for: .seconds(3))
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try await MacStoreShots.shoot(dir, "\(name)-\(dark ? "dark" : "light")", [("main", w)])
    }

    @Test(arguments: [false, true]) func pdfOpenInItsFolder(dark: Bool) async throws {
        try await shoot("mac-file-open", item: "Attention is all you need.pdf", dark: dark)
    }

    @Test(arguments: [false, true]) func folderListWithANote(dark: Bool) async throws {
        try await shoot("mac-folder-list", item: "Reading plan", dark: dark)
    }
}
#endif
