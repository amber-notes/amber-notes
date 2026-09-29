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
