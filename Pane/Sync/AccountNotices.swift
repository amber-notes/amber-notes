import Foundation
import Observation
import OSLog
import Supabase

// Things every device of the account should say (public.account_notices): an AI was connected,
// the account started fresh, a device was added, or a wrong number was typed when connecting an AI. The server writes them; each device fetches them when the
// library opens and hears new ones through realtime, and says each one once.

/// One row of account_notices. What it says is built here from its kind and, for an AI
/// connection, the connection's name as this account's own list has it (`mcp_tokens`): never from
/// the server's `what`, which anyone who can write the table could fill with anything.
struct AccountNotice: Decodable, Equatable, Identifiable, Sendable {
    enum Kind: String, Sendable {
        case aiConnected = "ai_connected", startedFresh = "started_fresh", wrongNumber = "wrong_number"
        /// Another device got the account's key (Add a device).
        case deviceAdded = "device_added"
        /// A kind from a newer server: not shown.
        case unknown
    }
    let id: Int64
    let kind: Kind
    /// For an AI connection: the grant, so the notice can offer Disconnect and name it.
    var grant_id: UUID? = nil
    let created_at: Date
    /// The connection's name, looked up by `grant_id` (nil when it's gone: "an AI").
    var name: String? = nil

    static let columns = "id,kind,grant_id,created_at"

    private enum CodingKeys: String, CodingKey { case id, kind, grant_id, created_at }

    init(id: Int64, kind: Kind, grant_id: UUID? = nil, created_at: Date, name: String? = nil) {
        self.id = id
        self.kind = kind
        self.grant_id = grant_id
        self.created_at = created_at
        self.name = name
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int64.self, forKey: .id)
        kind = Kind(rawValue: try c.decode(String.self, forKey: .kind)) ?? .unknown
        grant_id = try c.decodeIfPresent(UUID.self, forKey: .grant_id)
        created_at = try c.decode(Date.self, forKey: .created_at)
    }

    /// When it happened, always with the day: "1 Oct, 22:35".
    static func when(_ date: Date) -> String { date.formatted(.dateTime.day().month(.abbreviated).hour().minute()) }

    /// The alert's words.
    func text() -> (title: String, message: String) {
        switch kind {
        case .aiConnected:
            return ("Connected \(name ?? "an AI")", "\(Self.when(created_at)). It can use your notes. If you didn't connect it, disconnect it.")
        case .startedFresh:
            return ("Your notes were deleted and a new key was made on another device",
                    "Save your new recovery key in Settings \u{203A} Privacy & Security.")
        case .wrongNumber:
            return ("Someone who knows your password tried to connect an AI. Change your password.",
                    "The number typed didn't match, so it was declined. Amber Notes takes no new requests to connect an AI for an hour.")
        case .deviceAdded:
            return ("A device was added to your account",
                    "\(Self.when(created_at)). It can open your notes. If you didn\u{2019}t add it: remove it in Settings \u{203A} Privacy & Security, change your password, and disconnect and reconnect your AIs. Removing signs a real Amber Notes app out and erases its copy. A device that took your key keeps what it already has: the key can\u{2019}t be changed yet.")
        case .unknown:
            return ("", "")
        }
    }
}

extension [AccountNotice] {
    /// One alert for these: a notice on its own, or AI connections said together, newest first.
    var text: (title: String, message: String) {
        guard count > 1 else { return first?.text() ?? ("", "") }
        let lines = sorted { $0.created_at > $1.created_at }
            .map { "\($0.name ?? "An AI") \u{00B7} \(AccountNotice.when($0.created_at))" }
        return ("\(count) AIs were connected",
                lines.joined(separator: "\n") + "\n\nThey can use your notes. If you didn't connect one, disconnect it in Settings \u{203A} Connect an AI.")
    }
}

/// What this account's own list says about a connection a notice is about.
enum ConnectionLookup: Equatable, Sendable {
    /// Still connected, under this name.
    case active(String)
    /// Disconnected, or gone: it has no access, so it isn't news.
    case inactive
    /// The list couldn't be read: said anyway, as "an AI".
    case unknown
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
    /// news: the newest "started fresh" after this device started fresh, an AI connection
    /// approved here a moment before (`approvedHere`), and a device added from here or this one
    /// being added (`addedHere`), are marked seen without showing.
    func unseen(_ rows: [AccountNotice], now: Date = .now, approvedHere: Date? = nil, addedHere: Date? = nil) -> [AccountNotice] {
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
            // A device added from this one, or this one being added, a moment before.
            if n.kind == .deviceAdded, let addedHere, abs(n.created_at.timeIntervalSince(addedHere)) < 120 {
                markSeen(n.id)
                continue
            }
            if now.timeIntervalSince(n.created_at) > Self.window { continue }
            out.append(n)
        }
        return out
    }
}

/// Fetches and listens for the account's notices while the library is open, and shows them one
/// alert at a time (`current`), each once per device. AI connections waiting together show as one
/// alert (`group`), not one after another.
@MainActor
@Observable
final class AccountNotices {
    /// The notice showing now (for AI connections said together, the newest).
    private(set) var current: AccountNotice?
    /// Everything the alert showing now says: `current` alone, or AI connections, newest first.
    private(set) var group: [AccountNotice] = []
    private var queue: [AccountNotice] = []
    @ObservationIgnored private let client: SupabaseClient
    @ObservationIgnored private let ledger: NoticeLedger
    @ObservationIgnored private let approvedHere: () -> Date?
    @ObservationIgnored private var channel: RealtimeChannelV2?
    @ObservationIgnored private var tasks: [Task<Void, Never>] = []
    @ObservationIgnored private var stopped = false

    /// The connection a grant is, as Settings › Connect an AI lists it.
    @ObservationIgnored private let connection: (UUID) async -> ConnectionLookup

    init(client: SupabaseClient, user: UUID, defaults: UserDefaults = .standard,
         approvedHere: @escaping () -> Date? = { ConnectCenter.shared.approved?.at },
         connection: ((UUID) async -> ConnectionLookup)? = nil) {
        self.client = client
        ledger = NoticeLedger(account: user, defaults: defaults)
        self.approvedHere = approvedHere
        self.connection = connection ?? { grant in await Self.connection(client, grant: grant) }
    }

    nonisolated static func connection(_ client: SupabaseClient, grant: UUID) async -> ConnectionLookup {
        struct Row: Decodable { var name: String; var kind: String?; var redirect_host: String?; var revoked_at: Date? }
        guard let rows: [Row] = try? await client.from("mcp_tokens").select("name,kind,redirect_host,revoked_at")
            .eq("id", value: grant.uuidString.lowercased()).limit(1).execute().value else { return .unknown }
        guard let r = rows.first, r.revoked_at == nil else { return .inactive }
        return .active(Connection.title(name: r.name, kind: r.kind, host: r.redirect_host))
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
                await self?.take([n])
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
            await take(rows)
        } catch {
            noticesLog.error("fetching notices failed: \(String(describing: error), privacy: .public)")
        }
    }

    func take(_ rows: [AccountNotice]) async {
        guard !stopped else { return }
        let unseen = ledger.unseen(rows.filter { $0.kind != .unknown }, approvedHere: approvedHere(), addedHere: AddDeviceMoment.here)
        var fresh: [AccountNotice] = []
        for var n in unseen {
            if n.kind == .aiConnected, let grant = n.grant_id {
                switch await connection(grant) {
                case .active(let name): n.name = name
                // Disconnected since: nothing to warn about. Said, so it never comes back.
                case .inactive: ledger.markSeen(n.id); continue
                case .unknown: break
                }
            }
            fresh.append(n)
        }
        guard !stopped else { return }
        let known = Set(queue.map(\.id)).union(group.map(\.id)).union(current.map { [$0.id] } ?? [])
        queue += fresh.filter { !known.contains($0.id) }
        showNext()
    }

    /// OK: the alert is said (every notice in it), and the next one shows.
    func dismiss() {
        for n in group { ledger.markSeen(n.id) }
        if let current { ledger.markSeen(current.id) }
        group = []
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
        let next = queue.removeFirst()
        if next.kind == .aiConnected {
            group = ([next] + queue.filter { $0.kind == .aiConnected }).sorted { $0.created_at > $1.created_at }
            queue.removeAll { $0.kind == .aiConnected }
        } else {
            group = [next]
        }
        current = group.first
    }
}

private let noticesLog = Logger(subsystem: "dev.emilwagman.pane", category: "notices")
