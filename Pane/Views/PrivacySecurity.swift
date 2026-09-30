import SwiftUI

/// What Amber Notes does with your data, in short. The same facts as
/// ambernotes.app/privacy-security, kept here in one place so they change together when the
/// product does (full end-to-end encryption, for one). Only what's true today goes here.
enum PrivacyFacts {
    struct Fact: Identifiable, Equatable {
        var id: String { title }
        let symbol: String
        let title: String
        let detail: String
        var link: URL? = nil
    }

    static let page = URL(string: "https://ambernotes.app/privacy-security")!
    static let source = URL(string: "https://github.com/emilwagman/amber-notes")!

    static let intro = "Private by design: no ads and no tracking. AI apps can read your notes only if you approve them."

    static let all: [Fact] = [
        Fact(symbol: "eye.slash",
             title: "No ads, no tracking, no analytics.",
             detail: "The app counts a few things on our own server, like how many notes an AI changed each day, to improve Amber Notes. It's never shared or sold."),
        Fact(symbol: "building.columns",
             title: "Stored in the EU.",
             detail: "Your notes are kept in Frankfurt, Germany, and are encrypted in transit and at rest."),
        Fact(symbol: "lock",
             title: "Locked notes are end-to-end encrypted.",
             detail: "Only you can read them, with your notes password."),
        Fact(symbol: "sparkles",
             title: "AI apps see your notes only if you approve them.",
             detail: "Choose Read Only, and disconnect at any time. Every AI change keeps a version you can restore."),
        Fact(symbol: "chevron.left.forwardslash.chevron.right",
             title: "Open source.",
             detail: "Anyone can check how it works.",
             link: source),
    ]
}

/// Settings → Privacy & Security: the facts, then what you can do about your data.
struct PrivacySecurityView: View {
    let backend: Backend
    let sync: SyncEngine?

    var body: some View {
        Form {
            Section {
                Text(PrivacyFacts.intro)
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("privacy.intro")
                ForEach(PrivacyFacts.all) { FactRow(fact: $0) }
            } footer: {
                Link("Learn More", destination: PrivacyFacts.page)
                    .tint(Color(PColor.paneAccent))
                    .frame(minHeight: 24)
                    .accessibilityIdentifier("privacy.learnMore")
            }
            if case .signedIn = backend.state {
                Section {
                    ExportDataButton(backend: backend, sync: sync)
                } header: {
                    Text("Your Data")
                } footer: {
                    Text("A zip of your notes as Markdown and JSON, with folders, the list of your files, earlier versions, AI connections and your profile.")
                }
                Section {
                    DeleteAccountButton(backend: backend)
                } footer: {
                    Text("Deletes your account and everything in it, on our servers and on this device.")
                }
            }
        }
        .formStyle(.grouped)
        #if os(iOS)
        .navigationTitle("Privacy & Security")
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct FactRow: View {
    let fact: PrivacyFacts.Fact

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(fact.title)
                Text(fact.detail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let link = fact.link {
                    Link("View the Source Code", destination: link)
                        .font(.callout)
                        .tint(Color(PColor.paneAccent))
                        .frame(minHeight: 24)
                }
            }
        } icon: {
            // One column for every symbol, so the text lines up.
            Image(systemName: fact.symbol)
                .foregroundStyle(Color(PColor.paneAccent))
                .frame(width: 24)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Export My Data: syncs what's waiting, asks the server for the zip, then a save dialog.
struct ExportDataButton: View {
    let backend: Backend
    let sync: SyncEngine?
    @State private var working = false
    @State private var archive: DataExport.Archive?
    @State private var saving = false
    @State private var outcome: Outcome?

    enum Outcome: Equatable { case saved(String), failed(String) }

    var body: some View {
        Button {
            Task { await export() }
        } label: {
            HStack(spacing: 8) {
                Text(working ? "Preparing Your Export…" : "Export My Data…")
                if working { ProgressView().controlSize(.small) }
            }
        }
        .disabled(working)
        .accessibilityIdentifier("settings.exportData")
        .fileExporter(isPresented: $saving,
                      document: archive.map { ExportArchiveDocument(data: $0.data) },
                      contentType: .zip,
                      defaultFilename: archive?.filename) { result in
            switch result {
            case .success(let url): outcome = .saved(url.lastPathComponent)
            case .failure(let error as CocoaError) where error.code == .userCancelled: outcome = nil
            case .failure: outcome = .failed("Couldn't save the export. Try another place.")
            }
            archive = nil
        }
        switch outcome {
        case .saved(let name):
            Label("Saved \(name).", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.callout)
                .accessibilityIdentifier("settings.exportSaved")
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .font(.callout)
                .accessibilityIdentifier("settings.exportError")
        case nil:
            EmptyView()
        }
    }

    private func export() async {
        working = true
        outcome = nil
        defer { working = false }
        // What you just wrote belongs in the export: send it first.
        await sync?.sync()
        do {
            archive = try await backend.exportData()
            saving = true
        } catch let failure as DataExport.Failure {
            outcome = .failed(failure.message)
        } catch {
            outcome = .failed(DataExport.fallbackMessage)
        }
    }
}

/// The Settings entry: a row that opens the screen (a sheet in the Mac's Settings window,
/// which has no navigation stack).
struct PrivacySecurityLink: View {
    let backend: Backend
    let sync: SyncEngine?
    #if os(macOS)
    @State private var showing = false
    #endif

    var body: some View {
        Section {
            #if os(macOS)
            LabeledContent("Privacy & Security") {
                Button("Show…") { showing = true }
                    .accessibilityIdentifier("settings.privacySecurity")
            }
            .sheet(isPresented: $showing) {
                VStack(spacing: 0) {
                    PrivacySecurityView(backend: backend, sync: sync)
                    Divider()
                    HStack {
                        Spacer()
                        Button("Done") { showing = false }
                            .keyboardShortcut(.defaultAction)
                    }
                    .padding(12)
                }
                .frame(width: 480, height: 600)
            }
            #else
            NavigationLink {
                PrivacySecurityView(backend: backend, sync: sync)
            } label: {
                Label("Privacy & Security", systemImage: "hand.raised")
            }
            .accessibilityIdentifier("settings.privacySecurity")
            #endif
        } footer: {
            Text("No ads, no tracking. Export or delete your data.")
        }
    }
}
