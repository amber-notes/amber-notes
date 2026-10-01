import CryptoKit
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
        let id = UUID()
        #expect(ConnectLink.requestID(from: URL(string: "ambernotes://connect?request=nope")!) == nil)
        #expect(ConnectLink.requestID(from: URL(string: "ambernotes://open?request=\(UUID().uuidString)")!) == nil)
        #expect(ConnectLink.requestID(from: URL(string: "https://connect?request=\(UUID().uuidString)")!) == nil)
        // The site's universal link opens the same request.
        #expect(ConnectLink.requestID(from: URL(string: "https://ambernotes.app/open/connect?request=\(id.uuidString.lowercased())")!) == id)
        #expect(ConnectLink.requestID(from: URL(string: "https://www.ambernotes.app/open/connect?request=\(id.uuidString)")!) == id)
        #expect(ConnectLink.requestID(from: URL(string: "https://ambernotes.app/connect?request=\(id.uuidString)")!) == nil, "the web page itself isn't the app's link")
        #expect(ConnectLink.requestID(from: URL(string: "https://evil.example/open/connect?request=\(id.uuidString)")!) == nil)
        #expect(ConnectLink.requestID(from: URL(string: "http://ambernotes.app/open/connect?request=\(id.uuidString)")!) == nil)
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
        #expect(otherPath.claimedName == nil, "no plain claim from the server: none shown")
        #expect(req("ChatGPT", nil).verifiedAI == nil)
        let local = ConnectRequest(id: UUID(), client_name: "An app on this computer", redirect_host: "127.0.0.1", redirect_uri: "http://127.0.0.1:4000/cb", claimed_name: "claude code", loopback: true, wants_write: true)
        #expect(local.who == "an app on this computer")
        #expect(local.claimedName == "claude code")
        // The claim is only ever the server's plain version, never the raw name.
        #expect(req("CIaude", "https://attacker.example/cb").claimedName == nil)
        #expect(ConnectRequest(id: UUID(), client_name: "Claude", redirect_host: "claude.ai", redirect_uri: "https://claude.ai/api/mcp/auth_callback", claimed_name: "claude", loopback: false, wants_write: true).claimedName == nil)
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

/// A request asked from a browser elsewhere: no mark or name, number matching, and the address the
/// code goes to built here exactly as the server builds it.
@Suite struct AskedRequestTests {
    private func asked(_ uri: String, claimed: String? = "Claude") -> ConnectRequest {
        ConnectRequest(id: UUID(), client_name: URL(string: uri)!.host()!, redirect_host: URL(string: uri)!.host()!, redirect_uri: uri,
                       claimed_name: claimed, loopback: false, wants_write: true, asked: true, started_from: "Chrome on a Mac",
                       state: "s1", iss: "https://mcp.ambernotes.app")
    }

    @Test func anAskedRequestNeverShowsAnAIsMarkOrName() {
        let r = asked("https://claude.ai/api/mcp/auth_callback")
        #expect(r.verifiedAI == nil, "even Claude's own callback: whoever asked is the page that waits")
        #expect(r.who == "claude.ai")
        #expect(r.claimedName == "Claude", "shown only as what it calls itself")
        var here = r
        here.asked = false
        #expect(here.verifiedAI == "Claude", "the same request by link on this device keeps its mark")
    }

    @Test func theRedirectIsBuiltAsTheServerBuildsIt() {
        #expect(asked("https://claude.ai/api/mcp/auth_callback").handoffRedirect == "https://claude.ai/api/mcp/auth_callback?state=s1&iss=https%3A%2F%2Fmcp.ambernotes.app")
        // URLSearchParams: existing parameters are rewritten form-encoded, `set` replaces.
        #expect(ConnectAPI.clientRedirect("https://a.example/cb?x=1&state=old&y=a+b%21&state=again", state: "n w", iss: "https://i.example/")
                == "https://a.example/cb?x=1&state=n+w&y=a+b%21&iss=https%3A%2F%2Fi.example%2F")
        #expect(ConnectAPI.clientRedirect("http://127.0.0.1:4000/cb", state: nil, iss: "https://mcp.ambernotes.app")
                == "http://127.0.0.1:4000/cb?iss=https%3A%2F%2Fmcp.ambernotes.app", "no state: none added")
        #expect(ConnectAPI.clientRedirect("https://a.example/cb#frag", state: "é~*", iss: "x") == "https://a.example/cb?state=%C3%A9%7E*&iss=x#frag")
        var old = asked("https://claude.ai/api/mcp/auth_callback")
        old.iss = nil
        #expect(old.handoffRedirect == nil, "a server that doesn't say: nothing to seal")
    }

    @Test func theTitleNeverSaysWhoItIs() {
        #expect(ConsentSheet.title(asked("https://claude.ai/api/mcp/auth_callback")) == "An app that says it's Claude wants to use your notes")
        #expect(ConsentSheet.title(asked("https://claude.ai/api/mcp/auth_callback", claimed: nil)) == "An app wants to use your notes")
        var here = asked("https://claude.ai/api/mcp/auth_callback")
        here.asked = false
        #expect(ConsentSheet.title(here) == "Allow Claude to use your notes?")
    }

    @Test func theKeypadTakesTwoDigits() {
        var typed = ""
        for key in ["4", "x", "12", "2", "9"] { typed = ConnectMatch.typing(typed, key) }
        #expect(typed == "42", "a third digit, and anything but a digit, is ignored")
        typed = ConnectMatch.typing(typed, "delete")
        #expect(typed == "4")
        #expect(ConnectMatch.typing(ConnectMatch.typing("", "delete"), "0") == "0")
    }

    @MainActor @Test func aDeviceWritesOneNoncePerRequestAndCommit() {
        let a = UUID(), b = UUID()
        let c1 = String(repeating: "1", count: 64), c2 = String(repeating: "2", count: 64)
        let first = ConnectMatch.deviceNonce(for: a, commit: c1)
        #expect(first.count == 16 && ConnectMatch.deviceNonce(for: a, commit: c1) == first)
        #expect(ConnectMatch.deviceNonce(for: b, commit: c1) != first)
        #expect(ConnectMatch.deviceNonce(for: a, commit: c2) != first, "a new commit on the same request never reuses the nonce")
    }
}

/// Number matching against a database writer: the key and commit this device read first are the
/// only ones it ever shows a number for or seals the code to. Anything that changes them after
/// that declines the request.
@MainActor @Suite struct ConnectMatchSnapshotTests {
    let id = UUID()
    let redirect = "https://chatgpt.com/connector_platform_oauth_redirect"

    /// A page: its key and nonce, and the commit it made.
    struct Page {
        let secret = P256.KeyAgreement.PrivateKey()
        let nonce = E2EE.randomBytes(16)
        var key: Data { secret.publicKey.x963Representation }
        var commit: String { E2EE.matchCommit(browserKey: key, pageNonce: nonce) }
        func asked() -> ConnectAskMatch { ConnectAskMatch(browser_key: key.base64EncodedString(), match_commit: commit) }
        func revealed(_ nd: Data) -> ConnectAskMatch {
            ConnectAskMatch(browser_key: key.base64EncodedString(), match_commit: commit, device_nonce: E2EE.hex(nd), page_nonce: E2EE.hex(nonce))
        }
    }

    /// What the ask says on each read, in order; the last one again after that. Records the
    /// nonce this device writes, and every body sent to /connect/decide.
    final class Ask: @unchecked Sendable {
        var reads: [ConnectAskMatch?]
        var written: Data?
        var sent: [[String: Any]] = []
        var codesMade = 0
        init(_ reads: [ConnectAskMatch?]) { self.reads = reads }
        func read() -> ConnectAskMatch? { reads.count > 1 ? reads.removeFirst() : reads.first ?? nil }
        var send: ConnectAPI.Send {
            { _, _, body in
                self.sent.append(body ?? [:])
                return try JSONSerialization.data(withJSONObject: ["handoff": true])
            }
        }
    }

    func request() -> ConnectRequest {
        ConnectRequest(id: id, client_name: "chatgpt.com", redirect_host: "chatgpt.com", redirect_uri: redirect, loopback: false,
                       wants_write: true, asked: true, state: "s1", iss: "https://mcp.ambernotes.app")
    }

    func follow(_ ask: Ask) async throws -> ConnectMatch.Outcome {
        try await ConnectMatch.follow(requestID: id, read: { ask.read() }, write: { ask.written = $0 }, poll: .milliseconds(1))
    }

    func answer(_ ask: Ask, allow: Bool, wrongNumber: Bool = false, match: ConnectMatch.Match?) async throws -> ConnectAPI.Answered {
        let secret = "amb_code_" + E2EE.randomHex()
        return try await ConnectAPI.answer(request(), allow: allow, write: true, wrongNumber: wrongNumber, match: match, read: { ask.read() },
                                           code: { ask.codesMade += 1; return (secret, E2EE.sha256Hex(secret), "amb2.0123456789abcdef.AAAA") },
                                           send: ask.send)
    }

    /// The ask on its first read, with this device's nonce then written on it.
    func shown(_ page: Page) async throws -> (ask: Ask, match: ConnectMatch.Match) {
        let nd = ConnectMatch.deviceNonce(for: id, commit: page.commit)
        let ask = Ask([page.asked(), page.asked(), page.revealed(nd)])
        guard case .number(let m) = try await follow(ask) else { throw ConnectAPI.Failure(message: "no number") }
        return (ask, m)
    }

    @Test func anUnchangedAskShowsThePagesNumberAndSealsToItsKey() async throws {
        let page = Page()
        let (ask, m) = try await shown(page)
        let nd = try #require(ask.written)
        #expect(m.number == E2EE.matchNumber(browserKey: page.key, pageNonce: page.nonce, deviceNonce: nd, requestID: id))
        #expect(m.key == page.key)
        #expect(try await answer(ask, allow: true, match: m) == .answered(.handedOff))
        let sealed = try #require(ask.sent.first?["handoff"] as? String)
        #expect(try E2EE.openHandoff(sealed, browserPrivate: page.secret, requestID: id).contains("\"code\""), "the page opens it")
    }

    @Test func keyCommitAndRevealSwappedTogetherAfterTheNonceIsDeclinedWithNoNumber() async throws {
        let page = Page(), writer = Page()
        let nd = ConnectMatch.deviceNonce(for: id, commit: page.commit)
        // Once this device's nonce is known, a writer swaps in its own key, a commit to it and a
        // nonce ground against Nd: on its own that row opens and gives a number.
        let swapped = writer.revealed(nd)
        guard case .number = ConnectMatch.check(swapped, deviceNonce: nd, requestID: id) else {
            Issue.record("the swapped row is self-consistent"); return
        }
        let ask = Ask([page.asked(), swapped])
        #expect(try await follow(ask) == .changed, "never a number for a row other than the first read")
        #expect(ask.written == nd, "the nonce went on against the first read's commit")
        // The sheet then declines: not as a wrong number, and nothing made or sealed.
        #expect(try await answer(ask, allow: false, match: nil) == .answered(.handedOff))
        let body = try #require(ask.sent.first)
        #expect(body["allow"] as? Bool == false && body["wrong_number"] == nil && body["handoff"] == nil && body["code_hash"] == nil)
        #expect(ask.codesMade == 0)
    }

    @Test func theKeyAloneChangedIsDeclined() async throws {
        let page = Page(), writer = Page()
        let nd = ConnectMatch.deviceNonce(for: id, commit: page.commit)
        var swapped = page.revealed(nd)
        swapped = ConnectAskMatch(browser_key: writer.key.base64EncodedString(), match_commit: swapped.match_commit,
                                  device_nonce: swapped.device_nonce, page_nonce: swapped.page_nonce)
        #expect(try await follow(Ask([page.asked(), swapped])) == .changed)
        // Also before this device's nonce is on it.
        let early = ConnectAskMatch(browser_key: writer.key.base64EncodedString(), match_commit: page.commit)
        #expect(try await follow(Ask([page.asked(), early])) == .changed)
    }

    @Test func anAskChangedWhileItsNumberShowsIsDeclinedAndNothingIsSealed() async throws {
        let page = Page(), writer = Page()
        let (ask, m) = try await shown(page)
        let nd = try #require(ask.written)
        // Allowing with the page's number: the ask now carries another key, commit and reveal.
        ask.reads = [writer.revealed(nd)]
        #expect(try await answer(ask, allow: true, match: m) == .declinedChanged)
        #expect(ask.sent.count == 1 && ask.codesMade == 0, "no code is made")
        let body = try #require(ask.sent.first)
        #expect(body["allow"] as? Bool == false && body["handoff"] == nil && body["code_hash"] == nil && body["wrong_number"] == nil)

        // A wrong number typed meanwhile: declined as changed, not as a wrong number.
        ask.sent = []
        #expect(try await answer(ask, allow: false, wrongNumber: true, match: m) == .declinedChanged)
        #expect(ask.sent.first?["wrong_number"] == nil && ask.sent.first?["allow"] as? Bool == false)

        // The key alone changed: the same.
        ask.sent = []
        let rekeyed = ConnectAskMatch(browser_key: writer.key.base64EncodedString(), match_commit: m.row.match_commit,
                                      device_nonce: m.row.device_nonce, page_nonce: m.row.page_nonce)
        ask.reads = [rekeyed]
        #expect(ConnectMatch.recheck(m, now: rekeyed) == .changed)
        #expect(try await answer(ask, allow: true, match: m) == .declinedChanged)
        #expect(ask.sent.first?["handoff"] == nil)

        // Watching the number: returns as soon as the ask changes.
        ask.reads = [m.row, m.row, rekeyed]
        #expect(try await ConnectMatch.watch(m, read: { ask.read() }, poll: .milliseconds(1)) == .changed)
        ask.reads = [m.row, nil]
        #expect(try await ConnectMatch.watch(m, read: { ask.read() }, poll: .milliseconds(1)) == .expired)
    }

    @Test func aWrongNumberOnAnUnchangedAskIsAWrongNumber() async throws {
        let (ask, m) = try await shown(Page())
        #expect(try await answer(ask, allow: false, wrongNumber: true, match: m) == .answered(.handedOff))
        #expect(ask.sent.first?["wrong_number"] as? Bool == true && ask.codesMade == 0)
    }
}

/// One sheet at a time: what arrives while it's showing waits its turn.
@MainActor @Suite struct ConnectQueueTests {
    private func ask(_ id: UUID = UUID()) -> ConnectAsk {
        ConnectAsk(request_id: id, browser_key: "", started_from: "Chrome on a Mac", created_at: .now, expires_at: .now.addingTimeInterval(600))
    }

    private func link(_ id: UUID) -> URL { URL(string: "ambernotes://connect?request=\(id.uuidString.lowercased())")! }

    private func quietCenter() -> ConnectCenter {
        let c = ConnectCenter()
        #if os(macOS)
        c.activate = {}
        #endif
        return c
    }

    @Test func aLinkArrivingWhileASheetShowsWaitsItsTurn() {
        let center = quietCenter()
        let first = UUID(), second = UUID()
        center.receive(link(first))
        #expect(center.pending == first)
        center.receive(link(second))
        #expect(center.pending == first, "the sheet showing isn't replaced")
        #expect(center.queue == [second])
        center.receive(link(first))
        #expect(center.pending == first && center.queue == [second], "the same link again changes nothing")
        center.sheetClosed()
        center.showNext()
        #expect(center.pending == second && center.queue.isEmpty)
    }

    @Test func aLinkDoesntReplaceAnAskAndAnAskDoesntReplaceALink() {
        let center = quietCenter()
        let a = ask(), l = UUID(), b = ask()
        center.offer(a)
        #expect(center.pending == a.id)
        center.receive(link(l))
        #expect(center.pending == a.id && center.queue == [l])
        center.offer(b)
        #expect(center.pending == a.id && center.queue == [l, b.id])
        center.sheetClosed()
        center.showNext()
        #expect(center.pending == l)
        center.sheetClosed()
        center.showNext()
        #expect(center.pending == b.id)
    }
}

/// Connect ChatGPT or Claude: where the button goes, and knowing when it worked.
@Suite struct WebConnectTests {
    private func row(_ name: String, host: String?, kind: String = "oauth", at: Date, revoked: Bool = false) -> Connection {
        Connection(id: UUID(), name: name, kind: kind, can_write: true, created_at: at, last_used_at: nil,
                   revoked_at: revoked ? at : nil, redirect_host: host)
    }

    @Test func anUnverifiedConnectionIsTitledByWhereAccessWent() {
        let now = Date.now
        #expect(row("Claude", host: "claude.ai", at: now).title == "Claude")
        // Old grants still carry the name the app gave itself; the list doesn't use it.
        #expect(row("CIaude", host: "attacker.example", at: now).title == "attacker.example")
        #expect(row("\u{13DF}laude", host: "claude.ai.attacker.example", at: now).title == "claude.ai.attacker.example")
        #expect(row("Claude Code", host: "127.0.0.1", at: now).title == "An app on this computer")
        // Access tokens are named by the person, in the app.
        #expect(row("My laptop", host: nil, kind: "token", at: now).title == "My laptop")
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

/// Connect Incredible: a local app, so the guide never vouches for the name.
@Suite struct IncredibleConnectTests {
    private func row(host: String?, kind: String = "oauth", at: Date, revoked: Bool = false) -> Connection {
        Connection(id: UUID(), name: "An app on this computer", kind: kind, can_write: false, created_at: at, last_used_at: nil,
                   revoked_at: revoked ? at : nil, redirect_host: host)
    }

    @Test func isInTheListAfterTheOthers() {
        #expect(ConnectAISection.Guide.allCases.map(\.title) == ["ChatGPT", "Claude", "Claude Code", "Codex", "Incredible"])
        #expect(AIGlyph.asset("Incredible") == "AIGlyphIncredible")
        #expect(WebConnectPlan.forAI("Incredible") == nil, "Incredible is added in Incredible, not on a website")
    }

    @Test func aNewSignInToThisComputerFinishesTheGuide() {
        let opened = Date.now
        let rows = [
            row(host: "127.0.0.1", at: opened.addingTimeInterval(-3600)),   // an older one
            row(host: "127.0.0.1", at: opened.addingTimeInterval(20)),
        ]
        #expect(IncredibleConnect.newConnection(rows, since: opened)?.created_at == opened.addingTimeInterval(20))
        #expect(IncredibleConnect.newConnection([row(host: "localhost", at: opened.addingTimeInterval(5))], since: opened) != nil)
    }

    @Test func webAppsTokensAndOldOrRevokedSignInsDontCount() {
        let opened = Date.now
        let later = opened.addingTimeInterval(10)
        let rows = [
            row(host: "127.0.0.1", at: opened.addingTimeInterval(-60)),     // before the guide opened
            row(host: "127.0.0.1", at: later, revoked: true),                // disconnected
            row(host: nil, kind: "token", at: later),                        // an access token
            row(host: "incredible.one", at: later),                          // a website, whatever it's called
            row(host: "claude.ai", at: later),
        ]
        #expect(IncredibleConnect.newConnection(rows, since: opened) == nil)
    }

    @Test func stepsSentToYourselfCarryTheAddressAndNoSecret() {
        let server = "https://mcp.ambernotes.app"
        let text = IncredibleConnect.message(server: server)
        #expect(text.hasSuffix("\n\(server)"))
        #expect(text.contains("search for Amber Notes") && text.contains("Let's go"), "the built-in app comes first")
        #expect(text.contains("Add another MCP server") && text.contains("Add server"), "older versions add the address")
        #expect(!text.contains("pane_"), "Incredible signs in; it never needs a token")
    }

    @Test func copyFollowsTheWritingRules() {
        for line in IncredibleConnect.steps + [IncredibleConnect.olderVersion, IncredibleConnect.consentNote, IncredibleConnect.message(server: "https://mcp.ambernotes.app")] {
            #expect(!line.contains("\u{2014}"), "no em dashes: \(line)")
            #expect(!line.localizedCaseInsensitiveContains("ipad"))
        }
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
extension AIEditSnapshots {
    /// Connect Incredible: the guide with and without the app on this Mac, "connected", and the
    /// consent sheet it gets (a local app, named by where access goes).
    @Test func incredibleGuide() async throws {
        guard AppSnapshotTests.dir != nil else { return }
        let client = SupabaseClient(supabaseURL: URL(string: "http://127.0.0.1:9")!, supabaseKey: "test")
        try await AppSnapshotTests.render(Form { IncredibleGuide(client: client, installed: true) }.formStyle(.grouped).frame(width: 560, height: 760),
                                          name: "connect-incredible-guide", dark: false)
        try await AppSnapshotTests.render(Form { IncredibleGuide(client: client, installed: false) }.formStyle(.grouped).frame(width: 560, height: 760),
                                          name: "connect-incredible-not-installed", dark: false)
        try await AppSnapshotTests.render(Form { IncredibleGuide(client: client, installed: true) }.formStyle(.grouped).frame(width: 560, height: 760),
                                          name: "connect-incredible-guide-dark", dark: true)
        try await AppSnapshotTests.render(Form { IncredibleGuide(client: client, connected: true, installed: true) }.formStyle(.grouped).frame(width: 560, height: 520),
                                          name: "connect-incredible-connected", dark: false)
        try await AppSnapshotTests.render(Form { ConnectAISection(client: client, preview: []) }.formStyle(.grouped).frame(width: 560, height: 560),
                                          name: "connect-list", dark: false)
        let local = ConnectRequest(id: UUID(), client_name: "An app on this computer", redirect_host: "127.0.0.1",
                                   redirect_uri: "http://127.0.0.1:53682/callback", claimed_name: "incredible", loopback: true, wants_write: true)
        try await AppSnapshotTests.render(ConsentSheet(client: client, requestID: local.id, initial: .asking(local), finish: { _ in }),
                                          name: "consent-incredible", dark: false)
    }
}
#endif
