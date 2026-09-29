#if os(macOS)
import AppKit
import SwiftData
import SwiftUI

/// Amber Notes in the menu bar: type to capture a note or find one, and your pinned
/// and latest notes a click away. The same library and sync as the window.
struct MenuBarPanel: View {
    let backend: Backend
    let sync: SyncEngine?
    @Environment(\.modelContext) private var context
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Note.updatedAt, order: .reverse) private var notes: [Note]
    @State private var text = ""
    /// The highlighted row: 0 is "New note" while you type, then the notes in order.
    @State private var highlight: Int?
    @State private var saved: String?
    @State private var savedToken = 0
    @FocusState private var fieldFocused: Bool

    init(backend: Backend, sync: SyncEngine?, query: String = "") {
        self.backend = backend
        self.sync = sync
        _text = State(initialValue: query)
        _highlight = State(initialValue: query.isEmpty ? nil : 0)
    }

    private var signedOut: Bool { if case .signedOut = backend.state { true } else { false } }
    private var typing: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var sections: MenuBarList.Sections { MenuBarList.sections(notes, query: text, isNested: { context.isNested($0) }) }

    var body: some View {
        Group {
            if signedOut { signIn } else { panel }
        }
        .frame(width: 320)
    }

    // MARK: Signed in

    private var panel: some View {
        let sections = self.sections
        let rows = sections.all
        return VStack(spacing: 0) {
            field(rows: rows)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if let saved { savedRow(saved) }
                    if typing {
                        createRow(highlighted: highlight == 0)
                        if !sections.matches.isEmpty { header("Notes") }
                        list(sections.matches, offset: 1)
                    } else if rows.isEmpty {
                        Text("Notes you pin or edit show up here.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    } else {
                        if !sections.pinned.isEmpty { header("Pinned") }
                        list(sections.pinned, offset: 0)
                        if !sections.recent.isEmpty { header("Recent") }
                        list(sections.recent, offset: sections.pinned.count)
                    }
                }
                .padding(6)
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: 440)
            .fixedSize(horizontal: false, vertical: true)
            Divider()
            footer
        }
        .onAppear { fieldFocused = true }
        .onChange(of: text) { _, _ in highlight = typing ? 0 : nil }
    }

    private func field(rows: [UUID]) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "square.and.pencil")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            TextField("New note or search", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: 14))
                .focused($fieldFocused)
                .accessibilityIdentifier("menubar.field")
                .onKeyPress(.downArrow) { move(1, count: rowCount(rows)); return .handled }
                .onKeyPress(.upArrow) { move(-1, count: rowCount(rows)); return .handled }
                .onKeyPress(.escape) {
                    if typing { text = ""; return .handled }
                    close(); return .handled
                }
                .onKeyPress(.return, phases: .down) { press in
                    activate(rows: rows, open: press.modifiers.contains(.command))
                    return .handled
                }
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
    }

    /// Rows the arrows walk: "New note" first while typing, then the notes.
    private func rowCount(_ rows: [UUID]) -> Int { rows.count + (typing ? 1 : 0) }

    private func move(_ delta: Int, count: Int) {
        guard count > 0 else { return }
        let next = (highlight ?? (delta > 0 ? -1 : count)) + delta
        highlight = min(max(next, 0), count - 1)
    }

    /// Return acts on the highlighted row; with nothing highlighted while typing, it saves.
    /// ⌘Return saves and opens the new note in the window.
    private func activate(rows: [UUID], open: Bool) {
        if typing {
            let h = highlight ?? 0
            if h == 0 || open { capture(open: open) } else if h - 1 < rows.count { reveal(rows[h - 1]) }
        } else if let h = highlight, h < rows.count {
            reveal(rows[h])
        }
    }

    private func capture(open: Bool) {
        guard let note = QuickCapture.save(text, in: context) else { return }
        sync?.schedule(after: 0.5)
        text = ""
        if open { reveal(note.id); return }
        let title = note.title
        withAnimation(.snappy(duration: 0.2)) { saved = title }
        savedToken += 1
        let token = savedToken
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
            guard token == savedToken else { return }
            withAnimation(.easeOut(duration: 0.2)) { saved = nil }
        }
    }

    private func createRow(highlighted: Bool) -> some View {
        Button { capture(open: false) } label: {
            HStack(spacing: 10) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.accentColor)
                Text("New note \u{201C}\(text.trimmingCharacters(in: .whitespacesAndNewlines))\u{201D}")
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 8)
                Text("↩").font(.callout).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8)
            .frame(height: 32)
            .background(rowFill(highlighted), in: .rect(cornerRadius: 6))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("menubar.create")
    }

    private func savedRow(_ title: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 16))
                .foregroundStyle(.green)
            Text("Saved \u{201C}\(title)\u{201D}")
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .frame(height: 32)
        .transition(.opacity.combined(with: .move(edge: .top)))
        .accessibilityIdentifier("menubar.saved")
    }

    private func header(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.top, 8)
            .padding(.bottom, 2)
    }

    @ViewBuilder
    private func list(_ ids: [UUID], offset: Int) -> some View {
        ForEach(Array(ids.enumerated()), id: \.element) { i, id in
            if let note = notes.first(where: { $0.id == id }) {
                row(note, highlighted: highlight == i + offset + (typing ? 1 : 0))
            }
        }
    }

    private func row(_ note: Note, highlighted: Bool) -> some View {
        Button { reveal(note.id) } label: {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 5) {
                    if note.isPinned {
                        Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(.secondary)
                    }
                    Text(note.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                }
                Text(note.preview.isEmpty ? "No additional text" : note.preview)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(rowFill(highlighted), in: .rect(cornerRadius: 6))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("menubar.note.\(note.title)")
    }

    private func rowFill(_ highlighted: Bool) -> AnyShapeStyle {
        highlighted ? AnyShapeStyle(.selection) : AnyShapeStyle(.clear)
    }

    private var footer: some View {
        HStack(spacing: 4) {
            Button("Open Amber Notes") { showWindow() }
                .accessibilityIdentifier("menubar.open")
            Spacer()
            SettingsLink { Image(systemName: "gearshape") }
                .help("Settings…")
                .accessibilityLabel("Settings")
            Button { NSApp.terminate(nil) } label: { Image(systemName: "power") }
                .help("Quit Amber Notes")
                .accessibilityLabel("Quit Amber Notes")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 10)
        .frame(height: 36)
    }

    // MARK: Signed out

    private var signIn: some View {
        VStack(spacing: 12) {
            AppMark(size: 40)
            Text("Sign in to see your notes here.")
                .font(.callout)
                .foregroundStyle(.secondary)
            Button("Sign In…") { showWindow() }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("menubar.signIn")
        }
        .padding(24)
        .frame(maxWidth: .infinity)
    }

    // MARK: The window

    private func reveal(_ id: UUID) {
        NoteOpener.shared.open(id)
        showWindow()
    }

    /// Brings the notes window forward, opening it if it was closed.
    private func showWindow() {
        close()
        NSApp.activate()
        if let window = NSApp.windows.first(where: { $0.identifier?.rawValue.hasPrefix(PaneApp.mainWindowID) == true && ($0.isVisible || $0.isMiniaturized) }) {
            if window.isMiniaturized { window.deminiaturize(nil) }
            window.makeKeyAndOrderFront(nil)
        } else {
            openWindow(id: PaneApp.mainWindowID)
        }
    }

    private func close() {
        text = ""
        highlight = nil
        dismiss()
    }
}
#endif
