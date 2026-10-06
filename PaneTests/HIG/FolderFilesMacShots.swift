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
    /// The Settings section on its own, over the usage set above (no account needed).
    struct StorageSectionPreview: View {
        var body: some View { StorageSectionBody(usage: StorageStore.shared.usage) }
    }

    static var dir: URL? { ProcessInfo.processInfo.environment["AMBER_FILES_SHOTS"].map { URL(fileURLWithPath: $0) } }

    static func library(kinds: URL? = nil) throws -> ModelContainer {
        let c = try AppSnapshotTests.container()
        DemoData.loadFolderFiles(into: c.mainContext)
        if let kinds { DemoData.loadKinds(from: kinds, into: c.mainContext) }
        try c.mainContext.save()
        return c
    }

    /// Opens `item` (a note title or a file name) in its folder, then photographs the window.
    func shoot(_ name: String, item: String, dark: Bool, kinds: URL? = nil, keepUsage: Bool = false) async throws {
        guard let dir = Self.dir else { return }
        if !keepUsage { StorageStore.shared.usage = nil }
        let c = try Self.library(kinds: kinds)
        let ctx = c.mainContext
        let file = ctx.folderFiles().first { $0.filename == item && (kinds == nil || ctx.folder($0.folderID!)?.name == "All kinds") }
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
        try await shoot("mac-file-open", item: "Fluent Python.pdf", dark: dark)
    }

    @Test(arguments: [false, true]) func folderListWithANote(dark: Bool) async throws {
        try await shoot("mac-folder-list", item: "TODO", dark: dark)
    }

    /// Every kind the app takes, opened one by one (AMBER_TYPES_DIR: a folder of samples).
    @Test func everyKindOpens() async throws {
        guard let types = ProcessInfo.processInfo.environment["AMBER_TYPES_DIR"], Self.dir != nil else { return }
        let names = ((try? FileManager.default.contentsOfDirectory(atPath: types)) ?? []).sorted()
        for name in names {
            try await shoot("kind-\(name.replacingOccurrences(of: " ", with: "-"))", item: name, dark: false, kinds: URL(fileURLWithPath: types))
        }
    }

    /// Settings' storage numbers, and the list's warning near the limit.
    @Test(arguments: [false, true]) func storage(dark: Bool) async throws {
        guard let dir = Self.dir else { return }
        let gb: Int64 = 1_073_741_824
        StorageStore.shared.usage = StorageUsage(used: Int64(1.86 * Double(gb)), limit: 2 * gb, notes: 41_000_000, files: Int64(1.52 * Double(gb)), apps: 12_000_000, deleted: 230_000_000, versions: 64_000_000)
        defer { StorageStore.shared.usage = nil }
        let w = MacStoreShots.panel(Form { StorageSectionPreview() }.formStyle(.grouped), size: CGSize(width: 520, height: 420), dark: dark)
        defer { w.orderOut(nil); w.close() }
        try? await Task.sleep(for: .seconds(0.8))
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try await MacStoreShots.shoot(dir, "mac-storage-settings-\(dark ? "dark" : "light")", [("main", w)])
        try await shoot("mac-storage-warning", item: "TODO", dark: dark, keepUsage: true)
    }
}
#endif
