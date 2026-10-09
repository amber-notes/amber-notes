import SwiftUI

/// Amber Notes' terms and privacy policy, on the share site.
enum Legal {
    static let terms = URL(string: "https://ambernotes.app/terms")!
    static let privacy = URL(string: "https://ambernotes.app/privacy")!

    /// "By continuing, you agree to the Terms of Service and Privacy Policy." with both names as links.
    static var consentSentence: AttributedString {
        var s = AttributedString("By continuing, you agree to the ")
        var t = AttributedString("Terms of Service"); t.link = terms
        var p = AttributedString("Privacy Policy"); p.link = privacy
        s += t; s += AttributedString(" and "); s += p; s += AttributedString(".")
        return s
    }
}

/// The quiet line under the sign-in form. One sentence for VoiceOver, with its two links.
struct ConsentFooter: View {
    var body: some View {
        Text(Legal.consentSentence)
            .font(.footnote)
            .foregroundStyle(Color.muted)
            .tint(Color(PColor.paneAccent))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4) // a taller tap area for the links
            .accessibilityIdentifier("signin.legal")
    }
}

/// "Terms of Service · Privacy Policy" for Settings › General, under About.
struct LegalLinksRow: View {
    var body: some View {
        HStack(spacing: 6) {
            Link("Terms of Service", destination: Legal.terms)
                .accessibilityIdentifier("settings.terms")
            Text("·").foregroundStyle(.tertiary).accessibilityHidden(true)
            Link("Privacy Policy", destination: Legal.privacy)
                .accessibilityIdentifier("settings.privacy")
        }
        .font(.footnote)
        .tint(Color(PColor.paneAccent))
        .buttonStyle(.hoverLink)
        .frame(maxWidth: .infinity, minHeight: 24)
    }
}
