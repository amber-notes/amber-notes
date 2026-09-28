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

    static func body(of id: String) throws -> String {
        let escaped = id.replacingOccurrences(of: "\"", with: "\\\"")
        return try run("tell application \"Notes\" to get body of note id \"\(escaped)\"").stringValue ?? ""
    }
}

/// Pick Apple Notes to copy into Amber Notes. Nothing in Apple Notes is changed.
struct AppleNotesImportView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var notes: [AppleNote] = []
    @State private var picked: Set<String> = []
    @State private var query = ""
    @State private var keepFolders = true
    @State private var phase: Phase = .loading
    @State private var imported = 0

    enum Phase: Equatable { case loading, ready, importing, done, failed(String) }

    private var shown: [AppleNote] {
        query.isEmpty ? notes : notes.filter { $0.name.localizedStandardContains(query) || $0.folder.localizedStandardContains(query) }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
            Divider()
            footer
        }
        .frame(width: 520, height: 560)
        .task { await load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Import from Apple Notes").font(.title3.bold())
            Text("Pick the notes to copy into Amber Notes. Your Apple Notes stay as they are.")
                .font(.callout).foregroundStyle(.secondary)
            TextField("Filter", text: $query)
                .textFieldStyle(.roundedBorder)
                .padding(.top, 6)
        }
        .padding(20)
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView("Reading Apple Notes…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't read Apple Notes", systemImage: "exclamationmark.triangle")
            } description: { Text(message) } actions: {
                Button("Try again") { Task { await load() } }
            }
        case .done:
            ContentUnavailableView {
                Label(imported == 1 ? "Imported 1 note" : "Imported \(imported) notes", systemImage: "checkmark.circle")
            } actions: {
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
        case .ready, .importing:
            List(shown) { note in
                Toggle(isOn: Binding(get: { picked.contains(note.id) }, set: { on in if on { picked.insert(note.id) } else { picked.remove(note.id) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(note.name).lineLimit(1)
                        Text("\(note.folder) · \(DateBucket.rowDate(note.modified))")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                .toggleStyle(.checkbox)
            }
            .disabled(phase == .importing)
        }
    }

    private var footer: some View {
        HStack {
            if phase == .ready || phase == .importing {
                Button(picked.count == shown.count && !shown.isEmpty ? "Select none" : "Select all") {
                    picked = picked.count == shown.count ? [] : Set(shown.map(\.id))
                }
                Toggle("Keep folders", isOn: $keepFolders).toggleStyle(.checkbox)
            }
            Spacer()
            Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
            if phase == .ready || phase == .importing {
                Button(phase == .importing ? "Importing…" : "Import \(picked.count) \(picked.count == 1 ? "note" : "notes")", action: { Task { await runImport() } })
                    .keyboardShortcut(.defaultAction)
                    .disabled(picked.isEmpty || phase == .importing)
            }
        }
        .padding(16)
    }

    private func load() async {
        phase = .loading
        do {
            notes = try await Task.detached { try AppleNotesBridge.list() }.value
            phase = .ready
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func runImport() async {
        phase = .importing
        let chosen = notes.filter { picked.contains($0.id) }
        var count = 0
        for n in chosen {
            guard let html = try? await Task.detached(operation: { try AppleNotesBridge.body(of: n.id) }).value else { continue }
            let md = RichPaste.clean(RichTextToMarkdown.markdown(fromHTML: html))
            let scope: Scope = keepFolders ? .folder(folder(named: n.folder).id) : .all
            let note = context.createNote(in: scope, body: md.isEmpty ? n.name : md)
            note.createdAt = n.modified
            note.updatedAt = n.modified
            count += 1
        }
        try? context.save()
        imported = count
        phase = .done
    }

    private func folder(named name: String) -> Folder {
        let clean = name.isEmpty ? "Notes" : name
        if let f = context.allFolders().first(where: { $0.name == clean && $0.parent == nil }) { return f }
        return context.createFolder(named: clean)
    }
}
#endif
