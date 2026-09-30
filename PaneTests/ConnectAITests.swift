import Foundation
import Testing
@testable import Pane

@Suite struct ConnectAITests {
    @Test func readsTheRequestFromAConnectLink() {
        let id = UUID()
        #expect(ConnectLink.requestID(from: URL(string: "ambernotes://connect?request=\(id.uuidString.lowercased())")!) == id)
        #expect(ConnectLink.requestID(from: URL(string: "AmberNotes://Connect?request=\(id.uuidString)")!) == id)
    }

    @Test func ignoresOtherLinks() {
        #expect(ConnectLink.requestID(from: URL(string: "ambernotes://connect?request=nope")!) == nil)
        #expect(ConnectLink.requestID(from: URL(string: "ambernotes://open?request=\(UUID().uuidString)")!) == nil)
        #expect(ConnectLink.requestID(from: URL(string: "https://connect?request=\(UUID().uuidString)")!) == nil)
    }

    @Test func knowsTheBigAIsAndWarnsAboutTheRest() {
        #expect(ConnectTrust.verifiedAI(host: "chatgpt.com", loopback: false) == "ChatGPT")
        #expect(ConnectTrust.verifiedAI(host: "claude.ai", loopback: false) == "Claude")
        #expect(ConnectTrust.verifiedAI(host: "chatgpt.com.evil.example", loopback: false) == nil)
        #expect(ConnectTrust.verifiedAI(host: "notclaude.ai", loopback: false) == nil)
        #expect(ConnectTrust.verifiedAI(host: "evil.claude.ai", loopback: false) == nil, "a subdomain isn't claude.ai")
        #expect(ConnectTrust.verifiedAI(host: "127.0.0.1", loopback: true) == nil)
        #expect(ConnectTrust.destination(host: "127.0.0.1", loopback: true) == "an app on this computer")
        #expect(ConnectTrust.destination(host: "chatgpt.com", loopback: false) == "chatgpt.com")
    }

    @Test func snippetsCarryTheTokenInAHeaderNeverTheURL() {
        let url = "https://example.supabase.co/functions/v1/mcp"
        let token = "pane_" + String(repeating: "a", count: 64)
        let claude = ConnectSnippets.claudeCode(url: url, token: token)
        #expect(claude.contains("--scope user"))
        #expect(claude.contains("--header \"Authorization: Bearer \(token)\""))
        #expect(!claude.contains("\(url)/\(token)"))
        let codex = ConnectSnippets.codex(url: url, token: token)
        #expect(codex.contains("url = \"\(url)\""))
        #expect(codex.contains("Bearer \(token)"))
    }

    @Test func showsTheServersPublicAddressWhenTheBuildHasOne() {
        let function = URL(string: "https://ref.supabase.co/functions/v1/mcp")!
        #expect(BackendConfig.publicMCPURL(configured: "https://mcp.ambernotes.app", function: function)?.absoluteString == "https://mcp.ambernotes.app")
        // Unset ($(PANE_MCP_URL) expands to nothing) or not https: the function's own address.
        #expect(BackendConfig.publicMCPURL(configured: "", function: function) == function)
        #expect(BackendConfig.publicMCPURL(configured: nil, function: function) == function)
        #expect(BackendConfig.publicMCPURL(configured: "http://mcp.example", function: function) == function)
    }
}


/// The consent sheet shows an AI's mark only when the approval really goes to that AI.
@Suite struct ConsentMarkTests {
    @Test func theMarkComesFromTheAddressNotTheName() {
        #expect(ConnectTrust.verifiedAI(host: "chatgpt.com", loopback: false) == "ChatGPT")
        #expect(ConnectTrust.verifiedAI(host: "chat.openai.com", loopback: false) == "ChatGPT")
        #expect(ConnectTrust.verifiedAI(host: "claude.ai", loopback: false) == "Claude")
        #expect(ConnectTrust.verifiedAI(host: "claude.com", loopback: false) == "Claude")
    }

    @Test func onTheConsentSheetOnlyThePinnedCallbackCounts() {
        func req(_ name: String, _ uri: String?) -> ConnectRequest {
            ConnectRequest(id: UUID(), client_name: name, redirect_host: uri.flatMap { URL(string: $0)?.host() } ?? "chatgpt.com", redirect_uri: uri, loopback: false, wants_write: true)
        }
        let real = req("ChatGPT", "https://chatgpt.com/connector_platform_oauth_redirect")
        #expect(real.verifiedAI == "ChatGPT")
        #expect(real.who == "ChatGPT")
        #expect(real.claimedName == nil)
        #expect(req("Claude", "https://claude.ai/api/mcp/auth_callback").verifiedAI == "Claude")
        // Same site, other path; or a server too old to say: no mark, and the host is the headline.
        let otherPath = req("Claude", "https://claude.ai/somewhere/else")
        #expect(otherPath.verifiedAI == nil)
        #expect(otherPath.who == "claude.ai")
        #expect(otherPath.claimedName == "Claude")
        #expect(req("ChatGPT", nil).verifiedAI == nil)
        let local = ConnectRequest(id: UUID(), client_name: "Claude Code", redirect_host: "127.0.0.1", redirect_uri: "http://127.0.0.1:4000/cb", loopback: true, wants_write: true)
        #expect(local.who == "an app on this computer")
        #expect(local.claimedName == "Claude Code")
    }

    @Test func aClientThatOnlyCallsItselfChatGPTGetsNoMark() {
        // Registered as "ChatGPT", but the approval would go to its own site.
        let spoof = ConnectRequest(id: UUID(), client_name: "ChatGPT", redirect_host: "chatgpt-login.example.com", loopback: false, wants_write: true)
        #expect(ConnectTrust.verifiedAI(host: spoof.redirect_host, loopback: spoof.loopback) == nil)
        #expect(ConnectTrust.verifiedAI(host: "evilchatgpt.com", loopback: false) == nil, "a look-alike domain isn't chatgpt.com")
        #expect(ConnectTrust.verifiedAI(host: "chatgpt.com.example.net", loopback: false) == nil)
        #expect(ConnectTrust.verifiedAI(host: "localhost", loopback: true) == nil)
    }
}

/// Connect ChatGPT or Claude: where the button goes, and knowing when it worked.
@Suite struct WebConnectTests {
    private func row(_ name: String, host: String?, kind: String = "oauth", at: Date, revoked: Bool = false) -> Connection {
        Connection(id: UUID(), name: name, kind: kind, can_write: true, created_at: at, last_used_at: nil,
                   revoked_at: revoked ? at : nil, redirect_host: host, url_used_at: nil)
    }

    @Test func eachWebAIHasAPlanThatOpensItsOwnSite() throws {
        let chatgpt = try #require(WebConnectPlan.forAI("ChatGPT"))
        let claude = try #require(WebConnectPlan.forAI("Claude"))
        let server = "https://example.supabase.co/functions/v1/mcp"
        #expect(chatgpt.setupPage(server: server).absoluteString == "https://chatgpt.com/plugins")
        #expect(claude.setupPage(server: server).host() == "claude.ai")
        #expect(WebConnectPlan.forAI("Claude Code") == nil, "Claude Code connects with a command, not the web")
        for plan in [chatgpt, claude] {
            #expect(plan.setupPage(server: server).scheme == "https")
            #expect(ConnectTrust.verifiedAI(host: plan.testPage.host() ?? "", loopback: false) == plan.ai)
        }
    }

    @Test func claudesInstallLinkFillsInNameAndAddress() throws {
        let server = "https://example.supabase.co/functions/v1/mcp"
        let url = WebConnectPlan.claude.setupPage(server: server)
        #expect(url.absoluteString == "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Amber%20Notes&connectorUrl=https%3A%2F%2Fexample.supabase.co%2Ffunctions%2Fv1%2Fmcp")
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(items.first { $0.name == "connectorUrl" }?.value == server, "decodes back to the exact address")
        #expect(WebConnectPlan.claude.prefills && !WebConnectPlan.chatgpt.prefills)
    }

    @Test func theTestQuestionIsCarriedInTheLink() throws {
        let url = WebConnectPlan.chatgpt.testPage
        let q = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value
        #expect(q == WebConnectPlan.testPrompt)
    }

    @Test func stepsSentToYourselfCarryTheAddressAndNoSecret() {
        let text = WebConnectPlan.claude.message(server: "https://example.supabase.co/functions/v1/mcp")
        #expect(text.contains("connectorUrl=https%3A%2F%2Fexample.supabase.co"), "Claude's link carries the address")
        #expect(WebConnectPlan.chatgpt.message(server: "https://example.supabase.co/functions/v1/mcp").contains("\nhttps://example.supabase.co/functions/v1/mcp\n"))
        #expect(!text.contains("pane_"), "a web connection never needs a token")
    }

    @Test func aNewSignInFromTheRightAIFinishesTheGuide() {
        let opened = Date.now
        let rows = [
            row("ChatGPT", host: "chatgpt.com", at: opened.addingTimeInterval(-3600)),   // an older one
            row("ChatGPT", host: "chatgpt.com", at: opened.addingTimeInterval(20)),
        ]
        #expect(ConnectCompletion.newConnection(rows, ai: "ChatGPT", since: opened)?.created_at == opened.addingTimeInterval(20))
        #expect(ConnectCompletion.newConnection(rows, ai: "Claude", since: opened) == nil)
    }

    @Test func oldRevokedTokenOrSpoofedConnectionsDontCount() {
        let opened = Date.now
        let later = opened.addingTimeInterval(10)
        let rows = [
            row("ChatGPT", host: "chatgpt.com", at: opened.addingTimeInterval(-60)),       // before the guide opened
            row("ChatGPT", host: "chatgpt.com", at: later, revoked: true),                  // disconnected
            row("ChatGPT", host: nil, kind: "token", at: later),                            // an access token
            row("ChatGPT", host: "chatgpt-login.example.com", at: later),                   // only the name says ChatGPT
        ]
        #expect(ConnectCompletion.newConnection(rows, ai: "ChatGPT", since: opened) == nil)
    }

    #if os(macOS)
    @Test func theFloatingStepsSitTopRightOnScreen() {
        let screen = CGRect(x: 0, y: 0, width: 1512, height: 944)
        let p = ConnectPanel.placement(screen: screen, size: CGSize(width: 360, height: 520))
        #expect(p.x + 360 <= screen.maxX && p.x > screen.midX)
        #expect(p.y + 520 <= screen.maxY && p.y >= screen.minY)
    }
    #endif
}

#if os(macOS)
import SwiftUI
import Supabase
extension AIEditSnapshots {
    /// The consent sheet for ChatGPT, Claude, and a client that only calls itself ChatGPT.
    @Test func consentHeaders() async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")
        for (name, uri, file) in [("ChatGPT", "https://chatgpt.com/connector_platform_oauth_redirect", "consent-chatgpt"),
                                  ("Claude", "https://claude.ai/api/mcp/auth_callback", "consent-claude"),
                                  ("ChatGPT", "https://chatgpt-login.example.com/cb", "consent-spoofed-name")] {
            let r = ConnectRequest(id: UUID(), client_name: name, redirect_host: URL(string: uri)!.host()!, redirect_uri: uri, loopback: false, wants_write: true)
            try await AppSnapshotTests.render(ConsentSheet(client: client, requestID: r.id, initial: .asking(r), finish: { _ in }), name: file, dark: false)
        }
    }
}

extension AIEditSnapshots {
    /// Connect ChatGPT and Claude: the guide, the floating steps, and "connected".
    @Test func webConnectGuides() async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")
        for plan in [WebConnectPlan.chatgpt, .claude] {
            let slug = plan.ai.lowercased()
            try await AppSnapshotTests.render(Form { WebConnectGuide(plan: plan, client: client) }.formStyle(.grouped).frame(width: 520, height: 560),
                                              name: "connect-\(slug)-guide", dark: false)
            try await AppSnapshotTests.render(Form { WebConnectGuide(plan: plan, client: client, started: true) }.formStyle(.grouped).frame(width: 360, height: 560),
                                              name: "connect-\(slug)-panel", dark: false)
            try await AppSnapshotTests.render(Form { WebConnectGuide(plan: plan, client: client, connected: true) }.formStyle(.grouped).frame(width: 360, height: 460),
                                              name: "connect-\(slug)-connected", dark: false)
        }
        try await AppSnapshotTests.render(Form { WebConnectGuide(plan: .chatgpt, client: client, started: true) }.formStyle(.grouped).frame(width: 360, height: 560),
                                          name: "connect-chatgpt-panel-dark", dark: true)
    }
}
#endif
