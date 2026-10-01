import SwiftUI

/// The app's primary button: a capsule of the deeper amber with a bold white label, the same in
/// light and dark (the system's prominent style takes the dark-mode amber, under which white
/// text reads at about 2:1). Presses dip, keyboard focus shows a ring, disabled fades like the
/// system's, and an iPhone target is at least 44 pt tall.
///
///     Button("Done") { … }.buttonStyle(.amberProminent)
struct AmberProminentButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        AmberProminentButton(configuration: configuration)
    }

    /// The fill and the label's colour, for the contrast test.
    static let fill = Palette.amberButton
    static let label = PColor.white
}

extension ButtonStyle where Self == AmberProminentButtonStyle {
    static var amberProminent: AmberProminentButtonStyle { .init() }
}

private struct AmberProminentButton: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.isFocused) private var isFocused
    @Environment(\.controlSize) private var controlSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        configuration.label
            .font(font)
            .foregroundStyle(Color(AmberProminentButtonStyle.label))
            .lineLimit(1)
            .padding(.horizontal, horizontalPadding)
            .frame(minHeight: minHeight)
            .background {
                Capsule()
                    .fill(Color(AmberProminentButtonStyle.fill))
                    .overlay { if configuration.isPressed { Capsule().fill(.black.opacity(0.14)) } }
            }
            .overlay {
                if isFocused {
                    Capsule().inset(by: -3).strokeBorder(focusRing, lineWidth: 3)
                }
            }
            .contentShape(Capsule())
            .opacity(isEnabled ? 1 : 0.42)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
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
