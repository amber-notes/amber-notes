import CryptoKit
import Foundation
import Security

/// Home-screen widgets for note pages (prototype), the half the app and the widget extension share.
///
/// WidgetKit can't run a page's HTML, so a page also declares a small widget made of fixed native
/// blocks (NoteWidget.Spec, in the app). The app works out what each block shows from the note and
/// writes only that, never the note itself, to the App Group, sealed with a key the two share
/// through a Keychain access group. The extension opens it and draws it with SwiftUI.
///
/// A widget button can't wait for the app: the extension shows the result at once (the app worked
/// out every button's outcome ahead) and leaves the edit in a queue; the app applies it to the note
/// as an edit with tint and Undo, then writes the widget again.
enum WidgetShared {
    static let appGroup = "group.dev.emilwagman.pane"
    /// The extension's kind, for WidgetCenter.reloadTimelines(ofKind:).
    static let kind = "NotePageWidget"
    /// Posted (Darwin) by the extension after a button press, so a running app applies it now.
    static let actionNotification = "dev.emilwagman.pane.widget-action"
    /// "Hide widget content on the Lock Screen", read by the extension through the App Group.
    static let hideOnLockKey = "widgetHideOnLock"

    static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    nonisolated(unsafe) static var rootOverride: URL?
    static var root: URL? {
        if let rootOverride { return rootOverride }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appending(path: "Widgets", directoryHint: .isDirectory)
    }
}

// MARK: What a widget shows

/// One size of one widget, worked out: plain values, nothing left to compute.
struct WidgetFace: Codable, Equatable, Sendable {
    var blocks: [WidgetBlock]
}

indirect enum WidgetBlock: Codable, Equatable, Sendable {
    case title(text: String, sub: String?)
    case text(String)
    case number(value: String, label: String?)
    /// A ring filled to `fraction` (0-1), with an optional figure inside and a label under it.
    case ring(fraction: Double, center: String?, label: String?)
    case bar(fraction: Double, label: String?)
    case list([ListItem])
    case chart(line: Bool, values: [Double], labels: [String])
    /// Rows of named days, as a habit grid: `done[row][day]`; `today` is the column to outline.
    case grid(days: [String], rows: [GridRow], today: Int?)
    case button(WidgetButton)
    case row([WidgetBlock])

    struct ListItem: Codable, Equatable, Sendable { var text: String; var done: Bool? }
    struct GridRow: Codable, Equatable, Sendable { var name: String; var done: [Bool] }
}

/// A button as drawn, with what pressing it does: the edit to queue and the state to show after.
struct WidgetButton: Codable, Equatable, Sendable {
    var label: String
    /// Shown as done (ticked, amber).
    var on: Bool
    var action: WidgetAction
    /// The snapshot state the widget shows once pressed.
    var next: String
}

/// The edits a widget button can queue. Each says the end state, not "toggle", so a press that
/// lands after the note changed elsewhere can't flip it the wrong way.
enum WidgetAction: Codable, Equatable, Sendable {
    /// Today's row in table `table`: set `column` to `value` (adds today's row if it's missing).
    case setToday(table: Int, column: String, value: String)
    /// The checklist item with this text: ticked or not.
    case setChecklist(text: String, checked: Bool)
}

/// Everything the extension needs for one note's widget.
struct WidgetSnapshot: Codable, Equatable, Sendable {
    struct Faces: Codable, Equatable, Sendable {
        var small: WidgetFace?
        var medium: WidgetFace?
        var large: WidgetFace?
        var circular: WidgetFace?
        var rectangular: WidgetFace?
    }

    /// One calendar day: the faces for every combination of button presses, keyed by state
    /// ("" is the note as it is).
    struct Day: Codable, Equatable, Sendable {
        var start: Date
        var states: [String: Faces]
    }

    var noteID: UUID
    var title: String
    var written: Date
    /// Today and tomorrow, so the widget turns over at midnight without the app.
    var days: [Day]
    /// The state pressed buttons have put the widget in, until the app writes it again.
    var pending: String = ""

    /// The faces to show at `date`.
    func faces(at date: Date) -> Faces? {
        let day = days.last { $0.start <= date } ?? days.first
        return day?.states[pending] ?? day?.states[""]
    }
}

/// A press the app hasn't applied yet.
struct WidgetPress: Codable, Equatable, Sendable {
    var id = UUID()
    var noteID: UUID
    var action: WidgetAction
    var at = Date()
}

// MARK: Sealed storage

/// The App Group files, sealed (AES-GCM) with a key that lives only in this device's Keychain, in
/// an access group the app and the widget extension share. The account's own key is never shared
/// with the extension: the widget key opens only what a widget shows.
enum WidgetVault {
    static var keychainGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "PaneWidgetKeychainGroup") as? String
    }

    private static let service = "dev.emilwagman.pane.widgets"
    private static let account = "widget-key"

    /// Tests use an in-memory key (unsigned test hosts have no Keychain group).
    nonisolated(unsafe) static var keyOverride: SymmetricKey?

    /// The key, made on first use by the app. The extension only reads it.
    static func key(create: Bool) -> SymmetricKey? {
        if let keyOverride { return keyOverride }
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
        ]
        if let g = keychainGroup { q[kSecAttrAccessGroup as String] = g }
        var out: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data, d.count == 32 {
            return SymmetricKey(data: d)
        }
        guard create else { return nil }
        let key = SymmetricKey(size: .bits256)
        var add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: key.withUnsafeBytes { Data($0) },
            // The widget draws after the first unlock, while the phone is locked again.
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable as String: false,
        ]
        if let g = keychainGroup { add[kSecAttrAccessGroup as String] = g }
        guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else { return nil }
        return key
    }

    static func seal<T: Encodable>(_ value: T, to file: URL, create: Bool) throws {
        guard let key = key(create: create) else { throw CocoaError(.fileWriteNoPermission) }
        let box = try AES.GCM.seal(try JSONEncoder().encode(value), using: key)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS)
        try box.combined!.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try box.combined!.write(to: file, options: .atomic)
        #endif
    }

    static func open<T: Decodable>(_ type: T.Type, from file: URL) -> T? {
        guard let key = key(create: false), let data = try? Data(contentsOf: file),
              let box = try? AES.GCM.SealedBox(combined: data), let plain = try? AES.GCM.open(box, using: key) else { return nil }
        return try? JSONDecoder().decode(type, from: plain)
    }

    // MARK: Files

    static func snapshotFile(_ id: UUID) -> URL? { WidgetShared.root?.appending(path: "\(id.uuidString).widget") }
    static var pressesDir: URL? { WidgetShared.root?.appending(path: "Presses", directoryHint: .isDirectory) }

    /// Every note that has a widget, for the widget's note picker.
    static func snapshots() -> [WidgetSnapshot] {
        guard let root = WidgetShared.root, let files = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return [] }
        return files.filter { $0.pathExtension == "widget" }.compactMap { open(WidgetSnapshot.self, from: $0) }.sorted { $0.title < $1.title }
    }

    static func snapshot(_ id: UUID) -> WidgetSnapshot? { snapshotFile(id).flatMap { open(WidgetSnapshot.self, from: $0) } }

    static func write(_ s: WidgetSnapshot, create: Bool) throws {
        guard let f = snapshotFile(s.noteID) else { throw CocoaError(.fileNoSuchFile) }
        try seal(s, to: f, create: create)
    }

    static func remove(_ id: UUID) { if let f = snapshotFile(id) { try? FileManager.default.removeItem(at: f) } }

    static func removeAll() { if let r = WidgetShared.root { try? FileManager.default.removeItem(at: r) } }

    /// A button press, from the extension: queued for the app, and the widget moves to the
    /// pressed state right away.
    static func press(note: UUID, action: WidgetAction, next: String) throws {
        guard let dir = pressesDir else { throw CocoaError(.fileNoSuchFile) }
        let p = WidgetPress(noteID: note, action: action)
        try seal(p, to: dir.appending(path: "\(Int(p.at.timeIntervalSince1970 * 1000))-\(p.id.uuidString).press"), create: false)
        if var s = snapshot(note) {
            s.pending = next
            try write(s, create: false)
        }
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(WidgetShared.actionNotification as CFString), nil, nil, true)
    }

    /// Presses waiting, oldest first, with their files (remove each once applied).
    static func presses() -> [(WidgetPress, URL)] {
        guard let dir = pressesDir, let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return [] }
        return files.filter { $0.pathExtension == "press" }.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { f in
            guard let p = open(WidgetPress.self, from: f) else { try? FileManager.default.removeItem(at: f); return nil }
            return (p, f)
        }
    }
}
