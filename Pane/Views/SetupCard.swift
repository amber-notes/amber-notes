import Supabase
import SwiftUI

/// "Get set up" at the top of the note list for a new account: one thing at a time.
/// A progress bar of three segments on top (steps you've done fill in), then only the step
/// to do now: a short title, one line, one button. The xmark hides it for good.
struct SetupCard: View {
    let progress: SetupProgress
    let celebrating: Bool
    /// Mac: opens the Apple Notes picker. nil on iPhone, which can't read Apple Notes.
    var onImport: (() -> Void)?
    let onStartFresh: () -> Void
    let onConnect: () -> Void
    /// iPhone: how to share notes one by one from Notes.
    var onShareHowTo: (() -> Void)?
    let onHide: () -> Void

    @State private var copied = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let prompt = "Add \"Call mom\" to my to-do list in Amber Notes"

    /// What the card shows: a step, or the moment after your AI's first edit.
    private enum Page: Hashable { case step(SetupProgress.Step), done }
    private var page: Page { celebrating ? .done : progress.current.map(Page.step) ?? .done }

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.gap) {
            HStack(spacing: 12) {
                bar
                if !celebrating { closeButton }
            }
            content
                .id(page)
                .transition(stepTransition)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(Metrics.padding)
        .modifier(SetupCardSurface())
        .clipped()
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .smooth(duration: 0.35), value: page)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityTitle)
        .accessibilityIdentifier("setup.card")
    }

    /// The next step slides in from the side as the last one leaves; with Reduce Motion it cross-fades.
    private var stepTransition: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                              removal: .move(edge: .leading).combined(with: .opacity))
    }

    private var doneCount: Int { SetupProgress.Step.allCases.filter(progress.isDone).count }

    private var accessibilityTitle: String {
        celebrating ? "Get set up, done" : "Get set up, step \(min(doneCount + 1, 3)) of 3"
    }

    // MARK: Progress

    /// Three segments: done ones filled with the accent, the current one half-strength, later ones empty.
    private var bar: some View {
        HStack(spacing: 4) {
            ForEach(SetupProgress.Step.allCases, id: \.self) { step in
                Capsule()
                    .fill(fill(for: step))
                    .frame(height: 4)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel("\(doneCount) of 3 steps done")
    }

    private func fill(for step: SetupProgress.Step) -> AnyShapeStyle {
        if celebrating || progress.isDone(step) { return AnyShapeStyle(.tint) }
        if progress.current == step { return AnyShapeStyle(.tint.opacity(0.35)) }
        return AnyShapeStyle(.fill.secondary)
    }

    private var closeButton: some View {
        Button(action: onHide) {
            Image(systemName: "xmark")
                .font(.system(size: Metrics.closeGlyph, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: Metrics.closeSize, height: Metrics.closeSize)
                .background(.fill.tertiary, in: .circle)
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
    private var content: some View {
        switch page {
        case .done:
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(.tint)
                    .symbolEffect(.bounce, value: celebrating)
                text("That was your AI.", "It added \u{201C}Call mom\u{201D} to your To-do note.")
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("setup.celebration")
        case .step(let step):
            VStack(alignment: .leading, spacing: Metrics.gap) {
                text(title(step), line(step))
                actions(step)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("setup.step\(step.rawValue)")
        }
    }

    private func text(_ title: String, _ line: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(Metrics.title)
            Text(line).font(Metrics.line).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func title(_ step: SetupProgress.Step) -> String {
        switch step {
        case .bring: "Bring your notes"
        case .connect: "Connect your AI"
        case .tryIt: "Try it"
        }
    }

    private func line(_ step: SetupProgress.Step) -> String {
        switch step {
        case .bring:
            onImport != nil ? "Import from Apple Notes, all or some." : "Import on your Mac, or share one by one."
        case .connect:
            #if os(iOS)
            "Add it in ChatGPT or Claude, then approve it."
            #else
            "ChatGPT or Claude. You approve it here."
            #endif
        case .tryIt:
            "Ask your AI to add \u{201C}Call mom\u{201D} to To-do."
        }
    }

    @ViewBuilder
    private func actions(_ step: SetupProgress.Step) -> some View {
        HStack(spacing: 12) {
            switch step {
            case .bring:
                if let onImport {
                    primary("Import from Apple Notes…", id: "setup.import", action: onImport)
                } else if let onShareHowTo {
                    primary("Share from Notes", id: "setup.shareHowTo", action: onShareHowTo)
                }
                Button("Start Fresh", action: onStartFresh)
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("setup.fresh")
            case .connect:
                #if os(iOS)
                primary("Show Me How", id: "setup.connect", action: onConnect)
                #else
                primary("Connect an AI…", id: "setup.connect", action: onConnect)
                #endif
            case .tryIt:
                primary(copied ? "Copied" : "Copy Prompt", id: "setup.copy", action: copy)
            }
        }
        .font(Metrics.button)
    }

    private func primary(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
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

    /// Mac: 13 pt like the rows under it. iPhone: the list's own type sizes.
    private enum Metrics {
        #if os(macOS)
        static let title = Font.system(size: 13, weight: .semibold)
        static let line = Font.system(size: 12)
        static let button = Font.system(size: 13)
        static let padding: CGFloat = 12
        static let gap: CGFloat = 10
        static let closeSize: CGFloat = 18
        static let closeGlyph: CGFloat = 8
        static let closeSlop: CGFloat = 4
        #else
        static let title = Font.headline
        static let line = Font.subheadline
        static let button = Font.body.weight(.semibold)
        static let padding: CGFloat = 0
        static let gap: CGFloat = 12
        static let closeSize: CGFloat = 24
        static let closeGlyph: CGFloat = 10
        static let closeSlop: CGFloat = 10
        #endif
    }
}

/// Mac: a quiet rounded fill inside the list's margins, like a selected row at rest. iPhone:
/// nothing here; the card sits in its own grouped section, which draws the ground, insets and radius.
private struct SetupCardSurface: ViewModifier {
    func body(content: Content) -> some View {
        #if os(macOS)
        content.background(.fill.quinary, in: .rect(cornerRadius: 10, style: .continuous))
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
