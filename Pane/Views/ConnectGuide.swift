import Supabase
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// Connect ChatGPT or Claude in as few moves as the two apps allow.
//
// Claude documents a link that opens its Add custom connector dialog with the name and address
// filled in, so for Claude one button does it and the person confirms. ChatGPT has no such
// link: the button copies the address and opens ChatGPT's Plugins page. Both add custom apps
// only on the web or desktop, once; after that they work in the phone apps too. The steps stay
// in view (on a Mac, in a small window that floats over the browser), and the guide watches
// for the sign-in itself and says when it worked, with a first thing to ask.
//
// Sources: claude.com/docs/connectors/building/directory-vs-custom (install link),
// developers.openai.com/api/docs/guides/developer-mode (ChatGPT: Plus and up, on the web).

// MARK: Pure pieces (tested)

/// What connecting one web AI takes, and where.
struct WebConnectPlan: Equatable {
    let ai: String
    /// True when the page opens with Amber Notes already filled in.
    let prefills: Bool
    let steps: [String]
    /// Who can do it at all.
    let plans: String
    /// A first request that proves the connection, and where to ask it.
    let testPrompt: String
    let testPage: URL
    private let page: @Sendable (String) -> URL

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

    static let testPrompt = "Search my Amber Notes and tell me what I wrote most recently."

    static let chatgpt = WebConnectPlan(
        ai: "ChatGPT",
        prefills: false,
        steps: [
            "Turn on Developer mode in Settings, Security and login (once).",
            "In Plugins, choose + and name it Amber Notes.",
            "Paste the address, choose OAuth, then Create.",
            "Allow Amber Notes to open, then choose Allow.",
        ],
        plans: "Needs ChatGPT Plus, Pro, Business, Enterprise or Edu, on the web.",
        testPrompt: testPrompt,
        testPage: prefilled("https://chatgpt.com/", testPrompt),
        page: { _ in URL(string: "https://chatgpt.com/plugins")! })

    static let claude = WebConnectPlan(
        ai: "Claude",
        prefills: true,
        steps: [
            "Claude opens Add custom connector with Amber Notes filled in. Choose Add.",
            "Choose Connect.",
            "Allow Amber Notes to open, then choose Allow.",
        ],
        plans: "Works on every Claude plan; Free includes one custom connector. On Team and Enterprise, an Owner adds it.",
        testPrompt: testPrompt,
        testPage: prefilled("https://claude.ai/new", testPrompt),
        page: installLink)

    /// Claude's documented install link: the Add custom connector dialog, prefilled. The person still confirms.
    static func installLink(server: String) -> URL {
        // Fully percent-encoded, as the link wants (URLComponents would leave ":" and "/" as they are).
        let encode = { (s: String) in s.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(.init(charactersIn: "-._~"))) ?? "" }
        return URL(string: "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=\(encode("Amber Notes"))&connectorUrl=\(encode(server))")!
    }

    /// A new chat with the question typed in. Not documented by either app, so the question is
    /// also copied (see ConnectedSection).
    static func prefilled(_ page: String, _ prompt: String) -> URL {
        var c = URLComponents(string: page)!
        c.queryItems = [URLQueryItem(name: "q", value: prompt)]
        return c.url!
    }

    /// The steps as plain text, for sending to yourself.
    func message(server: String) -> String {
        var lines = ["Connect \(ai) to Amber Notes (on a computer, once):", "", "1. Open \(setupPage(server: server).absoluteString)"]
        for (i, s) in steps.enumerated() { lines.append("\(i + 2). \(s)") }
        if !prefills { lines += ["", "Address:", server] }
        lines += ["", "After that, Amber Notes works in the \(ai) app on your phone too."]
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
    let ai: String
    let since = Date.now.addingTimeInterval(-5)
    private(set) var connected: Connection?
    private(set) var approvedHere = false

    init(ai: String) { self.ai = ai }

    var isConnected: Bool { connected != nil || approvedHere }

    func run(client: SupabaseClient) async {
        while !Task.isCancelled, connected == nil {
            if let a = ConnectCenter.shared.approved, a.ai == ai, a.at >= since { approvedHere = true }
            if let rows: [Connection] = try? await client.from("mcp_tokens").select().order("created_at", ascending: false).limit(20).execute().value {
                connected = ConnectCompletion.newConnection(rows, ai: ai, since: since)
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

/// Connect ChatGPT or Claude: one button, the steps, the address, then "connected".
struct WebConnectGuide: View {
    let plan: WebConnectPlan
    let client: SupabaseClient
    /// Mac: opens the floating steps, and closes the sheet this sits in.
    var popOut: (() -> Void)? = nil
    @State private var watch: ConnectWatch
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

    private var server: String { BackendConfig.mcpURL?.absoluteString ?? "" }

    var body: some View {
        Group {
            if watch.isConnected {
                ConnectedSection(plan: plan)
            } else {
                #if os(iOS)
                onAComputer
                #else
                start
                #endif
                stepsSection
                addressSection
            }
        }
        .task { await watch.run(client: client) }
        #if os(iOS)
        // Handoff: the same guide is waiting on the Mac.
        .userActivity(ConnectHandoff.activityType, isActive: !watch.isConnected) { a in
            a.title = "Connect \(plan.ai)"
            a.addUserInfoEntries(from: [ConnectHandoff.key: plan.ai])
        }
        #endif
    }

    #if os(iOS)
    /// iPhone: custom apps are added on the web, once. Say so up front.
    private var onAComputer: some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Takes a minute on a computer, once.").font(.body.weight(.semibold))
                    Text("Then Amber Notes works in the \(plan.ai) app on your phone too.").foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "laptopcomputer").foregroundStyle(.tint)
            }
            ShareLink(item: plan.message(server: server), subject: Text("Connect \(plan.ai) to Amber Notes")) {
                Label("Send Steps to Yourself", systemImage: "paperplane")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("connect.sendSteps")
        } footer: {
            Text("\(plan.plans) On a Mac with Amber Notes, Handoff brings this guide with you.")
        }
    }
    #endif

    /// The one button: copy the address, open the right page, keep the steps in view.
    private var start: some View {
        Section {
            Button {
                copy()
                openURL(plan.setupPage(server: server))
                started = true
                popOut?()
            } label: {
                Label(started ? "Open \(plan.ai) Again" : plan.prefills ? "Add to \(plan.ai)" : "Copy Address and Open \(plan.ai)", systemImage: "arrow.up.forward.app")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("connect.open")
            if started {
                Label("Waiting for you to choose Allow…", systemImage: "hourglass")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("connect.waiting")
            }
        } footer: {
            Text(plan.plans)
        }
    }

    private var stepsSection: some View {
        Section("In \(plan.ai)") {
            ForEach(Array(plan.steps.enumerated()), id: \.offset) { i, line in
                ConnectStep(number: i + 1, text: line)
            }
        }
    }

    private var addressSection: some View {
        Section {
            Text(server).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
            Button(copied ? "Copied" : "Copy Address", systemImage: copied ? "checkmark" : "doc.on.doc") { copy() }
                .accessibilityIdentifier("connect.copyAddress")
        } header: {
            Text("Server address")
        } footer: {
            Text("The address holds no password. Access is granted only when you choose Allow in Amber Notes.")
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

/// "ChatGPT is connected", and a first thing to ask it.
struct ConnectedSection: View {
    let plan: WebConnectPlan
    @State private var copied = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        Section {
            HStack(spacing: 12) {
                AITile(ai: plan.ai, size: 40)
                Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(.green)
                AppMark(size: 40)
            }
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
            Text("\(plan.ai) is connected")
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("connect.connected")
        }
        Section {
            Text("“\(plan.testPrompt)”").foregroundStyle(.primary)
            Button("Try It in \(plan.ai)", systemImage: "arrow.up.forward.app") {
                // The question is copied too, in case the chat opens empty.
                ConnectClipboard.set(plan.testPrompt)
                openURL(plan.testPage)
            }
                .accessibilityIdentifier("connect.tryIt")
            Button(copied ? "Copied" : "Copy Question", systemImage: copied ? "checkmark" : "doc.on.doc") {
                ConnectClipboard.set(plan.testPrompt)
                withAnimation(.snappy) { copied = true }
            }
        } header: {
            Text("Try it")
        } footer: {
            Text("It works in the \(plan.ai) app on your phone too. You can disconnect it in Settings any time.")
        }
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
