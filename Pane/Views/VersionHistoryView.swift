import SwiftData
import SwiftUI

/// Version history for one note, like browsing versions in Pages: a list of versions by day,
/// a read-only preview with the lines that differ from the note tinted amber, and Restore.
/// On the Mac it's one sheet with the list beside the preview; on iPhone a list, then a preview.
@MainActor
@Observable
final class VersionHistoryModel {
    enum Phase: Equatable { case loading, loaded, failed(String) }

    private(set) var phase: Phase = .loading
    private(set) var days: [HistoryDay] = []
    var selection: Int64?
    private(set) var previewText: String?
    private(set) var changed: [NSRange] = []
    private(set) var previewFailed: String?
    private(set) var restoring = false
    var restoreError: String?

    let note: Note
    let history: NoteHistory

    /// What "Today" and "Yesterday" are measured from; tests pin it.
    private let now: () -> Date

    init(note: Note, history: NoteHistory, now: @escaping () -> Date = { .now }) {
        self.note = note
        self.history = history
        self.now = now
    }

    var entries: [HistoryEntry] { days.flatMap(\.entries) }
    var selected: HistoryEntry? { entries.first { $0.id == selection } }
    /// Only the current version: nothing to go back to.
    var isEmpty: Bool { entries.allSatisfy(\.version.isCurrent) }

    func load() async {
        phase = .loading
        do {
            let versions = try await history.versions(of: note.id)
            days = HistoryGrouping.days(HistoryGrouping.entries(versions), now: now())
            phase = .loaded
            // The newest earlier version is what you most likely came for.
            let pick = HistoryLaunch.pick.flatMap { entries.indices.contains($0) ? entries[$0] : nil }
            if let first = pick ?? entries.first(where: { !$0.version.isCurrent }) ?? entries.first { await select(first.id) }
        } catch {
            phase = .failed(HistoryError.from(error).localizedDescription)
        }
    }

    func select(_ id: Int64?) async {
        selection = id
        previewText = nil
        previewFailed = nil
        changed = []
        guard let entry = selected else { return }
        do {
            let text = try await history.body(of: note, entry.version)
            guard selection == id else { return }
            previewText = text
            changed = entry.version.isCurrent ? [] : HistoryDiff.changedLines(in: text, comparedTo: note.body)
        } catch {
            guard selection == id else { return }
            previewFailed = HistoryError.from(error).localizedDescription
        }
    }

    /// Restores the selected version. True when it's done and the history can close.
    func restore() async -> Bool {
        guard let entry = selected, !entry.version.isCurrent, !restoring else { return false }
        restoring = true
        defer { restoring = false }
        do {
            try await history.restore(noteID: note.id, toVersion: entry.version.version)
            return true
        } catch {
            restoreError = HistoryError.from(error).localizedDescription
            return false
        }
    }

    /// "Today at 14:02", for the preview's heading.
    static func heading(_ v: NoteVersion) -> String {
        let day = HistoryGrouping.title(for: v.madeAt)
        return "\(day) at \(time(v.madeAt))"
    }

    static func time(_ d: Date) -> String { d.formatted(date: .omitted, time: .shortened) }

    /// "You on Mac · 3 edits", "Restored by you on iPhone".
    static func byline(_ e: HistoryEntry) -> String {
        var s = e.version.author.name
        if e.version.restored {
            switch e.version.author {
            case .ai(let name): s = "Restored by \(name)"
            case .you(let device?): s = "Restored by you on \(device)"
            case .you(nil): s = "Restored by you"
            }
        }
        if e.count > 1 { s += " · \(e.count) edits" }
        return s
    }
}

/// Launch arguments for captures and recordings: `-uitest -showHistory` opens the open note's
/// history, `-historyPick 2` selects (on iPhone, opens) the third entry after `-historyPickAfter`
/// seconds, and `-historyRestoreAfter 3` then restores it.
enum HistoryLaunch {
    private static var args: [String] { ProcessInfo.processInfo.arguments }
    private static func value(_ name: String) -> String? {
        guard args.contains("-uitest"), let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }
    static var open: Bool { args.contains("-uitest") && args.contains("-showHistory") }
    static var pick: Int? { value("-historyPick").flatMap(Int.init) }
    static var pickAfter: Double { value("-historyPickAfter").flatMap(Double.init) ?? 0 }
    static var restoreAfter: Double? { value("-historyRestoreAfter").flatMap(Double.init) }
}

/// The history for `note`, as a sheet's content.
struct VersionHistorySheet: View {
    @State private var model: VersionHistoryModel
    @Environment(\.dismiss) private var dismiss

    init(note: Note, history: NoteHistory) {
        _model = State(initialValue: VersionHistoryModel(note: note, history: history))
    }

    var body: some View {
        content
            .task { await model.load() }
            .task { await restoreFromLaunchArguments() }
            .alert("Couldn't restore this version", isPresented: Binding(get: { model.restoreError != nil }, set: { if !$0 { model.restoreError = nil } })) {
                Button("OK") {}
            } message: { Text(model.restoreError ?? "") }
    }

    @ViewBuilder
    private var content: some View {
        #if os(macOS)
        MacVersionHistory(model: model, close: { dismiss() })
        #else
        PhoneVersionHistory(model: model, close: { dismiss() })
        #endif
    }

    private func restoreFromLaunchArguments() async {
        guard let after = HistoryLaunch.restoreAfter else { return }
        try? await Task.sleep(for: .seconds(HistoryLaunch.pickAfter + after))
        if await model.restore() { dismiss() }
    }
}

// MARK: Pieces both platforms use

/// Who made a version: the AI's own mark, or the device you used.
struct VersionAuthorMark: View {
    let author: VersionAuthor
    var size: CGFloat = 13

    var body: some View {
        Group {
            switch author {
            case .ai(let name):
                if let asset = Self.asset(name) {
                    Image(asset).resizable().scaledToFit()
                        .foregroundStyle(Self.color(name))
                } else {
                    Image(systemName: "sparkle").resizable().scaledToFit().foregroundStyle(.tint)
                }
            case .you(let device):
                Image(systemName: Self.symbol(device)).resizable().scaledToFit().foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    /// The AIs' marks, as on the website and in Connect an AI.
    static func asset(_ name: String) -> String? {
        guard !AIGlyph.storeSafe else { return nil }
        let n = name.lowercased()
        if n.contains("chatgpt") || n.contains("openai") || n.contains("codex") { return "AIGlyphOpenAI" }
        if n.contains("claude") { return "AIGlyphClaude" }
        return nil
    }

    static func color(_ name: String) -> Color {
        name.lowercased().contains("claude") ? Color(red: 0.851, green: 0.467, blue: 0.341) : .primary
    }

    static func symbol(_ device: String?) -> String {
        switch device {
        case "iPhone": "iphone"
        case "iPad": "ipad"
        case "Mac": "laptopcomputer"
        default: "person.crop.circle"
        }
    }
}

/// One version in the list: when, and who.
struct VersionRow: View {
    let entry: HistoryEntry

    #if os(macOS)
    private let timeFont = Font.system(size: 13, weight: .medium)
    private let bylineFont = Font.system(size: 11)
    private let markSize: CGFloat = 12
    #else
    private let timeFont = Font.body.weight(.medium)
    private let bylineFont = Font.subheadline
    private let markSize: CGFloat = 15
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(entry.version.isCurrent ? "Current version" : VersionHistoryModel.time(entry.version.madeAt))
                .font(timeFont)
                .monospacedDigit()
            HStack(spacing: 5) {
                VersionAuthorMark(author: entry.version.author, size: markSize)
                Text(entry.version.isCurrent ? "\(VersionHistoryModel.byline(entry)), \(VersionHistoryModel.time(entry.version.madeAt))" : VersionHistoryModel.byline(entry))
                    .lineLimit(1)
            }
            .font(bylineFont)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("history.row")
    }
}

/// The amber swatch and what it means, above the preview.
struct ChangeLegend: View {
    let count: Int
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 6) {
            if !isCurrent && count > 0 {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(Color(PColor.paneAccent).opacity(0.28))
                    .overlay(alignment: .leading) { Rectangle().fill(Color(PColor.paneAccent)).frame(width: 2) }
                    .clipShape(.rect(cornerRadius: 2))
                    .frame(width: 14, height: 10)
                    .accessibilityHidden(true)
            }
            Text(isCurrent ? "This is the note as it is now." : HistoryDiff.summary(count))
        }
        .foregroundStyle(.secondary)
    }
}

/// The preview: the version's text, read-only, styled like the note.
struct VersionPreview: View {
    let model: VersionHistoryModel

    var body: some View {
        Group {
            if let text = model.previewText {
                VersionTextView(text: text, changed: model.changed)
                    .accessibilityIdentifier("history.preview")
            } else if let failed = model.previewFailed {
                ContentUnavailableView("Can't show this version", systemImage: "exclamationmark.triangle", description: Text(failed))
            } else if model.selection != nil {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView("No version selected", systemImage: "clock.arrow.circlepath", description: Text("Choose a version to see it here."))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.notePage)
    }
}

/// Loading, offline and nothing-kept-yet, in place of the list.
struct HistoryStatus: View {
    let model: VersionHistoryModel

    var body: some View {
        switch model.phase {
        case .loading:
            ProgressView("Loading versions…").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Can't load versions", systemImage: "wifi.slash")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") { Task { await model.load() } }
            }
        case .loaded:
            ContentUnavailableView("No earlier versions", systemImage: "clock.arrow.circlepath",
                                   description: Text("When you or an AI change this note, its earlier versions appear here."))
        }
    }
}

// MARK: Mac

#if os(macOS)
struct MacVersionHistory: View {
    @Bindable var model: VersionHistoryModel
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if hasVersions {
                HStack(spacing: 0) {
                    sidebar.frame(width: 260)
                    Hairline(vertical: true)
                    detail
                }
            } else {
                // Loading, offline or nothing kept yet: one message across the sheet.
                VStack(alignment: .leading, spacing: 0) {
                    header.frame(maxWidth: .infinity, alignment: .leading)
                    HistoryStatus(model: model).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(nsColor: .windowBackgroundColor))
            }
            Hairline()
            bar
        }
        .frame(minWidth: 820, idealWidth: 900, minHeight: 540, idealHeight: 600)
    }

    private var hasVersions: Bool { model.phase == .loaded && !model.isEmpty }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Version History").font(.system(size: 13, weight: .semibold))
            Text(model.note.title).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 8)
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            List(selection: Binding(get: { model.selection }, set: { id in Task { await model.select(id) } })) {
                ForEach(model.days) { day in
                    Section(day.title) {
                        ForEach(day.entries) { entry in
                            VersionRow(entry: entry).tag(entry.id)
                                .listRowSeparator(.hidden)
                        }
                    }
                    .listSectionSeparator(.hidden)
                }
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("history.list")
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    @ViewBuilder
    private var detail: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let entry = model.selected {
                VStack(alignment: .leading, spacing: 3) {
                    Text(entry.version.isCurrent ? "Current version" : VersionHistoryModel.heading(entry.version))
                        .font(.system(size: 13, weight: .semibold))
                    ChangeLegend(count: model.changed.count, isCurrent: entry.version.isCurrent)
                        .font(.system(size: 11))
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.notePage)
                Hairline()
                VersionPreview(model: model)
            } else {
                Color.notePage
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var bar: some View {
        HStack(spacing: 8) {
            if model.restoring {
                ProgressView().controlSize(.small)
                Text("Restoring…").font(.system(size: 13)).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Done", action: close)
                .keyboardShortcut(.cancelAction)
            if hasVersions { restoreButton }
        }
        .controlSize(.large)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var restoreButton: some View {
        Button("Restore This Version") {
            Task { if await model.restore() { close() } }
        }
        .keyboardShortcut(.defaultAction)
        .buttonStyle(.borderedProminent)
        .disabled(model.selected == nil || model.selected?.version.isCurrent == true || model.previewText == nil || model.restoring)
        .accessibilityIdentifier("history.restore")
    }
}

/// A separator line. Drawn as a plain fill so it reads the same in the sheet and in captures.
private struct Hairline: View {
    var vertical = false
    var body: some View {
        Rectangle().fill(Color(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(white: 0.27, alpha: 1) : NSColor(white: 0.87, alpha: 1) }))
            .frame(width: vertical ? 1 : nil, height: vertical ? nil : 1)
    }
}
#endif

// MARK: iPhone

#if os(iOS)
struct PhoneVersionHistory: View {
    @Bindable var model: VersionHistoryModel
    let close: () -> Void
    @State private var path: [HistoryEntry.ID] = []

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if model.phase == .loaded && !model.isEmpty {
                    List {
                        ForEach(model.days) { day in
                            Section(day.title) {
                                ForEach(day.entries) { entry in
                                    NavigationLink(value: entry.id) { VersionRow(entry: entry) }
                                }
                            }
                        }
                    }
                    .accessibilityIdentifier("history.list")
                } else {
                    HistoryStatus(model: model)
                }
            }
            .navigationTitle("Version History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", action: close) }
            }
            .navigationDestination(for: HistoryEntry.ID.self) { id in
                PhoneVersionPreview(model: model, id: id, close: close)
            }
        }
        .task(id: model.phase) {
            // Captures: open the picked version once the list has been on screen a moment.
            guard model.phase == .loaded, let pick = HistoryLaunch.pick, model.entries.indices.contains(pick), path.isEmpty else { return }
            try? await Task.sleep(for: .seconds(HistoryLaunch.pickAfter))
            path = [model.entries[pick].id]
        }
    }
}

struct PhoneVersionPreview: View {
    let model: VersionHistoryModel
    let id: HistoryEntry.ID
    let close: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if let entry = model.selected {
                HStack(spacing: 8) {
                    VersionAuthorMark(author: entry.version.author, size: 15)
                    Text(VersionHistoryModel.byline(entry)).font(.subheadline).foregroundStyle(.secondary)
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                ChangeLegend(count: model.changed.count, isCurrent: entry.version.isCurrent)
                    .font(.subheadline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.top, 4)
                    .padding(.bottom, 8)
            }
            VersionPreview(model: model)
        }
        .background(Color.notePage.ignoresSafeArea())
        .navigationTitle(model.selected.map { $0.version.isCurrent ? "Current Version" : VersionHistoryModel.heading($0.version) } ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if model.selected?.version.isCurrent == false {
                Button {
                    Task { if await model.restore() { close() } }
                } label: {
                    Group {
                        if model.restoring { ProgressView() } else { Text("Restore This Version") }
                    }
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 32)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(model.previewText == nil || model.restoring)
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
                .accessibilityIdentifier("history.restore")
            }
        }
        .task(id: id) { if model.selection != id || model.previewText == nil { await model.select(id) } }
    }
}
#endif
