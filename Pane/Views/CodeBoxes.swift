import SwiftUI

/// The confirmation code as six boxes in two groups of three ("1 2 3 - 4 5 6"). One real text
/// field under the boxes takes the input, so typing, backspace, paste ("123456" or "123 456")
/// and iOS's one-time-code suggestion all work as in any field; the boxes only draw it.
/// VoiceOver reads the field: "Verification code", and the digits so far.
struct CodeBoxes: View {
    @Binding var code: String
    var focus: FocusState<SignInView.Field?>.Binding
    var disabled = false
    /// Bumped on a wrong or expired code: the boxes shake once.
    var shakes = 0
    var onSubmit: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    nonisolated static let length = EmailSignInFlow.codeLength

    /// What each box shows, and which box is next (nil when all six are filled).
    nonisolated static func slots(_ code: String) -> (digits: [Character?], active: Int?) {
        let chars = Array(code.prefix(length))
        let digits = (0..<length).map { $0 < chars.count ? chars[$0] : nil }
        return (digits, chars.count < length ? chars.count : nil)
    }

    var body: some View {
        let (digits, active) = Self.slots(code)
        let focused = focus.wrappedValue == .code
        ZStack {
            // The field that takes the input: as big as the boxes so a click or tap anywhere
            // on them focuses it, and nearly transparent so its own text and caret don't show.
            TextField("", text: $code)
                .textContentType(.oneTimeCode)
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .autocorrectionDisabled()
                .focused(focus, equals: .code)
                .submitLabel(.go)
                .onSubmit(onSubmit)
                .disabled(disabled)
                .textFieldStyle(.plain)
                .foregroundStyle(.clear)
                .tint(.clear)
                .opacity(0.02)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel("Verification code")
                .accessibilityValue(code.isEmpty ? "Empty" : code.map(String.init).joined(separator: " "))
                .accessibilityIdentifier("signin.code")

            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { box($0, digits[$0], active: focused && active == $0) }
                Text("-")
                    .font(.system(size: SignInView.Row.text + 6, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Color.muted)
                ForEach(3..<6, id: \.self) { box($0, digits[$0], active: focused && active == $0) }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .frame(height: Self.boxHeight)
        .contentShape(.rect)
        .onTapGesture { focus.wrappedValue = .code }
        .modifier(Shake(amount: reduceMotion ? 0 : CGFloat(shakes)))
        .animation(reduceMotion ? nil : .linear(duration: 0.4), value: shakes)
        .opacity(disabled ? 0.6 : 1)
    }

    #if os(macOS)
    static let boxHeight: CGFloat = 48
    #else
    static let boxHeight: CGFloat = 56
    #endif

    /// One box: the field's white with a warm hairline, the amber ring on the next one to fill.
    private func box(_ i: Int, _ digit: Character?, active: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: SignInView.Row.radius, style: .continuous)
        return Text(digit.map(String.init) ?? " ")
            .font(.system(size: SignInView.Row.text + 10, weight: .semibold, design: .monospaced))
            .foregroundStyle(Color.ink)
            .frame(maxWidth: .infinity)
            .frame(height: Self.boxHeight)
            .background(Color(Palette.field), in: shape)
            .overlay(shape.strokeBorder(active ? Color(Palette.amber) : Color(Palette.fieldHairline), lineWidth: active ? 2 : 1))
            .animation(.easeOut(duration: 0.12), value: active)
            .animation(.snappy(duration: 0.15), value: digit)
    }
}

/// A gentle no: three side-to-side swings that settle, about 6 points at most. Animating
/// `amount` from n to n + 1 plays it once.
struct Shake: GeometryEffect {
    var amount: CGFloat
    var animatableData: CGFloat {
        get { amount }
        set { amount = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        let t = amount - amount.rounded(.down)
        let x = 6 * (1 - t) * sin(t * .pi * 6)
        return ProjectionTransform(CGAffineTransform(translationX: x, y: 0))
    }
}
