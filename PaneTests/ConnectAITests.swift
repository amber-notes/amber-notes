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
        #expect(ConnectTrust.isKnown(host: "chatgpt.com", loopback: false))
        #expect(ConnectTrust.isKnown(host: "claude.ai", loopback: false))
        #expect(!ConnectTrust.isKnown(host: "chatgpt.com.evil.example", loopback: false))
        #expect(!ConnectTrust.isKnown(host: "notclaude.ai", loopback: false))
        #expect(!ConnectTrust.isKnown(host: "127.0.0.1", loopback: true))
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
}


/// The consent sheet shows an AI's mark only when the approval really goes to that AI.
@Suite struct ConsentMarkTests {
    @Test func theMarkComesFromTheAddressNotTheName() {
        #expect(ConnectTrust.verifiedAI(host: "chatgpt.com", loopback: false) == "ChatGPT")
        #expect(ConnectTrust.verifiedAI(host: "chat.openai.com", loopback: false) == "ChatGPT")
        #expect(ConnectTrust.verifiedAI(host: "claude.ai", loopback: false) == "Claude")
        #expect(ConnectTrust.verifiedAI(host: "claude.com", loopback: false) == "Claude")
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

#if os(macOS)
import SwiftUI
import Supabase
extension AIEditSnapshots {
    /// The consent sheet for ChatGPT, Claude, and a client that only calls itself ChatGPT.
    @Test func consentHeaders() async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")
        for (name, host, file) in [("ChatGPT", "chatgpt.com", "consent-chatgpt"), ("Claude", "claude.ai", "consent-claude"), ("ChatGPT", "chatgpt-login.example.com", "consent-spoofed-name")] {
            let r = ConnectRequest(id: UUID(), client_name: name, redirect_host: host, loopback: false, wants_write: true)
            try await AppSnapshotTests.render(ConsentSheet(client: client, requestID: r.id, initial: .asking(r), finish: { _ in }), name: file, dark: false)
        }
    }
}
#endif
