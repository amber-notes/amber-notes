import SwiftData
import SwiftUI
import UniformTypeIdentifiers

/// Where notes come from, and how its sheet talks about it.
enum ImportKind: String, Identifiable, CaseIterable, Sendable {
    case evernote, keep, markdown

    var id: String { rawValue }

    var title: String {
        switch self {
        case .evernote: "Import from Evernote"
        case .markdown: "Import Markdown or Text"
        case .keep: "Import from Google Keep"
        }
    }

    /// The iPhone's title, which has room for about 20 characters between its buttons.
    var shortTitle: String {
        switch self {
        case .evernote: "Import from Evernote"
        case .markdown: "Import Markdown"
        case .keep: "Import from Keep"
        }
    }

    /// The source, as the setup card names it.
    var sourceName: String {
        switch self {
        case .evernote: "Evernote"
        case .markdown: "Markdown files"
        case .keep: "Google Keep"
        }
    }

    /// The setup card's choice.
    var choiceTitle: String {
        switch self {
        case .evernote: "From Evernote…"
        case .markdown: "From Markdown or Text Files…"
        case .keep: "From Google Keep…"
        }
    }

    /// The menu item that opens the sheet.
    var menuTitle: String {
        switch self {
        case .evernote: "Import from Evernote…"
        case .markdown: "Import Markdown or Text…"
        case .keep: "Import from Google Keep…"
        }
    }

    var subtitle: String {
        switch self {
        case .evernote: "Each notebook you exported becomes a folder. Nothing in Evernote changes."
        case .markdown: "Each folder or .zip becomes a folder, subfolders included. Your files aren't changed."
        case .keep: "From your Google Takeout download. Nothing in Keep changes."
        }
    }

    var emptyTitle: String {
        switch self {
        case .evernote: "Choose your Evernote exports"
        case .markdown: "Choose a folder or .zip of notes"
        case .keep: "Choose your Google Takeout"
        }
    }

    var emptyText: String {
        switch self {
        case .evernote: "In Evernote, export each notebook as an ENEX file (.enex). You can pick several at once."
        case .markdown: "Markdown (.md) and text (.txt) files from Obsidian, Notion, Bear, Joplin, Logseq, Simplenote, Standard Notes or anywhere else. Pictures and files they link to come too."
        case .keep: "At takeout.google.com, export Keep. Then choose the .zip, or the Takeout or Keep folder inside it."
        }
    }

    var chooseTitle: String {
        switch self {
        case .evernote: "Choose Files…"
        case .markdown: "Choose a Folder or .zip…"
        case .keep: "Choose the Takeout…"
        }
    }

    var addMoreTitle: String {
        switch self {
        case .evernote: "Add More Files…"
        case .markdown: "Add More…"
        case .keep: "Add More…"
        }
    }

    /// What one source is called, in the list's header and its count.
    var sourceNoun: (one: String, many: String) {
        switch self {
        case .evernote: ("notebook", "notebooks")
        case .markdown: ("folder", "folders")
        case .keep: ("Takeout", "Takeouts")
        }
    }

    var perSourceTitle: String {
        switch self {
        case .evernote: "A folder for each notebook"
        case .markdown: "A folder for each folder or .zip"
        case .keep: "A folder named Google Keep"
        }
    }

    var symbol: String {
        switch self {
        case .evernote: "book.closed"
        case .markdown: "folder"
        case .keep: "lightbulb"
        }
    }

    var contentTypes: [UTType] {
        switch self {
        case .evernote: [.enex, .xml]
        case .markdown: [.folder, .zip]
        case .keep: [.folder, .zip]
        }
    }

    nonisolated func inspect(_ url: URL) -> ImportSource {
        switch self {
        case .evernote: EvernoteImporter.inspect(url)
        case .markdown: MarkdownImporter.inspect(url)
        case .keep: KeepImporter.inspect(url)
        }
    }

    @MainActor
    func run(_ sources: [ImportSource], into destination: ImportDestination, options: ImportOptions = ImportOptions(), context: ModelContext,
             progress: (Int, Int) -> Void, shouldStop: () -> Bool) async -> ImportSummary {
        switch self {
        case .evernote: await EvernoteImporter(context: context).run(sources, into: destination, progress: progress, shouldStop: shouldStop)
        case .markdown: await MarkdownImporter(context: context).run(sources, into: destination, progress: progress, shouldStop: shouldStop)
        case .keep: await KeepImporter(context: context, options: options).run(sources, into: destination, progress: progress, shouldStop: shouldStop)
        }
    }
}

/// The import sheet every source shares: pick files or folders, see what's in them, choose where
/// the notes go, watch them come in, and read what happened. Nothing at the source is changed.
struct ImportSheet: View {
    /// The sheet's height on the Mac (captures can ask for another).
    nonisolated(unsafe) static var height: CGFloat = 560

    enum Phase: Equatable {
        case choosing
        case importing(done: Int, total: Int)
        case finished(ImportSummary)
    }

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    let kind: ImportKind
    /// Files to start with: shared into the app, opened from Files or dropped.
    var files: [URL] = []
    /// Called with the new notes' ids once the import is done.
    var onImported: ([UUID]) -> Void = { _ in }

    @State private var sources: [ImportSource]
    @State private var phase: Phase
    @State private var destination: ImportDestination = .perSource
    @State private var options = ImportOptions()
    @State private var folders: [(id: UUID, name: String)] = []
    @State private var picking = false
    @State private var inspecting = false
    @State private var stopRequested = false

    init(_ kind: ImportKind, files: [URL] = [], sources: [ImportSource] = [], phase: Phase = .choosing, onImported: @escaping ([UUID]) -> Void = { _ in }) {
        self.kind = kind
        self.files = files
        self.onImported = onImported
        _sources = State(initialValue: sources)
        _phase = State(initialValue: phase)
    }

    #if os(iOS)
    private static let compact = true
    #else
    private static let compact = false
    #endif

    private var importable: [ImportSource] { sources.filter { $0.problem == nil } }
    private var noteCount: Int { importable.reduce(0) { $0 + $1.notes } }
    private var isImporting: Bool { if case .importing = phase { true } else { false } }

    var body: some View {
        chrome
            .fileImporter(isPresented: $picking, allowedContentTypes: kind.contentTypes, allowsMultipleSelection: true) { result in
                if case .success(let urls) = result { add(urls) }
            }
            .task {
                folders = context.allFolders().map { ($0.id, $0.name) }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                if !files.isEmpty { add(files) }
            }
    }

    // MARK: Mac

    #if os(macOS)
    private var chrome: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text(kind.title).font(.system(size: 17, weight: .bold))
                Text(kind.subtitle)
                    .font(.callout).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 12)

            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()
            footer
        }
        .frame(width: 540, height: Self.height)
        .dropDestination(for: URL.self) { urls, _ in
            guard !isImporting else { return false }
            add(urls)
            return true
        }
    }

    @ViewBuilder
    private var content: some View {
        if case .finished(let summary) = phase {
            ScrollView { summaryView(summary).padding(20) }
        } else if sources.isEmpty {
            emptyState
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(sources) { s in sourceRow(s).padding(.horizontal, 20).padding(.vertical, 8) }
                    Button(kind.addMoreTitle) { picking = true }
                        .buttonStyle(.link)
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                        .disabled(isImporting)
                        .accessibilityIdentifier("evernote.addMore")
                    VStack(alignment: .leading, spacing: 10) {
                        destinationPicker.fixedSize()
                        if kind == .keep { keepOptions }
                    }
                    .disabled(importable.isEmpty)
                    .padding(.horizontal, 20)
                    .padding(.top, 24)
                }
                .padding(.bottom, 12)
            }
            .disabled(isImporting)
        }
    }

    private var footer: some View {
        HStack(spacing: 14) {
            switch phase {
            case .importing(let done, let total):
                ProgressView(value: Double(done), total: Double(max(total, 1)))
                    .frame(width: 120)
                Text(progressText(done, total))
                    .font(.callout).foregroundStyle(.secondary).monospacedDigit()
                    .lineLimit(1).fixedSize()
                Spacer()
                Button("Stop Import") { stopRequested = true }
                    .keyboardShortcut(.cancelAction)
                    .disabled(stopRequested)
            case .finished:
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("evernote.done")
            case .choosing:
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .fixedSize()
                importButton
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.defaultAction)
                    .fixedSize()
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
    }
    #endif

    // MARK: iPhone

    #if os(iOS)
    private var chrome: some View {
        NavigationStack {
            List {
                if case .finished(let summary) = phase {
                    Section { summaryView(summary).padding(.vertical, 8) }
                } else if sources.isEmpty {
                    Section { emptyState.padding(.vertical, 12) }
                } else {
                    Section {
                        ForEach(sources) { sourceRow($0) }
                        Button(kind.addMoreTitle) { picking = true }
                            .disabled(isImporting)
                            .accessibilityIdentifier("evernote.addMore")
                    } header: {
                        Text(kind.sourceNoun.many.capitalized)
                    } footer: {
                        Text("\(count(noteCount, "note", "notes")) in \(count(importable.count, kind.sourceNoun.one, kind.sourceNoun.many)).")
                            .monospacedDigit()
                    }
                    Section {
                        destinationPicker
                        if kind == .keep { keepOptions }
                    }
                        .disabled(isImporting || importable.isEmpty)
                }
            }
            .navigationTitle(kind.shortTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                switch phase {
                case .choosing:
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { importButton }
                case .importing:
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Stop") { stopRequested = true }.disabled(stopRequested)
                    }
                case .finished:
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }.accessibilityIdentifier("evernote.done")
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if case .importing(let done, let total) = phase {
                    VStack(spacing: 8) {
                        ProgressView(value: Double(done), total: Double(max(total, 1)))
                        Text(progressText(done, total))
                            .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(.bar)
                }
            }
        }
        .interactiveDismissDisabled(isImporting)
    }
    #endif

    // MARK: Shared parts

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "tray.and.arrow.down")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.secondary)
            Text(kind.emptyTitle).font(.headline)
            Text(kind.emptyText)
                .font(.callout).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if inspecting {
                ProgressView().controlSize(.small).padding(.top, 6)
            } else {
                Button(kind.chooseTitle) { picking = true }
                    .buttonStyle(.bordered)
                    .padding(.top, 6)
                    .accessibilityIdentifier("evernote.choose")
            }
        }
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 20)
    }

    private func sourceRow(_ s: ImportSource) -> some View {
        HStack(spacing: 12) {
            Image(systemName: s.problem == nil ? kind.symbol : "exclamationmark.triangle")
                .font(.system(size: 17))
                .foregroundStyle(s.problem == nil ? AnyShapeStyle(.tint) : AnyShapeStyle(.orange))
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.name).font(.system(size: 13, weight: .medium)).lineLimit(1)
                Text(s.problem ?? "\(count(s.notes, "note", "notes")) · \(s.bytes.formatted(.byteCount(style: .file).locale(locale)))")
                    .font(.system(size: 12)).foregroundStyle(.secondary).monospacedDigit()
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            if !isImporting {
                Button {
                    sources.removeAll { $0.id == s.id }
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundStyle(.tertiary)
                        .frame(width: 28, height: 28)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Remove \(s.name)")
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// Keep's labels and archive: where they go is the person's choice.
    @ViewBuilder
    private var keepOptions: some View {
        Picker("Labels become", selection: $options.labelsAsFolders) {
            Text("Folders").tag(true)
            Text("Tags").tag(false)
        }
        .fixedSize()
        .accessibilityIdentifier("import.labels")
        Toggle("Also import archived notes, into a folder named Archive", isOn: $options.includeArchived)
            #if os(macOS)
            .toggleStyle(.checkbox)
            #endif
            .accessibilityIdentifier("import.archived")
    }

    private var destinationPicker: some View {
        Picker("Put notes in", selection: $destination) {
            Text(kind.perSourceTitle).tag(ImportDestination.perSource)
            if !folders.isEmpty {
                Divider()
                ForEach(folders, id: \.id) { f in Text(f.name).tag(ImportDestination.folder(f.id)) }
            }
        }
        .accessibilityIdentifier("evernote.destination")
    }

    private var importButton: some View {
        // The iPhone's bar has room for one word; the count is under the list there.
        Button(noteCount == 0 || Self.compact ? "Import" : "Import \(count(noteCount, "Note", "Notes"))") {
            Task { await runImport() }
        }
        .disabled(noteCount == 0 || inspecting)
        .accessibilityIdentifier("evernote.import")
    }

    private func summaryView(_ s: ImportSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Label {
                Text(s.stopped ? "Stopped after \(count(s.notes, "note", "notes"))" : "Imported \(count(s.notes, "note", "notes"))")
                    .font(.title3.weight(.semibold))
            } icon: {
                Image(systemName: s.stopped ? "pause.circle.fill" : "checkmark.circle.fill").foregroundStyle(.tint)
            }
            .accessibilityIdentifier("evernote.summary")
            VStack(alignment: .leading, spacing: 10) {
                summaryRow("paperclip", "\(count(s.attachments, "attachment", "attachments")) brought in")
                if s.skipped > 0 {
                    summaryRow("arrow.uturn.forward", "\(count(s.skipped, "note", "notes")) skipped", detail: skippedReasons(s))
                }
                if s.filesMissing + s.filesTooBig > 0 {
                    summaryRow("paperclip.badge.ellipsis", "\(count(s.filesMissing + s.filesTooBig, "attachment", "attachments")) left out", detail: fileReasons(s))
                }
                if s.encrypted > 0 {
                    summaryRow("lock", "\(count(s.encrypted, "encrypted section", "encrypted sections")) couldn't be opened",
                               detail: "Evernote's encryption can't be read outside Evernote. Each one is marked in its note.")
                }
                if s.notNotes > 0 {
                    summaryRow("doc.badge.ellipsis", "\(count(s.notNotes, "file", "files")) that aren't notes left out",
                               detail: "Spreadsheets, backups and settings that no note links to.")
                }
                ForEach(s.dropped, id: \.self) { summaryRow("minus.circle", $0) }
                ForEach(s.failedFiles, id: \.self) { summaryRow("exclamationmark.triangle", $0) }
            }
            .font(.callout)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func summaryRow(_ symbol: String, _ text: String, detail: String? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(.secondary).frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(text).monospacedDigit()
                if let detail {
                    Text(detail).font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func skippedReasons(_ s: ImportSummary) -> String {
        var parts: [String] = []
        if s.alreadyImported > 0 { parts.append("\(s.alreadyImported.formatted(.number.locale(locale))) already imported") }
        if s.archived > 0 { parts.append("\(s.archived.formatted(.number.locale(locale))) archived") }
        if s.trashed > 0 { parts.append("\(s.trashed.formatted(.number.locale(locale))) in the trash") }
        if s.empty > 0 { parts.append("\(s.empty.formatted(.number.locale(locale))) empty") }
        if s.tooLong > 0 { parts.append("\(s.tooLong.formatted(.number.locale(locale))) longer than a note can be") }
        return parts.joined(separator: ", ").capitalizedFirst + "."
    }

    private func fileReasons(_ s: ImportSummary) -> String {
        var parts: [String] = []
        if s.filesMissing > 0 { parts.append("\(s.filesMissing.formatted(.number.locale(locale))) missing from the export") }
        if s.filesTooBig > 0 { parts.append("\(s.filesTooBig.formatted(.number.locale(locale))) over 50 MB") }
        return parts.joined(separator: ", ").capitalizedFirst + "."
    }

    private func count(_ n: Int, _ one: String, _ many: String) -> String {
        "\(n.formatted(.number.locale(locale))) \(n == 1 ? one : many)"
    }

    private func progressText(_ done: Int, _ total: Int) -> String {
        "Importing \(min(done + 1, total).formatted(.number.locale(locale))) of \(total.formatted(.number.locale(locale)))…"
    }

    // MARK: Actions

    private func add(_ urls: [URL]) {
        let new = urls.filter { u in !sources.contains { $0.url == u } }
        guard !new.isEmpty else { return }
        inspecting = true
        Task {
            let kind = kind
            let found = await Task.detached { new.map(kind.inspect) }.value
            sources += found
            inspecting = false
        }
    }

    private func runImport() async {
        let chosen = importable
        guard !chosen.isEmpty else { return }
        stopRequested = false
        phase = .importing(done: 0, total: noteCount)
        let summary = await kind.run(chosen, into: destination, options: options, context: context,
                                     progress: { done, total in phase = .importing(done: done, total: total) },
                                     shouldStop: { stopRequested })
        phase = .finished(summary)
        EvernoteInbox.clear()
        onImported(summary.noteIDs)
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
