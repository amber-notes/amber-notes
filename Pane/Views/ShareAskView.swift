import SwiftUI

/// "Enjoying Amber Notes?" (see `ShareAsk`): the app's mark, two lines, and three buttons.
/// A short sheet on iPhone, a small sheet on the Mac. Sharing opens the post in the browser and
/// turns the sheet into a thank-you, which goes by itself a few seconds after you come back.
struct ShareAskView: View {
    let store: ShareAskStore
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// You left for the post after choosing to share.
    @State private var returning = false

    var body: some View {
        Group {
            if store.thanked { thanks } else { ask }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, Metrics.padding)
        .padding(.top, Metrics.top)
        .padding(.bottom, Metrics.padding)
        #if os(macOS)
        .frame(width: 360)
        #endif
        // Back from the post: the thank-you holds a moment, then goes.
        .onChange(of: phase) { _, p in if store.thanked && p != .active { returning = true } }
        .task(id: returning && phase == .active) {
            guard returning, phase == .active else { return }
            try? await Task.sleep(for: .seconds(3.5))
            if !Task.isCancelled { store.visible = false }
        }
    }

    private var ask: some View {
        VStack(spacing: Metrics.gap) {
            AppMark(size: Metrics.mark)
            VStack(spacing: 6) {
                Text("Enjoying Amber Notes?")
                    .font(Metrics.title)
                    .accessibilityAddTraits(.isHeader)
                Text("I\u{2019}m building it on my own, and word of mouth is how people find it. If it\u{2019}s been useful, a post would mean a lot.")
                    .font(Metrics.line)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: Metrics.buttonGap) {
                share("Share on X", .sharedX, id: "shareAsk.x")
                    .buttonStyle(.borderedProminent)
                share("Share on LinkedIn", .sharedLinkedIn, id: "shareAsk.linkedin")
                    .buttonStyle(.bordered)
                Button { store.choose(.dismissed) } label: {
                    Text("Not now").frame(maxWidth: .infinity).frame(minHeight: Metrics.quietHeight)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("shareAsk.notNow")
            }
            .padding(.top, Metrics.buttonsTop)
        }
        .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.98)))
        .accessibilityIdentifier("shareAsk")
    }

    private func share(_ title: String, _ choice: ShareAsk.Choice, id: String) -> some View {
        Button {
            if let url = store.choose(choice) { openURL(url) }
        } label: {
            Text(title).frame(maxWidth: .infinity)
        }
        .controlSize(.large)
        #if os(iOS)
        .buttonBorderShape(.capsule)
        #endif
        .accessibilityIdentifier(id)
    }

    private var thanks: some View {
        VStack(spacing: Metrics.gap) {
            DrawnCheck(animated: !reduceMotion)
                .frame(width: Metrics.check, height: Metrics.check)
            VStack(spacing: 6) {
                Text("Thank you")
                    .font(Metrics.title)
                    .accessibilityAddTraits(.isHeader)
                Text("Every post helps someone find it.")
                    .font(Metrics.line)
                    .foregroundStyle(.secondary)
            }
            Button { store.visible = false } label: {
                Text("Done").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            #if os(iOS)
            .buttonBorderShape(.capsule)
            #endif
            .padding(.top, Metrics.buttonsTop)
            .accessibilityIdentifier("shareAsk.done")
        }
        .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.98)))
        .accessibilityIdentifier("shareAsk.thanks")
    }

    /// Mac: the system's sheet sizes. iPhone: the list's own type sizes.
    private enum Metrics {
        #if os(macOS)
        static let title = Font.system(size: 15, weight: .semibold)
        static let line = Font.system(size: 13)
        static let padding: CGFloat = 24
        static let top: CGFloat = 24
        static let gap: CGFloat = 14
        static let buttonGap: CGFloat = 8
        static let buttonsTop: CGFloat = 6
        static let quietHeight: CGFloat = 24
        static let mark: CGFloat = 52
        static let check: CGFloat = 44
        #else
        static let title = Font.title3.weight(.semibold)
        static let line = Font.subheadline
        static let padding: CGFloat = 24
        static let top: CGFloat = 32
        static let gap: CGFloat = 16
        static let buttonGap: CGFloat = 10
        static let buttonsTop: CGFloat = 4
        static let quietHeight: CGFloat = 44
        static let mark: CGFloat = 60
        static let check: CGFloat = 52
        #endif
    }
}

extension View {
    /// Shows the share ask over this view when the store says so; sized to fit on iPhone.
    func shareAskSheet(_ store: ShareAskStore) -> some View {
        modifier(ShareAskSheet(store: store))
    }
}

struct ShareAskSheet: ViewModifier {
    @Bindable var store: ShareAskStore
    #if os(macOS)
    /// Offscreen captures: draw controls as they look in your front window (the test host is
    /// never the active app, and a sheet doesn't take its window's environment).
    nonisolated(unsafe) static var drawsAsKey = false
    #endif
    @State private var height: CGFloat = 380

    func body(content: Content) -> some View {
        content.sheet(isPresented: $store.visible, onDismiss: store.closed) {
            ShareAskView(store: store)
                #if os(iOS)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self, of: \.size.height) { height = $0 }
                .presentationDetents([.height(height)])
                .presentationDragIndicator(.hidden)
                #endif
                .tint(Color(PColor.paneAccent))
                #if os(macOS)
                .modifier(DrawAsKey(on: Self.drawsAsKey))
                #endif
        }
    }
}

#if os(macOS)
private struct DrawAsKey: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.environment(\.controlActiveState, .key) } else { content }
    }
}
#endif
