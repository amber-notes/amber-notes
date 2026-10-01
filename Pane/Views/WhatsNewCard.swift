import SwiftUI

/// "New in 1.1" at the top of the note list after a major update: the release's title, a few
/// short lines, and two buttons. It wears the setup card's surface, type and spacing, and sits
/// where that card does, never alongside it.
struct WhatsNewCard: View {
    let release: WhatsNew.Release
    let secondary: WhatsNew.Secondary
    /// Off for snapshots, which draw the card at rest.
    var animated = true
    let onDismiss: () -> Void
    let onReconnect: () -> Void

    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL

    private typealias Metrics = SetupCard.Metrics

    var body: some View {
        // Still with Reduce Motion (or in a snapshot): it's simply there.
        let settled = appeared || reduceMotion || !animated
        VStack(alignment: .leading, spacing: Metrics.gap) {
            VStack(alignment: .leading, spacing: 2) {
                Text("New in \(release.version)")
                    .font(Metrics.line.weight(.medium))
                    .monospacedDigit()
                    .foregroundStyle(.tint)
                Text(release.title).font(Metrics.title).foregroundStyle(Color.ink)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 5) {
                ForEach(release.highlights ?? [], id: \.self) { line in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "circle.fill")
                            .font(.system(size: 5))
                            .foregroundStyle(.tint)
                            .accessibilityHidden(true)
                        Text(line)
                            .font(Metrics.line)
                            .monospacedDigit()
                            .foregroundStyle(Color.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            actions
                .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Metrics.padding)
        .modifier(SetupCardSurface())
        // In: rises a little and fades up. Out (the list removing the row): a plain fade.
        .opacity(settled ? 1 : 0)
        .offset(y: settled ? 0 : 10)
        .scaleEffect(settled ? 1 : 0.98, anchor: .top)
        .onAppear {
            guard animated, !reduceMotion else { return }
            withAnimation(.spring(duration: 0.45, bounce: 0.2)) { appeared = true }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("What's new in \(release.version)")
        .accessibilityIdentifier("whatsNew.card")
    }

    private var actions: some View {
        // Side by side when there's room; the quiet one goes under when there isn't.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { buttons }
            VStack(alignment: .leading, spacing: 6) { buttons }
        }
        .font(Metrics.button)
    }

    @ViewBuilder
    private var buttons: some View {
        // TODO: `.buttonStyle(.amberProminent)` once PR 96 is on main; until then the setup card's look.
        Button(action: onDismiss) {
            Text("Got it").foregroundStyle(Color(Palette.onAmber))
        }
        .buttonStyle(.borderedProminent)
        #if os(iOS)
        .buttonBorderShape(.capsule)
        #endif
        .fixedSize()
        .accessibilityIdentifier("whatsNew.dismiss")
        Group {
            switch secondary {
            case .reconnect:
                Button("Reconnect your AI", action: onReconnect)
                    .accessibilityIdentifier("whatsNew.reconnect")
            case .changelog:
                Button("See all changes") {
                    openURL(WhatsNew.changelogURL)
                    onDismiss()
                }
                .accessibilityIdentifier("whatsNew.changelog")
            }
        }
        .buttonStyle(.borderless)
        .foregroundStyle(.secondary)
        .fixedSize()
    }
}
