import AppIntents
import SwiftUI
import WidgetKit

/// Home-screen widgets for note pages (prototype): draws what the app worked out for a note's
/// widget (WidgetShared), and turns a button press into a queued edit. Never sees the note itself.
@main
struct PaneWidgets: WidgetBundle {
    var body: some Widget { NotePageWidget() }
}

struct NotePageWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: WidgetShared.kind, intent: PickNoteIntent.self, provider: Provider()) { entry in
            WidgetView(entry: entry)
                .containerBackground(for: .widget) { Color.notePage }
        }
        .configurationDisplayName("Note")
        .description("A note at a glance, made by the AI that built the note's app.")
        .supportedFamilies(families)
    }

    private var families: [WidgetFamily] {
        #if os(iOS)
        [.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular]
        #else
        [.systemSmall, .systemMedium, .systemLarge]
        #endif
    }
}

// MARK: Which note

struct NoteEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Note"
    static let defaultQuery = NoteQuery()
    var id: String
    var title: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}

struct NoteQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [NoteEntity] {
        try await suggestedEntities().filter { identifiers.contains($0.id) }
    }
    /// The notes whose page has a widget.
    func suggestedEntities() async throws -> [NoteEntity] {
        WidgetVault.snapshots().map { NoteEntity(id: $0.noteID.uuidString, title: $0.title) }
    }
    func defaultResult() async -> NoteEntity? { try? await suggestedEntities().first }
}

struct PickNoteIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Note"
    static let description = IntentDescription("The note whose widget to show.")
    @Parameter(title: "Note") var note: NoteEntity?
    init() {}
}

/// A widget button: the edit goes to the app's queue and the widget shows the result now.
struct PressIntent: AppIntent {
    static let title: LocalizedStringResource = "Press a note widget's button"
    static let isDiscoverable = false
    @Parameter(title: "Note") var note: String
    @Parameter(title: "Action") var action: String
    @Parameter(title: "Next") var next: String

    init() {}
    init(note: UUID, button: WidgetButton) {
        self.note = note.uuidString
        self.action = String(decoding: (try? JSONEncoder().encode(button.action)) ?? Data(), as: UTF8.self)
        self.next = button.next
    }

    func perform() async throws -> some IntentResult {
        guard let id = UUID(uuidString: note), let a = try? JSONDecoder().decode(WidgetAction.self, from: Data(action.utf8)) else { return .result() }
        try WidgetVault.press(note: id, action: a, next: next)
        return .result()
    }
}

// MARK: Timeline

struct Entry: TimelineEntry {
    var date: Date
    var noteID: UUID?
    var title: String
    var faces: WidgetSnapshot.Faces?
    var hideOnLock: Bool
}

struct Provider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> Entry { Self.sample }

    func snapshot(for configuration: PickNoteIntent, in context: Context) async -> Entry {
        entries(configuration).first ?? Self.sample
    }

    func timeline(for configuration: PickNoteIntent, in context: Context) async -> Timeline<Entry> {
        // The app reloads when the note changes; tomorrow's entry is already in.
        Timeline(entries: entries(configuration), policy: .never)
    }

    private func entries(_ c: PickNoteIntent) -> [Entry] {
        let hide = WidgetShared.defaults?.bool(forKey: WidgetShared.hideOnLockKey) ?? false
        let snap = c.note.flatMap { UUID(uuidString: $0.id) }.flatMap(WidgetVault.snapshot) ?? WidgetVault.snapshots().first
        guard let snap else { return [Entry(date: .now, noteID: nil, title: "", faces: nil, hideOnLock: hide)] }
        let now = Date.now
        return snap.days.enumerated().map { i, d in
            var s = snap
            s.days = [d]
            return Entry(date: i == 0 ? now : d.start, noteID: snap.noteID, title: snap.title, faces: s.faces(at: d.start), hideOnLock: hide)
        }
    }

    static let sample = Entry(date: .now, noteID: nil, title: "Habit tracker", faces: .init(
        small: .init(blocks: [.title(text: "Walk", sub: nil), .ring(fraction: 5.0 / 7, center: "12", label: "day streak")]),
        medium: nil, large: nil, circular: nil, rectangular: nil), hideOnLock: false)
}

// MARK: Drawing

struct WidgetView: View {
    var entry: Entry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let face {
            FaceView(face: face, noteID: entry.noteID, compact: compact, hide: entry.hideOnLock)
                .widgetURL(entry.noteID.flatMap { URL(string: "ambernotes://note/\($0.uuidString)") })
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.noteID == nil ? "No widgets yet" : entry.title).font(.headline).foregroundStyle(Color.ink)
                Text(entry.noteID == nil ? "Ask the AI that built a note's app to add a widget." : "This note has no widget at this size.")
                    .font(.caption).foregroundStyle(Color.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var face: WidgetFace? {
        guard let f = entry.faces else { return nil }
        switch family {
        case .systemSmall: return f.small
        case .systemMedium: return f.medium ?? f.small
        case .systemLarge, .systemExtraLarge: return f.large ?? f.medium ?? f.small
        #if os(iOS)
        case .accessoryCircular: return f.circular
        case .accessoryRectangular: return f.rectangular
        #endif
        default: return f.small
        }
    }

    private var compact: Bool {
        #if os(iOS)
        family == .accessoryCircular || family == .accessoryRectangular
        #else
        false
        #endif
    }
}

struct FaceView: View {
    var face: WidgetFace
    var noteID: UUID?
    var compact: Bool
    var hide: Bool

    var body: some View {
        if compact {
            // Lock Screen: one block, in the system's tint.
            VStack(alignment: .leading, spacing: 1) { ForEach(Array(face.blocks.enumerated()), id: \.offset) { BlockView(block: $0.element, noteID: noteID, compact: true, hide: hide) } }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(face.blocks.enumerated()), id: \.offset) { i, b in
                    BlockView(block: b, noteID: noteID, compact: false, hide: hide)
                    if i == 0, face.blocks.count > 1, case .title = b { Spacer(minLength: 0) }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

struct BlockView: View {
    var block: WidgetBlock
    var noteID: UUID?
    var compact: Bool
    var hide: Bool

    var body: some View {
        content.modifier(Sensitive(on: hide))
    }

    @ViewBuilder private var content: some View {
        switch block {
        case .title(let text, let sub):
            VStack(alignment: .leading, spacing: 1) {
                Text(text).font(.system(size: compact ? 13 : 15, weight: .bold)).foregroundStyle(Color.ink).lineLimit(1)
                if let sub { Text(sub).font(.system(size: 12, weight: .medium)).foregroundStyle(Color.amberInk).lineLimit(1).widgetAccentable() }
            }
        case .text(let s):
            Text(s).font(.system(size: 13)).foregroundStyle(Color.muted).lineLimit(compact ? 1 : 3)
        case .number(let v, let label):
            VStack(alignment: .leading, spacing: -2) {
                Text(v).font(.system(size: compact ? 22 : 34, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(Color.ink)
                    .contentTransition(.numericText())
                if let label { Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Color.muted).lineLimit(1) }
            }
        case .ring(let f, let center, let label):
            if compact {
                Gauge(value: f) { Text(label ?? "") } currentValueLabel: { Text(center ?? "") }
                    .gaugeStyle(.accessoryCircularCapacity)
                    .widgetAccentable()
            } else {
                HStack(spacing: 10) {
                    ZStack {
                        Circle().stroke(Color.amberSoft, lineWidth: 7)
                        Circle().trim(from: 0, to: f).stroke(Color.amber, style: StrokeStyle(lineWidth: 7, lineCap: .round)).rotationEffect(.degrees(-90)).widgetAccentable()
                        if let center { Text(center).font(.system(size: 20, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(Color.ink).contentTransition(.numericText()) }
                    }
                    .frame(width: 58, height: 58)
                    if let label { Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.muted).lineLimit(2) }
                }
            }
        case .bar(let f, let label):
            VStack(alignment: .leading, spacing: 4) {
                if let label { Text(label).font(.system(size: 12, weight: .medium)).foregroundStyle(Color.muted).lineLimit(1) }
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.amberSoft)
                        Capsule().fill(Color.amber).frame(width: max(6, g.size.width * f)).widgetAccentable()
                    }
                }
                .frame(height: 6)
            }
        case .list(let items):
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(spacing: 6) {
                        if let done = item.done {
                            Image(systemName: done ? "checkmark.circle.fill" : "circle").font(.system(size: 12)).foregroundStyle(done ? Color.amber : Color.muted)
                        }
                        Text(item.text).font(.system(size: 13)).foregroundStyle(item.done == true ? Color.muted : Color.ink).strikethrough(item.done == true).lineLimit(1)
                    }
                }
            }
        case .chart(let line, let values, let labels):
            ChartView(line: line, values: values, labels: labels)
        case .grid(let days, let rows, let today):
            GridBlock(days: days, rows: rows, today: today)
        case .button(let b):
            if let noteID {
                Button(intent: PressIntent(note: noteID, button: b)) {
                    HStack(spacing: 6) {
                        Image(systemName: b.on ? "checkmark.circle.fill" : "circle").font(.system(size: 15, weight: .semibold))
                        Text(b.label).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .foregroundStyle(b.on ? Color.white : Color.amberInk)
                    .background(b.on ? Color.amber : Color.amberSoft, in: .capsule)
                    .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(b.on ? "\(b.label), done" : b.label)
                .widgetAccentable()
            }
        case .row(let blocks):
            HStack(alignment: .top, spacing: 10) {
                ForEach(Array(blocks.enumerated()), id: \.offset) { BlockView(block: $0.element, noteID: noteID, compact: compact, hide: hide).frame(maxWidth: .infinity, alignment: .leading) }
            }
        }
    }
}

/// "Hide widget content on the Lock Screen": the system redacts these while the device is locked.
struct Sensitive: ViewModifier {
    var on: Bool
    func body(content: Content) -> some View {
        if on { content.privacySensitive() } else { content }
    }
}

struct GridBlock: View {
    var days: [String]
    var rows: [WidgetBlock.GridRow]
    var today: Int?

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 4, verticalSpacing: 4) {
            GridRow {
                Color.clear.frame(width: 1, height: 1)
                ForEach(Array(days.enumerated()), id: \.offset) { i, d in
                    Text(d).font(.system(size: 9, weight: i == today ? .bold : .medium)).foregroundStyle(i == today ? Color.amberInk : Color.muted).frame(maxWidth: .infinity)
                }
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                GridRow {
                    Text(r.name).font(.system(size: 11, weight: .medium)).foregroundStyle(Color.ink).lineLimit(1).frame(width: 72, alignment: .leading)
                    ForEach(Array(r.done.enumerated()), id: \.offset) { i, on in
                        RoundedRectangle(cornerRadius: 3.5)
                            .fill(on ? Color.amber : Color.muted.opacity(0.16))
                            .overlay { if i == today { RoundedRectangle(cornerRadius: 3.5).stroke(Color.amberInk, lineWidth: 1.2) } }
                            .frame(maxWidth: .infinity)
                            .frame(height: 13)
                            .widgetAccentable(on)
                    }
                }
            }
        }
    }
}

struct ChartView: View {
    var line: Bool
    var values: [Double]
    var labels: [String]

    var body: some View {
        let top = max(values.max() ?? 1, 1)
        GeometryReader { g in
            if line {
                Path { p in
                    for (i, v) in values.enumerated() {
                        let pt = CGPoint(x: g.size.width * CGFloat(i) / CGFloat(max(values.count - 1, 1)), y: g.size.height * (1 - v / top))
                        i == 0 ? p.move(to: pt) : p.addLine(to: pt)
                    }
                }
                .stroke(Color.amber, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                .widgetAccentable()
            } else {
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(Array(values.enumerated()), id: \.offset) { _, v in
                        RoundedRectangle(cornerRadius: 2.5).fill(Color.amber).frame(height: max(3, g.size.height * v / top)).frame(maxWidth: .infinity).widgetAccentable()
                    }
                }
            }
        }
        .frame(minHeight: 36)
    }
}

extension Color {
    static let amber = Color(Palette.amber)
}
