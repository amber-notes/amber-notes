import PhotosUI
import Supabase
import SwiftUI
import UniformTypeIdentifiers

/// The pages of Settings: toolbar tabs on the Mac, as in the system's apps, and rows that open a
/// page on iPhone.
enum SettingsTab: String, CaseIterable, Identifiable, Hashable {
    case general, account, ai, security, storage

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: "General"
        case .account: "Account"
        case .ai: "AI"
        case .security: PrivacyCopy.title
        case .storage: "Storage"
        }
    }

    var symbol: String {
        switch self {
        case .general: "gearshape"
        case .account: "person.crop.circle"
        case .ai: "sparkles"
        case .security: "lock.shield"
        case .storage: "externaldrive"
        }
    }
}

/// Account, sync status, the AIs connected to your notes, your devices and your storage.
struct SettingsView: View {
    let backend: Backend
    let sync: SyncEngine?
    var crypto: AccountCrypto = .shared
    var devices: KeyDevices = .shared
    /// Captures: shows these instead of asking the server.
    var connections: [Connection]? = nil
    var route: SettingsRoute = .shared
    @Environment(\.dismiss) private var dismiss
    #if os(iOS)
    @State private var path: [SettingsTab] = []
    @State private var addingDevice = false
    @State private var storage = StorageStore.shared
    #endif

    var body: some View {
        #if os(macOS)
        // A Mac Settings window: a tab per page, and the window takes each page's height.
        TabView(selection: Binding(get: { shown(route.tab) }, set: { route.tab = $0 })) {
            ForEach(tabs) { tab in
                Tab(tab.title, systemImage: tab.symbol, value: tab) { page(tab) }
            }
        }
        .environment(\.networkReach, reach)
        .onChange(of: isSignedIn) { was, now in if was && !now { dismiss() } }
        #else
        NavigationStack(path: $path) {
            root
                .navigationTitle("Settings")
                // Scrolled, the rows pass under a solid edge instead of showing through the title.
                .scrollEdgeEffectStyle(.hard, for: .top)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
                }
                .navigationDestination(for: SettingsTab.self) { tab in
                    page(tab)
                        .navigationTitle(tab.title)
                        .navigationBarTitleDisplayMode(.inline)
                }
        }
        .environment(\.networkReach, reach)
        .consentHost(client: backend.client, active: isSignedIn)
        // A link, a card or the storage warning opens Settings at its page.
        .onChange(of: route.target, initial: true) { _, target in
            guard let target else { return }
            if tabs.contains(target) { path = [target] }
            route.target = nil
        }
        .onChange(of: isSignedIn) { was, now in if was && !now { dismiss() } }
        #endif
    }

    private var isSignedIn: Bool {
        if case .signedIn = backend.state { return true }
        return false
    }

    /// Whether the server can be reached; signed out there's nothing that needs it.
    private var reach: SyncEngine.Reach { isSignedIn ? sync?.reach ?? .online : .online }

    private var demoStorage: Bool { ProcessInfo.processInfo.arguments.contains("-demoStorage") }

    /// The pages there is something on: signed out, only General and Account.
    var tabs: [SettingsTab] {
        SettingsTab.allCases.filter { tab in
            switch tab {
            case .general, .account: true
            case .ai: isSignedIn && backend.client != nil
            case .security: (isSignedIn && crypto.isReady) || NoteVault.shared.isSetUp
            case .storage: (isSignedIn && backend.client != nil) || demoStorage
            }
        }
    }

    /// The remembered tab, or General when that page isn't there now.
    private func shown(_ tab: SettingsTab) -> SettingsTab { tabs.contains(tab) ? tab : .general }

    @ViewBuilder
    func page(_ tab: SettingsTab) -> some View {
        switch tab {
        case .general:
            SettingsPage { GeneralSettings(signedIn: isSignedIn, close: { dismiss() }) }
        case .account:
            SettingsPage { AccountSettings(backend: backend, sync: sync) }
        case .ai:
            SettingsPage {
                if let client = backend.client {
                    ConnectAISection(client: client, preview: connections)
                    if NoteApps.enabled { AppPreviewSection(client: client) }
                }
            }
            .connectGuides(client: backend.client)
        case .security:
            SettingsPage {
                if isSignedIn, crypto.isReady {
                    PrivacySecuritySection(crypto: crypto, devices: devices, addDeviceServer: backend.client.map { SupabaseAddDevice(client: $0) })
                }
                LockedNotesSection(sync: sync)
            }
        case .storage:
            SettingsPage {
                if isSignedIn, let client = backend.client {
                    StorageSection(client: client)
                } else {
                    // Captures without an account.
                    StorageSectionBody(usage: StorageStore.shared.usage)
                }
            }
        }
    }

    #if os(iOS)
    /// You first, like the Apple Account at the top of Settings, then a row per page.
    private var root: some View {
        Form {
            OfflineSection()
            if case .signedIn(let email) = backend.state {
                Section {
                    NavigationLink(value: SettingsTab.account) {
                        AccountRow(backend: backend, email: backend.displayEmail ?? email)
                    }
                    .accessibilityIdentifier("settings.account")
                }
            } else if backend.state == .disabled {
                Section {
                    Text("Sync is off. This build keeps notes on this device only.")
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                ForEach(tabs.filter { $0 == .ai || $0 == .security }) { row($0) }
                if tabs.contains(.security), isSignedIn, crypto.isReady {
                    // A new device's screen says Settings › Security › Add a device; here it's one tap.
                    Button { addingDevice = true } label: {
                        Label(AddDeviceCopy.sheetTitle, systemImage: "plus.circle")
                    }
                    .accessibilityIdentifier("settings.addDevice")
                    .disabled(reach != .online)
                    .sheet(isPresented: $addingDevice) {
                        AddDeviceSheet(crypto: crypto, server: backend.client.map { SupabaseAddDevice(client: $0) })
                            .onDisappear { Task { await devices.refresh(crypto) } }
                    }
                }
                if tabs.contains(.storage) { row(.storage) }
            }
            Section { row(.general) }
        }
        .formStyle(.grouped)
        .task(id: isSignedIn) { await storage.refresh(backend.client, force: false) }
    }

    private func row(_ tab: SettingsTab) -> some View {
        NavigationLink(value: tab) {
            if tab == .storage, let usage = storage.usage {
                LabeledContent {
                    Text(usage.summary).monospacedDigit()
                } label: {
                    Label(tab.title, systemImage: tab.symbol)
                }
            } else {
                Label(tab == .ai ? "Connect an AI" : tab.title, systemImage: tab.symbol)
            }
        }
        .accessibilityIdentifier("settings.\(tab.rawValue)")
    }
    #endif
}

/// One page of Settings: a grouped form. On the Mac the window takes the page's own height, so
/// no page scrolls at its normal size.
private struct SettingsPage<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        Form {
            #if os(macOS)
            // Every tab has something that needs the server; iPhone says it on the first screen.
            OfflineSection()
            #endif
            content
        }
            .formStyle(.grouped)
            #if os(macOS)
            .frame(width: SettingsLayout.width)
            .background(NoInitialFocus())
            #endif
    }
}

/// At the top of Settings while the server can't be reached: what still works and what waits.
private struct OfflineSection: View {
    @Environment(\.networkReach) private var reach

    var body: some View {
        if reach != .online {
            Section {
                Label(OfflineCopy.settings, systemImage: OfflineCopy.symbol(reach))
                    .foregroundStyle(Color.muted)
                    .accessibilityIdentifier("settings.offline")
            }
        }
    }
}

#if os(macOS)
/// A page opens with nothing focused. AppKit hands a window's keyboard to its first text field
/// when the window becomes key or a tab's page comes in, which put a caret in your name, ready
/// for a stray keystroke. Clicking a field still focuses it.
private struct NoInitialFocus: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { Resigner() }
    func updateNSView(_ nsView: NSView, context: Context) {}

    final class Resigner: NSView {
        private var keyObserver: NSObjectProtocol?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let keyObserver { NotificationCenter.default.removeObserver(keyObserver) }
            keyObserver = nil
            guard let window else { return }
            resignSoon()
            // Only the first time the window becomes key: later the focus is the person's own.
            keyObserver = NotificationCenter.default.addObserver(forName: NSWindow.didBecomeKeyNotification, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.resignSoon()
                    if let o = self?.keyObserver { NotificationCenter.default.removeObserver(o) }
                    self?.keyObserver = nil
                }
            }
        }

        /// After AppKit and SwiftUI have placed their focus, on the next pass and once more a
        /// moment later (SwiftUI can place it a pass late): a text field's editor gives it up.
        private func resignSoon() {
            for delay in [0, 0.15] {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                    guard let window = self?.window, window.firstResponder is NSText else { return }
                    window.makeFirstResponder(nil)
                }
            }
        }
    }
}
#endif

private enum SettingsLayout {
    static let width: CGFloat = 520
}

/// General: the menu bar item (on iPhone, the setup guide), API keys for apps in notes, the
/// diagnostics switch, and about.
private struct GeneralSettings: View {
    let signedIn: Bool
    let close: () -> Void

    var body: some View {
        #if os(macOS)
        MenuBarSection()
        #else
        if signedIn {
            // On the Mac this is Help › Show Setup Guide.
            Section {
                Button("Show Setup Guide") {
                    NotificationCenter.default.post(name: .paneShowSetupGuide, object: nil)
                    close()
                }
                .accessibilityIdentifier("settings.setupGuide")
            } footer: {
                Text("Shows the Get set up steps at the top of your notes again.")
            }
        }
        #endif
        if NoteApps.enabled { APIKeysSection() }
        DiagnosticsSection()
        AboutSection()
    }
}

/// Account: you, sync, how you sign in, exporting your notes, and signing out last, apart, as in
/// System Settings.
private struct AccountSettings: View {
    let backend: Backend
    let sync: SyncEngine?
    @State private var confirmSignOut = false

    var body: some View {
        if case .signedIn(let email) = backend.state {
            ProfileSection(backend: backend, email: backend.displayEmail ?? email)
            Section {
                // The status and its action on one row, like iCloud in System Settings.
                LabeledContent("Sync") {
                    HStack(spacing: 10) {
                        SyncStatusLabel(status: sync?.status ?? .idle)
                        Button("Sync Now") { Task { await sync?.sync() } }
                            .controlSize(.small)
                            .accessibilityIdentifier("settings.syncNow")
                    }
                }
                AppleIDRow(backend: backend)
            }
            // Next to Delete Account, which says to export first.
            Section {
                ExportNotesButton()
            } footer: {
                Text(PrivacyCopy.exportFooter)
            }
            Section {
                Button(role: .destructive) { confirmSignOut = true } label: { Text("Sign Out…").foregroundStyle(.red) }
                    .accessibilityIdentifier("settings.signOut")
                    // Settings closes once you're signed out.
                    .confirmationDialog("Sign out of Pinto Notes?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                        Button("Sign Out", role: .destructive) { Task { await backend.signOut() } }
                    } message: {
                        Text("Your notes stay in your account and come back when you sign in again.")
                    }
                DeleteAccountButton(backend: backend)
            }
        } else if backend.state == .disabled {
            // Only a build without a backend.
            Section {
                Text("Sync is off. This build keeps notes on this device only.")
                    .foregroundStyle(.secondary)
            }
        } else {
            Section {
                Text("Sign in to sync your notes across your iPhone and Mac.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

#if os(iOS)
/// Settings' first row on iPhone: your photo, name and email, opening Account.
private struct AccountRow: View {
    let backend: Backend
    let email: String
    @State private var profile = ProfileStore.shared

    var body: some View {
        HStack(spacing: 14) {
            AvatarView(photo: profile.photo, name: profile.name ?? email, size: 56)
            VStack(alignment: .leading, spacing: 2) {
                Text(profile.name ?? "Your Name")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(profile.name == nil ? .secondary : .primary)
                Text(email)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(.vertical, 4)
        .task(id: backend.state) { await profile.bind(backend) }
    }
}
#endif

/// Your photo, name and email, and the controls to change the first two.
private struct ProfileSection: View {
    let backend: Backend
    let email: String
    @State private var profile = ProfileStore.shared
    @State private var draft = ""
    @FocusState private var editing: Bool
    @State private var importing = false
    #if os(iOS)
    @State private var picked: PhotosPickerItem?
    #endif

    var body: some View {
        Section {
            HStack(spacing: 16) {
                AvatarView(photo: profile.photo, name: profile.name ?? email, size: 64)
                    #if os(macOS)
                    .dropDestination(for: URL.self) { urls, _ in
                        guard let url = urls.first, let data = try? Data(contentsOf: url) else { return false }
                        Task { await profile.setPhoto(data) }
                        return true
                    }
                    #endif
                VStack(alignment: .leading, spacing: 2) {
                    TextField("Name", text: $draft, prompt: Text("Your Name"))
                        .labelsHidden()
                        .textFieldStyle(.plain)
                        .multilineTextAlignment(.leading)
                        .font(.title3.weight(.semibold))
                        .focused($editing)
                        .onSubmit(commit)
                        .accessibilityLabel("Name")
                        .accessibilityIdentifier("settings.profileName")
                    Text(email)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
            }
            .padding(.vertical, 4)
            HStack(spacing: 10) {
                #if os(iOS)
                PhotosPicker(profile.photo == nil ? "Choose Photo…" : "Change Photo…", selection: $picked, matching: .images)
                    .accessibilityIdentifier("settings.choosePhoto")
                #else
                Button(profile.photo == nil ? "Choose Photo…" : "Change Photo…") { importing = true }
                    .accessibilityIdentifier("settings.choosePhoto")
                #endif
                if profile.photo != nil {
                    Button("Remove Photo", role: .destructive) { Task { await profile.removePhoto() } }
                        .accessibilityIdentifier("settings.removePhoto")
                }
                if profile.working { ProgressView().controlSize(.small) }
            }
            if let problem = profile.problem {
                Text(problem).font(.footnote).foregroundStyle(.secondary)
            }
        } footer: {
            Text("Shown in the app and on notes you share.")
        }
        .onAppear { draft = profile.name ?? "" }
        .onChange(of: profile.name) { _, new in if !editing { draft = new ?? "" } }
        .onChange(of: editing) { _, now in if !now { commit() } }
        .onChange(of: draft) { _, new in if new.count > ProfileName.maxLength { draft = String(new.prefix(ProfileName.maxLength)) } }
        .task(id: backend.state) { await profile.bind(backend) }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .heic, .image]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            Task { await profile.setPhoto(data) }
        }
        #if os(iOS)
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) { await profile.setPhoto(data) }
                picked = nil
            }
        }
        #endif
    }

    private func commit() {
        Task { await profile.setName(draft) }
    }
}

/// Sign in with Apple for this account: connect it once, then Apple is how you sign in.
private struct AppleIDRow: View {
    let backend: Backend
    @State private var working = false
    @State private var error: String?

    var body: some View {
        if let apple = backend.apple {
            LabeledContent("Sign in with Apple") {
                Label(apple.email ?? "Connected", systemImage: "checkmark.circle.fill")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("settings.appleConnected")
        } else {
            // A settings row: what it is on the left, the standard Apple button on the right.
            LabeledContent {
                AppleAuthButton(label: .continue, height: 30, title: "Continue with Apple", web: webLink) { result in
                    switch result {
                    case .success(let credential): link(credential)
                    case .failure(let failure): error = AppleSignIn.message(for: failure)
                    }
                }
                .frame(width: 190)
                .disabled(working)
                .accessibilityIdentifier("settings.connectApple")
            } label: {
                Text("Sign in with Apple")
                Text(error ?? "Sign in on every device without a password.")
                    .foregroundStyle(error == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
            }
        }
    }

    /// The Mac download links your Apple ID on the web (see AppleAuthButton.web).
    private var webLink: (@MainActor () -> Void)? {
        #if DIRECT
        return {
            working = true
            error = nil
            Task {
                do { try await backend.linkAppleOnTheWeb() } catch where !Backend.isCanceled(error) {
                    self.error = Backend.appleMessage(for: error, linking: true)
                } catch {}
                working = false
            }
        }
        #else
        return nil
        #endif
    }

    private func link(_ credential: AppleSignIn.Credential) {
        working = true
        error = nil
        Task {
            do { try await backend.linkApple(credential) } catch { self.error = Backend.appleMessage(for: error, linking: true) }
            working = false
        }
    }
}

struct SyncStatusLabel: View {
    let status: SyncEngine.Status
    var body: some View {
        switch status {
        case .idle: Text("Waiting").foregroundStyle(.secondary)
        case .syncing: HStack(spacing: 6) { ProgressView().controlSize(.mini); Text("Syncing…") }
        case .synced(let d): Text("Syncing to your iPhone and Mac · \(Self.when(d))").foregroundStyle(.secondary)
        // No network isn't a problem to fix: said plainly. Refusals and the like stay orange.
        case .offline(let why): Text(why).foregroundStyle(why == SyncEngine.describe(URLError(.notConnectedToInternet)) ? AnyShapeStyle(.secondary) : AnyShapeStyle(.orange))
        }
    }

    /// "just now" for the last minute, then the time.
    static func when(_ d: Date, now: Date = .now) -> String {
        now.timeIntervalSince(d) < 60 ? "just now" : "last synced \(d.formatted(date: .omitted, time: .shortened))"
    }
}

#if os(macOS)
/// Amber Notes in the menu bar, on by default.
private struct MenuBarSection: View {
    @AppStorage(MenuBarSettings.key) private var show = true

    var body: some View {
        Section {
            Toggle("Show in menu bar", isOn: $show)
                .accessibilityIdentifier("settings.menuBar")
        } header: {
            Text("Menu Bar")
        } footer: {
            Text("Capture a note or find one from the menu bar, even with the window closed.")
                .foregroundStyle(.secondary)
        }
    }
}
#endif

/// About › Open source: three quiet links to the code on GitHub, and the terms and privacy
/// policy under them. Nothing here ever asks.
struct AboutSection: View {
    static let links: [(title: String, url: URL, id: String)] = [
        ("Star on GitHub", ShareAsk.repository, "settings.github"),
        ("Report an issue", ShareAsk.newIssue, "settings.reportIssue"),
        ("Contribute", ShareAsk.contributing, "settings.contribute"),
    ]

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                Text("Open source")
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) { links(separated: true) }
                    VStack(alignment: .leading, spacing: 4) { links(separated: false) }
                }
                .font(.footnote)
                .tint(Color(PColor.paneAccent))
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("settings.openSource")
        } header: {
            Text("About")
        } footer: {
            LegalLinksRow()
        }
    }

    @ViewBuilder private func links(separated: Bool) -> some View {
        ForEach(Array(Self.links.enumerated()), id: \.offset) { i, link in
            if separated && i > 0 {
                Text("\u{00B7}").foregroundStyle(.tertiary).accessibilityHidden(true)
            }
            Link(link.title, destination: link.url)
                .frame(minHeight: 24)
                .accessibilityIdentifier(link.id)
        }
    }
}
