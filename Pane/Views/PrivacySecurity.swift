import LocalAuthentication
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
import PDFKit
#endif

/// What Settings › Privacy & Security says, in one place.
enum PrivacyCopy {
    static let title = "Privacy & Security"
    static let summary = "Encrypted on your devices. We can't read your notes. When you connect an AI, our server unlocks your notes for that AI's requests."
    static let recoveryFooter = "Your recovery key opens your notes on a new device when none of your other devices is at hand."
    static let pageTitle = "Amber Notes recovery key"
    static let pageGuidance = "Keep this somewhere safe. With it, you can open your notes on a new device if you don't have your other devices."
    static let showReason = "Show your recovery key"
    static let saveReason = "Save your recovery key"
    static let fileName = "Amber Notes Recovery Key"
}

#if os(iOS)
/// Settings › Privacy & Security on iPhone, a page of its own.
struct PrivacySecurityView: View {
    let crypto: AccountCrypto

    var body: some View {
        Form { PrivacySecuritySection(crypto: crypto) }
            .formStyle(.grouped)
            .navigationTitle(PrivacyCopy.title)
            .navigationBarTitleDisplayMode(.inline)
    }
}
#endif

/// The encryption summary and the recovery key: shown behind Face ID or Touch ID (or the device
/// passcode), and saved by printing, as a PDF or by copying it.
struct PrivacySecuritySection: View {
    let crypto: AccountCrypto
    /// The recovery key while it's shown.
    @State private var shown: String?
    @State private var saving: String?
    @State private var problem: String?

    var body: some View {
        Section {
            Text(PrivacyCopy.summary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("privacy.summary")
        } header: {
            #if os(macOS)
            Text(PrivacyCopy.title)
            #endif
        }
        Section {
            LabeledContent("Recovery key") {
                Text(crypto.recoverySavedAt == nil ? "Not saved" : "Saved")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("privacy.recoveryStatus")
            }
            if let shown {
                Text(shown)
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                    .textSelection(.enabled)
                    .accessibilityIdentifier("privacy.recoveryKey")
                Button("Hide recovery key") { self.shown = nil }
                    .accessibilityIdentifier("privacy.hideRecovery")
            } else {
                Button("Show recovery key") { Task { await reveal(reason: PrivacyCopy.showReason) { shown = $0 } } }
                    .accessibilityIdentifier("privacy.showRecovery")
            }
            Button("Save a recovery key…") { Task { await reveal(reason: PrivacyCopy.saveReason) { saving = $0 } } }
                .accessibilityIdentifier("privacy.saveRecovery")
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(.red)
            }
        } footer: {
            Text(PrivacyCopy.recoveryFooter)
        }
        .sheet(item: Binding(get: { saving.map(RecoveryKeyItem.init) }, set: { saving = $0?.key })) { item in
            SaveRecoveryKeySheet(key: item.key) { await markSaved() }
        }
        .task { await crypto.recheck() }
        #if os(iOS)
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in shown = nil }
        #endif
        .onDisappear { shown = nil }
    }

    private func reveal(reason: String, then show: (String) -> Void) async {
        problem = nil
        guard let key = crypto.recoveryKeyText else { return }
        if await DeviceOwner.authenticate(reason: reason) { show(key) }
    }

    private func markSaved() async {
        do { try await crypto.markRecoveryKeySaved() } catch { problem = error.localizedDescription }
    }
}

private struct RecoveryKeyItem: Identifiable {
    let key: String
    var id: String { key }
}

/// Face ID, Touch ID or the device passcode (`deviceOwnerAuthentication`).
enum DeviceOwner {
    @MainActor static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // No passcode on this device: nothing to ask for.
            return (error as? LAError)?.code == .passcodeNotSet
        }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}

// MARK: Saving the recovery key

/// Print it, save it as a PDF, or copy it. Each one done counts as saved, on every device.
struct SaveRecoveryKeySheet: View {
    let key: String
    let saved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var exporting = false
    @State private var done: String?
    @State private var pdf: Data?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(key)
                        .font(.system(.title3, design: .monospaced).weight(.semibold))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .accessibilityIdentifier("recovery.key")
                } footer: {
                    Text(PrivacyCopy.pageGuidance)
                }
                Section {
                    Button("Print…", systemImage: "printer") { Task { if await RecoveryKeyPage.print(key) { await finished("Printed") } } }
                        .accessibilityIdentifier("recovery.print")
                    Button("Save as PDF…", systemImage: "doc") {
                        pdf = RecoveryKeyPage.pdf(key)
                        exporting = true
                    }
                        .accessibilityIdentifier("recovery.pdf")
                    Button("Copy", systemImage: "doc.on.doc") {
                        RecoveryKeyPage.copy(key)
                        Task { await finished("Copied") }
                    }
                    .accessibilityIdentifier("recovery.copy")
                } footer: {
                    if let done { Text(done) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Save a recovery key")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .fileExporter(isPresented: $exporting, document: pdf.map(PDFFile.init(data:)), contentType: .pdf,
                          defaultFilename: PrivacyCopy.fileName) { result in
                if case .success = result { Task { await finished("Saved as a PDF") } }
            }
        }
        #if os(macOS)
        .frame(width: 440, height: 620)
        #endif
    }

    private func finished(_ what: String) async {
        done = what + "."
        await saved()
    }
}

/// The page that's printed or saved: the key and one line of guidance, black on white.
struct RecoveryKeyPage: View {
    let key: String
    /// US Letter, in points; fits on A4 too.
    static let size = CGSize(width: 612, height: 792)

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            Text(PrivacyCopy.pageTitle)
                .font(.system(size: 26, weight: .heavy))
            Text(key)
                .font(.system(size: 24, weight: .semibold, design: .monospaced))
                .padding(.vertical, 18)
                .padding(.horizontal, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.black.opacity(0.3), lineWidth: 1))
            Text(PrivacyCopy.pageGuidance)
                .font(.system(size: 14))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Text(Date.now.formatted(date: .long, time: .omitted))
                .font(.system(size: 11))
                .foregroundStyle(.black.opacity(0.5))
        }
        .foregroundStyle(.black)
        .padding(64)
        .frame(width: Self.size.width, height: Self.size.height, alignment: .topLeading)
        .background(.white)
        .environment(\.colorScheme, .light)
    }

    @MainActor static func pdf(_ key: String) -> Data {
        let data = NSMutableData()
        let renderer = ImageRenderer(content: RecoveryKeyPage(key: key))
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            guard let consumer = CGDataConsumer(data: data as CFMutableData),
                  let pdf = CGContext(consumer: consumer, mediaBox: &box, nil) else { return }
            pdf.beginPDFPage(nil)
            draw(pdf)
            pdf.endPDFPage()
            pdf.closePDF()
        }
        return data as Data
    }

    /// The print panel with the page. True when it was printed.
    @MainActor static func print(_ key: String) async -> Bool {
        let data = pdf(key)
        #if os(iOS)
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo.printInfo()
        info.jobName = PrivacyCopy.fileName
        info.outputType = .grayscale
        controller.printInfo = info
        controller.printingItem = data
        return await withCheckedContinuation { done in
            controller.present(animated: true) { _, completed, _ in done.resume(returning: completed) }
        }
        #else
        guard let document = PDFDocument(data: data),
              let operation = document.printOperation(for: .shared, scalingMode: .pageScaleToFit, autoRotate: true) else { return false }
        operation.jobTitle = PrivacyCopy.fileName
        return operation.run()
        #endif
    }

    /// On the pasteboard, kept off other devices and marked as a secret for clipboard managers.
    @MainActor static func copy(_ key: String) {
        #if os(iOS)
        UIPasteboard.general.setItems([[UTType.plainText.identifier: key]], options: [.localOnly: true])
        #else
        let board = NSPasteboard.general
        board.clearContents()
        board.declareTypes([.string, NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")], owner: nil)
        board.setString(key, forType: .string)
        board.setString(key, forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
        #endif
    }
}

struct PDFFile: FileDocument {
    static let readableContentTypes: [UTType] = [.pdf]
    let data: Data

    init(data: Data) { self.data = data }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
