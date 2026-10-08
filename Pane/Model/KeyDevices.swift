import CryptoKit
import Foundation
import Observation

// Where the key is kept: each device that holds the account's key lists itself on the server
// (key_devices), and Settings › Security shows the list. The server can't tell who has
// the key, so a row counts only when its tag (made with a subkey of the key) verifies, and a
// removal only when its removal tag does.

/// One row of key_devices, as the server holds it.
struct KeyDeviceRow: Decodable, Equatable, Sendable {
    var device_id: UUID
    var platform: String
    var name_ct: String
    var how: String
    var backed_up: Bool
    var key_id: String
    /// Made by the device when it came to hold the key; its tag and any removal name it.
    var epoch: String
    var tag: String
    var added_at: Date
    var seen_at: Date
    var removed_at: Date?
    var removal_tag: String?

    static let columns = "device_id,platform,name_ct,how,backed_up,key_id,epoch,tag,added_at,seen_at,removed_at,removal_tag"
}

protocol KeyDeviceServer: Sendable {
    func list() async throws -> [KeyDeviceRow]
    func checkIn(device: UUID, platform: String, nameCT: String, how: String, backedUp: Bool, keyID: String, epoch: String, tag: String) async throws
    /// True when there was such a device to remove.
    func remove(device: UUID, removalTag: String) async throws -> Bool
    func forget(device: UUID) async throws
}

/// A device that holds the key, checked: its row's tag was made with the key.
struct KeyDevice: Identifiable, Equatable, Sendable {
    let id: UUID
    let name: String
    let platform: String
    let how: KeyHow
    /// It keeps the key as an iCloud Keychain item.
    let backedUp: Bool
    let addedAt: Date
    /// When it last said it holds the key (it says so at least once a day while it's in use).
    var seenAt: Date = .now
    /// The epoch its row vouches for: a removal is made for this one.
    var epoch = ""
    /// Removed from a device with the key; it drops its copy the next time it's online.
    let removing: Bool

    var symbol: String { platform == "macos" ? "laptopcomputer" : "iphone" }

    /// Not seen for this long, a device doesn't count as a way back to the notes: it may be lost,
    /// wiped or sold.
    static let recent: TimeInterval = 30 * 24 * 3600

    func isRecent(now: Date = .now) -> Bool { now.timeIntervalSince(seenAt) <= Self.recent }

    /// Only a key that lives on the device alone can be taken from it: one in iCloud Keychain
    /// belongs to every device of that Apple Account at once.
    var canRemove: Bool { !backedUp && !removing }

    private static func day(_ d: Date) -> String { d.formatted(.dateTime.day().month(.wide)) }

    /// How it got the key and when, and when it was last seen: two iPhones both called "iPhone"
    /// are told apart by these.
    func detail(now: Date = .now) -> String {
        if removing { return "Removed. It stops opening your notes the next time it\u{2019}s online." }
        let origin = switch how {
        case .added: "Added \(Self.day(addedAt))"
        case .made: "Made your key on \(Self.day(addedAt))"
        case .keychain: "Got your key from iCloud Keychain on \(Self.day(addedAt))"
        case .recovery: "Opened with the recovery key on \(Self.day(addedAt))"
        case .unknown: "Has had your key since \(Self.day(addedAt))"
        }
        let seen = isRecent(now: now)
            ? (Calendar.current.isDate(seenAt, inSameDayAs: now) ? "last seen today" : "last seen \(Self.day(seenAt))")
            : "not seen since \(Self.day(seenAt))"
        return "\(origin) \u{00B7} \(seen)"
    }
}

/// Whether losing this device would lose the notes.
enum KeySafety: Equatable, Sendable {
    /// Something else is known to open the notes: another device that holds the key and was seen
    /// in the last 30 days, or a recovery key that was saved. How many such ways.
    case safe(ways: Int)
    /// The key is stored as an iCloud Keychain item and nothing else is known. That is a backup
    /// only if iCloud Keychain is on for the Apple Account, which the app can't check.
    case unconfirmed
    /// The key lives on this device alone, and nothing else is known to hold it.
    case onlyThisDevice
}

/// The list's rules, pure.
enum KeyDeviceList {
    /// The other devices whose rows verify, for the account's current key, oldest first.
    static func others(_ rows: [KeyDeviceRow], key: StoredKey, user: UUID, this: UUID) -> [KeyDevice] {
        rows.filter { $0.device_id != this }.compactMap { verified($0, key: key, user: user) }.sorted { $0.addedAt < $1.addedAt }
    }

    static func verified(_ r: KeyDeviceRow, key: StoredKey, user: UUID) -> KeyDevice? {
        guard r.key_id == key.keyID, let how = KeyHow(rawValue: r.how),
              E2EE.tagsMatch(E2EE.keyDeviceTag(key.key, user: user, device: r.device_id, platform: r.platform, how: r.how, backedUp: r.backed_up, epoch: r.epoch), r.tag)
        else { return nil }
        let name = (try? NoteCrypto.open(r.name_ct, key: key.key, context: E2EE.device(r.device_id))).map(AddDeviceNames.clean)
        // A removal counts only from a device with the key; anything else leaves the row as it was.
        let removing = r.removed_at != nil && E2EE.tagsMatch(E2EE.keyDeviceRemovalTag(key.key, user: user, device: r.device_id, epoch: r.epoch), r.removal_tag)
        return KeyDevice(id: r.device_id, name: name ?? (r.platform == "macos" ? "Mac" : "iPhone"), platform: r.platform, how: how,
                         backedUp: r.backed_up, addedAt: r.added_at, seenAt: r.seen_at, epoch: r.epoch, removing: removing)
    }

    /// This device was removed by one that has the key. The removal must be for the epoch this
    /// device holds itself (`epoch`, kept on the device, never taken from the server's row): a tag
    /// from an earlier removal, replayed after the device was added again, doesn't count.
    static func removedHere(_ rows: [KeyDeviceRow], key: StoredKey, user: UUID, this: UUID, epoch: String) -> Bool {
        guard let mine = rows.first(where: { $0.device_id == this }), mine.removed_at != nil, mine.key_id == key.keyID else { return false }
        return E2EE.tagsMatch(E2EE.keyDeviceRemovalTag(key.key, user: user, device: this, epoch: epoch), mine.removal_tag)
    }

    /// What this device's row should say now, and whether the server's needs writing.
    static func needsCheckIn(_ rows: [KeyDeviceRow], key: StoredKey, user: UUID, this: UUID, platform: String, name: String,
                             how: KeyHow, backedUp: Bool, epoch: String, now: Date = .now) -> Bool {
        guard let mine = rows.first(where: { $0.device_id == this }), let me = verified(mine, key: key, user: user) else { return true }
        // A removal that got this far wasn't one to obey (no valid tag for this epoch, or the key
        // is in iCloud Keychain): the row is renewed, which clears it.
        return mine.removed_at != nil || mine.epoch != epoch || me.how != how || me.backedUp != backedUp || me.name != name || mine.platform != platform
            || now.timeIntervalSince(mine.seen_at) > 24 * 3600
    }

    /// Safe only on evidence: another device that holds the key and was seen lately, or a saved
    /// recovery key. A key merely stored as an iCloud Keychain item proves nothing (iCloud
    /// Keychain may be off), so it's "can't confirm", never "safe".
    static func safety(thisBackedUp: Bool, others: [KeyDevice], recoverySaved: Bool, now: Date = .now) -> KeySafety {
        let ways = others.filter { !$0.removing && $0.isRecent(now: now) }.count + (recoverySaved ? 1 : 0)
        if ways > 0 { return .safe(ways: ways) }
        return thisBackedUp ? .unconfirmed : .onlyThisDevice
    }
}

/// The devices that hold the account's key, for Settings › Security, and this device's own row.
@MainActor
@Observable
final class KeyDevices {
    static var shared = KeyDevices()

    private(set) var others: [KeyDevice] = []
    /// The list was read at least once for this account.
    private(set) var loaded = false
    private var account: UUID?
    private var server: KeyDeviceServer?
    private var refreshing = false
    /// This device's id in the list. Nil while its identity can't be read (the Keychain before
    /// the first unlock): then it neither lists itself nor reads the list, and tries again later.
    var device: UUID? { named ?? identity.id }
    private let named: UUID?
    let platform: String
    let name: String
    private let identity: DeviceIdentity
    /// A removal of this device is being carried out: it's done once, whoever noticed it.
    private var obeying = false

    /// This device was removed from another one that has the key. The app pushes what hasn't
    /// synced if it can, drops the key, erases its copy of the notes and signs out (`DeviceRemoval`).
    var removedHere: (@MainActor () async -> Void)?

    /// `device`: tests name it; otherwise it's this device's own id (`DeviceIdentity`).
    init(device: UUID? = nil, platform: String = InstallID.platform, name: String = AddDeviceNames.thisDevice, identity: DeviceIdentity = .shared) {
        named = device
        self.platform = platform
        self.name = name
        self.identity = identity
    }

    func attach(account: UUID?, server: KeyDeviceServer?) {
        if account != self.account { others = []; loaded = false }
        self.account = account
        self.server = server
    }

    /// Reads the list, lists this device (or obeys its removal), and keeps the others for showing.
    func refresh(_ crypto: AccountCrypto) async {
        guard !refreshing, let server, let account, crypto.account == account, let key = crypto.keyToHandOver else { return }
        // Without knowing which device this is, nothing is listed and nothing is claimed: under a
        // made-up id this device would count its own old row as another device that holds the key.
        guard let device, let epoch = identity.epoch(account) else { return }
        refreshing = true
        defer { refreshing = false }
        guard let rows = try? await server.list(), crypto.account == account, crypto.keyToHandOver == key else { return }
        // Removed from a device with the key. Only a key that lives on this device alone is given
        // up: one in iCloud Keychain would go from every device, so it stays, and the row is renewed.
        if KeyDeviceList.removedHere(rows, key: key, user: account, this: device, epoch: epoch), !crypto.backedUp {
            await obeyRemoval()
            return
        }
        let mine = rows.first { $0.device_id == device }.flatMap { KeyDeviceList.verified($0, key: key, user: account) }
        // How the key got here is only said when it's known: a device that already had it when it
        // first listed itself says nothing about where it came from.
        let how = crypto.arrivedHow ?? mine?.how ?? .unknown
        if KeyDeviceList.needsCheckIn(rows, key: key, user: account, this: device, platform: platform, name: name, how: how, backedUp: crypto.backedUp, epoch: epoch),
           let nameCT = try? NoteCrypto.seal(name, key: key.key, keyID: key.keyID, context: E2EE.device(device)) {
            try? await server.checkIn(device: device, platform: platform, nameCT: nameCT, how: how.rawValue, backedUp: crypto.backedUp, keyID: key.keyID, epoch: epoch,
                                      tag: E2EE.keyDeviceTag(key.key, user: account, device: device, platform: platform, how: how.rawValue, backedUp: crypto.backedUp, epoch: epoch))
        }
        others = KeyDeviceList.others(rows, key: key, user: account, this: device)
        loaded = true
    }

    /// The removal was carried out here: this device's row goes from the list, and whatever
    /// lists it next does so under a new epoch. The row is best effort (no session, no network:
    /// it stays marked as being removed); the epoch is local and always changes.
    func removalDone(account: UUID) async {
        identity.rotateEpoch(account)
        if let device { try? await server?.forget(device: device) }
    }

    /// Carries out this device's removal once: looking at the list and trying to remove another
    /// device can both notice it at the same moment.
    private func obeyRemoval() async {
        guard !obeying else { return }
        obeying = true
        defer { obeying = false }
        await removedHere?()
    }

    /// Removes another device: it drops its key and its copy of the notes the next time it's
    /// online. Refused on a device that has itself been removed and hasn't acted on it yet: two
    /// devices removing each other would otherwise leave nobody with the key. That device acts on
    /// its own removal instead.
    func remove(_ d: KeyDevice, crypto: AccountCrypto) async throws {
        guard let server, let account, let key = crypto.keyToHandOver, let device, let epoch = identity.epoch(account) else { throw KeyError.notReady }
        guard let rows = try? await server.list() else { throw KeyError.offline }
        if KeyDeviceList.removedHere(rows, key: key, user: account, this: device, epoch: epoch), !crypto.backedUp {
            await obeyRemoval()
            throw KeyError.removedHere
        }
        do {
            _ = try await server.remove(device: d.id, removalTag: E2EE.keyDeviceRemovalTag(key.key, user: account, device: d.id, epoch: d.epoch))
        } catch { throw KeyError.offline }
        await refresh(crypto)
    }

    func safety(_ crypto: AccountCrypto, now: Date = .now) -> KeySafety {
        KeyDeviceList.safety(thisBackedUp: crypto.backedUp, others: others, recoverySaved: crypto.recoveryKeySaved, now: now)
    }

    /// Tests and captures: the list as given.
    func setForTesting(_ devices: [KeyDevice]) {
        others = devices
        loaded = true
    }
}

/// When this device last added a device, or was added: the "A device was added" notice every
/// device gets isn't news on the two that just did it.
@MainActor
enum AddDeviceMoment {
    static var here: Date?
}

/// Carrying out this device's removal, in an order a kill midway can't undo: the key goes first
/// and the fact is written down, so the next launch finishes the job instead of opening the notes.
///
///   1. What hasn't synced is pushed, if the server can be reached. The wait is as long as the
///      sync's own network timeouts allow; if the push fails, the removal wins and those edits are
///      lost (the Remove dialog says so).
///   2. "Removed" is written down, then the key is deleted.
///   3. Sync stops and the library is erased.
///   4. The device's row leaves the list and its epoch changes.
///   5. The mark is cleared, "This Mac was removed" is left to be said, and the device signs out.
@MainActor
struct DeviceRemoval {
    /// The account whose removal is under way on this device (its id), until it's finished.
    static let pendingFlag = "e2ee.removalPending"
    /// Said once on the sign-in screen.
    static let noticeFlag = "e2ee.removedHere"
    /// After this long a push that honours cancellation is given up. A sync already under way
    /// doesn't, so the real bound on the wait is the sync's own network timeouts.
    static let pushLimit: Duration = .seconds(10)

    var defaults: UserDefaults = .standard
    /// Pushes unsynced edits. Called only while the key is still here.
    var push: () async -> Void
    /// Deletes this device's copy of the account's key.
    var dropKey: (UUID) -> Void
    /// Stops sync and erases the local library.
    var erase: () async -> Void
    /// The row leaves the list and the epoch changes (`KeyDevices.removalDone`).
    var forget: (UUID) async -> Void
    var signOut: () async -> Void

    /// The removal was just verified on this device.
    func run(account: UUID) async {
        await push()
        defaults.set(account.uuidString.lowercased(), forKey: Self.pendingFlag)
        dropKey(account)
        await finish(account)
    }

    /// At launch: a removal that was cut short is finished before anything is shown.
    func resumeIfInterrupted() async {
        guard let s = defaults.string(forKey: Self.pendingFlag), let account = UUID(uuidString: s) else { return }
        dropKey(account)
        await finish(account)
    }

    private func finish(_ account: UUID) async {
        await erase()
        await forget(account)
        defaults.removeObject(forKey: Self.pendingFlag)
        defaults.set(true, forKey: Self.noticeFlag)
        await signOut()
    }
}
