#if os(macOS)
import AppKit
import SwiftData
import SwiftUI

/// One note in Apple Notes, as listed for the import picker.
struct AppleNote: Identifiable, Hashable {
    let id: String
    let name: String
    let folder: String
    let modified: Date
}

/// Reads Apple Notes through AppleScript. macOS asks once for permission.
enum AppleNotesBridge {
    enum Failure: LocalizedError {
        case script(String)
        var errorDescription: String? {
            switch self { case .script(let m): m }
        }
    }

    private static func run(_ source: String) throws -> NSAppleEventDescriptor {
        var error: NSDictionary?
        guard let script = NSAppleScript(source: source) else { throw Failure.script("Couldn't prepare the script.") }
        let result = script.executeAndReturnError(&error)
        if let error {
            let code = error[NSAppleScript.errorNumber] as? Int
            if code == -1743 {
                throw Failure.script("Amber Notes isn't allowed to read Apple Notes. Turn it on in System Settings → Privacy & Security → Automation.")
            }
            throw Failure.script(error[NSAppleScript.errorMessage] as? String ?? "Apple Notes didn't answer.")
        }
        return result
    }

    static func list() throws -> [AppleNote] {
        let d = try run("""
        tell application "Notes"
            set out to {}
            repeat with f in folders
                set fname to name of f
                if fname is not "Recently Deleted" then
                    repeat with n in notes of f
                        set end of out to {id of n, name of n, fname, modification date of n}
                    end repeat
                end if
            end repeat
            return out
        end tell
        """)
        var notes: [AppleNote] = []
        guard d.numberOfItems > 0 else { return [] }
        for i in 1...d.numberOfItems {
            guard let item = d.atIndex(i), item.numberOfItems >= 4 else { continue }
            notes.append(AppleNote(
                id: item.atIndex(1)?.stringValue ?? "",
                name: item.atIndex(2)?.stringValue ?? "Untitled",
                folder: item.atIndex(3)?.stringValue ?? "",
                modified: item.atIndex(4)?.dateValue ?? .now))
        }
        var seen = Set<String>()
        return notes.filter { seen.insert($0.id).inserted }.sorted { $0.modified > $1.modified }
    }

    /// `-uitest -demo`: website and store captures show this library instead of the person's own.
    static var isDemo: Bool {
        let args = ProcessInfo.processInfo.arguments
        return args.contains("-uitest") && args.contains("-demo")
    }

    static var demoNotes: [AppleNote] {
        let day: TimeInterval = 86_400
        let rows: [(String, String, Double)] = [
            ("Pasta night for eight", "Recipes", 0.1), ("Grandma's cardamom buns", "Recipes", 2), ("Weeknight curry", "Recipes", 5),
            ("Porto in October", "Travel", 0.3), ("Packing list", "Travel", 9), ("Copenhagen tips from Jonas", "Travel", 21),
            ("Kitchen measurements", "Home", 1), ("Paint colours", "Home", 12), ("Plants and when to water them", "Home", 30),
            ("Books to read", "Notes", 3), ("Gift ideas", "Notes", 6), ("Wi-Fi at the cabin", "Notes", 40),
            ("Old apartment", "Archive", 200),
        ]
        return rows.enumerated().map { i, r in AppleNote(id: "demo-\(i)", name: r.0, folder: r.1, modified: Date.now.addingTimeInterval(-r.2 * day)) }
    }

    static func body(of id: String) throws -> String {
        let escaped = id.replacingOccurrences(of: "\"", with: "\\\"")
        return try run("tell application \"Notes\" to get body of note id \"\(escaped)\"").stringValue ?? ""
    }
}

/// Pick Apple Notes to copy in. Nothing in Apple Notes is changed.
struct AppleNotesImportView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    /// Called with the new notes' ids once the import is done.
    var onImported: ([UUID]) -> Void = { _ in }

    @State private var notes: [AppleNote] = []
    @State private var picked: Set<String> = []
    @State private var query = ""
    @State private var keepFolders = true
    @State private var loading = true
    @State private var failure: String?
    @State private var progress: (done: Int, total: Int)?
    @State private var existingTitles: Set<String> = []
    /// Opt-in: also bring over which notes are pinned (needs Full Disk Access).
    @State private var bringPins = false
    @State private var pinAccess = false
    /// Said after the import when pins couldn't be read; the sheet waits for Done.
    @State private var notice: String?
    @FocusState private var searchFocused: Bool

    private var shown: [AppleNote] {
        query.isEmpty ? notes : notes.filter { $0.name.localizedStandardContains(query) || $0.folder.localizedStandardContains(query) }
    }

    private var groups: [(String, [AppleNote])] {
        var order: [String] = []
        var map: [String: [AppleNote]] = [:]
        for n in shown {
            if map[n.folder] == nil { order.append(n.folder) }
            map[n.folder, default: []].append(n)
        }
        return order.map { ($0, map[$0]!) }
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Import from Apple Notes").font(.system(size: 17, weight: .bold))
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Search Notes", text: $query)
                        .textFieldStyle(.plain)
                        .focusEffectDisabled()
                        .focused($searchFocused)
                }
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(.fill.tertiary, in: .rect(cornerRadius: 8))
                // The field draws its own focus ring, so keyboard users always see where they are.
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor.opacity(searchFocused ? 0.8 : 0), lineWidth: 2.5).padding(-1.5))
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()
            if let notice {
                noticeBar(notice)
            } else {
                footer
            }
        }
        .frame(width: 540, height: 640)
        .task { await load() }
        // Coming back from System Settings: look again.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            pinAccess = ApplePins.hasAccess()
        }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            ProgressView("Reading Apple Notes…").controlSize(.small)
        } else if let failure {
            ContentUnavailableView {
                Label("Can't read Apple Notes", systemImage: "exclamationmark.triangle")
            } description: { Text(failure) } actions: {
                Button("Try Again") { Task { await load() } }
            }
        } else if shown.isEmpty {
            ContentUnavailableView.search(text: query)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    ForEach(groups, id: \.0) { folder, items in
                        Section {
                            ForEach(items) { note in row(note) }
                        } header: {
                            HStack {
                                Text(folder.isEmpty ? "Notes" : folder).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                                Spacer()
                                Button(items.allSatisfy { picked.contains($0.id) } ? "Deselect All" : "Select All") {
                                    let ids = items.map(\.id)
                                    if items.allSatisfy({ picked.contains($0.id) }) { picked.subtract(ids) } else { picked.formUnion(ids) }
                                }
                                .buttonStyle(.plain)
                                .font(.system(size: 12))
                                .foregroundStyle(.tint)
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 6)
                            .background(.background)
                        }
                    }
                }
                .padding(.bottom, 8)
            }
            .disabled(progress != nil)
        }
    }

    private func row(_ note: AppleNote) -> some View {
        let on = picked.contains(note.id)
        let already = existingTitles.contains(note.name.lowercased())
        return Button {
            if on { picked.remove(note.id) } else { picked.insert(note.id) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 17))
                    .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                    .contentTransition(.symbolEffect(.replace))
                VStack(alignment: .leading, spacing: 2) {
                    Text(note.name).font(.system(size: 13, weight: .medium)).lineLimit(1)
                    Text(DateBucket.rowDate(note.modified)).font(.system(size: 12)).foregroundStyle(.secondary).monospacedDigit()
                }
                Spacer(minLength: 8)
                if already {
                    Text("Already imported")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(.fill.tertiary, in: .capsule)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 7)
            .background(on ? Color.accentColor.opacity(0.10) : .clear)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(already ? "\(note.name), already imported" : note.name)
        .accessibilityValue(DateBucket.rowDate(note.modified))
        .accessibilityAddTraits(on ? .isSelected : [])
        .animation(.easeOut(duration: 0.12), value: on)
    }

    private var footer: some View {
        HStack(spacing: 14) {
            if let progress {
                ProgressView(value: Double(progress.done), total: Double(max(progress.total, 1)))
                    .frame(width: 140)
                Text("Importing \(min(progress.done + 1, progress.total)) of \(progress.total)…")
                    .font(.callout).foregroundStyle(.secondary).monospacedDigit()
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Toggle("Keep Apple Notes folders", isOn: $keepFolders)
                        .toggleStyle(.checkbox)
                    if ApplePins.isAvailable {
                        Toggle("Also bring over pinned notes (asks for Full Disk Access)", isOn: $bringPins)
                            .toggleStyle(.checkbox)
                            .accessibilityIdentifier("import.pins")
                        if bringPins && !pinAccess {
                            HStack(spacing: 8) {
                                Text("Pins live where only apps with Full Disk Access can read them.")
                                    .foregroundStyle(.secondary)
                                Button("Open Settings") { NSWorkspace.shared.open(ApplePins.settingsURL) }
                                    .buttonStyle(.link)
                            }
                            .font(.footnote)
                            .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .font(.callout)
                .onChange(of: bringPins) { _, on in if on { pinAccess = ApplePins.hasAccess() } }
            }
            Spacer()
            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
            Button(picked.isEmpty ? "Import" : "Import \(picked.count) \(picked.count == 1 ? "Note" : "Notes")") {
                Task { await runImport() }
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .disabled(picked.isEmpty || progress != nil)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    private func noticeBar(_ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "pin.slash").foregroundStyle(.secondary)
            Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
            Spacer()
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }

    private func load() async {
        loading = true
        failure = nil
        let titles = ((try? context.fetch(FetchDescriptor<Note>())) ?? []).filter { $0.deletedAt == nil && $0.trashedAt == nil }.map { $0.title.lowercased() }
        existingTitles = Set(titles)
        if AppleNotesBridge.isDemo {
            // Captures never read the real Apple Notes: a made-up library, most of it picked.
            notes = AppleNotesBridge.demoNotes
            picked = Set(notes.filter { $0.folder != "Archive" }.map(\.id))
            loading = false
            return
        }
        do {
            notes = try await Task.detached { try AppleNotesBridge.list() }.value
        } catch {
            failure = error.localizedDescription
        }
        loading = false
    }

    private func runImport() async {
        let chosen = notes.filter { picked.contains($0.id) }
        progress = (0, chosen.count)
        // Pins are read once, up front, only when asked for.
        let pins: Result<Set<Int>, ApplePins.Failure>? = bringPins
            ? await Task.detached { ApplePins.pinnedKeys() }.value
            : nil
        let pinned = (try? pins?.get()) ?? []
        var made: [UUID] = []
        for (i, n) in chosen.enumerated() {
            progress = (i, chosen.count)
            // Importing the same unchanged note again would only make a copy.
            if context.hasImported(title: n.name, modified: n.modified) { continue }
            guard let html = try? await Task.detached(operation: { try AppleNotesBridge.body(of: n.id) }).value else { continue }
            let md = RichPaste.clean(RichTextToMarkdown.markdown(fromHTML: html))
            let scope: Scope = keepFolders ? .folder(folder(named: n.folder).id) : .all
            let note = context.createNote(in: scope, body: md.isEmpty ? n.name : md)
            note.createdAt = n.modified
            note.updatedAt = n.modified
            if let key = ApplePins.primaryKey(fromNoteID: n.id), pinned.contains(key) { note.isPinned = true }
            made.append(note.id)
        }
        try? context.save()
        SyncSignal.changed()
        if !made.isEmpty { NotificationCenter.default.post(name: .paneNotesBrought, object: nil) }
        onImported(made)
        if case .failure(let why) = pins {
            // Everything else came over; say so plainly, and why pins didn't.
            progress = nil
            notice = why == .noAccess
                ? "Pins couldn't be read without Full Disk Access; everything else imported."
                : "Pins couldn't be read; everything else imported."
            return
        }
        dismiss()
    }

    private func folder(named name: String) -> Folder {
        let clean = name.isEmpty ? "Notes" : name
        if let f = context.allFolders().first(where: { $0.name == clean && $0.parent == nil }) { return f }
        return context.createFolder(named: clean)
    }
}
#endif
