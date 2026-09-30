import Foundation
import Testing
@testable import Pane

/// "Enjoying Amber Notes?": when it's due, that it's asked once, and what it opens.
@MainActor @Suite(.serialized) struct ShareAskTests {
    static let day: TimeInterval = 86400
    /// Days are counted in the device's calendar; tests pin one so they read the same in any zone.
    static let cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
    /// 21 Sep 2026, 14:13 UTC: mid-afternoon, far from midnight.
    static let t0 = Date(timeIntervalSince1970: 1_790_000_000)

    static func defaults() -> UserDefaults { TestDefaults() }

    /// Notes used on `n` different days, every other day from t0.
    static func usedOn(_ n: Int, _ d: UserDefaults) {
        for i in 0..<n { ShareAsk.noteUsed(now: t0.addingTimeInterval(Double(i) * 2 * day), defaults: d, calendar: Self.cal) }
    }

    /// The server: one account's answer and its days of use from every device.
    final class FakeService: ShareAskService, @unchecked Sendable {
        var answered: ShareAsk.Choice?
        var days: Set<String> = []
        var fails = false
        var counted: [String] = []
        func state() async throws -> ShareAskState {
            if fails { throw URLError(.notConnectedToInternet) }
            return ShareAskState(decided: answered != nil, days: days.count)
        }
        func addDays(_ new: [String]) async throws {
            if fails { throw URLError(.notConnectedToInternet) }
            days.formUnion(new)
        }
        func decide(_ choice: ShareAsk.Choice) async throws { if answered == nil { answered = choice } }
        func count(_ event: String) async { counted.append(event) }
    }

    /// A store for an account, with the server answering from `service`.
    static func store(_ d: UserDefaults, service: FakeService? = FakeService(), account: UUID = UUID()) -> ShareAskStore {
        let s = ShareAskStore(defaults: d, launched: t0, arguments: [])
        s.attach(account: account, service: service)
        return s
    }

    /// Well after launch, with nothing typed.
    static let later = t0.addingTimeInterval(30 * day)

    init() {
        ShareAsk.lastKeystroke = .distantPast
        ShareAsk.onNewDay = {}
    }

    // MARK: The rule

    @Test func dueAfterSevenDaysOfUse() {
        #expect(ShareAsk.isDue(activeDays: 7, decided: false))
        #expect(!ShareAsk.isDue(activeDays: 6, decided: false), "six days of use isn't a week")
        #expect(!ShareAsk.isDue(activeDays: 30, decided: true), "answered already")
        #expect(!ShareAsk.isDue(activeDays: 30, decided: nil), "the server hasn't said yet")
    }

    @Test func daysOfUseAreDifferentCalendarDays() {
        let d = Self.defaults()
        for minute in 0..<5 { ShareAsk.noteUsed(typing: true, now: Self.t0.addingTimeInterval(Double(minute) * 60), defaults: d, calendar: Self.cal) }
        #expect(ShareAsk.localDays(defaults: d).count == 1, "typing all afternoon is one day")
        ShareAsk.noteUsed(now: Self.t0.addingTimeInterval(Self.day), defaults: d, calendar: Self.cal)
        ShareAsk.noteUsed(now: Self.t0, defaults: d, calendar: Self.cal)
        #expect(ShareAsk.localDays(defaults: d).count == 2, "going back to a day already counted adds nothing")
        #expect(ShareAsk.localDays(defaults: d) == ["2026-09-21", "2026-09-22"], "sent as yyyy-MM-dd")
    }

    @Test func aDayIsTheDevicesOwnCalendarDay() {
        // 23:30 and 00:30 the next day in Stockholm are two days there, one day in UTC.
        var stockholm = Calendar(identifier: .gregorian)
        stockholm.timeZone = TimeZone(identifier: "Europe/Stockholm")!
        let late = stockholm.date(from: DateComponents(year: 2026, month: 9, day: 29, hour: 23, minute: 30))!
        let early = late.addingTimeInterval(3600)
        #expect(ShareAsk.day(late, calendar: stockholm) == "2026-09-29")
        #expect(ShareAsk.day(early, calendar: stockholm) == "2026-09-30")
        #expect(ShareAsk.day(late, calendar: Self.cal) == ShareAsk.day(early, calendar: Self.cal))
        let d = Self.defaults()
        ShareAsk.noteUsed(now: late, defaults: d, calendar: stockholm)
        ShareAsk.noteUsed(now: early, defaults: d, calendar: stockholm)
        #expect(ShareAsk.localDays(defaults: d) == ["2026-09-29", "2026-09-30"])
    }

    @Test func aFreshDeviceIsNeverMistakenForTheLastOne() {
        // The first day on a new store counts, even on the same day as the last one noted elsewhere.
        for _ in 0..<20 {
            let d = Self.defaults()
            ShareAsk.noteUsed(now: Self.t0, defaults: d, calendar: Self.cal)
            #expect(ShareAsk.localDays(defaults: d) == ["2026-09-21"])
        }
    }

    @Test func sevenDaysNeedNotBeInARowNorAWeekSinceSignUp() async {
        // Seven days of use spread over two weeks count; so do seven in a row the week you signed up.
        let d = Self.defaults()
        Self.usedOn(6, d)
        let s = Self.store(d)
        await s.refresh()
        #expect(!s.isDue(now: Self.later))
        ShareAsk.noteUsed(now: Self.t0.addingTimeInterval(13 * Self.day), defaults: d, calendar: Self.cal)
        await s.refresh()
        #expect(s.activeDays == 7)
        #expect(s.isDue(now: Self.later))
    }

    @Test func daysOnEveryDeviceAddUp() async {
        // Four days on the Mac, three other days (and one shared) on the iPhone: seven in all.
        let server = FakeService()
        let mac = Self.defaults(), phone = Self.defaults()
        let account = UUID()
        for i in 0..<4 { ShareAsk.noteUsed(now: Self.t0.addingTimeInterval(Double(i) * Self.day), defaults: mac, calendar: Self.cal) }
        for i in 3..<7 { ShareAsk.noteUsed(now: Self.t0.addingTimeInterval(Double(i) * Self.day), defaults: phone, calendar: Self.cal) }
        let onMac = Self.store(mac, service: server, account: account)
        await onMac.refresh()
        #expect(!onMac.isDue(now: Self.later), "the Mac alone has 4")
        let onPhone = Self.store(phone, service: server, account: account)
        await onPhone.refresh()
        #expect(onPhone.activeDays == 7)
        #expect(onPhone.isDue(now: Self.later))
        await onMac.refresh()
        #expect(onMac.isDue(now: Self.later), "the Mac hears about the iPhone's days too")
    }

    @Test func daysAreSentOnceAndOfflineDaysLater() async {
        let d = Self.defaults()
        let server = FakeService()
        server.fails = true
        Self.usedOn(7, d)
        let s = Self.store(d, service: server)
        await s.refresh()
        #expect(server.days.isEmpty)
        #expect(s.activeDays == 7, "this device's own days count while the server can't be reached")
        server.fails = false
        await s.refresh()
        #expect(server.days.count == 7)
        #expect(Set(d.stringArray(forKey: ShareAsk.sentKey) ?? []) == server.days)
    }

    @Test func withoutAnAccountThisDevicesDaysAreAllThereIs() {
        let d = Self.defaults()
        Self.usedOn(7, d)
        let s = ShareAskStore(defaults: d, launched: Self.t0, arguments: [])
        #expect(s.decided == false, "no server: this device's answer is all there is")
        #expect(s.isDue(now: Self.later))
    }

    // MARK: Quiet moments

    @Test func asksAtAQuietMomentOnly() async {
        let d = Self.defaults()
        Self.usedOn(7, d)
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
        Self.usedOn(7, d)
        let launch = Self.t0.addingTimeInterval(8 * Self.day)
        let s = ShareAskStore(defaults: d, launched: launch, arguments: [])
        s.attach(account: UUID(), service: FakeService())
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
            Self.usedOn(7, d)
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
            // The answer goes to the server in the background: wait for it (slow CI runners need more than a moment).
            for _ in 0 ..< 200 where service.answered != choice { try? await Task.sleep(for: .milliseconds(10)) }
            #expect(service.answered == choice, "the server keeps the answer for every device")
            // Weeks later, on this device: never again.
            s.moment(setupVisible: false, tipShowing: false, now: later.addingTimeInterval(30 * Self.day))
            #expect(!s.visible)
        }
    }

    @Test func swipingItAwayCountsAsNotNow() async {
        let d = Self.defaults()
        Self.usedOn(7, d)
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
        Self.usedOn(9, d)
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
        Self.usedOn(7, d)
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
        s.attach(account: account, service: offline)
        s.choose(.sharedX)
        // Next launch, online.
        let online = FakeService()
        let next = ShareAskStore(defaults: d, launched: Self.t0, arguments: [])
        next.attach(account: account, service: online)
        #expect(next.decided == true, "this device remembers its own answer")
        await next.refresh()
        #expect(online.answered == .sharedX)
    }

    @Test func anotherAccountOnThisDeviceIsAskedItsOwnQuestion() {
        let d = Self.defaults()
        let s = Self.store(d)
        s.choose(.dismissed)
        let other = ShareAskStore(defaults: d, launched: Self.t0, arguments: [])
        other.attach(account: UUID(), service: FakeService())
        #expect(other.decided == nil, "waits for the server, not the other account's answer")
    }

    // MARK: Dev and links

    @Test func devForceShowsItAndSendsNothing() {
        let d = Self.defaults()
        let s = ShareAskStore(defaults: d, launched: .now, arguments: ["-forceShareAsk"])
        s.attach(account: UUID(), service: FakeService())
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
