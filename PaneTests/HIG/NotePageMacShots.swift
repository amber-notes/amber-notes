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
        let training = ctx.createNote(in: .all, body: try String(contentsOf: demo.appending(path: "training.md"), encoding: .utf8))
        training.updatedAt = .now.addingTimeInterval(-7200)
        NotePageStore.shared[training.id] = .init(html: try String(contentsOf: demo.appending(path: "training-react.json"), encoding: .utf8), by: "Claude", at: .now)
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
        try await training(dir, want("training"))
        try await firstOpen(dir, want("firstopen"))
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

    /// Preact on the Mac: Training with its sidebar, light and dark, and narrow (tab bar).
    func training(_ dir: URL, _ on: Bool) async throws {
        guard on else { return }
        for (name, width, dark) in [("wide-light", 1440.0, false), ("wide-dark", 1440.0, true), ("narrow-light", 1000.0, false)] {
            let (w, _) = try await Self.open("Training", size: CGSize(width: width, height: 860), dark: dark)
            defer { w.orderOut(nil); w.close() }
            try? await Task.sleep(for: .seconds(1))
            try await MacStoreShots.shoot(dir, "training-\(name)", [("main", w)])
        }
    }

    /// The first-open moment on the Mac, the three designs, for the Evening tracker app template.
    func firstOpen(_ dir: URL, _ on: Bool) async throws {
        guard on else { return }
        let onboarding = Self.demo.deletingLastPathComponent().appending(path: "onboarding/apps")
        let project = try String(contentsOf: onboarding.appending(path: "evening-tracker.json"), encoding: .utf8)
        let preview = try? Data(contentsOf: onboarding.appending(path: "evening-tracker.jpg"))
        let json = #"{"slug":"evening-tracker","title":"Evening tracker","note":"Evening tracker\n\nA two-minute check-in at the end of the day.\n","description":"A small app for your evenings: how the day went, sleep and mood, with your week and trends. Your AI can change it.","ask":"Add a sleep column to my Evening tracker."}"#
        let template = try JSONDecoder().decode(NoteTemplate.self, from: Data(json.utf8))
        defer { FirstOpen.variant = .a }
        let meals = #"{"slug":"meal-plan","title":"Meal plan and groceries","note":"Meal plan and groceries\n\nThis week's dinners and the shopping list that goes with them.\n","description":"A weekly meal plan with the grocery list that goes with it. Your AI plans the dinners and writes the list in Pinto Notes.","ask":"Plan dinners for this week. We're out on Friday, and no mushrooms."}"#
        let mealTemplate = try JSONDecoder().decode(NoteTemplate.self, from: Data(meals.utf8))
        let runs: [(FirstOpen.Variant, Bool, Bool)] = [(.a, false, false), (.b, false, false), (.c, false, false), (.a, true, false),
                                                       (.ac, false, false), (.ac, true, false), (.ac, false, true), (.ac, true, true)]
        for (variant, dark, isNote) in runs {
            FirstOpen.variant = variant
            let c = try Self.library()
            // (The demo library has a text note called "Evening tracker" already.)
            let title = isNote ? "Weekly dinners" : "Evening check-in"
            let note = c.mainContext.createNote(in: .all, body: isNote
                ? "\(title)\n\nThis week's dinners and the shopping list that goes with them.\n\n- Monday: lentil soup\n- Tuesday: tacos\n"
                : "\(title)\n\nA two-minute check-in at the end of the day.\n")
            try c.mainContext.save()
            var draft = NoteDraft(template: isNote ? mealTemplate : template,
                                  link: NoteSourceLink(kind: .template, slug: isNote ? "meal-plan" : "evening-tracker"))
            if !isNote {
                NotePageStore.shared[note.id] = .init(html: project, by: FirstOpen.templateWriter, at: .now)
                draft.appProject = project
                draft.preview = preview
            }
            FirstOpen.shared.reset()
            FirstOpen.shared.added(note: note.id, draft: draft)
            let w = await AppSnapshotTests.withLastNote(c, title) {
                let w = MacStoreShots.window(RootView().modelContainer(c).environment(SetupStore()), size: CGSize(width: 1280, height: 820), dark: dark)
                try? await Task.sleep(for: .seconds(1))
                if let split = AIEditSnapshots.splitView(in: w.contentView) {
                    split.setPosition(0, ofDividerAt: 0)
                    split.setPosition(300, ofDividerAt: 1)
                }
                return w
            }
            defer { w.orderOut(nil); w.close(); FirstOpen.shared.reset() }
            try? await Task.sleep(for: .seconds(2))
            // (The capture window follows its content's height; the app's own window doesn't.)
            w.setContentSize(CGSize(width: 1280, height: 820))
            try? await Task.sleep(for: .seconds(1))
            var windows = [("main", w)]
            if let sheet = w.attachedSheet { windows.append(("sheet", sheet)) }
            try await MacStoreShots.shoot(dir, "firstopen-\(variant.rawValue)\(isNote ? "-note" : "")-\(dark ? "dark" : "light")", windows)
        }
    }

    /// The list's app mark, every candidate, on the Lisbon note so the list shows the app notes.
    func marks(_ dir: URL, _ on: Bool) async throws {
        guard on else { return }
        let only = ProcessInfo.processInfo.environment["AMBER_MARKS"].map { Set($0.split(separator: ",").map(String.init)) }
        for style in NoteAppMark.Style.allCases where only?.contains(style.rawValue) ?? true {
            NoteAppMark.style = style
            defer { NoteAppMark.style = .soft }
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