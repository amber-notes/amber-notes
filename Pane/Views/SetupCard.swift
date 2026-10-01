import Supabase
import SwiftUI

/// "Get set up" at the top of the note list for a new account: one thing at a time.
/// A bar of three segments on top, then only the step to do now: a short title, one line, one
/// button. Finishing a step fills its segment green and pops a check before the next step slides
/// in; after the last one, a check draws itself ("You're all set") and the card goes.
struct SetupCard: View {
    let progress: SetupProgress
    let celebrating: Bool
    /// Mac: opens the Apple Notes picker. nil on iPhone, which can't read Apple Notes.
    var onImport: (() -> Void)?
    /// Opens an import from files (Evernote, Markdown…), on the Mac and iPhone.
    var onImportFrom: ((ImportKind) -> Void)?
    let onStartFresh: () -> Void
    let onConnect: () -> Void
    /// iPhone: how to share notes one by one from Notes.
    var onShareHowTo: (() -> Void)?
    let onHide: () -> Void

    @State private var copied = false
    /// The Import Notes choice is open.
    @State private var choosingSource = false
    /// The page on screen, which trails `page` while a finished step plays out.
    @State private var shown: Page?
    /// Segments drawn green; they fill as steps finish.
    @State private var filled: Set<SetupProgress.Step> = []
    @State private var popping = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let prompt = "Add \"Call mom\" to my to-do list in Amber Notes"

    /// What the card shows: a step, or the finish after your AI's first edit.
    enum Page: Hashable { case step(SetupProgress.Step), done }
    private var page: Page { celebrating ? .done : progress.current.map(Page.step) ?? .done }
    private var done: Set<SetupProgress.Step> {
        celebrating ? Set(SetupProgress.Step.allCases) : Set(SetupProgress.Step.allCases.filter(progress.isDone))
    }

    var body: some View {
        let showing = shown ?? page
        VStack(alignment: .leading, spacing: Metrics.gap) {
            HStack(spacing: 12) {
                bar(showing)
                if showing != .done { closeButton }
            }
            content(showing)
                // The finished step steps back while its check pops.
                .opacity(popping ? 0.12 : 1)
                .id(showing)
                .transition(stepTransition)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .leading) { if popping { pop } }
        }
        .padding(Metrics.padding)
        .clipped()
        .modifier(SetupCardSurface())
        .onAppear { filled = done; shown = page }
        .onChange(of: page) { _, new in advance(to: new) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(showing == .done ? "Get set up, done" : "Get set up, step \(min(done.count + 1, 3)) of 3")
        .accessibilityIdentifier("setup.card")
    }

    /// A step finished: its segment fills green, a check pops, then the next step slides in.
    /// With Reduce Motion it's one cross-fade.
    private func advance(to new: Page) {
        let finished = done.subtracting(filled)
        guard !reduceMotion else {
            withAnimation(.easeInOut(duration: 0.25)) { filled = done; shown = new }
            return
        }
        withAnimation(.easeOut(duration: 0.35)) { filled = done }
        guard !finished.isEmpty, new != .done else {
            withAnimation(.spring(duration: 0.5, bounce: 0.15)) { shown = new }
            return
        }
        withAnimation(.spring(duration: 0.35, bounce: 0.45)) { popping = true }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.55))
            withAnimation(.easeOut(duration: 0.15)) { popping = false }
            withAnimation(.spring(duration: 0.5, bounce: 0.15)) { shown = new }
        }
    }

    /// In: slides a little and fades up. Out: fades, barely moving.
    private var stepTransition: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(insertion: .opacity.combined(with: .offset(x: 28)),
                                              removal: .opacity.combined(with: .offset(x: -6)))
    }

    private var pop: some View {
        Image(systemName: "checkmark.circle.fill")
            .font(.system(size: Metrics.popSize, weight: .semibold))
            .foregroundStyle(.white, Color.green)
            .background(Circle().fill(Color.notePage).padding(-6))
            .transition(.scale(scale: 0.4).combined(with: .opacity))
            .accessibilityHidden(true)
    }

    // MARK: Progress

    /// Three segments: finished ones green (filling left to right), the current one amber, later ones empty.
    private func bar(_ showing: Page) -> some View {
        HStack(spacing: 4) {
            ForEach(SetupProgress.Step.allCases, id: \.self) { step in
                Capsule()
                    .fill(showing == .step(step) && !filled.contains(step) ? AnyShapeStyle(.tint) : AnyShapeStyle(.fill.secondary))
                    .overlay(alignment: .leading) {
                        GeometryReader { g in
                            Capsule().fill(Color.green)
                                .frame(width: filled.contains(step) ? g.size.width : 0)
                        }
                    }
                    .frame(height: 4)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel("\(filled.count) of 3 steps done")
    }

    private var closeButton: some View {
        Button(action: onHide) {
            Image(systemName: "xmark")
                .font(.system(size: Metrics.closeGlyph, weight: Metrics.closeWeight))
                .foregroundStyle(Metrics.closeStyle)
                .frame(width: Metrics.closeSize, height: Metrics.closeSize)
                #if os(iOS)
                .background(.fill.tertiary, in: .circle)
                #endif
                // A bigger target than it looks.
                .padding(Metrics.closeSlop)
                .contentShape(.rect)
                .padding(-Metrics.closeSlop)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Hide")
        .accessibilityHint("Hides these steps for good")
        .accessibilityIdentifier("setup.hide")
        #if os(macOS)
        .help("Hide")
        #endif
    }

    // MARK: The step

    @ViewBuilder
    private func content(_ showing: Page) -> some View {
        switch showing {
        case .done:
            HStack(alignment: .center, spacing: 10) {
                DrawnCheck(animated: !reduceMotion)
                    .frame(width: Metrics.popSize, height: Metrics.popSize)
                text("You\u{2019}re all set", Text("Your AI just added \u{201C}Call mom\u{201D} to To-do. Your notes are on your iPhone and Mac."))
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("setup.celebration")
        case .step(let step):
            VStack(alignment: .leading, spacing: Metrics.gap) {
                text(title(step), line(step), marks: step == .connect && !AIGlyph.storeSafe)
                actions(step)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("setup.step\(step.rawValue)")
        }
    }

    private func text(_ title: String, _ line: Text, marks: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(Metrics.title).foregroundStyle(Color.ink)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                if marks {
                    // ChatGPT and Claude, small, before the line (App Store captures show neither).
                    HStack(spacing: 3) {
                        AIGlyph(ai: "ChatGPT", size: Metrics.markSize)
                        AIGlyph(ai: "Claude", size: Metrics.markSize)
                    }
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
                }
                line.font(Metrics.line).foregroundStyle(Color.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func title(_ step: SetupProgress.Step) -> String {
        switch step {
        case .bring: "Bring your notes"
        case .connect: "Connect your AI"
        case .tryIt: "Try it"
        }
    }

    /// The same words on the Mac and iPhone; only the buttons differ.
    private func line(_ step: SetupProgress.Step) -> Text {
        switch step {
        case .bring:
            Text("Bring them in from \(Self.sources), all or just some.")
        case .connect:
            Text("Then ask it to add something to a note.")
        case .tryIt:
            Text("Ask your AI to add \u{201C}Call mom\u{201D} to To-do.")
        }
    }

    @ViewBuilder
    private func actions(_ step: SetupProgress.Step) -> some View {
        HStack(spacing: 12) {
            switch step {
            case .bring:
                // Side by side when there's room; the quiet one goes under when there isn't.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { bringButtons }
                    VStack(alignment: .leading, spacing: 6) { bringButtons }
                }
            case .connect:
                primary("Connect ChatGPT or Claude", id: "setup.connect", action: onConnect)
            case .tryIt:
                primary(copied ? "Copied" : "Copy Prompt", id: "setup.copy", action: copy)
            }
        }
        .font(Metrics.button)
    }

    /// Where notes can come from, for the step's line: "Apple Notes, Evernote or Markdown files".
    static var sources: String {
        let names = ["Apple Notes"] + ImportKind.allCases.map(\.sourceName)
        return names.dropLast().joined(separator: ", ") + " or " + names.last!
    }

    /// One choice: where your notes are. Apple Notes is read directly on the Mac and shared from
    /// Notes on iPhone; the rest come from files you exported.
    @ViewBuilder
    private var bringButtons: some View {
        primary("Import Notes…", id: "setup.import") { choosingSource = true }
            .popover(isPresented: $choosingSource, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    if let onImport {
                        choice("From Apple Notes…", symbol: "note.text") { onImport() }
                    } else if let onShareHowTo {
                        choice("From Apple Notes…", symbol: "note.text") { onShareHowTo() }
                    }
                    if let onImportFrom {
                        ForEach(ImportKind.allCases) { kind in
                            choice(kind.choiceTitle, symbol: kind.symbol) { onImportFrom(kind) }
                        }
                    }
                }
                .padding(6)
                .presentationCompactAdaptation(.popover)
            }
        Button("Start Fresh", action: onStartFresh)
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)
            .fixedSize()
            .accessibilityIdentifier("setup.fresh")
    }

    /// One place notes can come from, in the Import Notes choice.
    private func choice(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            choosingSource = false
            action()
        } label: {
            Label(title, systemImage: symbol)
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                .padding(.horizontal, 8)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("setup.import.\(symbol)")
    }

    /// Dark ink on amber: readable on the deeper light-mode amber and the brighter dark one.
    private func primary(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).foregroundStyle(Color(Palette.onAmber))
        }
            .buttonStyle(.borderedProminent)
            #if os(iOS)
            .buttonBorderShape(.capsule)
            #endif
            .fixedSize()
            .accessibilityIdentifier(id)
    }

    private func copy() {
        #if os(iOS)
        UIPasteboard.general.string = Self.prompt
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(Self.prompt, forType: .string)
        #endif
        withAnimation(.snappy(duration: 0.15)) { copied = true }
        Task {
            try? await Task.sleep(for: .seconds(2))
            withAnimation(.snappy(duration: 0.15)) { copied = false }
        }
    }

    /// Mac: 13 pt like the rows under it. iPhone: the list's own type sizes. The What's new card
    /// uses the same.
    enum Metrics {
        #if os(macOS)
        static let title = Font.system(size: 13, weight: .semibold)
        static let line = Font.system(size: 12)
        static let button = Font.system(size: 13)
        static let padding: CGFloat = 12
        static let gap: CGFloat = 10
        // A plain, light xmark with a 24 pt target.
        static let closeSize: CGFloat = 16
        static let closeGlyph: CGFloat = 10
        static let closeWeight = Font.Weight.medium
        static let closeStyle = HierarchicalShapeStyle.tertiary
        static let closeSlop: CGFloat = 4
        static let popSize: CGFloat = 22
        static let markSize: CGFloat = 12
        #else
        static let title = Font.headline
        static let line = Font.subheadline
        static let button = Font.body.weight(.semibold)
        static let padding: CGFloat = 0
        static let gap: CGFloat = 12
        static let closeSize: CGFloat = 24
        static let closeGlyph: CGFloat = 10
        static let closeWeight = Font.Weight.semibold
        static let closeStyle = HierarchicalShapeStyle.secondary
        static let closeSlop: CGFloat = 10
        static let popSize: CGFloat = 28
        static let markSize: CGFloat = 15
        #endif
    }
}

/// A green circle with a check that draws itself in, stroke by stroke.
struct DrawnCheck: View {
    var animated = true
    @State private var drawn: CGFloat = 0

    var body: some View {
        ZStack {
            Circle().trim(from: 0, to: drawn).rotation(.degrees(-90))
                .stroke(Color.green, style: StrokeStyle(lineWidth: 2, lineCap: .round))
            CheckShape().trim(from: 0, to: max(0, drawn * 1.6 - 0.6))
                .stroke(Color.green, style: StrokeStyle(lineWidth: 2.4, lineCap: .round, lineJoin: .round))
                .padding(6)
        }
        .onAppear {
            if animated { withAnimation(.easeOut(duration: 0.7).delay(0.1)) { drawn = 1 } } else { drawn = 1 }
        }
        .accessibilityHidden(true)
    }

    private struct CheckShape: Shape {
        func path(in r: CGRect) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: r.minX + r.width * 0.12, y: r.midY + r.height * 0.02))
            p.addLine(to: CGPoint(x: r.minX + r.width * 0.42, y: r.maxY - r.height * 0.18))
            p.addLine(to: CGPoint(x: r.maxX - r.width * 0.08, y: r.minY + r.height * 0.2))
            return p
        }
    }
}

/// Mac: the native control surface inside the list's margins, lifted by a soft layered shadow
/// (a tight contact shadow under a wide, faint one). iPhone: nothing here; the card sits in its
/// own grouped section, which draws the surface, insets and radius. The What's new card wears it too.
struct SetupCardSurface: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        content.background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color(nsColor: .controlBackgroundColor))
                .shadow(color: .black.opacity(0.06), radius: 0.5, y: 0.5)
                .shadow(color: Color(Palette.rgb(Palette.brown)).opacity(0.10), radius: 10, y: 4)
        }
        #else
        content
        #endif
    }
}

/// Connect an AI, on its own (from the setup card).
struct ConnectAISheet: View {
    let client: SupabaseClient
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form { ConnectAISection(client: client) }
                .formStyle(.grouped)
                .navigationTitle("Connect an AI")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
        }
        #if os(macOS)
        .frame(width: 520, height: 560)
        #endif
    }
}

#if os(iOS)
/// iPhone: how to send a note from Apple Notes into Amber Notes.
struct ShareHowToSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    step(1, "Open a note in Notes", "The Notes app, with the note you want to bring.")
                    step(2, "Tap Share", "The share button at the top, or ⋯ then Send a Copy.")
                    step(3, "Choose Amber Notes", "If it isn't in the row of apps, swipe to the end and tap More.")
                    step(4, "Tap Save", "The note appears in Amber Notes, formatting and photos included.")
                } footer: {
                    Text("To bring everything at once, use Import from Apple Notes in Amber Notes on your Mac. It syncs here a second later.")
                }
            }
            .navigationTitle("Share Notes One by One")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func step(_ n: Int, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(n)")
                .font(.callout.weight(.semibold)).monospacedDigit()
                .foregroundStyle(.tint)
                .frame(width: 24, height: 24)
                .background(.tint.opacity(0.15), in: .circle)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.semibold))
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
#endif
