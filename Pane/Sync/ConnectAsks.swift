import Foundation
import OSLog
import Supabase
import UserNotifications
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// Approving an AI connection from your devices.
//
// A browser anywhere can start connecting ChatGPT or Claude. The /connect page signs in only to
// say whose request it is, and asks the account's devices to approve it: a row in connect_asks
// with the page's public key. Every signed-in device hears about it here, through realtime while
// the app runs and by looking again when it comes to the front, and opens the consent sheet. The
// device that allows it seals the code to the page's key; the page picks it up and goes on.
//
// There's no push: an iPhone that isn't running hears nothing until it's opened.

/// A browser waiting for this account's devices to approve a connection (public.connect_asks).
struct ConnectAsk: Decodable, Equatable, Identifiable, Sendable {
    let request_id: UUID
    /// The page's P-256 public key, raw uncompressed, base64.
    let browser_key: String
    /// What the page says it is, e.g. "Chrome on a Mac".
    let started_from: String
    let created_at: Date
    let expires_at: Date
    var answered_at: Date? = nil

    var id: UUID { request_id }
    var browserKey: Data? { Data(base64Encoded: browser_key) }

    /// Still waiting for an answer.
    func isOpen(now: Date = .now) -> Bool { answered_at == nil && expires_at > now }

    static let columns = "request_id,browser_key,started_from,created_at,expires_at,answered_at"
}

/// An ask's number-matching columns, as the consent sheet reads them (about every second while it
/// waits for the page to reveal its nonce). See `ConnectMatch`.
struct ConnectAskMatch: Decodable, Equatable, Sendable {
    /// The page's P-256 public key, raw uncompressed, base64.
    let browser_key: String
    /// hex SHA-256(browser key ‖ the page's nonce), written when the page asked.
    let match_commit: String
    /// The nonce the first device to write one wrote (hex, 16 bytes).
    var device_nonce: String? = nil
    /// The page's nonce, revealed only after a device's is on the ask (hex, 16 bytes).
    var page_nonce: String? = nil

    var browserKey: Data? { Data(base64Encoded: browser_key) }

    static let columns = "browser_key,match_commit,device_nonce,page_nonce"
}

/// Watches for asks while the app runs; started with sync, stopped at sign-out.
@MainActor
final class ConnectAsks {
    private let client: SupabaseClient
    private let user: UUID
    private let center: ConnectCenter
    private let notifier: ConnectNotifier
    /// Who's asking, for the notification ("ChatGPT"), or nil when it can't be told.
    private let describe: (UUID) async -> String?
    private let now: () -> Date
    private var channel: RealtimeChannelV2?
    private var tasks: [Task<Void, Never>] = []
    private var stopped = false

    init(client: SupabaseClient, user: UUID, center: ConnectCenter = .shared, notifier: ConnectNotifier = .system,
         describe: ((UUID) async -> String?)? = nil, now: @escaping () -> Date = { .now }) {
        self.client = client
        self.user = user
        self.center = center
        self.notifier = notifier
        self.describe = describe ?? { id in try? await ConnectAPI.request(client, id: id).who }
        self.now = now
    }

    /// Looks for asks already waiting, then listens for new ones and for answers from elsewhere.
    func start() async {
        await refresh()
        guard channel == nil, !stopped else { return }
        #if DEBUG || QA
        if NetFault.config.offline { return }
        #endif
        let ch = client.channel("pane-connect-asks")
        let changes = ch.postgresChange(AnyAction.self, schema: "public", table: "connect_asks",
                                        filter: .eq("user_id", value: user.uuidString.lowercased()))
        let joins = ch.statusChange
        try? await ch.subscribeWithError()
        // Signed out while joining.
        if stopped { await ch.unsubscribe(); return }
        channel = ch
        tasks.append(Task { [weak self] in
            for await action in changes { await self?.received(action) }
        })
        // After sleep or a dropped connection the channel rejoins on its own; what came meanwhile is fetched.
        tasks.append(Task { [weak self] in
            var joined = false
            for await s in joins {
                guard case .subscribed = s else { continue }
                if joined { await self?.refresh() }
                joined = true
            }
        })
    }

    func stop() async {
        stopped = true
        tasks.forEach { $0.cancel() }
        tasks = []
        if let channel { await channel.unsubscribe() }
        channel = nil
        center.clearAsks()
    }

    /// Unanswered, unexpired asks, newest first: the newest opens, the rest wait their turn. Asks
    /// this device knew that have gone (answered elsewhere, or expired) close.
    func refresh() async {
        guard !stopped else { return }
        let at = now()
        do {
            let rows: [ConnectAsk] = try await client.from("connect_asks").select(ConnectAsk.columns)
                .is("answered_at", value: nil)
                .gt("expires_at", value: at.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
                .order("created_at", ascending: false)
                .execute().value
            guard !stopped else { return }
            let open = rows.filter { $0.isOpen(now: at) }.sorted { $0.created_at > $1.created_at }
            for gone in center.askIDs where !open.contains(where: { $0.id == gone }) { withdraw(gone) }
            for ask in open { await take(ask) }
        } catch {
            asksLog.error("fetching connect asks failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// A row from realtime: a new ask, a new key for one (the page reloaded), or an answer.
    private func received(_ action: AnyAction) async {
        switch action {
        case .insert(let a): await apply(a.record)
        case .update(let a): await apply(a.record)
        case .delete(let a):
            if case .string(let s)? = a.oldRecord["request_id"], let id = UUID(uuidString: s) { withdraw(id) }
        }
    }

    private func apply(_ record: [String: AnyJSON]) async {
        guard let ask = try? record.decode(as: ConnectAsk.self, decoder: AnyJSON.decoder) else { return }
        if ask.isOpen(now: now()) { await take(ask) } else { withdraw(ask.id) }
    }

    /// Opens the sheet for a new ask (or queues it), and says so when the app isn't in front.
    func take(_ ask: ConnectAsk) async {
        guard center.offer(ask, now: now()) else { return }
        await notifier.askPermission()
        guard !notifier.isFrontmost() else { return }
        await notifier.post(ask, await describe(ask.id))
    }

    private func withdraw(_ id: UUID) {
        center.withdraw(id)
        notifier.withdraw(id)
    }

    /// A request's number-matching columns as they are now; nil once it's answered, expired or gone.
    nonisolated static func match(_ client: SupabaseClient, id: UUID) async throws -> ConnectAskMatch? {
        let rows: [ConnectAskMatch] = try await client.from("connect_asks").select(ConnectAskMatch.columns)
            .eq("request_id", value: id.uuidString.lowercased())
            .is("answered_at", value: nil)
            .gt("expires_at", value: Date.now.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
            .limit(1).execute().value
        return rows.first
    }
}

private let asksLog = Logger(subsystem: "dev.emilwagman.pane", category: "connect")

// MARK: Notifications

/// A local notification when an ask arrives and the app isn't in front. Tests answer for it.
@MainActor
struct ConnectNotifier {
    var isFrontmost: () -> Bool
    /// Asks for permission to notify; the system asks the person only the first time.
    var askPermission: () async -> Void
    var post: (ConnectAsk, _ who: String?) async -> Void
    var withdraw: (UUID) -> Void

    nonisolated static let userInfoKey = "connect_request"
    static func identifier(_ id: UUID) -> String { "connect-" + id.uuidString.lowercased() }

    /// "Allow ChatGPT to use your notes?" / "Requested from Chrome on a Mac. Open Amber Notes to allow it."
    static func content(_ ask: ConnectAsk, who: String?) -> (title: String, body: String) {
        let from = ask.started_from.isEmpty ? "a web browser" : ask.started_from
        return ("Allow \(who ?? "an AI") to use your notes?", "Requested from \(from). Open Amber Notes to allow it.")
    }

    static let system = ConnectNotifier(
        isFrontmost: {
            #if os(macOS)
            NSApp.isActive
            #else
            UIApplication.shared.applicationState == .active
            #endif
        },
        askPermission: {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        },
        post: { ask, who in
            let text = content(ask, who: who)
            let content = UNMutableNotificationContent()
            content.title = text.title
            content.body = text.body
            content.sound = .default
            content.userInfo = [userInfoKey: ask.id.uuidString.lowercased()]
            let request = UNNotificationRequest(identifier: identifier(ask.id), content: content, trigger: nil)
            try? await UNUserNotificationCenter.current().add(request)
        },
        withdraw: { id in
            let center = UNUserNotificationCenter.current()
            center.removeDeliveredNotifications(withIdentifiers: [identifier(id)])
            center.removePendingNotificationRequests(withIdentifiers: [identifier(id)])
        }
    )
}

extension ConnectCenter: UNUserNotificationCenterDelegate {
    /// Tapping a notification opens its ask. Installed with the first window.
    func installNotifications() {
        UNUserNotificationCenter.current().delegate = self
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let s = response.notification.request.content.userInfo[ConnectNotifier.userInfoKey] as? String,
              let id = UUID(uuidString: s) else { return }
        await MainActor.run { self.showAsk(id) }
    }

    /// In front, the sheet is already showing: no banner.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        []
    }
}
