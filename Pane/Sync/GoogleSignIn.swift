import SwiftUI

/// Google's sign-in button, drawn to Google's branding guidelines
/// (developers.google.com/identity/branding-guidelines): the full-colour "G" at its own
/// proportions, the standard wording, and Google's light and dark colours with their 1 pt
/// border. Its height, corners and title size are the form's (`SignInView.Row`), so it reads
/// as one family with Sign in with Apple above it.
struct GoogleAuthButton: View {
    var title = "Sign in with Google"
    var height: CGFloat = 44
    var cornerRadius: CGFloat = 8
    let action: () -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var isEnabled

    /// Google's colours for the button, light and dark.
    struct Colors: Equatable {
        var fill: UInt32
        var stroke: UInt32
        var label: UInt32

        static let light = Colors(fill: 0xFFFFFF, stroke: 0x747775, label: 0x1F1F1F)
        static let dark = Colors(fill: 0x131314, stroke: 0x8E918F, label: 0xE3E3E3)
    }

    static func colors(_ scheme: ColorScheme) -> Colors { scheme == .dark ? .dark : .light }

    /// The logo's side: Google's 18 pt on its 40 pt button, scaled with the row and never smaller.
    static func logoSize(height: CGFloat) -> CGFloat { max(16, (height * 0.42).rounded()) }

    var body: some View {
        let colors = Self.colors(scheme)
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        Button(action: action) {
            HStack(spacing: Self.logoGap) {
                Image("GoogleG")
                    .resizable()
                    .interpolation(.high)
                    .aspectRatio(1, contentMode: .fit)
                    .frame(width: Self.logoSize(height: height), height: Self.logoSize(height: height))
                    .accessibilityHidden(true)
                Text(title)
                    .font(AmberProminentButtonStyle.rowTitle(height: height))
                    .foregroundStyle(Color(Palette.rgb(colors.label)))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: height, maxHeight: height)
            .background(Color(Palette.rgb(colors.fill)), in: shape)
            .overlay(shape.strokeBorder(Color(Palette.rgb(colors.stroke)), lineWidth: 1))
            .contentShape(shape)
        }
        .buttonStyle(PressScale())
        .opacity(isEnabled ? 1 : 0.6)
        .accessibilityLabel(title)
    }

    /// Between the logo and the words: Google's 12 pt on iPhone, 10 on the Mac's smaller row.
    #if os(macOS)
    static let logoGap: CGFloat = 10
    #else
    static let logoGap: CGFloat = 12
    #endif
}
