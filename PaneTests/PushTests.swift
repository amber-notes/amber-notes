import Foundation
import Testing
import UserNotifications
@testable import Pane

/// Push for AI connection asks: which APNs server, the token row, and what tapping a push does.
@Suite struct APNsEnvironmentTests {
    /// A provisioning profile as it sits in an app: signature bytes around the plist.
    private func profile(entitlements: String) -> Data {
        let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
        \t<key>AppIDName</key><string>Amber Notes</string>
        \t<key>Entitlements</key>
        \t<dict>
        \t\t<key>application-identifier</key><string>4UM3XVUN9Y.dev.emilwagman.pane</string>
        \(entitlements)
        \t</dict>
        \t<key>TeamIdentifier</key><array><string>4UM3XVUN9Y</string></array>
        </dict>
        </plist>
        """
        var data = Data([0x30, 0x80, 0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x07, 0x02, 0xA0, 0x80, 0x00, 0xFF])
        data.append(Data(plist.utf8))
        data.append(Data([0x00, 0x00, 0xA0, 0x82, 0x0B, 0x3C, 0x3C, 0x2F, 0x70, 0x6C, 0x69, 0x00]))
        return data
    }

    @Test func developmentProfilesAreSandbox() {
        #expect(APNsEnvironment.fromProfile(profile(entitlements: "<key>aps-environment</key><string>development</string>")) == .sandbox)
        // The Mac's key.
        #expect(APNsEnvironment.fromProfile(profile(entitlements: "<key>com.apple.developer.aps-environment</key><string>development</string>")) == .sandbox)
    }

    @Test func distributionProfilesAreProduction() {
        #expect(APNsEnvironment.fromProfile(profile(entitlements: "<key>aps-environment</key><string>production</string>")) == .production)
        #expect(APNsEnvironment.fromProfile(profile(entitlements: "<key>com.apple.developer.aps-environment</key><string>production</string>")) == .production)
    }

    @Test func noAnswerFallsBackToTheBuild() {
        let missing = profile(entitlements: "<key>get-task-allow</key><true/>")
        #expect(APNsEnvironment.fromProfile(missing) == nil)
        #expect(APNsEnvironment.fromProfile(Data("not a profile".utf8)) == nil)
        #expect(APNsEnvironment.fromProfile(profile(entitlements: "<key>aps-environment</key><string>staging</string>")) == nil)
        #if DEBUG
        let fallback = APNsEnvironment.sandbox
        #else
        let fallback = APNsEnvironment.production
        #endif
        #expect(APNsEnvironment.resolve(profile: nil) == fallback)
        #expect(APNsEnvironment.resolve(profile: missing) == fallback)
        #expect(APNsEnvironment.resolve(profile: profile(entitlements: "<key>aps-environment</key><string>production</string>")) == .production)
    }
}

@MainActor
private final class FakeTokens: PushTokenService {
    var registered: [PushTokenParams] = []
    var removed: [UUID] = []
    var fails = false

    func register(_ params: PushTokenParams) async throws {
        if fails { throw URLError(.notConnectedToInternet) }
        registered.append(params)
    }

    func remove(device: UUID) async throws { removed.append(device) }
}

@MainActor @Suite struct PushRegistrationTests {
    let device = UUID(uuidString: "0A1B2C3D-4E5F-4061-8293-A4B5C6D7E8F9")!
    let token = Data([0x00, 0x0F, 0xA0, 0xFF] + Array(repeating: UInt8(0xAB), count: 28))
    let tokenHex = "000fa0ff" + String(repeating: "ab", count: 28)

    private final class Calls { var register = 0, unregister = 0 }

    private func registration(_ calls: Calls, environment: APNsEnvironment = .sandbox) -> PushRegistration {
        PushRegistration(device: { device }, environment: { environment },
                         system: .init(register: { calls.register += 1 }, unregister: { calls.unregister += 1 }))
    }

    @Test func tokensAreLowercaseHex() {
        #expect(PushRegistration.hex(token) == tokenHex)
        #expect(PushRegistration.hex(Data([0xDE, 0xAD, 0xBE, 0xEF])) == "deadbeef")
        #expect(PushRegistration.hex(Data()) == "")
    }

    @Test func sendsTheTokenWithTheRightParameters() async {
        let calls = Calls(), service = FakeTokens()
        let push = registration(calls, environment: .production)
        await push.attach(account: UUID(), service: service)
        #expect(calls.register == 1, "signing in registers with the system")
        #expect(service.registered.isEmpty, "nothing to send before the system gives a token")
        await push.received(token: token)
        #expect(service.registered == [PushTokenParams(p_device: device.uuidString.lowercased(), p_platform: InstallID.platform,
                                                         p_token: tokenHex, p_environment: "production")])
        // The same token again (every launch) isn't sent again; a new one is.
        await push.received(token: token)
        #expect(service.registered.count == 1)
        await push.received(token: Data(repeating: 0x11, count: 32))
        #expect(service.registered.count == 2 && service.registered.last?.p_token == String(repeating: "11", count: 32))
    }

    @Test func theParametersAreWhatTheRPCTakes() throws {
        let params = PushTokenParams(p_device: device.uuidString.lowercased(), p_platform: "ios", p_token: tokenHex, p_environment: "sandbox")
        let json = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(params)) as? [String: String])
        #expect(json == ["p_device": "0a1b2c3d-4e5f-4061-8293-a4b5c6d7e8f9", "p_platform": "ios", "p_token": tokenHex, "p_environment": "sandbox"])
    }

    @Test func anotherAccountSendsItAgain() async {
        let calls = Calls(), service = FakeTokens()
        let push = registration(calls)
        let first = UUID()
        await push.received(token: token)
        await push.attach(account: first, service: service)
        #expect(service.registered.count == 1, "a token from before sign-in goes once signed in")
        await push.attach(account: first, service: service)
        #expect(service.registered.count == 1, "the same account again changes nothing")
        #expect(calls.register == 1)
        await push.attach(account: UUID(), service: service)
        #expect(service.registered.count == 2, "another account on this device sends it again")
        // Signed out, then the first account again: sent again.
        push.detach()
        await push.attach(account: first, service: service)
        #expect(service.registered.count == 3)
        #expect(calls.register == 2 && calls.unregister == 1)
    }

    @Test func aFailedSendIsTriedAgain() async {
        let calls = Calls(), service = FakeTokens()
        let push = registration(calls)
        service.fails = true
        await push.attach(account: UUID(), service: service)
        await push.received(token: token)
        #expect(service.registered.isEmpty)
        service.fails = false
        await push.received(token: token)
        #expect(service.registered.count == 1)
    }

    @Test func signingOutDeletesThisDevicesRowThenStops() async {
        let calls = Calls(), service = FakeTokens()
        let push = registration(calls)
        await push.attach(account: UUID(), service: service)
        await push.received(token: token)
        await push.signingOut()
        #expect(service.removed == [device])
        #expect(calls.unregister == 1 && !push.registered)
        // Nothing more goes to that account.
        await push.received(token: Data(repeating: 0x22, count: 32))
        #expect(service.registered.count == 1)
    }

    @Test func signingOutWhenNeverRegisteredDoesNothing() async {
        let calls = Calls()
        let push = registration(calls)
        await push.signingOut()
        push.detach()
        #expect(calls.unregister == 0)
    }

    @Test func deletingTheAccountStopsWithoutTouchingTheServer() async {
        let calls = Calls(), service = FakeTokens()
        let push = registration(calls)
        await push.attach(account: UUID(), service: service)
        push.accountDeleted()
        #expect(service.removed.isEmpty, "the server's cascade removed the row")
        #expect(calls.unregister == 1)
        await push.signingOut()
        #expect(service.removed.isEmpty, "the sign-out after it has no account to touch")
    }
}

/// A push is only "look now": tapping it opens its ask like a local notification, and the app
/// fetches the ask itself.
@MainActor @Suite struct PushTapTests {
    private func quietCenter() -> ConnectCenter {
        let c = ConnectCenter()
        #if os(macOS)
        c.activate = {}
        #endif
        return c
    }

    private final class Looks { var count = 0 }

    private func settle(_ looks: Looks, until n: Int) async {
        for _ in 0 ..< 200 where looks.count < n { try? await Task.sleep(for: .milliseconds(5)) }
    }

    @Test func readsTheAskFromAPushOrOurOwnNotification() {
        let id = UUID()
        #expect(ConnectNotifier.ask(in: ["aps": ["alert": ["title": "t"]], "ask": id.uuidString.lowercased()])?.id == id)
        #expect(ConnectNotifier.ask(in: ["ask": id.uuidString.lowercased()])?.push == true)
        #expect(ConnectNotifier.ask(in: [ConnectNotifier.userInfoKey: id.uuidString.lowercased()])?.push == false)
        #expect(ConnectNotifier.ask(in: ["ask": "not-an-id"]) == nil)
        #expect(ConnectNotifier.ask(in: ["ask": 42]) == nil)
        #expect(ConnectNotifier.ask(in: ["aps": ["alert": "hi"]]) == nil)
        #expect(ConnectNotifier.ask(in: [:]) == nil)
    }

    @Test func tappingAPushOpensTheAskAndLooksAgain() async {
        let center = quietCenter(), looks = Looks(), id = UUID()
        center.lookAgain = { looks.count += 1 }
        #expect(center.handleNotification(["aps": ["alert": ["title": "Allow"]], "ask": id.uuidString.lowercased()]))
        #expect(center.pending == id, "the sheet opens for it: it fetches the request and checks it")
        await settle(looks, until: 1)
        #expect(looks.count == 1, "and the asks are fetched now")
    }

    @Test func aPushWithoutAGoodIdDoesNothing() async {
        let center = quietCenter(), looks = Looks()
        center.lookAgain = { looks.count += 1 }
        #expect(!center.handleNotification(["aps": ["alert": ["title": "Allow"]], "ask": "../../etc"]))
        #expect(!center.handleNotification(["aps": ["alert": ["title": "Allow"]]]))
        #expect(!center.handleNotification(["ask": ["nested": true]]))
        try? await Task.sleep(for: .milliseconds(50))
        #expect(center.pending == nil && looks.count == 0)
    }

    @Test func aPushInFrontIsABannerOnlyWhenTheAskIsntHereYet() async {
        let center = quietCenter(), looks = Looks()
        center.lookAgain = { looks.count += 1 }
        let showing = ConnectAsk(request_id: UUID(), browser_key: "", started_from: "Chrome on a Mac", created_at: .now, expires_at: .now.addingTimeInterval(600))
        center.offer(showing)
        #expect(center.presentation(for: showing.id, push: true).isEmpty, "its sheet is showing: no second banner")
        let queued = ConnectAsk(request_id: UUID(), browser_key: "", started_from: "Safari", created_at: .now, expires_at: .now.addingTimeInterval(600))
        center.offer(queued)
        #expect(center.presentation(for: queued.id, push: true).isEmpty, "already queued behind it")
        #expect(center.presentation(for: UUID(), push: true).contains(.banner), "one realtime hasn't brought yet")
        #expect(center.presentation(for: UUID(), push: false).isEmpty, "our own notifications are only posted when the app isn't in front")
        await settle(looks, until: 3)
        #expect(looks.count == 3, "each push looks again; the local one doesn't")
    }
}
