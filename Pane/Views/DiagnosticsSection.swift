import SwiftUI

/// The words for what the app reports about itself (Telemetry), in Settings and under the
/// sign-in form. docs/Technical/app-telemetry.md lists everything that's sent.
enum DiagnosticsCopy {
    static let title = "Share diagnostics and usage"
    static let footer = "Sends error and crash reports, how fast the app is, and a few counts such as “signed in” and “first sync”, linked to your account. Never your notes, their titles, file names or anything you type."
    /// Under the sign-in form, where an account is made.
    static let signIn = "The app sends error reports and a few usage counts, never your notes. You can turn this off in Settings."
}

/// Settings › General: one switch for everything the app reports about itself. Off, nothing is
/// kept or sent, and what was waiting to be sent is dropped.
struct DiagnosticsSection: View {
    @AppStorage(Telemetry.consentKey) private var share = true

    var body: some View {
        Section {
            Toggle(DiagnosticsCopy.title, isOn: Binding(get: { share }, set: { share = $0; Telemetry.shared.consent = $0 }))
                .accessibilityIdentifier("settings.diagnostics")
        } footer: {
            Text(DiagnosticsCopy.footer)
                .foregroundStyle(.secondary)
        }
    }
}
