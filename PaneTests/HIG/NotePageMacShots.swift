#if os(macOS)
import AppKit
import SwiftData
import SwiftUI
import Testing
import WebKit
@testable import Pane

/// Note pages (prototype) on the Mac: the real app in off-screen windows at a narrow, a typical and a
/// wide size, one window resized live, and the list's app mark in both designs. Photographed by
/// `scripts/note-pages-mac.sh` with `screencapture -l` (web views don't draw into cacheDisplay).
/// Nothing appears on the display. Runs only when AMBER_PAGE_MAC is set.
@MainActor @Suite(.serialized) struct NotePageMacShots {
    static let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "demo/note-pages")

    static func library() throws -> ModelContainer {
        let c = try AppSnapshotTests.container()
        let ctx = c.mainContext
        let budget = ctx.createNote(in: .all, body: Capture.budgetNote)
        budget.updatedAt = .now.addingTimeInterval(-90)
        let habits = ctx.createNote(in: .all, body: Capture.habitNote())
        habits.isPinned = true
        try ctx.save()
        NotePageStore.shared[habits.id] = .init(html: try String(contentsOf: demo.appending(path: "habit-tracker.html"), encoding: .utf8), by: "Claude", at: .now)
        NotePageStore.shared[budget.id] = .init(html: try String(contentsOf: demo.appending(path: "budget.html"), encoding: .utf8), by: "Claude", at: .now)
        let stack = ctx.createNote(in: .all, body: try String(contentsOf: demo.appending(path: "reading-stack.md"), encoding: .utf8))
        stack.updatedAt = .now.addingTimeInterval(-3600)
        try ctx.save()
        NotePageStore.shared[stack.id] = .init(html: try String(contentsOf: demo.appending(path: "reading-stack.html"), encoding: .utf8), by: "Claude", at: .now)
        return c
    }

    static func open(_ title: String, size: CGSize, dark: Bool, list: CGFloat = 520, sidebar: CGFloat = 220) async throws -> (NSWindow, ModelContainer) {
        let c = try library()
        let w = await AppSnapshotTests.withLastNote(c, title) {
            let w = MacStoreShots.window(RootView().modelContainer(c).environment(SetupStore()), size: size, dark: dark)
            try? await Task.sleep(for: .seconds(1))
            if let split = AIEditSnapshots.splitView(in: w.contentView) {
                split.setPosition(sidebar, ofDividerAt: 0)
                split.setPosition(list, ofDividerAt: 1)
            }
            return w
        }
        try? await Task.sleep(for: .seconds(2.5))
        return (w, c)
    }

    @Test func frames() async throws {
        guard let dir = ProcessInfo.processInfo.environment["AMBER_PAGE_MAC"].map({ URL(fileURLWithPath: $0) }) else { return }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let scenes = ProcessInfo.processInfo.environment["AMBER_PAGE_SCENES"].map { Set($0.split(separator: ",").map(String.init)) }
        func want(_ scene: String) -> Bool { scenes?.contains(scene) ?? true }
        try await toolbar(dir, want("toolbar"))
        try await libraries(dir, want("lib"))
        try await marks(dir, want("mark"))
        guard want("pages") else { return }
        let sizes: [(String, CGSize)] = [("narrow", CGSize(width: 1000, height: 760)), ("typical", CGSize(width: 1440, height: 900)), ("wide", CGSize(width: 1920, height: 1160))]
        for dark in [false, true] {
            for (name, size) in sizes where !(dark && name == "narrow") {
                let (w, _) = try await Self.open("Habit tracker", size: size, dark: dark)
                defer { w.orderOut(nil); w.close() }
                try await MacStoreShots.shoot(dir, "habit-\(name)-\(dark ? "dark" : "light")", [("main", w)])
            }
        }
        // One window, resized while the page is open: it lays out again without reloading.
        do {
            let (w, _) = try await Self.open("Habit tracker", size: CGSize(width: 1440, height: 900), dark: false)
            defer { w.orderOut(nil); w.close() }
            try await MacStoreShots.shoot(dir, "resize-1-before", [("main", w)])
            w.setContentSize(CGSize(width: 1080, height: 900))
            try? await Task.sleep(for: .seconds(1))
            try await MacStoreShots.shoot(dir, "resize-2-narrower", [("main", w)])
            w.setContentSize(CGSize(width: 1920, height: 900))
            try? await Task.sleep(for: .seconds(1))
            try await MacStoreShots.shoot(dir, "resize-3-wider", [("main", w)])
        }
        for (name, size) in sizes.dropFirst() {
            let (w, _) = try await Self.open("October budget", size: size, dark: false)
            defer { w.orderOut(nil); w.close() }
            try await MacStoreShots.shoot(dir, "budget-\(name)-light", [("main", w)])
        }
    }

    /// The note's toolbar on its App and Text sides, at three widths, with the sidebar open and closed:
    /// the same items in the same places on both sides.
    func toolbar(_ dir: URL, _ on: Bool) async throws {
        guard on else { return }
        defer { NoteDetailView.startMode = .page }
        for (name, width) in [("narrow", 1000.0), ("typical", 1440.0), ("wide", 1920.0)] {
            for (side, sidebar) in [("sidebar", 220.0), ("nosidebar", 0.0)] {
                for mode in [NoteDetailView.NoteMode.page, .text] {
                    NoteDetailView.startMode = mode
                    let (w, _) = try await Self.open("Habit tracker", size: CGSize(width: width, height: 760), dark: false, sidebar: sidebar)
                    defer { w.orderOut(nil); w.close() }
                    try await MacStoreShots.shoot(dir, "toolbar-\(name)-\(side)-\(mode == .page ? "app" : "text")", [("main", w)])
                }
            }
        }
    }

    /// Bundled libraries in the real app on the Mac: the three.js reading stack.
    func libraries(_ dir: URL, _ on: Bool) async throws {
        guard on else { return }
        let (w, _) = try await Self.open("Reading stack", size: CGSize(width: 1440, height: 900), dark: false)
        defer { w.orderOut(nil); w.close() }
        try? await Task.sleep(for: .seconds(1.5))
        let three = try? await BestWeb.find(in: w.contentView)?.evaluateJavaScript("typeof THREE")
        try "THREE is \(three as? String ?? "unknown")".write(to: dir.appending(path: "lib-three.txt"), atomically: true, encoding: .utf8)
        try await MacStoreShots.shoot(dir, "lib-stack-light", [("main", w)])
    }

    /// The list's app mark, every candidate, on the Lisbon note so the list shows the app notes.
    func marks(_ dir: URL, _ on: Bool) async throws {
        guard on else { return }
        let only = ProcessInfo.processInfo.environment["AMBER_MARKS"].map { Set($0.split(separator: ",").map(String.init)) }
        for style in NoteAppMark.Style.allCases where only?.contains(style.rawValue) ?? true {
            NoteAppMark.style = style
            defer { NoteAppMark.style = .capsule }
            for dark in [false, true] {
                let (w, _) = try await Self.open("Lisbon", size: CGSize(width: 1280, height: 800), dark: dark, list: 560)
                defer { w.orderOut(nil); w.close() }
                try await MacStoreShots.shoot(dir, "mark-\(style.rawValue)-\(dark ? "dark" : "light")", [("main", w)])
            }
        }
    }
}

/// The first web view in a window.
enum BestWeb {
    static func find(in view: NSView?) -> WKWebView? {
        guard let view else { return nil }
        if let w = view as? WKWebView { return w }
        for v in view.subviews { if let w = find(in: v) { return w } }
        return nil
    }
}
#endif