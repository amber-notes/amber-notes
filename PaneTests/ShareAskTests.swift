import Foundation
import Testing
@testable import Pane

/// "Enjoying Amber Notes?": when it's due, that it's asked once, and what it opens.
@MainActor @Suite(.serialized) struct ShareAskTests {
    static let day: TimeInterval = 86400
    static let t0 = Date(timeIntervalSince1970: 1_790_000_000)

    static func defaults() -> UserDefaults {
        let name = "ShareAskTests.\(UUID().uuidString)"
        let d = UserDefaults(suiteName: name)!
        d.removePersistentDomain(forName: name)
        return d
    }

    /// Notes used on `n` different days, the last one a week after t0.
    static func usedOn(_ n: Int, _ d: UserDefaults) {
        for i in 0..<n { ShareAsk.noteUsed(now: t0.addingTimeInterval(Double(i) * 2 * day), defaults: d) }
    }

    final class FakeService: ShareAskService, @unchecked Sendable {
        var answered: ShareAsk.Choice?
        var fails = false
        var counted: [String] = []
        func decided() async throws -> Bool {
            if fails { throw URLError(.notConnectedToInternet) }
            return answered != nil
        }
        func decide(_ choice: ShareAsk.Choice) async throws { if answered == nil { answered = choice } }
        func count(_ event: String) async { counted.append(event) }
    }

    /// A store for an account made at t0, with the server answering from `service`.
    static func store(_ d: UserDefaults, service: FakeService? = FakeService()) -> ShareAskStore {
        let s = ShareAskStore(defaults: d, launched: t0, arguments: [])
        s.attach(account: UUID(), created: t0, service: service)
        return s
    }

    init() { ShareAsk.lastKeystroke = .distantPast }

    // MARK: The rule

    @Test func dueAfterSevenDaysAndThreeDaysOfUse() {
        let week = Self.t0.addingTimeInterval(7 * Self.day)
        #expect(ShareAsk.isDue(firstUse: Self.t0, activeDays: 3, decided: false, now: week))
        #expect(!ShareAsk.isDue(firstUse: Self.t0, activeDays: 3, decided: false, now: week.addingTimeInterval(-60)), "six days and change isn't a week")
        #expect(!ShareAsk.isDue(firstUse: Self.t0, activeDays: 2, decided: false, now: week.addingTimeInterval(30 * Self.day)), "a month in, but used on only 2 days")
        #expect(!ShareAsk.isDue(firstUse: Self.t0, activeDays: 5, decided: true, now: week), "answered already")
        #expect(!ShareAsk.isDue(firstUse: Self.t0, activeDays: 5, decided: nil, now: week), "the server hasn't said yet")
        #expect(!ShareAsk.isDue(firstUse: nil, activeDays: 5, decided: false, now: week))
    }

    @Test func daysOfUseAreDifferentCalendarDays() {
        let d = Self.defaults()
        for minute in 0..<5 { ShareAsk.noteUsed(typing: true, now: Self.t0.addingTimeInterval(Double(minute) * 60), defaults: d) }
        #expect(ShareAsk.activeDayCount(defaults: d) == 1, "typing all afternoon is one day")
        ShareAsk.noteUsed(now: Self.t0.addingTimeInterval(Self.day), defaults: d)
        ShareAsk.noteUsed(now: Self.t0, defaults: d)
        #expect(ShareAsk.activeDayCount(defaults: d) == 2, "going back to a day already counted adds nothing")
    }

    @Test func withoutAnAccountTheWeekStartsOnThisDevice() {
        let d = Self.defaults()
        d.set(Self.t0, forKey: ShareAsk.firstUseKey)
        Self.usedOn(3, d)
        let s = ShareAskStore(defaults: d, launched: Self.t0, arguments: [])
        #expect(s.decided == false, "no server: this device's answer is all there is")
        #expect(s.isDue(now: Self.t0.addingTimeInterval(8 * Self.day)))
        #expect(!s.isDue(now: Self.t0.addingTimeInterval(5 * Self.day)))
    }

    // MARK: Quiet moments

    @Test func asksAtAQuietMomentOnly() async {
        let d = Self.defaults()
        Self.usedOn(3, d)
        let service = FakeService()
        let s = Self.store(d, service: service)
        await s.refresh()
        let later = Self.t0.addingTimeInterval(8 * Self.day)
        s.moment(setupVisible: true, tipShowing: false, now: later)
        #expect(!s.visible, "never beside the Get set up card")
        s.moment(setupVisible: false, tipShowing: true, now: later)
        #expect(!s.visible, "never beside a tip")
        ShareAsk.lastKeystroke = later.addingTimeInterval(-3)
        s.moment(setupVisible: false, tipShowing: false, now: later)
        #expect(!s.visible, "never while you type")
        ShareAsk.lastKeystroke = .distantPast
        s.moment(setupVisible: false, tipShowing: false, now: later)
        #expect(s.visible)
        #expect(PaneTips.shareAskVisible, "tips wait while it shows")
        #expect(s.sent == ["shown"])
        s.closed()
        #expect(!PaneTips.shareAskVisible)
    }

    @Test func neverRightAtLaunch() async {
        let d = Self.defaults()
        Self.usedOn(3, d)
        let launch = Self.t0.addingTimeInterval(8 * Self.day)
        let s = ShareAskStore(defaults: d, launched: launch, arguments: [])
        s.attach(account: UUID(), created: Self.t0, service: FakeService())
        await s.refresh()
        s.moment(setupVisible: false, tipShowing: false, now: launch.addingTimeInterval(5))
        #expect(!s.visible)
        s.moment(setupVisible: false, tipShowing: false, now: launch.addingTimeInterval(ShareAsk.launchQuiet))
        #expect(s.visible)
    }

    // MARK: Once

    @Test func anyAnswerEndsItForGood() async {
        for choice in [ShareAsk.Choice.sharedX, .sharedLinkedIn, .dismissed] {
            let d = Self.defaults()
            Self.usedOn(3, d)
            let service = FakeService()
            let s = Self.store(d, service: service)
            await s.refresh()
            let later = Self.t0.addingTimeInterval(8 * Self.day)
            s.moment(setupVisible: false, tipShowing: false, now: later)
            let url = s.choose(choice)
            #expect((url != nil) == (choice != .dismissed))
            #expect(s.thanked == (choice != .dismissed), "sharing shows the thank-you")
            #expect(s.visible == (choice != .dismissed), "Not now closes it at once")
            s.closed()
            #expect(s.sent == ["shown", choice.rawValue])
            try? await Task.sleep(for: .milliseconds(50))
            #expect(service.answered == choice, "the server keeps the answer for every device")
            // Weeks later, on this device: never again.
            s.moment(setupVisible: false, tipShowing: false, now: later.addingTimeInterval(30 * Self.day))
            #expect(!s.visible)
        }
    }

    @Test func swipingItAwayCountsAsNotNow() async {
        let d = Self.defaults()
        Self.usedOn(3, d)
        let service = FakeService()
        let s = Self.store(d, service: service)
        await s.refresh()
        s.moment(setupVisible: false, tipShowing: false, now: Self.t0.addingTimeInterval(8 * Self.day))
        s.closed()
        #expect(s.decided == true)
        #expect(s.sent == ["shown", "dismissed"])
    }

    @Test func answeredOnAnotherDeviceMeansNeverHere() async {
        let d = Self.defaults()
        Self.usedOn(5, d)
        let service = FakeService()
        service.answered = .sharedLinkedIn
        let s = Self.store(d, service: service)
        let later = Self.t0.addingTimeInterval(20 * Self.day)
        s.moment(setupVisible: false, tipShowing: false, now: later)
        #expect(!s.visible, "not before the server has answered")
        await s.refresh()
        s.moment(setupVisible: false, tipShowing: false, now: later)
        #expect(!s.visible)
        #expect(s.decided == true)
    }

    @Test func unreachableServerMeansNoAsk() async {
        let d = Self.defaults()
        Self.usedOn(3, d)
        let service = FakeService()
        service.fails = true
        let s = Self.store(d, service: service)
        await s.refresh()
        #expect(s.decided == nil)
        #expect(!s.isDue(now: Self.t0.addingTimeInterval(8 * Self.day)))
    }

    @Test func anAnswerGivenOfflineReachesTheServerLater() async {
        let d = Self.defaults()
        let account = UUID()
        let offline = FakeService()
        offline.fails = true
        let s = ShareAskStore(defaults: d, launched: Self.t0, arguments: [])
        s.attach(account: account, created: Self.t0, service: offline)
        s.choose(.sharedX)
        // Next launch, online.
        let online = FakeService()
        let next = ShareAskStore(defaults: d, launched: Self.t0, arguments: [])
        next.attach(account: account, created: Self.t0, service: online)
        #expect(next.decided == true, "this device remembers its own answer")
        await next.refresh()
        #expect(online.answered == .sharedX)
    }

    @Test func anotherAccountOnThisDeviceIsAskedItsOwnQuestion() {
        let d = Self.defaults()
        let s = Self.store(d)
        s.choose(.dismissed)
        let other = ShareAskStore(defaults: d, launched: Self.t0, arguments: [])
        other.attach(account: UUID(), created: Self.t0, service: FakeService())
        #expect(other.decided == nil, "waits for the server, not the other account's answer")
    }

    // MARK: Dev and links

    @Test func devForceShowsItAndSendsNothing() {
        let d = Self.defaults()
        let s = ShareAskStore(defaults: d, launched: .now, arguments: ["-forceShareAsk"])
        s.attach(account: UUID(), created: .now, service: FakeService())
        s.moment(setupVisible: false, tipShowing: false)
        #expect(!s.visible, "only the Dev trigger shows it")
        s.showIfForced()
        #expect(s.visible)
        s.choose(.sharedX)
        #expect(s.sent.isEmpty)
        #expect(s.decided == nil, "a Dev run never answers for the account")
        s.closed()
    }

    @Test func theLinksCarryThePost() throws {
        let x = ShareAsk.xURL.absoluteString
        #expect(x.hasPrefix("https://x.com/intent/post?text=I%E2%80%99ve%20been%20using%20Amber%20Notes%3A%20a%20simple%20notes%20app"))
        #expect(x.hasSuffix("&url=https%3A%2F%2Fambernotes.app"))
        let text = try #require(URLComponents(url: ShareAsk.xURL, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "text" }?.value)
        #expect(text == ShareAsk.postText)
        #expect(text.hasSuffix("ChatGPT and Claude can actually read and edit. Free."))
        #expect(ShareAsk.linkedInURL.absoluteString == "https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fambernotes.app")
    }
}
