import SwiftUI

/// The app's primary button: the deeper amber with a bold white label, the same in light and dark
/// (the system's prominent style takes the dark-mode amber, under which white text reads at about
/// 2:1). Presses dip, keyboard focus shows a ring, disabled turns a quiet warm grey with muted
/// text, and an iPhone target is at least 44 pt tall. A destructive button (`Button(role: .destructive)`) is the deeper
/// red instead. Two shapes:
///
///     Button("Done") { … }.buttonStyle(.amberProminent)                        // a capsule
///     Button("Sign In") { … }.buttonStyle(.amberProminent(height: 44, cornerRadius: 12))  // a full-width row
///
/// `.amberBusy(true)` swaps the label for a spinner of the same size, so nothing moves.
struct AmberProminentButtonStyle: ButtonStyle {
    /// A full-width row of this height and corner radius (forms), or nil for a capsule.
    var row: (height: CGFloat, cornerRadius: CGFloat)? = nil

    func makeBody(configuration: Configuration) -> some View {
        AmberProminentButton(configuration: configuration, row: row)
    }

    /// The fills and the label's colour, for the contrast test.
    static let fill = Palette.amberButton
    static let destructiveFill = Palette.destructiveButton
    static let label = PColor.white
    static let disabledFill = Palette.disabledButton
    static let disabledLabel = Palette.disabledButtonLabel

    /// A full-width row's title: the size Sign in with Apple draws at the same height, so the
    /// form's buttons read as one family (Apple's button sizes its title from its height).
    static func rowTitle(height: CGFloat) -> Font {
        #if os(macOS)
        .system(size: (height * 0.39).rounded(), weight: .semibold)
        #else
        // Measured on iOS 26: at 48 pt the native button's title is 18 pt medium.
        .system(size: (height * 0.375).rounded(), weight: .medium)
        #endif
    }
}

extension ButtonStyle where Self == AmberProminentButtonStyle {
    static var amberProminent: AmberProminentButtonStyle { .init() }
    static func amberProminent(height: CGFloat, cornerRadius: CGFloat) -> AmberProminentButtonStyle { .init(row: (height, cornerRadius)) }
}

private struct AmberBusyKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var amberBusy: Bool {
        get { self[AmberBusyKey.self] }
        set { self[AmberBusyKey.self] = newValue }
    }
}

extension View {
    /// Shows an amber primary button's spinner in place of its label (and says so to VoiceOver).
    func amberBusy(_ busy: Bool) -> some View {
        environment(\.amberBusy, busy)
    }
}

private struct AmberProminentButton: View {
    let configuration: ButtonStyleConfiguration
    let row: (height: CGFloat, cornerRadius: CGFloat)?
    @Environment(\.amberBusy) private var busy
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.isFocused) private var isFocused
    @Environment(\.controlSize) private var controlSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.hoverPreview) private var preview
    @State private var hovering = false

    var body: some View {
        let shape: AnyShape = row.map { AnyShape(RoundedRectangle(cornerRadius: $0.cornerRadius, style: .continuous)) } ?? AnyShape(Capsule())
        // A busy button stays solid: it's working, not unavailable.
        let off = !isEnabled && !busy
        let fill = off ? AmberProminentButtonStyle.disabledFill
            : configuration.role == .destructive ? AmberProminentButtonStyle.destructiveFill : AmberProminentButtonStyle.fill
        return configuration.label
            .font(row.map { AmberProminentButtonStyle.rowTitle(height: $0.height) } ?? font)
            .foregroundStyle(Color(off ? AmberProminentButtonStyle.disabledLabel : AmberProminentButtonStyle.label))
            .lineLimit(1)
            // Busy: the label keeps its place (so nothing moves) and a spinner sits on it.
            .opacity(busy ? 0 : 1)
            .overlay { if busy { AmberSpinner(reduceMotion: reduceMotion) } }
            .padding(.horizontal, horizontalPadding)
            .frame(maxWidth: row == nil ? nil : .infinity)
            .frame(minHeight: row?.height ?? minHeight, maxHeight: row?.height)
            .background {
                shape
                    .fill(Color(fill))
                    // Under the pointer a touch lighter; pressed, darker.
                    .overlay {
                        if configuration.isPressed { shape.fill(.black.opacity(0.14)) }
                        else if !off && (hovering || preview.contains("*")) { shape.fill(.white.opacity(0.12)) }
                    }
            }
            .overlay {
                if isFocused {
                    shape.stroke(focusRing, lineWidth: 3).padding(-1.5)
                }
            }
            .contentShape(shape)
            .modifier(HoverTracking(hovering: $hovering))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
            .accessibilityValue(busy ? Text("Working") : Text(""))
    }

    private var focusRing: Color {
        #if os(macOS)
        Color(nsColor: .keyboardFocusIndicatorColor)
        #else
        Color(Palette.amberButton).opacity(0.5)
        #endif
    }

    #if os(macOS)
    private var font: Font { controlSize == .large || controlSize == .extraLarge ? .system(size: 14, weight: .bold) : .system(size: 13, weight: .bold) }
    private var minHeight: CGFloat {
        switch controlSize {
        case .mini, .small: 22
        case .large, .extraLarge: 32
        default: 26
        }
    }
    private var horizontalPadding: CGFloat { controlSize == .large || controlSize == .extraLarge ? 18 : 14 }
    #else
    private var font: Font { .body.bold() }
    private var minHeight: CGFloat { controlSize == .large || controlSize == .extraLarge ? 50 : 44 }
    private var horizontalPadding: CGFloat { 20 }
    #endif
}

/// The busy button's spinner: a white arc that turns (the Mac's own spinner draws grey, and dimmed
/// in a disabled button). With Reduce Motion it holds still.
private struct AmberSpinner: View {
    let reduceMotion: Bool

    var body: some View {
        TimelineView(.animation(paused: reduceMotion)) { context in
            let turn = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 0.9) / 0.9
            Circle()
                .trim(from: 0, to: 0.72)
                .stroke(Color(AmberProminentButtonStyle.label), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .frame(width: 14, height: 14)
                .rotationEffect(.degrees(turn * 360))
        }
        .accessibilityHidden(true)
    }
}
