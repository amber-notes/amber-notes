import SwiftUI

/// The app's icon, drawn small inside the app. The white page needs an edge on light
/// backgrounds, so it gets the hairline and soft shadow app icons get in Finder.
struct AppMark: View {
    var size: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous)
        Image("MarkTight")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.primary.opacity(0.16), lineWidth: size < 32 ? 0.5 : 1))
            .shadow(color: .black.opacity(0.14), radius: size * 0.05, y: size * 0.025)
            .accessibilityHidden(true)
    }
}
