import Supabase
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// Connect ChatGPT or Claude in as few moves as the two apps allow.
//
// Amber Notes is listed in Claude's connector directory (since 2 October 2026), so for Claude one
// button opens the listing and the person chooses Connect to Claude. Claude's install link for its
// Add custom connector dialog, with the name and address filled in, stays as the fallback for
// older Claude apps. ChatGPT has no such link: the button copies the address and opens ChatGPT's
// Plugins page. Both are added on the web or desktop, once; after that they work in the phone
// apps too. claude.ai doesn't hand /directory links to its iPhone app, so iPhone sends the link
// to the computer, as before. The steps stay
// in view (on a Mac, in a small window that floats over the browser), and the guide watches
// for the sign-in itself and says when it worked, with a first thing to ask.
//
// Sources: claude.ai/directory/amber-notes (the listing),
// claude.com/docs/connectors/building/directory-vs-custom (install link),
// developers.openai.com/api/docs/guides/developer-mode (ChatGPT: Plus and up, on the web).

// MARK: Pure pieces (tested)

/// What connecting one web AI takes, and where.
struct WebConnectPlan: Equatable {
    let ai: String
    /// True when the page opens on Amber Notes itself, so there's no address to paste.
    let prefills: Bool
    let steps: [String]
    /// Who can do it at all.
    let plans: String
    /// A first request that proves the connection, and where to ask it.
    let testPrompt: String
    let testPage: URL
    private let page: @Sendable (String) -> URL
    /// Another way to add it, for apps that don't show the main page: a line, a button, the page.
    var fallback: (line: String, button: String, page: @Sendable (String) -> URL)? = nil

    static func == (a: WebConnectPlan, b: WebConnectPlan) -> Bool { a.ai == b.ai }

    /// The most specific page that exists for adding Amber Notes.
    func setupPage(server: String) -> URL { page(server) }

    static func forAI(_ ai: String) -> WebConnectPlan? {
        switch ai {
        case "ChatGPT": chatgpt
        case "Claude": claude
        default: nil
        }
    }

    /// The page shows a code to scan; on a Mac it also opens Amber Notes here.
    #if os(macOS)
    static let allowStep = "Choose Open Pinto Notes on this Mac, or scan the code with your iPhone. Then choose Allow."
    #else
    static let allowStep = "Scan the code it shows with this iPhone, then choose Allow."
    #endif

    static let testPrompt = "Search my Pinto Notes and tell me what I wrote most recently."

    static let chatgpt = WebConnectPlan(
        ai: "ChatGPT",
        prefills: false,
        steps: [
            "Turn on Developer mode in Settings, Security and login (once).",
            "In Plugins, choose + and name it Pinto Notes.",
            "Paste the address, choose OAuth, then Create.",
            allowStep,
        ],
        plans: "Needs ChatGPT Plus, Pro, Business, Enterprise or Edu, on the web.",
        testPrompt: testPrompt,
        testPage: prefilled("https://chatgpt.com/", testPrompt),
        page: { _ in URL(string: "https://chatgpt.com/plugins")! })

    static let claude = WebConnectPlan(
        ai: "Claude",
        prefills: true,
        steps: [
            "Claude opens Amber Notes in its connector directory. Choose Connect to Claude.",
            allowStep,
        ],
        plans: "Amber Notes is in Claude's connector directory. On Team and Enterprise, an Owner may need to allow it first.",
        testPrompt: testPrompt,
        testPage: prefilled("https://claude.ai/new", testPrompt),
        page: { _ in directoryListing },
        fallback: (line: "Using an older Claude app, or it doesn't show Amber Notes? Add it as a custom connector instead. That works on every plan; Free includes one.",
                   button: "Add as Custom Connector",
                   page: installLink))

    /// Amber Notes in Claude's connector directory. Its Connect to Claude button adds it.
    static let directoryListing = URL(string: "https://claude.ai/directory/amber-notes")!

    /// Claude's documented install link: the Add custom connector dialog, prefilled. The person still confirms.
    static func installLink(server: String) -> URL {
        // Fully percent-encoded, as the link wants (URLComponents would leave ":" and "/" as they are).
        let encode = { (s: String) in s.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(.init(charactersIn: "-._~"))) ?? "" }
        return URL(string: "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=\(encode("Pinto Notes"))&connectorUrl=\(encode(server))")!
    }

    /// A new chat with the question typed in. Not documented by either app, so the question is
    /// also copied (see WebConnectGuide.tryIt).
    static func prefilled(_ page: String, _ prompt: String) -> URL {
        var c = URLComponents(string: page)!
        c.queryItems = [URLQueryItem(name: "q", value: prompt)]
        return c.url!
    }

    /// The steps as plain text, for sending to yourself.
    func message(server: String) -> String {
        var lines = ["Connect \(ai) to Pinto Notes (on a computer, once):", "", "1. Open \(setupPage(server: server).absoluteString)"]
        for (i, s) in steps.enumerated() { lines.append("\(i + 2). \(s)") }
        if !prefills { lines += ["", "Address:", server] }
        if let fallback { lines += ["", fallback.line, fallback.page(server).absoluteString] }
        lines += ["", "After that, Pinto Notes works in the \(ai) app on your phone too."]
        return lines.joined(separator: "\n")
    }
}

/// Handing the guide from iPhone to Mac with Handoff.
enum ConnectHandoff {
    static let activityType = "dev.emilwagman.pane.connect"
    static let key = "ai"
}

// MARK: Watching for the sign-in

/// Says when the new connection exists: at once when it's approved on this device, and by
/// asking the server every few seconds, so approving on the Mac also finishes the guide on iPhone.
@MainActor
@Observable
final class ConnectWatch {
    /// The name an approval on this device carries for this guide: the AI, or nil for an app
    /// Amber Notes can't vouch for (Incredible).
    let approvedAs: String?
    let since = Date.now.addingTimeInterval(-5)
    private(set) var connected: Connection?
    private(set) var approvedHere = false
    private let find: ([Connection], Date) -> Connection?

    convenience init(ai: String) {
        self.init(approvedAs: ai) { ConnectCompletion.newConnection($0, ai: ai, since: $1) }
    }

    init(approvedAs: String?, find: @escaping ([Connection], Date) -> Connection?) {
        self.approvedAs = approvedAs
        self.find = find
    }

    var isConnected: Bool { connected != nil || approvedHere }

    func run(client: SupabaseClient) async {
        while !Task.isCancelled, connected == nil {
            if let a = ConnectCenter.shared.approved, a.ai == approvedAs, a.at >= since { approvedHere = true }
            if let rows: [Connection] = try? await client.from("mcp_tokens").select().order("created_at", ascending: false).limit(20).execute().value {
                connected = find(rows, since)
            }
            try? await Task.sleep(for: .seconds(approvedHere ? 1 : 3))
        }
    }

    #if DEBUG
    /// Captures: pretend it just worked.
    func pretendConnected() { approvedHere = true }
    #endif
}

// MARK: The guide

/// Connect ChatGPT or Claude: three steps that tick themselves as it happens. Add Amber Notes in
/// the AI, allow it here, ask the AI something.
struct WebConnectGuide: View {
    let plan: WebConnectPlan
    let client: SupabaseClient
    /// Mac: opens the floating steps, and closes the sheet this sits in.
    var popOut: (() -> Void)? = nil
    @State private var watch: ConnectWatch
    @State private var center = ConnectCenter.shared
    @State private var copied = false
    @State private var started: Bool
    @Environment(\.openURL) private var openURL

    init(plan: WebConnectPlan, client: SupabaseClient, popOut: (() -> Void)? = nil, started: Bool = false, connected: Bool = false) {
        self.plan = plan
        self.client = client
        self.popOut = popOut
        _started = State(initialValue: started)
        let w = ConnectWatch(ai: plan.ai)
        #if DEBUG
        if connected { w.pretendConnected() }
        #endif
        _watch = State(initialValue: w)
    }

    private var server: String { BackendConfig.mcpPublicURL?.absoluteString ?? "" }

    /// 0: add it in the AI. 1: the request is here, allow it. 2: connected.
    private var stage: Int {
        if watch.isConnected { return 2 }
        return center.pending != nil ? 1 : 0
    }

    var body: some View {
        Group {
            Section {
                step(0, "Add Pinto Notes in \(plan.ai)", detail: addDetail) { addButton }
                step(1, Self.allowLine, detail: nil) { EmptyView() }
                step(2, "Ask \(plan.ai) about your notes", detail: nil) { tryIt }
            } footer: {
                Text(stage == 2 ? "It works in the \(plan.ai) app on your phone too." : plan.plans)
            }
            if stage < 2 { addressSection }
        }
        .animation(.smooth(duration: 0.3), value: stage)
        .task { await watch.run(client: client) }
        // The approval comes to this device: it looks for it every couple of seconds while the
        // guide is open, and may notify (asked now, so the push shows if the app goes away).
        .onAppear {
            ConnectCenter.shared.expectAsks()
            if !PaneApp.isUnitTestHost { Task { await ConnectNotifier.system.askPermission() } }
        }
        .onDisappear { ConnectCenter.shared.stopExpectingAsks() }
        #if os(iOS)
        // Handoff: the same guide is waiting on the Mac.
        .userActivity(ConnectHandoff.activityType, isActive: !watch.isConnected) { a in
            a.title = "Connect \(plan.ai)"
            a.addUserInfoEntries(from: [ConnectHandoff.key: plan.ai])
        }
        #endif
    }

    #if os(iOS)
    static let allowLine = "Scan the code on your computer with this iPhone, then choose Allow"
    #else
    static let allowLine = "Choose Open Pinto Notes on this Mac, then Allow"
    #endif

    /// What adding takes, while it's the step at hand.
    private var addDetail: String? {
        #if os(iOS)
        "On a computer, once. Then it works on your phone too."
        #else
        plan.steps.dropLast().joined(separator: " ")
        #endif
    }

    /// iPhone: custom AIs are added on the web, so the link goes to the computer. Mac: open it.
    @ViewBuilder
    private var addButton: some View {
        #if os(iOS)
        ShareLink(item: plan.message(server: server), subject: Text("Connect \(plan.ai) to Pinto Notes")) {
            Label("Send Link to My Computer", systemImage: "paperplane").frame(maxWidth: .infinity)
        }
        .buttonStyle(.amberProminent)
        .controlSize(.large)
        .accessibilityIdentifier("connect.sendSteps")
        #else
        Button {
            copy()
            openURL(plan.setupPage(server: server))
            started = true
            popOut?()
        } label: {
            Label(started ? "Open \(plan.ai) Again" : plan.prefills ? "Open in \(plan.ai)'s Directory" : "Copy Address and Open \(plan.ai)",
                  systemImage: "arrow.up.forward.app")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.amberProminent)
        .controlSize(.large)
        .accessibilityIdentifier("connect.open")
        #endif
    }

    private var tryIt: some View {
        Button {
            // The question is copied too, in case the chat opens empty.
            ConnectClipboard.set(plan.testPrompt)
            openURL(plan.testPage)
        } label: {
            Label("Try It in \(plan.ai)", systemImage: "arrow.up.forward.app").frame(maxWidth: .infinity)
        }
        .buttonStyle(.amberProminent)
        .controlSize(.large)
        .accessibilityIdentifier("connect.tryIt")
    }

    /// One step: a number that becomes a check, the line, and its button while it's the one at hand.
    private func step(_ i: Int, _ text: String, detail: String?, @ViewBuilder action: () -> some View) -> some View {
        let done = stage > i, now = stage == i
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: done ? "checkmark.circle.fill" : now ? "\(i + 1).circle.fill" : "\(i + 1).circle")
                    .font(.title3)
                    .foregroundStyle(done ? AnyShapeStyle(.green) : now ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(text)
                        .fontWeight(now ? .semibold : .regular)
                        .foregroundStyle(now ? .primary : .secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if now, let detail {
                        Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                if now && i == 1 { ProgressView().accessibilityIdentifier("connect.waiting") }
            }
            if now { action() }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(done ? "Done: \(text)" : text)
        .accessibilityIdentifier(done && i == 1 ? "connect.connected" : "connect.step.\(i)")
    }

    /// The address, for adding it by hand, and the AI's other way in if it has one. It holds no password.
    private var addressSection: some View {
        Section {
            if let fallback = plan.fallback {
                VStack(alignment: .leading, spacing: 8) {
                    Text(fallback.line).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    #if os(macOS)
                    Button(fallback.button, systemImage: "plus.circle") { openURL(fallback.page(server)) }
                        .accessibilityIdentifier("connect.fallback")
                    #endif
                }
            }
            DisclosureGroup("Server Address") {
                Text(server).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                Button(copied ? "Copied" : "Copy Address", systemImage: copied ? "checkmark" : "doc.on.doc") { copy() }
                    .accessibilityIdentifier("connect.copyAddress")
            }
        }
    }

    private func copy() {
        ConnectClipboard.set(server)
        withAnimation(.snappy) { copied = true }
    }
}

struct ConnectStep: View {
    let number: Int
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)").font(.callout.weight(.semibold)).monospacedDigit().foregroundStyle(.tint).frame(width: 16)
            Text(text)
        }
        .accessibilityElement(children: .combine)
    }
}

enum ConnectClipboard {
    static func set(_ s: String) {
        #if os(iOS)
        UIPasteboard.general.string = s
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        #endif
    }
}

#if os(macOS)
/// A small window that floats over the browser with the steps and the address, and says
/// "connected" when the approval comes through. Opened by the guide's one button, or by Handoff.
struct ConnectPanel: View {
    static let windowID = "connect-panel"
    let backend: Backend
    @State private var center = ConnectCenter.shared
    @Environment(\.dismissWindow) private var dismissWindow

    var body: some View {
        Group {
            if let ai = center.panelAI, let plan = WebConnectPlan.forAI(ai), let client = backend.client {
                Form { WebConnectGuide(plan: plan, client: client, started: true) }
                    .formStyle(.grouped)
                    .navigationTitle("Connect \(ai)")
                    .id(ai)
            } else {
                ContentUnavailableView("Nothing to connect", systemImage: "link")
            }
        }
        .frame(width: 360)
        .frame(minHeight: 420)
        .onDisappear { center.panelAI = nil }
    }

    /// Top right of the screen, clear of where the browser's page content usually is.
    static func placement(screen: CGRect, size: CGSize) -> CGPoint {
        CGPoint(x: screen.maxX - size.width - 24, y: screen.maxY - size.height - 24)
    }
}
#endif

// MARK: Incredible

// Incredible (incredible.one) is a desktop app for Mac and Windows. From the release that lists
// Amber Notes as one of its apps, it's in Apps: search, Connect, sign in. Older versions add it
// as an MCP server of your own: Add an MCP server, paste the address, Sign in. Either way the
// sign-in comes back to 127.0.0.1 on the person's own computer, which can't prove which app is
// listening, so the consent sheet shows it as an app on this computer, like any other local app.
// The guide says so up front, and knows it worked when a new sign-in to this computer appears.

/// What connecting Incredible takes (tested).
enum IncredibleConnect {
    static let ai = "Incredible"
    /// Incredible's Mac app, to open it from the guide. Its incredible:// links are only for its
    /// own sign-in and billing, so the guide opens the app itself.
    static let bundleID = "one.incredible.new"
    static let site = URL(string: "https://incredible.one")!

    /// Amber Notes as one of Incredible's apps (Incredible's built-in, found by search).
    static let steps = [
        "Open Apps and search for Amber Notes.",
        "Choose Connect. Your browser opens Pinto Notes.",
        allowStep,
        "Back in Incredible, choose Let's go.",
    ]

    /// The guide is read on the Mac next to Incredible, or on the iPhone that scans the code.
    static var allowStep: String {
        #if os(macOS)
        "Scan the code it shows with your iPhone (or open Pinto Notes on this Mac), then choose Allow."
        #else
        "Scan the code it shows with this iPhone, then choose Allow."
        #endif
    }

    /// Versions of Incredible from before Amber Notes was one of its apps.
    static let olderVersion = "If Pinto Notes isn't in Apps, add it as your own MCP server: choose Add it here at the bottom of Apps (or Add another MCP server), paste the address, choose Continue, then Sign in. After you choose Allow, choose Add server."

    /// What Amber Notes shows when Incredible asks, since it can't name Incredible for sure.
    static let consentNote = "Pinto Notes asks to allow an app on this computer that calls itself \u{201C}incredible\u{201D}. It can't prove which app that is, so only allow it if you just chose Connect. Choose Allow. Options has Read only, if Incredible should only look things up."

    /// The newest sign-in that went back to an app on the person's own computer since the guide
    /// opened. That's where Incredible's answer goes; the name it registered decides nothing.
    static func newConnection(_ rows: [Connection], since: Date) -> Connection? {
        rows.filter { c in
            c.isOAuth && c.revoked_at == nil && c.created_at >= since
                && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(c.redirect_host?.lowercased() ?? "")
        }
        .max { $0.created_at < $1.created_at }
    }

    /// The steps as plain text, for sending to yourself.
    static func message(server: String) -> String {
        var lines = ["Connect Incredible to Pinto Notes (in Incredible on your computer, once):", ""]
        for (i, s) in steps.enumerated() { lines.append("\(i + 1). \(s)") }
        lines += ["", "On a Windows PC, scan the code on the Pinto Notes page that opens with your iPhone, then choose Allow.",
                  "", olderVersion, "", "Address:", server]
        return lines.joined(separator: "\n")
    }

    #if os(macOS)
    /// Where Incredible is installed on this Mac, if it is.
    static var appURL: URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) }

    static func open() {
        guard let url = appURL else { return }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }
    #endif
}

/// Connect Incredible: the steps in Incredible, what Amber Notes will ask, the address for older
/// versions, then "connected".
struct IncredibleGuide: View {
    let client: SupabaseClient
    @State private var watch: ConnectWatch
    @State private var copied = false
    @State private var copiedQuestion = false
    @State private var started: Bool
    /// Mac: whether Incredible is on this Mac, so the button can open it.
    private let installed: Bool

    init(client: SupabaseClient, started: Bool = false, connected: Bool = false, installed: Bool? = nil) {
        self.client = client
        _started = State(initialValue: started)
        let w = ConnectWatch(approvedAs: nil) { IncredibleConnect.newConnection($0, since: $1) }
        #if DEBUG
        if connected { w.pretendConnected() }
        #endif
        _watch = State(initialValue: w)
        #if os(macOS)
        self.installed = installed ?? (IncredibleConnect.appURL != nil)
        #else
        self.installed = installed ?? false
        #endif
    }

    private var server: String { BackendConfig.mcpPublicURL?.absoluteString ?? "" }

    var body: some View {
        Group {
            if watch.isConnected {
                connectedSection
            } else {
                #if os(iOS)
                onAComputer
                #else
                start
                #endif
                stepsSection
                olderVersionSection
            }
        }
        .task { await watch.run(client: client) }
    }

    #if os(iOS)
    /// iPhone: Incredible runs on a computer. Say so up front.
    private var onAComputer: some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Takes a minute on your computer, once.").font(.body.weight(.semibold))
                    Text("Incredible is a desktop app for Mac and Windows. You connect Pinto Notes in Incredible there.").foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "laptopcomputer").foregroundStyle(.tint)
            }
            ShareLink(item: IncredibleConnect.message(server: server), subject: Text("Connect Incredible to Pinto Notes")) {
                Label("Send Steps to Yourself", systemImage: "paperplane")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.amberProminent)
            .controlSize(.large)
            .accessibilityIdentifier("connect.sendSteps")
        }
    }
    #endif

    #if os(macOS)
    /// The one button: open Incredible when it's on this Mac, or get it.
    private var start: some View {
        Section {
            if installed {
                Button {
                    IncredibleConnect.open()
                    started = true
                } label: {
                    Label(started ? "Open Incredible Again" : "Open Incredible", systemImage: "arrow.up.forward.app")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.amberProminent)
                .controlSize(.large)
                .accessibilityIdentifier("connect.open")
            } else {
                Link(destination: IncredibleConnect.site) {
                    Label("Get Incredible", systemImage: "arrow.up.forward.app")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.amberProminent)
                .controlSize(.large)
                .accessibilityIdentifier("connect.get")
            }
            if started {
                Label("Waiting for you to choose Allow…", systemImage: "hourglass")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("connect.waiting")
            }
        } footer: {
            Text(installed ? "On a Windows PC, follow the same steps in Incredible there." : "Incredible isn't on this Mac. It's a desktop app for Mac and Windows from incredible.one.")
        }
    }
    #endif

    private var stepsSection: some View {
        Section {
            ForEach(Array(IncredibleConnect.steps.enumerated()), id: \.offset) { i, line in
                ConnectStep(number: i + 1, text: line)
            }
        } header: {
            Text("In Incredible")
        } footer: {
            Text(IncredibleConnect.consentNote)
        }
    }

    /// Before Amber Notes was one of Incredible's apps: the address, pasted as an MCP server.
    private var olderVersionSection: some View {
        Section {
            Text(IncredibleConnect.olderVersion).font(.callout).foregroundStyle(.secondary)
            Text(server).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
            Button(copied ? "Copied" : "Copy Address", systemImage: copied ? "checkmark" : "doc.on.doc") { copy() }
                .accessibilityIdentifier("connect.copyAddress")
        } header: {
            Text("On an older version of Incredible")
        } footer: {
            Text("The address holds no password. Access is granted only when you choose Allow in Pinto Notes.")
        }
    }

    /// Named the way Settings lists it: Amber Notes can't vouch that the app on this computer is Incredible.
    @ViewBuilder
    private var connectedSection: some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: "desktopcomputer")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 40, height: 40)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 40 * 0.3, style: .continuous))
                Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(.green)
                AppMark(size: 40)
            }
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
            Text("Connected")
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("connect.connected")
            Text("Back in Incredible, choose Let's go (Add server on an older version). In Settings, it's listed as An app on this computer.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        Section {
            Text("\u{201C}\(WebConnectPlan.testPrompt)\u{201D}").foregroundStyle(.primary)
            #if os(macOS)
            if installed {
                Button("Copy Question and Open Incredible", systemImage: "arrow.up.forward.app") {
                    ConnectClipboard.set(WebConnectPlan.testPrompt)
                    IncredibleConnect.open()
                }
                .accessibilityIdentifier("connect.tryIt")
            }
            #endif
            Button(copiedQuestion ? "Copied" : "Copy Question", systemImage: copiedQuestion ? "checkmark" : "doc.on.doc") {
                ConnectClipboard.set(WebConnectPlan.testPrompt)
                withAnimation(.snappy) { copiedQuestion = true }
            }
        } header: {
            Text("Try it")
        } footer: {
            Text("Ask Incredible this. You can disconnect it in Settings any time.")
        }
    }

    private func copy() {
        ConnectClipboard.set(server)
        withAnimation(.snappy) { copied = true }
    }
}
