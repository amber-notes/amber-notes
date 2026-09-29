import SwiftUI

/// The app's icon, drawn small inside the app. On light backgrounds the amber reads darker
/// than it does in the Dock or a browser tab, so it's lifted a touch there; on dark ones a
/// faint hairline keeps its corners crisp.
struct AppMark: View {
    var size: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous)
        let light = colorScheme == .light
        Image("MarkTight")
            .resizable()
            .interpolation(.high)
            .antialiased(true)
            .scaledToFit()
            .frame(width: size, height: size)
            .brightness(light ? 0.06 : 0)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.primary.opacity(light ? 0 : 0.08), lineWidth: 0.5))
            .shadow(color: .black.opacity(light ? 0.06 : 0.10), radius: size * 0.04, y: size * 0.02)
            .accessibilityHidden(true)
    }
}
