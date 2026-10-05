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
    static let recoveryFooter = "A recovery key opens your notes on a new device when none of your other devices is at hand. If every device is gone and you saved no recovery key, your notes are lost. We can\u{2019}t open them either."
    static let pageTitle = "Amber Notes recovery key"
    static let pageGuidance = "Keep this somewhere safe. With it, you can open your notes on a new device if you don't have your other devices."
    static let keyHeader = "Where your key is kept"
    static let keyFooter = "Without one of these, nobody can open your notes, including us. A connected AI can read them while it\u{2019}s connected."
    static var thisDevice: String { "This \(InstallID.kind)" }
    static var keptInKeychain: String { "Keeps your key in its Keychain, where iCloud Keychain can pick it up" }
    static var keptHere: String { "Keeps your key on this \(InstallID.kind) only" }
    static let keychainTitle = "iCloud Keychain"
    static let keychainDetail = "Brings your key to your other iPhone or Mac, if it\u{2019}s on for this Apple Account."
    static var safeTitle: String { "Safe if you lose this \(InstallID.kind)" }
    static func safeDetail(_ ways: Int) -> String {
        switch ways {
        case 1: "One other way can open your notes."
        case 2: "Two other ways can open your notes."
        case 3: "Three other ways can open your notes."
        default: "\(ways) other ways can open your notes."
        }
    }
    static let unconfirmedTitle = "Can\u{2019}t confirm a backup of your key"
    static let unconfirmedDetail = "Your key is backed up only if iCloud Keychain is on. Adding a device makes it safe."
    static let howToCheck = "How to check"
    #if os(macOS)
    static let howToCheckDetail = "System Settings \u{203A} [your name] \u{203A} iCloud \u{203A} Passwords & Keychain. Amber Notes can\u{2019}t see that setting."
    #else
    static let howToCheckDetail = "Settings \u{203A} [your name] \u{203A} iCloud \u{203A} Passwords & Keychain. Amber Notes can\u{2019}t see that setting."
    #endif
    static var onlyTitle: String { "Only this \(InstallID.kind) can open your notes" }
    static let onlyDetail = "If you lose it, your notes are lost. We can\u{2019}t open them either. Add another device to be safe."
    static let addDevice = "Add a device\u{2026}"
    static func removeTitle(_ name: String) -> String { "Remove \(name)?" }
    static let removeMessage = "It\u{2019}s signed out and its copy of your notes is erased the next time it\u{2019}s online. Notes on it that haven\u{2019}t synced are erased too. Anything it already showed could have been copied before that."
    static var removedTitle: String { "This \(InstallID.kind) was removed" }
    static let removedMessage = "Another of your devices removed it, so its copy of your notes was erased. To open them here again, sign in and add this device."
    static let showReason = "Show your recovery key"
    static let saveReason = "Save your recovery key"
    static let fileName = "Amber Notes Recovery Key"
    static let recoveryChangedTitle = "Your recovery key changed"
    static let recoveryChanged = "Your account started fresh on another device, so a recovery key you saved before no longer opens your notes. The new one is here."
    static let recoveryChangedAlert = "Your account started fresh on another device, so it has a new recovery key. If you keep one, the new one is in Settings › Privacy & Security."
    static let exportFooter = "Every note as a Markdown file in its folder, with its files. Your notes are encrypted, so the export is made on this device."
}

#if os(iOS)
/// Settings › Privacy & Security on iPhone, a page of its own.
struct PrivacySecurityView: View {
    let crypto: AccountCrypto
    var devices: KeyDevices = .shared
    var addDeviceServer: AddDeviceServer?

    var body: some View {
        Form { PrivacySecuritySection(crypto: crypto, devices: devices, addDeviceServer: addDeviceServer) }
            .formStyle(.grouped)
            .navigationTitle(PrivacyCopy.title)
            .navigationBarTitleDisplayMode(.inline)
    }
}
#endif

/// The encryption summary, where the key is kept (this device, iCloud Keychain, devices added,
/// and Add a device), and the recovery key, which is optional: shown behind Face ID or Touch ID
/// (or the device passcode), and saved by printing, as a PDF or by copying it.
struct PrivacySecuritySection: View {
    let crypto: AccountCrypto
    var devices: KeyDevices = .shared
    /// Adding a device talks to the server; nil in previews.
    var addDeviceServer: AddDeviceServer?
    /// The recovery key while it's shown.
    @State private var shown: String?
    @State private var saving: String?
    @State private var problem: String?
    @State private var adding = false
    @State private var removing: KeyDevice?
    @State private var showsHowToCheck = false
    @Environment(\.dynamicTypeSize) private var typeSize

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
        keySection
        Section {
            LabeledContent("Recovery key") {
                Text(recoveryStatus)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("privacy.recoveryStatus")
            }
            if crypto.recoveryKeyChanged {
                Label(PrivacyCopy.recoveryChanged, systemImage: "exclamationmark.triangle.fill")
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("privacy.recoveryChanged")
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
            // The sheet hangs on its button: on a Section it isn't presented on iPhone.
            Button("Save a recovery key…") { Task { await reveal(reason: PrivacyCopy.saveReason) { saving = $0 } } }
                .accessibilityIdentifier("privacy.saveRecovery")
                .sheet(item: Binding(get: { saving.map(RecoveryKeyItem.init) }, set: { saving = $0?.key })) { item in
                    SaveRecoveryKeySheet(key: item.key) { await markSaved() }
                }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(.red)
            }
        } footer: {
            // "Optional" only while something else is known to open the notes.
            Text((recoveryStatus == "Optional" ? "Optional. " : "") + PrivacyCopy.recoveryFooter)
        }
        WidgetPrivacySection()
        Section {
            ExportNotesButton()
        } footer: {
            Text(PrivacyCopy.exportFooter)
        }
        .task {
            await crypto.recheck()
            await devices.refresh(crypto)
        }
        #if os(iOS)
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in shown = nil }
        #endif
        .onDisappear { shown = nil }
    }

    // MARK: Where your key is kept

    private var keySection: some View {
        Section {
            safety
            keyRow(PrivacyCopy.thisDevice, crypto.backedUp ? PrivacyCopy.keptInKeychain : PrivacyCopy.keptHere,
                   symbol: InstallID.platform == "macos" ? "laptopcomputer" : "iphone", id: "privacy.thisDevice")
            if crypto.backedUp || devices.others.contains(where: { $0.backedUp && !$0.removing && $0.isRecent() }) {
                keyRow(PrivacyCopy.keychainTitle, PrivacyCopy.keychainDetail, symbol: "icloud", id: "privacy.keychain")
            }
            ForEach(devices.others) { d in
                keyRow(d.name, d.detail(), symbol: d.symbol, id: "privacy.device") {
                    if d.canRemove {
                        // The question hangs on the button that asked it.
                        Button("Remove\u{2026}", role: .destructive) { removing = d }
                            .accessibilityIdentifier("privacy.removeDevice")
                            .confirmationDialog(PrivacyCopy.removeTitle(d.name),
                                                isPresented: Binding(get: { removing?.id == d.id }, set: { if !$0 { removing = nil } }),
                                                titleVisibility: .visible) {
                                Button("Remove", role: .destructive) { Task { await remove(d) } }
                                    .accessibilityIdentifier("privacy.confirmRemove")
                            } message: {
                                Text(PrivacyCopy.removeMessage)
                            }
                    }
                }
            }
            // The sheet hangs on its button: on a Section it isn't presented.
            Button(PrivacyCopy.addDevice) { adding = true }
                .accessibilityIdentifier("privacy.addDevice")
                .sheet(isPresented: $adding) {
                    AddDeviceSheet(crypto: crypto, server: addDeviceServer)
                        .onDisappear { Task { await devices.refresh(crypto) } }
                }
        } header: {
            Text(PrivacyCopy.keyHeader)
        } footer: {
            Text(PrivacyCopy.keyFooter)
        }
    }

    /// One line on top. Green only on evidence: another device seen lately, or a saved recovery
    /// key. A key that's only stored for iCloud Keychain gets a plain "can't confirm". A key on
    /// this device alone gets the warning.
    @ViewBuilder private var safety: some View {
        // Before the list has loaded, nothing is claimed either way.
        if devices.loaded || crypto.recoveryKeySaved {
            switch devices.safety(crypto) {
            case .safe(let n):
                keyRow(PrivacyCopy.safeTitle, PrivacyCopy.safeDetail(n), symbol: "checkmark.circle.fill", tint: .green, id: "privacy.safe")
            case .unconfirmed:
                keyRow(PrivacyCopy.unconfirmedTitle, PrivacyCopy.unconfirmedDetail, symbol: "questionmark.circle", id: "privacy.unconfirmed")
                // Where to look, for those who want to: out of the way until asked for.
                if showsHowToCheck {
                    Text(PrivacyCopy.howToCheckDetail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("privacy.howToCheckDetail")
                } else {
                    Button(PrivacyCopy.howToCheck) { showsHowToCheck = true }
                        .font(.footnote)
                        .accessibilityIdentifier("privacy.howToCheck")
                }
            case .onlyThisDevice:
                keyRow(PrivacyCopy.onlyTitle, PrivacyCopy.onlyDetail, symbol: "exclamationmark.circle.fill", tint: .orange, id: "privacy.onlyThisDevice")
            }
        }
    }

    /// "Optional" is only said while something else is known to open the notes.
    private var recoveryStatus: String {
        if crypto.recoveryKeySaved { return "Saved" }
        if case .safe = devices.safety(crypto) { return "Optional" }
        return "Not saved"
    }

    private func keyRow(_ title: String, _ detail: String, symbol: String, tint: Color = .secondary, id: String) -> some View {
        keyRow(title, detail, symbol: symbol, tint: tint, id: id) { EmptyView() }
    }

    private func keyRow(_ title: String, _ detail: String, symbol: String, tint: Color = .secondary, id: String,
                        @ViewBuilder trailing: () -> some View) -> some View {
        // At the largest text sizes the glyph sits above the words and the action below them.
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6)) : AnyLayout(HStackLayout(spacing: 12))
        return layout {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(tint)
                .frame(minWidth: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            trailing()
        }
        // A container, so the button in it keeps its own identifier.
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(id)
    }

    private func remove(_ d: KeyDevice) async {
        problem = nil
        guard await DeviceOwner.authenticate(reason: "remove \(d.name)") else { return }
        do { try await devices.remove(d, crypto: crypto) } catch { problem = error.localizedDescription }
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
        #if DEBUG
        // UI tests run on a simulator with no passcode and no account (its key store is in memory):
        // nothing is asked there. Release builds always ask.
        if ProcessInfo.processInfo.arguments.contains("-uitest") { return true }
        #endif
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

/// Note page widgets (prototype): what a widget shows while the device is locked.
struct WidgetPrivacySection: View {
    @AppStorage(WidgetShared.hideOnLockKey, store: WidgetShared.defaults) private var hideOnLock = false

    var body: some View {
        Section {
            Toggle("Hide widget content on the Lock Screen", isOn: $hideOnLock)
                .accessibilityIdentifier("privacy.widgetHideOnLock")
                .onChange(of: hideOnLock) { NoteWidgets.reload() }
        } footer: {
            Text("Widgets show only what their page puts on them, never the whole note. With this on, they show a placeholder until you unlock.")
        }
    }
}
