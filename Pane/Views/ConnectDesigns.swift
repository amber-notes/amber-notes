import Supabase
import SwiftUI

// Dev: the connect tasting menu (2026-10-02). Three simpler connect journeys next to the current
// one, picked in Settings › Dev. Not for release: the winner replaces the current views and this
// file goes.
//
//   A minimal: one line per screen, access in a footnote menu.
//   B balanced: one line plus where access goes, access behind Options.
//   C live: the guide is a checklist that ticks itself, the number allows on its own.
//
// All three keep the number match for a request asked from a browser, Face ID before allowing,
// and the warning for an app Amber Notes can't name. Unlike the current sheet, they name ChatGPT
// or Claude when the address access goes to is theirs, also for a request asked from a browser:
// the number ties the request to the person's own browser, and the address to the AI.

enum ConnectDesign: String, CaseIterable, Identifiable {
    case current, a, b, c
    var id: String { rawValue }

    static let key = "dev.connectDesign"

    /// What Settings › Dev picked. Release builds always show the current design.
    static var active: ConnectDesign {
        #if DEBUG
        UserDefaults.standard.string(forKey: key).flatMap(ConnectDesign.init(rawValue:)) ?? .current
        #else
        .current
        #endif
    }

    var label: String {
        switch self {
        case .current: "Current"
        case .a: "A minimal"
        case .b: "B balanced"
        case .c: "C live checklist"
        }
    }
}

enum ConnectDesignCopy {
    /// The AI the address belongs to, whoever asked.
    static func ai(_ r: ConnectRequest) -> String? { ConnectTrust.verifiedAI(redirectURI: r.redirect_uri) }

    static func name(_ r: ConnectRequest) -> String {
        ai(r) ?? ConnectTrust.destination(host: r.redirect_host, loopback: r.loopback)
    }

    static func title(_ r: ConnectRequest) -> String { "Allow \(name(r)) to use your notes?" }

    /// The steps for sending to a computer: Claude's link fills everything in.
    static func message(_ plan: WebConnectPlan, server: String) -> String {
        guard plan.prefills else { return plan.message(server: server) }
        return ["Add Amber Notes to \(plan.ai) (once, on a computer):", plan.setupPage(server: server).absoluteString,
                "Choose Add, then Connect, and allow it on your phone."].joined(separator: "\n")
    }

    static func steps(_ plan: WebConnectPlan) -> [String] {
        plan.prefills
            ? ["Open the link we send you.", "Choose Add, then Connect.", "Allow it here when your phone asks."]
            : ["Open the link we send you.", "Add a plugin with the address in it.", "Allow it here when your phone asks."]
    }
}

// MARK: The approval sheet

extension ConsentSheet {
    /// The keypad needs the whole screen; anything else fits in half, so nothing is cut off.
    var candidateDetents: Set<PresentationDetent> {
        if case .asking(let r) = phase, r.isAsked { return [.large] }
        return [.medium]
    }

    @ViewBuilder
    var candidate: some View {
        switch phase {
        case .loading, .working:
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .asking(let r):
            candidateAsking(r).padding(.horizontal, 24).padding(.top, 36).padding(.bottom, 12)
        case .done(let name):
            candidateDone(detail: "Go back to \(name).")
        case .handedOff:
            candidateDone(detail: "Finish on your computer.")
        case .failed(let message):
            VStack(spacing: 14) {
                Text("Couldn't connect").font(.title3.weight(.semibold))
                Text(message).multilineTextAlignment(.center).foregroundStyle(.secondary)
                    .accessibilityIdentifier("connect.failure")
                Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(28)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func candidateMarks(_ r: ConnectRequest) -> some View {
        let ai = ConnectDesignCopy.ai(r)
        return HStack(spacing: 14) {
            if let ai {
                AITile(ai: ai, size: 60)
            } else {
                Image(systemName: r.loopback ? "desktopcomputer" : "globe")
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 60, height: 60)
                    .background(.fill.tertiary, in: .rect(cornerRadius: 60 * 0.3, style: .continuous))
            }
            Image(systemName: "link").font(.system(size: 15, weight: .semibold)).foregroundStyle(.tertiary)
            AppMark(size: 60)
        }
        .accessibilityHidden(true)
    }

    private func candidateAsking(_ r: ConnectRequest) -> some View {
        let unknown = ConnectDesignCopy.ai(r) == nil
        return VStack(spacing: 0) {
            candidateMarks(r)
            Text(ConnectDesignCopy.title(r))
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 20)
                .accessibilityIdentifier("connect.title")
            if design == .b {
                Text("Access goes to \(Text(r.redirect_host).bold()).")
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
                    .accessibilityIdentifier("connect.destination")
            }
            if unknown {
                Label("Amber Notes doesn't recognize this app. Only allow it if you just started connecting it.",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.leading)
                    .padding(.top, 10)
            }
            if design == .c { accessMenu(r).padding(.top, 14) }
            Spacer(minLength: 20)
            if r.isAsked {
                Text(match == nil ? "Waiting for your computer\u{2026}" : "Type the number on your computer.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("connect.matchHint")
                Group {
                    if match != nil { typedDigits } else { ProgressView().frame(height: 56) }
                }
                .padding(.top, 10)
                .padding(.bottom, 16)
                keypad.disabled(match == nil)
                    .padding(.bottom, 16)
            }
            candidateButtons(r)
            switch design {
            case .a: accessFootnote(r).padding(.top, 10)
            case .b: optionsRow(r).padding(.top, 8)
            default: EmptyView()
            }
        }
        .onChange(of: typed) { _, now in
            // C: the right number is the answer; Face ID still comes first.
            if design == .c, r.isAsked, now.count == 2 { Task { await entered(r) } }
        }
    }

    @ViewBuilder
    private func candidateButtons(_ r: ConnectRequest) -> some View {
        let allow = { Task { if r.isAsked { await entered(r) } else { await decide(r, allow: true) } } }
        let canAllow = armed && (!r.isAsked || (match != nil && typed.count == 2))
        switch design {
        case .b:
            HStack(spacing: 12) {
                Button { Task { await decide(r, allow: false) } } label: { Text("Don't allow").frame(maxWidth: .infinity) }
                    .controlSize(.large)
                    .accessibilityIdentifier("connect.deny")
                Button { allow() } label: { Text("Allow").frame(maxWidth: .infinity) }
                    .buttonStyle(.amberProminent)
                    .controlSize(.large)
                    .disabled(!canAllow)
                    .accessibilityIdentifier("connect.allow")
            }
        case .c where r.isAsked:
            Button("Don't allow") { Task { await decide(r, allow: false) } }
                .frame(minHeight: 44)
                .accessibilityIdentifier("connect.deny")
        default:
            VStack(spacing: 4) {
                Button { allow() } label: { Text("Allow").frame(maxWidth: .infinity) }
                    .buttonStyle(.amberProminent)
                    .controlSize(.large)
                    .disabled(!canAllow)
                    .accessibilityIdentifier("connect.allow")
                Button("Don't allow") { Task { await decide(r, allow: false) } }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("connect.deny")
            }
        }
    }

    private func accessBinding(_ r: ConnectRequest) -> Binding<Bool> {
        Binding(get: { write && r.wants_write }, set: { write = $0 })
    }

    /// A: one footnote line; the menu changes it.
    private func accessFootnote(_ r: ConnectRequest) -> some View {
        Menu {
            Picker("Access", selection: accessBinding(r)) {
                Text("Read and edit").tag(true)
                Text("Read only").tag(false)
            }
        } label: {
            Text(accessBinding(r).wrappedValue ? "Can read and edit \u{00B7} Change" : "Can only read \u{00B7} Change")
                .font(.footnote)
        }
        .disabled(!r.wants_write)
        .accessibilityIdentifier("connect.access")
    }

    /// B: a quiet Options row that opens to the choice.
    private func optionsRow(_ r: ConnectRequest) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                Picker("Access", selection: accessBinding(r)) {
                    Text("Read and edit").tag(true)
                    Text("Read only").tag(false)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .disabled(!r.wants_write)
                Text(accessBinding(r).wrappedValue ? "Every change keeps the previous version." : "It can read your notes, but not change them.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 8)
        } label: {
            Text("Options").font(.callout)
        }
        .tint(.secondary)
        .accessibilityIdentifier("connect.options")
    }

    /// C: the access as a pill under the title.
    private func accessMenu(_ r: ConnectRequest) -> some View {
        Menu {
            Picker("Access", selection: accessBinding(r)) {
                Text("Read and edit").tag(true)
                Text("Read only").tag(false)
            }
        } label: {
            HStack(spacing: 4) {
                Text(accessBinding(r).wrappedValue ? "Can read and edit" : "Can only read")
                Image(systemName: "chevron.up.chevron.down").font(.caption2.weight(.semibold))
            }
            .font(.callout.weight(.medium))
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(.fill.tertiary, in: .capsule)
        }
        .disabled(!r.wants_write)
        .accessibilityIdentifier("connect.access")
    }

    private func candidateDone(detail: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.green)
            Text("Connected").font(.title2.weight(.semibold)).accessibilityIdentifier("connect.done")
            Text(detail).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Settings › Connect an AI

struct ConnectAISimple: View {
    let design: ConnectDesign
    let connections: [Connection]
    let loaded: Bool
    let error: String?
    let open: (ConnectAISection.Guide) -> Void
    let disconnect: (Connection) -> Void

    private var active: [Connection] { connections.filter { $0.revoked_at == nil } }

    var body: some View {
        if design == .c { merged } else { guides; connected }
    }

    static func subtitle(_ g: ConnectAISection.Guide) -> String {
        switch g {
        case .chatgpt: "Added once on the web"
        case .claude: "Added once on the web or desktop"
        case .claudeCode: "On a Mac with Claude Code"
        case .codex: "In your Codex settings"
        case .incredible: "In the Incredible app"
        }
    }

    private var footer: some View {
        Text("You approve each AI, and can disconnect it anytime.")
    }

    private var guides: some View {
        Section {
            ForEach(ConnectAISection.Guide.allCases) { g in
                Button { open(g) } label: { guideRow(g, subtitle: design == .b ? Self.subtitle(g) : nil, trailing: nil) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Connect \(g.title)")
                    .accessibilityIdentifier("connect.guide.\(g.rawValue)")
            }
        } header: {
            Text("Connect an AI")
        } footer: {
            footer
        }
    }

    @ViewBuilder
    private var connected: some View {
        if design == .b || !active.isEmpty || error != nil {
            Section("Connected") {
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity, alignment: .leading)
                } else if active.isEmpty && error == nil {
                    Text("Nothing connected yet.").foregroundStyle(.secondary)
                }
                ForEach(active) { c in connectedRow(c) }
                if let error { Text(error).font(.footnote).foregroundStyle(.red) }
            }
        }
    }

    /// C: one list. Each AI says whether it's connected; anything else connected follows.
    private var merged: some View {
        let matched = Dictionary(grouping: active, by: Self.guide(for:))
        let others = active.filter { Self.guide(for: $0) == nil }
        return Section {
            ForEach(ConnectAISection.Guide.allCases) { g in
                if let c = matched[g]?.first {
                    guideRow(g, subtitle: c.can_write ? "Connected" : "Connected, read only", trailing: AnyView(manage(c)), connected: true)
                } else {
                    Button { open(g) } label: { guideRow(g, subtitle: nil, trailing: nil) }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Connect \(g.title)")
                        .accessibilityIdentifier("connect.guide.\(g.rawValue)")
                }
            }
            ForEach(others) { c in connectedRow(c) }
            if let error { Text(error).font(.footnote).foregroundStyle(.red) }
        } header: {
            Text("Connect an AI")
        } footer: {
            footer
        }
    }

    /// Which guide a connection belongs to: by where its approval went, or a token's own name.
    static func guide(for c: Connection) -> ConnectAISection.Guide? {
        if c.isOAuth {
            switch ConnectTrust.verifiedAI(host: c.redirect_host ?? "", loopback: false) {
            case "ChatGPT": return .chatgpt
            case "Claude": return .claude
            default: return nil
            }
        }
        return ConnectAISection.Guide.allCases.first { $0.title == c.name && ($0 == .claudeCode || $0 == .codex) }
    }

    private func guideRow(_ g: ConnectAISection.Guide, subtitle: String?, trailing: AnyView?, connected: Bool = false) -> some View {
        HStack(spacing: 12) {
            AITile(ai: g.title, size: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(g.title).foregroundStyle(.primary)
                if let subtitle {
                    Text(subtitle).font(.footnote).foregroundStyle(connected ? AnyShapeStyle(.green) : AnyShapeStyle(.secondary))
                }
            }
            Spacer()
            if let trailing { trailing } else {
                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
    }

    private func manage(_ c: Connection) -> some View {
        Menu {
            Button("Disconnect\u{2026}", role: .destructive) { disconnect(c) }
        } label: {
            Image(systemName: "ellipsis.circle").font(.title3).frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel("Manage \(c.title)")
    }

    private func connectedRow(_ c: Connection) -> some View {
        HStack(spacing: 10) {
            AITile(ai: ConnectTrust.verifiedAI(host: c.redirect_host ?? "", loopback: false) ?? "", size: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(c.title)
                Text(c.can_write ? "Read and edit" : "Read only").font(.footnote).foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            Spacer()
            Button("Disconnect\u{2026}") { disconnect(c) }
                .buttonStyle(.borderless)
                .accessibilityLabel("Disconnect \(c.title)")
                .accessibilityIdentifier("connect.disconnect")
        }
    }
}

// MARK: The ChatGPT and Claude guide

struct SimpleWebGuide: View {
    let plan: WebConnectPlan
    let client: SupabaseClient
    let design: ConnectDesign
    @State private var watch: ConnectWatch
    @State private var center = ConnectCenter.shared
    @State private var showAddress = false
    @State private var copied = false
    @Environment(\.openURL) private var openURL

    init(plan: WebConnectPlan, client: SupabaseClient, design: ConnectDesign, connected: Bool = false) {
        self.plan = plan
        self.client = client
        self.design = design
        let w = ConnectWatch(ai: plan.ai)
        #if DEBUG
        if connected { w.pretendConnected() }
        #endif
        _watch = State(initialValue: w)
    }

    private var server: String { BackendConfig.mcpPublicURL?.absoluteString ?? "" }

    var body: some View {
        Group {
            switch design {
            case .c: checklist
            case .b: watch.isConnected ? AnyView(connected) : AnyView(balanced)
            default: watch.isConnected ? AnyView(connected) : AnyView(minimal)
            }
        }
        .task { await watch.run(client: client) }
        .onAppear {
            ConnectCenter.shared.expectAsks()
            if !PaneApp.isUnitTestHost { Task { await ConnectNotifier.system.askPermission() } }
        }
        .onDisappear { ConnectCenter.shared.stopExpectingAsks() }
        #if os(iOS)
        .userActivity(ConnectHandoff.activityType, isActive: !watch.isConnected) { a in
            a.title = "Connect \(plan.ai)"
            a.addUserInfoEntries(from: [ConnectHandoff.key: plan.ai])
        }
        #endif
    }

    private var sendButton: some View {
        ShareLink(item: ConnectDesignCopy.message(plan, server: server), subject: Text("Connect \(plan.ai) to Amber Notes")) {
            Label("Send link to my computer", systemImage: "paperplane").frame(maxWidth: .infinity)
        }
        .buttonStyle(.amberProminent)
        .controlSize(.large)
        .accessibilityIdentifier("connect.sendSteps")
    }

    private func hero(_ title: String, _ detail: String) -> some View {
        VStack(spacing: 10) {
            AITile(ai: plan.ai, size: 60)
            Text(title).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
            Text(detail).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    /// A: what to do, one button, and that it's waiting.
    @ViewBuilder
    private var minimal: some View {
        Section {
            hero("Add Amber Notes to \(plan.ai) on a computer", "Once. Then it works on your phone too.")
            sendButton
        }
        Section {
            Label { Text("Waiting for you to allow it\u{2026}").foregroundStyle(.secondary) } icon: { ProgressView() }
        }
    }

    /// B: three short steps, the button, the address tucked away.
    @ViewBuilder
    private var balanced: some View {
        Section {
            ForEach(Array(ConnectDesignCopy.steps(plan).enumerated()), id: \.offset) { i, line in
                ConnectStep(number: i + 1, text: line)
            }
            sendButton
        } header: {
            Text("On your computer, once")
        } footer: {
            Text("Then Amber Notes works in the \(plan.ai) app on your phone too.")
        }
        Section {
            DisclosureGroup("Server address", isExpanded: $showAddress) {
                Text(server).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                Button(copied ? "Copied" : "Copy address", systemImage: copied ? "checkmark" : "doc.on.doc") {
                    ConnectClipboard.set(server)
                    withAnimation(.snappy) { copied = true }
                }
            }
        }
    }

    @ViewBuilder
    private var connected: some View {
        Section {
            VStack(spacing: 10) {
                HStack(spacing: 12) {
                    AITile(ai: plan.ai, size: 48)
                    Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(.green)
                    AppMark(size: 48)
                }
                Text("\(plan.ai) is connected").font(.title3.weight(.semibold)).accessibilityIdentifier("connect.connected")
                if design == .b {
                    Text("Try asking: \u{201C}\(plan.testPrompt)\u{201D}").foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            tryIt
        } footer: {
            if design == .b { Text("Disconnect it in Settings anytime.") }
        }
    }

    private var tryIt: some View {
        Button {
            ConnectClipboard.set(plan.testPrompt)
            openURL(plan.testPage)
        } label: {
            Label("Try it in \(plan.ai)", systemImage: "arrow.up.forward.app").frame(maxWidth: .infinity)
        }
        .buttonStyle(.amberProminent)
        .controlSize(.large)
        .accessibilityIdentifier("connect.tryIt")
    }

    /// C: three steps that tick themselves as it happens.
    private var stage: Int {
        if watch.isConnected { return 2 }
        return center.pending != nil ? 1 : 0
    }

    private var checklist: some View {
        Section {
            checkRow(0, "Add Amber Notes in \(plan.ai) on a computer") { sendButton.padding(.top, 6) }
            checkRow(1, "Allow it on this phone") { EmptyView() }
            checkRow(2, "Ask \(plan.ai) about your notes") { tryIt.padding(.top, 6) }
        } footer: {
            Text(stage == 2 ? "It works in the \(plan.ai) app on your phone too." : "Once. Then it works on your phone too.")
        }
    }

    private func checkRow(_ i: Int, _ text: String, @ViewBuilder action: () -> some View) -> some View {
        let done = stage > i, now = stage == i
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: done ? "checkmark.circle.fill" : now ? "\(i + 1).circle.fill" : "\(i + 1).circle")
                    .font(.title2)
                    .foregroundStyle(done ? AnyShapeStyle(.green) : now ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                Text(text)
                    .foregroundStyle(now ? .primary : .secondary)
                    .fontWeight(now ? .semibold : .regular)
                Spacer(minLength: 0)
                if now && i == 1 { ProgressView() }
            }
            if now { action() }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }
}

#if DEBUG
/// Settings › Dev: which connect design shows.
struct ConnectDesignDevSection: View {
    @AppStorage(ConnectDesign.key) private var design = ConnectDesign.current.rawValue

    var body: some View {
        Section("Dev") {
            Picker("Dev: connect design", selection: $design) {
                ForEach(ConnectDesign.allCases) { Text($0.label).tag($0.rawValue) }
            }
        }
    }
}
#endif
