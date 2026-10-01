import SwiftData
import SwiftUI
import UniformTypeIdentifiers

/// Bring in notebooks exported from Evernote (.enex files). Each becomes a folder, or they all go
/// into one you pick. Nothing in Evernote is changed.
struct EvernoteImportView: View {
    /// The sheet's height on the Mac (captures can ask for another).
    nonisolated(unsafe) static var height: CGFloat = 560

    enum Phase: Equatable {
        case choosing
        case importing(done: Int, total: Int)
        case finished(EvernoteImportSummary)
    }

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    /// Files to start with: shared into the app, opened from Files or dropped.
    var files: [URL] = []
    /// Called with the new notes' ids once the import is done.
    var onImported: ([UUID]) -> Void = { _ in }

    @State private var sources: [ENEXSource]
    @State private var phase: Phase
    @State private var destination: EvernoteDestination = .perNotebook
    @State private var folders: [(id: UUID, name: String)] = []
    @State private var picking = false
    @State private var inspecting = false
    @State private var stopRequested = false

    init(files: [URL] = [], sources: [ENEXSource] = [], phase: Phase = .choosing, onImported: @escaping ([UUID]) -> Void = { _ in }) {
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

    private var importable: [ENEXSource] { sources.filter { $0.problem == nil } }
    private var noteCount: Int { importable.reduce(0) { $0 + $1.notes } }
    private var isImporting: Bool { if case .importing = phase { true } else { false } }

    var body: some View {
        chrome
            .fileImporter(isPresented: $picking, allowedContentTypes: [.enex, .xml], allowsMultipleSelection: true) { result in
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
                Text("Import from Evernote").font(.system(size: 17, weight: .bold))
                Text("Each notebook you exported becomes a folder. Nothing in Evernote changes.")
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
                    Button("Add More Files…") { picking = true }
                        .buttonStyle(.link)
                        .padding(.horizontal, 20)
                        .padding(.top, 8)
                        .disabled(isImporting)
                        .accessibilityIdentifier("evernote.addMore")
                    destinationPicker
                        .fixedSize()
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
                    .buttonStyle(.amberProminent)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("evernote.done")
            case .choosing:
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .fixedSize()
                importButton
                    .buttonStyle(.amberProminent)
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
                        Button("Add More Files…") { picking = true }
                            .disabled(isImporting)
                            .accessibilityIdentifier("evernote.addMore")
                    } header: {
                        Text("Notebooks")
                    } footer: {
                        Text("\(count(noteCount, "note", "notes")) in \(count(importable.count, "notebook", "notebooks")). Nothing in Evernote changes.")
                            .monospacedDigit()
                    }
                    Section { destinationPicker }
                        .disabled(isImporting || importable.isEmpty)
                }
            }
            .navigationTitle("Import from Evernote")
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
            Text("Choose your Evernote exports").font(.headline)
            Text("In Evernote, export each notebook as an ENEX file (.enex). You can pick several at once.")
                .font(.callout).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if inspecting {
                ProgressView().controlSize(.small).padding(.top, 6)
            } else {
                Button("Choose Files…") { picking = true }
                    .buttonStyle(.bordered)
                    .padding(.top, 6)
                    .accessibilityIdentifier("evernote.choose")
            }
        }
        .frame(maxWidth: 360)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 20)
    }

    private func sourceRow(_ s: ENEXSource) -> some View {
        HStack(spacing: 12) {
            Image(systemName: s.problem == nil ? "book.closed" : "exclamationmark.triangle")
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

    private var destinationPicker: some View {
        Picker("Put notes in", selection: $destination) {
            Text("A folder for each notebook").tag(EvernoteDestination.perNotebook)
            if !folders.isEmpty {
                Divider()
                ForEach(folders, id: \.id) { f in Text(f.name).tag(EvernoteDestination.folder(f.id)) }
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

    private func summaryView(_ s: EvernoteImportSummary) -> some View {
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

    private func skippedReasons(_ s: EvernoteImportSummary) -> String {
        var parts: [String] = []
        if s.alreadyImported > 0 { parts.append("\(s.alreadyImported.formatted(.number.locale(locale))) already imported") }
        if s.empty > 0 { parts.append("\(s.empty.formatted(.number.locale(locale))) empty") }
        if s.tooLong > 0 { parts.append("\(s.tooLong.formatted(.number.locale(locale))) longer than a note can be") }
        return parts.joined(separator: ", ").capitalizedFirst + "."
    }

    private func fileReasons(_ s: EvernoteImportSummary) -> String {
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
            let found = await Task.detached { new.map(ENEXSource.inspect) }.value
            sources += found
            inspecting = false
        }
    }

    private func runImport() async {
        let chosen = importable
        guard !chosen.isEmpty else { return }
        stopRequested = false
        phase = .importing(done: 0, total: noteCount)
        let importer = EvernoteImporter(context: context)
        let summary = await importer.run(chosen, into: destination,
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
