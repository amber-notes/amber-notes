import SwiftData
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// "Use this template" / "Use this note": what the link adds, where it goes, and one button.
/// Once added, a template shows the prompt that has your AI fill it in, with Copy.
struct NoteSourceSheet: View {
    let model: NoteSourceModel
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @State private var client: String?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(navigationTitle)
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        if case .added = model.phase {} else { Button("Cancel") { dismiss() }.accessibilityIdentifier("noteSource.cancel") }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if case .added = model.phase { Button("Done") { dismiss() }.accessibilityIdentifier("noteSource.done") }
                    }
                }
        }
        #if os(macOS)
        .frame(width: 520, height: 620)
        #endif
        .task { if model.phase == .loading { await model.load(context: context) } }
        .alert("You already added this", isPresented: Binding(get: { model.duplicate != nil }, set: { if !$0 { model.duplicate = nil } })) {
            Button("Add another copy") { model.add(context: context, again: true) }
            Button("Open the one you have") {
                if let id = model.duplicate { NoteOpener.shared.open(id) }
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("\u{201C}\(model.draft?.title ?? "This note")\u{201D} is already in your notes. Add another copy?")
        }
    }

    private var navigationTitle: String {
        model.link.kind == .template ? "Use this template" : "Use this note"
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .loading:
            ProgressView(model.link.kind == .template ? "Loading template…" : "Loading note…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let error):
            ContentUnavailableView {
                Label(error.title, systemImage: error == .offline ? "wifi.slash" : "exclamationmark.triangle")
            } description: {
                Text(error.message)
            } actions: {
                if error.canRetry {
                    Button("Try again") { Task { await model.load(context: context) } }
                        .accessibilityIdentifier("noteSource.retry")
                }
            }
            .accessibilityIdentifier("noteSource.failed")
        case .ready(let draft):
            ready(draft)
        case .added(let draft, let note, let folder):
            added(draft, note: note, folder: folder)
        }
    }

    // MARK: Ready to add

    private func ready(_ draft: NoteDraft) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text(draft.title)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Color.ink)
                    .accessibilityAddTraits(.isHeader)
                if let d = draft.description, !d.isEmpty {
                    Text(d).font(.subheadline).foregroundStyle(Color.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            // The note as it will look, read-only: checklists, headings, lists and tables.
            NotePreview(markdown: draft.body)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .frame(minHeight: 200)
                .background(Color.notePage, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.separator, lineWidth: 0.5))
                .accessibilityLabel("Preview of \(draft.title)")
                .accessibilityIdentifier("noteSource.preview")
            if draft.leftOut > 0 {
                Label(draft.leftOut == 1 ? "A photo or file in this note stays with its owner." : "\(draft.leftOut) photos and files in this note stay with their owner.",
                      systemImage: "photo.on.rectangle")
                    .font(.footnote)
                    .foregroundStyle(Color.muted)
            }
            folderPicker(draft)
            Button { model.add(context: context) } label: {
                Text("Add to my notes").frame(maxWidth: .infinity)
            }
            .buttonStyle(.amberProminent)
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("noteSource.add")
        }
        .padding(20)
    }

    private func folderPicker(_ draft: NoteDraft) -> some View {
        let folders = context.allFolders().map { (id: $0.id, path: context.folderPath($0)) }.sorted { $0.path.localizedStandardCompare($1.path) == .orderedAscending }
        let suggested = context.suggestedFolder(for: draft)
        return Picker("Folder", selection: Binding(get: { model.folder ?? suggested }, set: { model.folder = $0 })) {
            if case .new(let name) = suggested {
                Text("\(name) (new folder)").tag(FolderChoice.new(name))
            }
            ForEach(folders, id: \.id) { f in
                Text(f.path).tag(FolderChoice.existing(f.id))
            }
        }
        .accessibilityIdentifier("noteSource.folder")
    }

    // MARK: Added

    private func added(_ draft: NoteDraft, note: UUID, folder: String) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack(spacing: 12) {
                    DrawnCheck().frame(width: 32, height: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Added to your notes").font(.headline).foregroundStyle(Color.ink)
                        Text("\u{201C}\(draft.title)\u{201D} is in \(folder).").font(.subheadline).foregroundStyle(Color.muted)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("noteSource.added")

                if !draft.instructions.isEmpty { instructions(draft.instructions) }

                Button {
                    NoteOpener.shared.open(note)
                    dismiss()
                } label: {
                    Text("Open note").frame(maxWidth: .infinity)
                }
                .buttonStyle(.amberProminent)
                .controlSize(.large)
                .accessibilityIdentifier("noteSource.open")
            }
            .padding(20)
        }
    }

    private func instructions(_ list: [NoteTemplate.Instruction]) -> some View {
        let current = list.first { $0.client == client } ?? list[0]
        return VStack(alignment: .leading, spacing: 10) {
            Text("Ask your AI to fill it in").font(.headline).foregroundStyle(Color.ink)
            Text("Connect your AI in Settings, then paste this into it.").font(.subheadline).foregroundStyle(Color.muted)
            if list.count > 1 {
                Picker("AI", selection: Binding(get: { current.client }, set: { client = $0; copied = false })) {
                    ForEach(list) { Text($0.name).tag($0.client) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .accessibilityIdentifier("noteSource.client")
            }
            // The prompt to read; the note's markdown it carries (for an AI to create the note
            // where it's missing) is copied with it but not shown. Long prompts scroll.
            let shown = PromptText.shown(current.prompt)
            VStack(alignment: .leading, spacing: 8) {
                ScrollView {
                    Text(shown.text)
                        .font(.callout)
                        .foregroundStyle(Color.ink)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .frame(maxHeight: 180)
                .fixedSize(horizontal: false, vertical: true)
                .background(Color.notePage, in: .rect(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator, lineWidth: 0.5))
                .accessibilityIdentifier("noteSource.prompt")
                if shown.includesMarkdown {
                    Label("The note\u{2019}s markdown is included when you copy.", systemImage: "doc.plaintext")
                        .font(.footnote)
                        .foregroundStyle(Color.muted)
                }
            }
            Button { copy(current.prompt) } label: {
                Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                    .contentTransition(.symbolEffect(.replace))
                    .frame(minWidth: 88)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("noteSource.copy")
        }
    }

    private func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
        withAnimation(.snappy(duration: 0.15)) { copied = true }
        Task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation(.snappy(duration: 0.15)) { copied = false }
        }
    }
}

/// Shows the sheet for a template or copy link once the notes are open.
struct NoteSourceHandler: ViewModifier {
    @State private var center = NoteSourceCenter.shared
    @State private var model: NoteSourceModel?
    /// Optional: views hosted without an account (previews, tests) still get links.
    @Environment(Backend.self) private var backend: Backend?

    func body(content: Content) -> some View {
        content
            .onChange(of: center.pending, initial: true) { _, link in
                guard let link else { return }
                center.pending = nil
                model = NoteSourceModel(link: link, source: WebNoteSource(), ledger: NoteSourceLedger(account: backend?.userID))
            }
            .sheet(item: $model) { NoteSourceSheet(model: $0) }
    }
}

extension NoteSourceModel: Identifiable {
    nonisolated var id: ObjectIdentifier { ObjectIdentifier(self) }
}

extension View {
    func noteSourceHandler() -> some View { modifier(NoteSourceHandler()) }
}

// MARK: Prompt

/// A template's prompt as the sheet shows it: the words before the ```markdown block that carries
/// the note (copied in full, not shown).
nonisolated enum PromptText {
    static func shown(_ prompt: String) -> (text: String, includesMarkdown: Bool) {
        guard let r = prompt.range(of: "```markdown") else { return (prompt.trimmingCharacters(in: .whitespacesAndNewlines), false) }
        return (String(prompt[..<r.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines), true)
    }
}

// MARK: Preview

/// A note's markdown drawn the way the editor shows it at rest, tables included (the version
/// preview leaves tables to the editor's grid, so it can't be used here). Read-only.
struct NotePreview: View {
    let markdown: String

    enum Block: Equatable {
        case title(String)
        case heading(Int, String)
        case paragraph(String)
        case check(Bool, String, indent: Int)
        case bullet(dash: Bool, String, indent: Int)
        case numbered(String, String, indent: Int)
        case quote(String)
        case code(String)
        case table(header: [String], rows: [[String]])
        case gap
    }

    /// The note in blocks. Type lines for tables (<!-- pane-table: … -->) and other comments are left out.
    nonisolated static func blocks(_ markdown: String) -> [Block] {
        let lines = markdown.components(separatedBy: "\n")
        var out: [Block] = []
        var i = 0
        var titled = false
        func indent(_ l: String) -> Int { (l.prefix { $0 == " " || $0 == "\t" }.count + 1) / 2 }
        func match(_ l: String, _ p: String) -> [String]? {
            guard let r = try? NSRegularExpression(pattern: p), let m = r.firstMatch(in: l, range: NSRange(l.startIndex..., in: l)) else { return nil }
            return (1..<m.numberOfRanges).map { Range(m.range(at: $0), in: l).map { String(l[$0]) } ?? "" }
        }
        let isDelimiter = { (l: String) in l.trimmingCharacters(in: .whitespaces).hasPrefix("|") && l.contains("-") && l.allSatisfy { "|-: \t".contains($0) } }
        while i < lines.count {
            let line = lines[i]
            let t = line.trimmingCharacters(in: .whitespaces)
            defer { i += 1 }
            if t.isEmpty { if out.last != .gap, !out.isEmpty { out.append(.gap) }; continue }
            if t.hasPrefix("<!--"), t.hasSuffix("-->") { continue }
            if !titled { titled = true; out.append(.title(t.replacingOccurrences(of: #"^#+\s*"#, with: "", options: .regularExpression))); continue }
            if t.hasPrefix("```") || t.hasPrefix("~~~") {
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(String(t.prefix(3))) { code.append(lines[i]); i += 1 }
                out.append(.code(code.joined(separator: "\n")))
                continue
            }
            if t.hasPrefix("|"), i + 1 < lines.count, isDelimiter(lines[i + 1]) {
                let header = MarkdownTableCells.cells(t)
                var rows: [[String]] = []
                i += 2
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    let c = MarkdownTableCells.cells(lines[i])
                    rows.append(header.indices.map { $0 < c.count ? c[$0] : "" })
                    i += 1
                }
                i -= 1
                out.append(.table(header: header, rows: rows))
                continue
            }
            if let m = match(line, #"^(#{1,6})\s+(.*)$"#) { out.append(.heading(m[0].count, m[1])); continue }
            if let m = match(line, #"^\s*[-*+]\s+\[([ xX])\]\s+(.*)$"#) { out.append(.check(m[0] != " ", m[1], indent: indent(line))); continue }
            if let m = match(line, #"^\s*([-*+])\s+(.*)$"#) { out.append(.bullet(dash: m[0] == "-", m[1], indent: indent(line))); continue }
            if let m = match(line, #"^\s*(\d+[.)])\s+(.*)$"#) { out.append(.numbered(m[0], m[1], indent: indent(line))); continue }
            if let m = match(line, #"^>\s?(.*)$"#) { out.append(.quote(m[0])); continue }
            out.append(.paragraph(t))
        }
        while out.last == .gap { out.removeLast() }
        return out
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(Self.blocks(markdown).enumerated()), id: \.offset) { _, block in
                    view(block)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .foregroundStyle(Color.ink)
    }

    private func inline(_ s: String) -> Text {
        if let a = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) { return Text(a) }
        return Text(s)
    }

    @ViewBuilder private func view(_ block: Block) -> some View {
        switch block {
        case .title(let s):
            Text(s).font(.system(.title, weight: .heavy)).padding(.bottom, 6)
        case .heading(let level, let s):
            inline(s).font(level <= 1 ? .title2.bold() : level == 2 ? .title3.bold() : .headline).padding(.top, 6)
        case .paragraph(let s):
            inline(s).fixedSize(horizontal: false, vertical: true)
        case .check(let done, let s, let n):
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(done ? AnyShapeStyle(Color(PColor.paneAccent)) : AnyShapeStyle(.tertiary))
                    .imageScale(.large)
                inline(s).foregroundStyle(done ? Color.muted : Color.ink)
            }
            .padding(.leading, CGFloat(n) * 20)
        case .bullet(let dash, let s, let n):
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(dash ? "\u{2013}" : "\u{2022}").frame(width: 14)
                inline(s)
            }
            .padding(.leading, CGFloat(n) * 20)
        case .numbered(let marker, let s, let n):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(marker).monospacedDigit()
                inline(s)
            }
            .padding(.leading, CGFloat(n) * 20)
        case .quote(let s):
            inline(s).foregroundStyle(Color.muted)
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Rectangle().fill(Color(PColor.paneAccent)).frame(width: 3) }
        case .code(let s):
            Text(s).font(.callout.monospaced())
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 8))
        case .table(let header, let rows):
            ScrollView(.horizontal, showsIndicators: false) {
                Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                    GridRow { ForEach(Array(header.enumerated()), id: \.offset) { cell($0.element, header: true) } }
                    // A tracker starts empty: one blank row shows it's a table to fill in.
                    ForEach(Array((rows.isEmpty ? [header.map { _ in "" }] : rows).enumerated()), id: \.offset) { _, row in
                        GridRow { ForEach(Array(row.enumerated()), id: \.offset) { cell($0.element, header: false) } }
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.separator, lineWidth: 0.5))
                .clipShape(.rect(cornerRadius: 6))
            }
            .padding(.vertical, 4)
        case .gap:
            Color.clear.frame(height: 8)
        }
    }

    private func cell(_ s: String, header: Bool) -> some View {
        inline(s.isEmpty ? " " : s)
            .font(header ? .footnote.weight(.semibold) : .footnote)
            .monospacedDigit()
            .lineLimit(2)
            .frame(minWidth: 44, maxWidth: 160, alignment: .leading)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(header ? AnyShapeStyle(.quaternary.opacity(0.6)) : AnyShapeStyle(.clear))
            .overlay(alignment: .trailing) { Rectangle().fill(.separator).frame(width: 0.5) }
            .overlay(alignment: .bottom) { Rectangle().fill(.separator).frame(height: 0.5) }
    }
}

/// Splits a markdown table row into cells, keeping escaped pipes.
nonisolated enum MarkdownTableCells {
    static func cells(_ line: String) -> [String] {
        var s = line.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("|") { s.removeFirst() }
        if s.hasSuffix("|"), !s.hasSuffix("\\|") { s.removeLast() }
        var out: [String] = [], cur = ""
        var it = s.makeIterator()
        while let ch = it.next() {
            if ch == "\\" { if let n = it.next() { cur.append(n == "|" ? "|" : "\\"); if n != "|" { cur.append(n) } }; continue }
            if ch == "|" { out.append(cur.trimmingCharacters(in: .whitespaces)); cur = ""; continue }
            cur.append(ch)
        }
        out.append(cur.trimmingCharacters(in: .whitespaces))
        return out
    }
}

// MARK: Captures

/// `-uitest -captureScreen template | template-added | copy`: the sheet with a made-up template or
/// shared page, nothing fetched.
struct NoteSourceCapture: View {
    let name: String
    @Environment(\.modelContext) private var context
    @State private var model: NoteSourceModel?

    private struct Fixed: NoteSourceFetching {
        let draft: NoteDraft
        func draft(for link: NoteSourceLink) async throws -> NoteDraft { draft }
    }

    static let habitTracker = """
    Habit tracker

    One row a day. Ask your AI each evening to log it.

    ## Habits
    - [ ] Walk 30 minutes
    - [ ] Read 20 pages
    - [ ] No phone after 22:00

    ## Log
    <!-- pane-table: Date=date; Walk=choice Yes|No; Read=choice Yes|No; Phone=choice Yes|No; Note=text -->
    | Date | Walk | Read | Phone | Note |
    | --- | --- | --- | --- | --- |
    | 2026-09-29 | Yes | Yes | No | Late call |
    | 2026-09-30 | Yes | No | Yes |  |
    """

    var body: some View {
        Group {
            if let model { NoteSourceSheet(model: model) } else { Color.clear }
        }
        .task { model = await Self.model(name, context: context) }
    }

    /// The sheet's state for one capture: `template`, `template-added` or `copy`.
    /// `template` replaces the made-up habit tracker (the snapshot tests pass the site's real one).
    static func model(_ name: String, context: ModelContext, template: NoteTemplate? = nil) async -> NoteSourceModel {
        let copy = name == "copy"
        let link = NoteSourceLink(kind: copy ? .copy : .template, slug: copy ? "AbCdEfGhIjKlMnOpQrStUvWx" : "habit-tracker")
        var draft: NoteDraft
        if copy {
            draft = NoteDraft(link: link, title: "Lisbon", body: "Lisbon\n\nFour days of tiles, trams and pastries in May.\n\n## Plan\n- [ ] Tram 28 early, before the crowds\n- [ ] Day trip to Sintra\n- [x] Book flights\n\n## Food\n- Manteigaria: pastel de nata\n- Ramiro: seafood", leftOut: 2)
        } else if let template {
            draft = NoteDraft(template: template, link: NoteSourceLink(kind: .template, slug: template.slug))
        } else {
            draft = NoteDraft(link: link, title: "Habit tracker", body: habitTracker, leftOut: 0)
            draft.description = "Tick off your habits, and have your AI log each day as a row."
            draft.folder = "Habits"
            draft.instructions = [
                .init(client: "chatgpt", name: "ChatGPT", prompt: "In Amber Notes, use the note \u{201C}Habit tracker\u{201D}. Ask me which habits I did today, then log a row with log_table_row."),
                .init(client: "claude", name: "Claude", prompt: "In Amber Notes, use the note \u{201C}Habit tracker\u{201D}. Ask me which habits I did today, then log a row with log_table_row."),
                .init(client: "claude-code", name: "Claude Code", prompt: "Use the amber-notes MCP server. In the note \u{201C}Habit tracker\u{201D}, log today's row with log_table_row."),
            ]
        }
        let m = NoteSourceModel(link: link, source: Fixed(draft: draft), ledger: NoteSourceLedger(defaults: UserDefaults(suiteName: "capture.noteSources") ?? .standard, account: nil))
        await m.load(context: context)
        if name == "template-added" { m.add(context: context, again: true) }
        return m
    }
}
