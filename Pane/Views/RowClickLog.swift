#if os(macOS)
import AppKit
import OSLog

/// Dev: what a click in the note list did, to find why a click on a file row sometimes selects
/// nothing (CI's synthesized clicks never reproduce it). Only in Amber Notes Beta and development
/// builds; the App Store app logs nothing. Read it with
///
///     log show --last 10m --info --predicate 'subsystem == "dev.emilwagman.pane" AND category == "rowclick"'
///
/// Ids are cut to 8 characters and no file or note names are logged.
enum RowClickLog {
    private static let log = Logger(subsystem: "dev.emilwagman.pane", category: "rowclick")

    static let enabled: Bool = {
        #if DEBUG || QA
        return true
        #else
        return Bundle.main.bundleIdentifier?.hasSuffix(".beta") == true
        #endif
    }()

    @MainActor private static var monitor: Any?
    @MainActor private static var downAt: Int?
    @MainActor private static var dragged = false

    /// Starts watching mouse-down and mouse-up in the list's window, once.
    @MainActor static func start() {
        guard enabled, monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) { event in
            MainActor.assumeIsolated { note(event) }
            return event
        }
        log.notice("rowclick logging on")
    }

    @MainActor private static func note(_ event: NSEvent) {
        guard let window = event.window, let content = window.contentView else { return }
        let hit = content.hitTest(content.convert(event.locationInWindow, from: nil))
        guard let table = enclosingTable(hit) else { return }
        let row = table.row(at: table.convert(event.locationInWindow, from: nil))
        let selected = Array(table.selectedRowIndexes).map(String.init).joined(separator: ",")
        switch event.type {
        case .leftMouseDown:
            downAt = row
            dragged = false
            log.notice("down row \(row, privacy: .public) clicks \(event.clickCount, privacy: .public) mods \(event.modifierFlags.rawValue & 0xFFFF0000, privacy: .public) key \(window.isKeyWindow, privacy: .public) firstResponder \(String(describing: type(of: window.firstResponder as Any)), privacy: .public) hit \(chain(hit), privacy: .public) selected [\(selected, privacy: .public)]")
        case .leftMouseDragged:
            guard !dragged else { return }
            dragged = true
            log.notice("dragged from row \(downAt ?? -2, privacy: .public)")
        case .leftMouseUp:
            log.notice("up row \(row, privacy: .public) (down \(downAt ?? -2, privacy: .public), dragged \(dragged, privacy: .public)) selected [\(selected, privacy: .public)]")
            // What the table settled on once the click is handled.
            Task { @MainActor in
                let after = Array(table.selectedRowIndexes).map(String.init).joined(separator: ",")
                log.notice("after up selected [\(after, privacy: .public)]")
            }
        default: break
        }
    }

    /// The list's selection changed (by click, keys or code).
    static func selection(_ old: Set<UUID>, _ new: Set<UUID>) {
        guard enabled else { return }
        log.notice("selection \(short(old), privacy: .public) -> \(short(new), privacy: .public)")
    }

    /// A file row's drag began (the List asked it for its item).
    static func dragStarted(_ id: UUID) {
        guard enabled else { return }
        log.notice("drag provider asked for file \(String(id.uuidString.prefix(8)), privacy: .public)")
    }

    private static func short(_ ids: Set<UUID>) -> String {
        "[" + ids.map { String($0.uuidString.prefix(8)) }.sorted().joined(separator: ",") + "]"
    }

    private static func enclosingTable(_ view: NSView?) -> NSTableView? {
        var v = view
        while let x = v {
            if let t = x as? NSTableView { return t }
            v = x.superview
        }
        return nil
    }

    /// The hit view and its first few ancestors, by class.
    private static func chain(_ view: NSView?) -> String {
        var names: [String] = []
        var v = view
        while let x = v, names.count < 5 {
            names.append(String(describing: type(of: x)))
            v = x.superview
        }
        return names.joined(separator: " < ")
    }
}
#endif
