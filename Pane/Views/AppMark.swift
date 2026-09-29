import SwiftUI

/// The app's icon, drawn small inside the app. The amber tile holds its own on light
/// backgrounds; a faint hairline keeps its corners crisp on dark ones.
struct AppMark: View {
    var size: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous)
        Image("MarkTight")
            .resizable()
            .interpolation(.high)
            .antialiased(true)
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.10), radius: size * 0.04, y: size * 0.02)
            .accessibilityHidden(true)
    }
}
