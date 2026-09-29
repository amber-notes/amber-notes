import Supabase
import SwiftUI

/// "Get set up": three steps at the top of the note list for a new account.
/// Done steps fold to a tick, the step to do next shows its buttons, later ones wait quietly.
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

    static let prompt = "Add \"Call mom\" to my to-do list in Amber Notes"

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Get set up").font(.headline)
                if !celebrating {
                    Text("\(SetupProgress.Step.allCases.filter(progress.isDone).count) of 3")
                        .font(.subheadline).monospacedDigit().foregroundStyle(.secondary)
                }
                Spacer()
                if !celebrating {
                    Button("Hide", action: onHide)
                        .buttonStyle(.borderless)
                        .font(.subheadline)
                        .accessibilityHint("Hides these steps for good")
                        .accessibilityIdentifier("setup.hide")
                }
            }
            if celebrating {
                celebration
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(SetupProgress.Step.allCases, id: \.self) { step in
                        row(step)
                    }
                }
            }
        }
        .padding(16)
        .modifier(SetupCardSurface())
        .animation(.smooth(duration: 0.3), value: progress)
        .animation(.smooth(duration: 0.3), value: celebrating)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Get set up")
        .accessibilityIdentifier("setup.card")
    }

    private var celebration: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.title2)
                .foregroundStyle(.tint)
                .symbolEffect(.bounce, value: celebrating)
            VStack(alignment: .leading, spacing: 2) {
                Text("That was your AI.").font(.body.weight(.semibold))
                Text("It just added to your To-do note. Ask it anything about your notes.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("setup.celebration")
    }

    private func row(_ step: SetupProgress.Step) -> some View {
        let done = progress.isDone(step)
        let isCurrent = progress.current == step
        return HStack(alignment: .top, spacing: 12) {
            marker(step, done: done, current: isCurrent)
            VStack(alignment: .leading, spacing: 6) {
                Text(title(step))
                    .font(.body.weight(isCurrent ? .semibold : .regular))
                    .foregroundStyle(done || isCurrent ? .primary : .secondary)
                if isCurrent { detail(step) }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Step \(step.rawValue) of 3, \(title(step))\(done ? ", done" : "")")
        .accessibilityIdentifier("setup.step\(step.rawValue)")
    }

    private func marker(_ step: SetupProgress.Step, done: Bool, current: Bool) -> some View {
        ZStack {
            Circle()
                .fill(done ? AnyShapeStyle(.tint) : AnyShapeStyle(.clear))
            Circle()
                .strokeBorder(done ? AnyShapeStyle(.clear) : (current ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary)), lineWidth: 1.5)
            if done {
                Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
            } else {
                Text("\(step.rawValue)").font(.caption.weight(.semibold)).monospacedDigit()
                    .foregroundStyle(current ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
            }
        }
        .frame(width: 22, height: 22)
        .accessibilityHidden(true)
    }

    private func title(_ step: SetupProgress.Step) -> String {
        switch step {
        case .bring: "Bring your notes"
        case .connect: "Connect your AI"
        case .tryIt: "Try it"
        }
    }

    @ViewBuilder
    private func detail(_ step: SetupProgress.Step) -> some View {
        switch step {
        case .bring:
            if let onImport {
                Text("Import from Apple Notes, all at once or the ones you choose.")
                    .font(.subheadline).foregroundStyle(.secondary)
                // Side by side when the list is wide enough, stacked when it isn't: never cut off.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { importButton(onImport); freshButton }
                    VStack(alignment: .leading, spacing: 8) { importButton(onImport); freshButton }
                }
            } else {
                Text("Open Amber Notes on your Mac and import everything from Apple Notes. Your notes appear here a second later.")
                    .font(.subheadline).foregroundStyle(.secondary)
                HStack(spacing: 10) {
                    if let onShareHowTo {
                        Button("Share Notes One by One", action: onShareHowTo)
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("setup.shareHowTo")
                    }
                    Button("Start Fresh", action: onStartFresh)
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("setup.fresh")
                }
            }
        case .connect:
            #if os(iOS)
            Text("Connect on your Mac or on the web: ChatGPT and Claude sign in there, and you approve it here.")
                .font(.subheadline).foregroundStyle(.secondary)
            Button("See How", action: onConnect)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("setup.connect")
            #else
            Text("ChatGPT or Claude. It takes a minute, and you approve it here.")
                .font(.subheadline).foregroundStyle(.secondary)
            Button("Connect an AI…", action: onConnect)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("setup.connect")
            #endif
        case .tryIt:
            tryIt
        }
    }

    /// The prompt as a message you'd send, like the chat in the website's demo.
    @ViewBuilder
    private var tryIt: some View {
        Text("Ask your AI:")
            .font(.subheadline).foregroundStyle(.secondary)
        HStack(alignment: .bottom, spacing: 8) {
            Spacer(minLength: 24)
            Text(Self.prompt)
                .font(.callout)
                .textSelection(.enabled)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.fill.tertiary, in: .rect(cornerRadius: 16, style: .continuous))
        }
        Button(copied ? "Copied" : "Copy Prompt", systemImage: copied ? "checkmark" : "doc.on.doc") { copy() }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("setup.copy")
        Text("Then watch it appear in your To-do note, tinted amber.")
            .font(.subheadline).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func importButton(_ action: @escaping () -> Void) -> some View {
        Button("Import from Apple Notes…", action: action)
            .buttonStyle(.borderedProminent)
            .fixedSize()
            .accessibilityIdentifier("setup.import")
    }

    private var freshButton: some View {
        Button("Start Fresh", action: onStartFresh)
            .buttonStyle(.bordered)
            .fixedSize()
            .accessibilityIdentifier("setup.fresh")
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
}

/// The card's ground: the page colour on soft layered shadows, like the website's cards.
private struct SetupCardSurface: ViewModifier {
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        content
            .background(Color.notePage, in: shape)
            .overlay(shape.strokeBorder(.separator.opacity(0.35), lineWidth: 0.5))
            .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.10), radius: 14, y: 8)
            .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.06), radius: 1.5, y: 1)
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
