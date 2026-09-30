import Foundation
import Observation
import OSLog
import Supabase

// Things every device of the account should say (public.account_notices): an AI was connected,
// or the account started fresh. The server writes them; each device fetches them when the
// library opens and hears new ones through realtime, and says each one once.

/// One row of account_notices.
struct AccountNotice: Decodable, Equatable, Identifiable, Sendable {
    enum Kind: String, Decodable, Sendable { case aiConnected = "ai_connected", startedFresh = "started_fresh" }
    let id: Int64
    let kind: Kind
    /// For an AI connection: the grant, so the notice can offer Disconnect.
    var grant_id: UUID? = nil
    let what: String
    let created_at: Date

    static let columns = "id,kind,grant_id,what,created_at"

    /// The alert's words.
    func text(now: Date = .now) -> (title: String, message: String) {
        switch kind {
        case .aiConnected:
            let when = Calendar.current.isDate(created_at, inSameDayAs: now)
                ? created_at.formatted(date: .omitted, time: .shortened)
                : created_at.formatted(date: .abbreviated, time: .shortened)
            return ("Connected \(what) \u{00B7} \(when)", "It can use your notes. If you didn't connect it, disconnect it now.")
        case .startedFresh:
            return ("Your notes were deleted and a new key was made on another device",
                    "Save your new recovery key in Settings \u{203A} Privacy & Security.")
        }
    }
}

/// Which notices this device still has to say, per account. Pure, so it's unit-tested.
struct NoticeLedger {
    let account: UUID
    let defaults: UserDefaults
    /// Only this recent a notice is news on a device that hasn't seen it.
    static let window: TimeInterval = 14 * 24 * 3600
    static let remembered = 300

    private var seenKey: String { "notices.seen.\(account.uuidString.lowercased())" }

    var seen: Set<Int64> { Set((defaults.array(forKey: seenKey) as? [NSNumber] ?? []).map(\.int64Value)) }

    func markSeen(_ id: Int64) {
        var ids = (defaults.array(forKey: seenKey) as? [NSNumber] ?? []).map(\.int64Value)
        guard !ids.contains(id) else { return }
        ids.append(id)
        defaults.set(Array(ids.suffix(Self.remembered)).map { NSNumber(value: $0) }, forKey: seenKey)
    }

    /// The notices to say, oldest first. Seen ones are left out. This device's own news isn't
    /// news: the newest "started fresh" after this device started fresh, and an AI connection
    /// approved here a moment before (`approvedHere`), are marked seen without showing.
    func unseen(_ rows: [AccountNotice], now: Date = .now, approvedHere: Date? = nil) -> [AccountNotice] {
        let seen = seen
        var out: [AccountNotice] = []
        let sorted = rows.sorted { $0.id < $1.id }
        let ownFresh = defaults.bool(forKey: AccountCrypto.startedFreshHereKey(account))
            ? sorted.last { $0.kind == .startedFresh && !seen.contains($0.id) }?.id : nil
        for n in sorted where !seen.contains(n.id) {
            if n.id == ownFresh {
                markSeen(n.id)
                defaults.removeObject(forKey: AccountCrypto.startedFreshHereKey(account))
                continue
            }
            if n.kind == .aiConnected, let approvedHere, abs(n.created_at.timeIntervalSince(approvedHere)) < 120 {
                markSeen(n.id)
                continue
            }
            if now.timeIntervalSince(n.created_at) > Self.window { continue }
            out.append(n)
        }
        return out
    }
}

/// Fetches and listens for the account's notices while the library is open, and shows them one at
/// a time (`current`), each once per device.
@MainActor
@Observable
final class AccountNotices {
    /// The notice showing now.
    private(set) var current: AccountNotice?
    private var queue: [AccountNotice] = []
    @ObservationIgnored private let client: SupabaseClient
    @ObservationIgnored private let ledger: NoticeLedger
    @ObservationIgnored private let approvedHere: () -> Date?
    @ObservationIgnored private var channel: RealtimeChannelV2?
    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    @ObservationIgnored private var stopped = false

    init(client: SupabaseClient, user: UUID, defaults: UserDefaults = .standard,
         approvedHere: @escaping () -> Date? = { ConnectCenter.shared.approved?.at }) {
        self.client = client
        ledger = NoticeLedger(account: user, defaults: defaults)
        self.approvedHere = approvedHere
    }

    func start() async {
        await refresh()
        guard channel == nil, !stopped else { return }
        #if DEBUG || QA
        if NetFault.config.offline { return }
        #endif
        let ch = client.channel("pane-account-notices")
        let inserts = ch.postgresChange(InsertAction.self, schema: "public", table: "account_notices",
                                        filter: .eq("user_id", value: ledger.account.uuidString.lowercased()))
        let joins = ch.statusChange
        try? await ch.subscribeWithError()
        if stopped { await ch.unsubscribe(); return }
        channel = ch
        tasks.append(Task { [weak self] in
            for await action in inserts {
                guard let n = try? action.record.decode(as: AccountNotice.self, decoder: AnyJSON.decoder) else { continue }
                self?.take([n])
            }
        })
        // After sleep or a dropped connection the channel rejoins by itself; what came meanwhile is fetched.
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
        queue = []
        current = nil
    }

    /// The recent notices, from the server.
    func refresh() async {
        guard !stopped else { return }
        let since = Date.now.addingTimeInterval(-NoticeLedger.window)
        do {
            let rows: [AccountNotice] = try await client.from("account_notices").select(AccountNotice.columns)
                .gt("created_at", value: since.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
                .order("created_at", ascending: true)
                .limit(50)
                .execute().value
            take(rows)
        } catch {
            noticesLog.error("fetching notices failed: \(String(describing: error), privacy: .public)")
        }
    }

    func take(_ rows: [AccountNotice]) {
        guard !stopped else { return }
        let known = Set(queue.map(\.id)).union(current.map { [$0.id] } ?? [])
        queue += ledger.unseen(rows, approvedHere: approvedHere()).filter { !known.contains($0.id) }
        showNext()
    }

    /// OK: the notice is said, and the next one shows.
    func dismiss() {
        if let current { ledger.markSeen(current.id) }
        current = nil
        showNext()
    }

    /// Disconnect, from an "AI connected" notice: revoked the way Settings › Connect an AI does it.
    func disconnect(_ notice: AccountNotice) async throws {
        if current?.id == notice.id { dismiss() }
        guard let grant = notice.grant_id else { return }
        try await ConnectRevoke.revoke(client, id: grant)
    }

    private func showNext() {
        guard current == nil, !queue.isEmpty else { return }
        current = queue.removeFirst()
    }
}

private let noticesLog = Logger(subsystem: "dev.emilwagman.pane", category: "notices")
