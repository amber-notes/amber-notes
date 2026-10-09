import SwiftData
import SwiftUI

/// "Move to…" from a toolbar's ••• menu: the folders as the sidebar has them, with a search
/// field. A click or Return moves, Esc closes. The menu used to hold a button per folder, which
/// SwiftUI built with the toolbar: with 80 folders that was half of a 1.5 s block at launch,
/// and 150 names in a menu are hard to pick from anyway.
struct MoveToPicker: View {
    /// The folder the note or file is in now: shown, and not a choice.
    let current: UUID?
    let move: (Folder) -> Void

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var highlighted: UUID?
    @FocusState private var searching: Bool

    enum Metrics {
        static let width: CGFloat = 280
        static let row: CGFloat = 28
        static let indent: CGFloat = 14
        static let search: CGFloat = 40
        static let maxRows = 11
    }

    struct Row: Identifiable, Equatable {
        let id: UUID
        let name: String
        /// Where it is, for a search result: "Work / Clients".
        let path: String
        let depth: Int
    }

    /// How many times the folders were listed (tests: none before the picker opens).
    nonisolated(unsafe) static var listed = 0

    /// The folders in the sidebar's order, each under its parent. A search lists the folders
    /// whose name has the text, flat, each with where it is.
    @MainActor static func rows(_ folders: [Folder], matching query: String = "") -> [Row] {
        listed += 1
        var out: [Row] = []
        let known = Set(folders.map(\.id))
        func add(_ f: Folder, _ depth: Int, _ above: [String]) {
            out.append(Row(id: f.id, name: f.name, path: above.joined(separator: " / "), depth: depth))
            guard depth < 32 else { return }
            for child in f.liveChildren { add(child, depth + 1, above + [f.name]) }
        }
        for top in folders.filter({ $0.parent == nil || !known.contains($0.parent?.id ?? $0.id) }).sorted(by: { $0.sortIndex < $1.sortIndex }) { add(top, 0, []) }
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return out }
        return out.filter { $0.name.localizedStandardContains(q) }.map { Row(id: $0.id, name: $0.name, path: $0.path, depth: 0) }
    }

    var body: some View {
        let rows = Self.rows(context.allFolders(), matching: query)
        let choice = highlighted.flatMap { id in rows.first { $0.id == id && $0.id != current } } ?? rows.first { $0.id != current }
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Move to", text: $query)
                    .textFieldStyle(.plain)
                    .focused($searching)
                    .onSubmit { if let choice { pick(choice.id) } }
                    #if os(macOS)
                    .onKeyPress(.downArrow) { step(1, in: rows, from: choice); return .handled }
                    .onKeyPress(.upArrow) { step(-1, in: rows, from: choice); return .handled }
                    #endif
                    .accessibilityIdentifier("moveTo.search")
            }
            .padding(.horizontal, 12)
            .frame(height: Metrics.search)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(rows) { row in rowView(row, chosen: row.id == choice?.id) }
                    }
                    .padding(6)
                }
                .onChange(of: choice?.id) { _, id in if let id { proxy.scrollTo(id) } }
            }
            .frame(height: CGFloat(min(max(rows.count, 1), Metrics.maxRows)) * Metrics.row + 12)
            .overlay { if rows.isEmpty { Text("No folders").foregroundStyle(.secondary) } }
        }
        .frame(width: Metrics.width)
        .onAppear { searching = true }
        #if os(macOS)
        .onExitCommand { dismiss() }
        #endif
    }

    private func rowView(_ row: Row, chosen: Bool) -> some View {
        Button { pick(row.id) } label: {
            HStack(spacing: 6) {
                Image(systemName: "folder").foregroundStyle(.secondary)
                Text(row.name).lineLimit(1)
                if !query.isEmpty, !row.path.isEmpty {
                    Text(row.path).lineLimit(1).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if row.id == current {
                    Image(systemName: "checkmark").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            .padding(.leading, 8 + CGFloat(row.depth) * Metrics.indent)
            .padding(.trailing, 8)
            .frame(maxWidth: .infinity, minHeight: Metrics.row, maxHeight: Metrics.row, alignment: .leading)
            .background(chosen ? AnyShapeStyle(.fill.tertiary) : AnyShapeStyle(.clear), in: .rect(cornerRadius: 6, style: .continuous))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(row.id == current)
        .id(row.id)
        .accessibilityIdentifier("moveTo.folder.\(row.name)")
    }

    private func step(_ by: Int, in rows: [Row], from choice: Row?) {
        let choices = rows.filter { $0.id != current }
        guard !choices.isEmpty else { return }
        let at = choice.flatMap { c in choices.firstIndex { $0.id == c.id } } ?? (by > 0 ? -1 : choices.count)
        highlighted = choices[min(max(at + by, 0), choices.count - 1)].id
    }

    private func pick(_ id: UUID) {
        guard id != current, let folder = context.folder(id) else { return }
        dismiss()
        move(folder)
    }
}
