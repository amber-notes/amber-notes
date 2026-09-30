import CryptoKit
import Foundation
import SwiftData
import Testing
@testable import Pane

extension NetworkFaults {
/// An end-to-end encrypted account on the wire and through sync (against StubSupabase): nothing
/// readable goes up, another device with the key reads it all, and a row it can't open is never
/// applied.
@MainActor @Suite(.sealedAccount) struct E2EESyncTests {
    let user = SealedAccount.user
    /// Any of this in what reaches the server is a leak.
    let canary = "Canary-7f3c"

    init() {
        StubSupabase.reset()
        NetFault.config = .init()
    }

    struct Device {
        let context: ModelContext
        let engine: SyncEngine
        let defaults: UserDefaults
    }

    func device(defaults: UserDefaults = MemoryDefaults()) throws -> Device {
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        let engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com", userID: user), context: context, defaults: defaults)
        return Device(context: context, engine: engine, defaults: defaults)
    }

    /// Every request body the server got, and every row and file it holds, as text.
    private func everythingSent() -> String {
        let rows = ["notes", "folders", "attachments"].flatMap { StubSupabase.rows($0) }
        return StubSupabase.bodies.joined(separator: "\n")
            + String(decoding: (try? JSONSerialization.data(withJSONObject: rows)) ?? Data(), as: UTF8.self)
            + StubSupabase.objects.values.map { String(decoding: $0, as: UTF8.self) }.joined()
    }

    private func attach(_ text: String, named name: String, to context: ModelContext) throws -> Pane.Attachment {
        let a = try FileStore.importData(Data(text.utf8), filename: name, type: .plainText)
        context.insert(a)
        return a
    }

    private func removeLocalCopy(_ a: Pane.Attachment) {
        try? FileManager.default.removeItem(at: FileStore.url(for: a.id, filename: a.filename).deletingLastPathComponent())
    }

    @Test func aNoteAFolderAndAFileGoUpSealedAndTheOtherDeviceOpensThem() async throws {
        let a = try device()
        let folder = a.context.createFolder(named: "\(canary) folder")
        let file = try attach("\(canary) file bytes", named: "\(canary) plan.txt", to: a.context)
        defer { removeLocalCopy(file) }
        let n = a.context.createNote(in: .folder(folder.id), body: "\(canary) Lisbon\nPastéis at 9\n\(file.markdown)")
        n.dirty = true
        await a.engine.sync()
        #expect(!n.dirty && !folder.dirty && !file.dirty && file.uploaded)

        let row = try #require(StubSupabase.note(n.id))
        #expect(row["body"] == nil && (row["body_ct"] as? String)?.hasPrefix("amb2.") == true && row["head_ct"] is String)
        let f = try #require(StubSupabase.rows("attachments").first)
        let path = "\(user.uuidString.lowercased())/\(file.id.uuidString.lowercased())"
        #expect(f["storage_path"] as? String == path, "the path says whose file and which, nothing else")
        #expect(f["filename"] == nil && f["content_type"] == nil && f["meta_ct"] is String)
        let stored = try #require(StubSupabase.objects[path])
        #expect(E2EE.isSealedFile(stored) && f["size"] as? Int == stored.count, "the size column is the sealed size")
        #expect(!everythingSent().contains(canary), "no text, title, folder name, file name or file byte reaches the server readable")

        let b = try device()
        await b.engine.sync()
        let there = try #require(b.context.note(n.id))
        #expect(there.body == n.body && there.folder?.name == "\(canary) folder")
        let theirs = try #require(b.context.attachment(file.id))
        #expect(theirs.filename == "\(canary) plan.txt" && theirs.contentType == file.contentType && theirs.size == file.size)
        removeLocalCopy(file)
        #expect(await b.engine.download(theirs))
        #expect(try String(contentsOf: FileStore.url(for: file.id, filename: file.filename), encoding: .utf8) == "\(canary) file bytes")
        await a.engine.stop(); await b.engine.stop()
    }

    @Test func anUnchangedNoteRepushesTheSameBox() async throws {
        let a = try device()
        let n = a.context.createNote(in: .all, body: "Same text\nand a preview")
        n.dirty = true
        await a.engine.sync()
        let body = StubSupabase.note(n.id)?["body_ct"] as? String, head = StubSupabase.note(n.id)?["head_ct"] as? String
        n.isPinned = true
        n.touch()
        await a.engine.sync()
        #expect(StubSupabase.note(n.id)?["is_pinned"] as? Bool == true)
        #expect(StubSupabase.note(n.id)?["body_ct"] as? String == body, "a pin doesn't look like a new text to the server")
        #expect(StubSupabase.note(n.id)?["head_ct"] as? String == head)
        n.body = "Changed text"
        n.touch()
        await a.engine.sync()
        #expect(StubSupabase.note(n.id)?["body_ct"] as? String != body)
        await a.engine.stop()
    }

    @Test func aRowThatDoesntOpenIsNeverApplied() async throws {
        let a = try device()
        let n = a.context.createNote(in: .all, body: "Mine")
        n.dirty = true
        await a.engine.sync()
        // Another key: this device can't open what's on the server.
        try await Wire.$testSealer.withValue(Sealer(key: SymmetricKey(size: .bits256), user: user)) {
            let b = try device()
            await b.engine.sync()
            #expect(b.context.note(n.id) == nil, "a note that can't be opened isn't made here, empty")
            #expect(b.engine.problem?.contains("couldn't be opened") == true)
            #expect(b.engine.problem?.contains("password") == false)
            await b.engine.stop()
        }
        await a.engine.stop()
    }

    @Test func withoutTheKeyNothingSyncs() async throws {
        let a = try device()
        a.context.createNote(in: .all, body: "Waiting").dirty = true
        let saved = E2EE.sealer
        E2EE.sealer = nil
        defer { E2EE.sealer = saved }
        await Wire.$testSealer.withValue(nil) {
            await a.engine.sync()
        }
        #expect(StubSupabase.requests.isEmpty, "nothing can be sealed, so nothing is sent")
        await a.engine.stop()
    }

    @Test func theLocalResetRunsOnceAndKeepsWhatNeverSynced() async throws {
        let a = try device()
        let old = a.context.createFolder(named: "Synced before")
        old.serverVersion = 1; old.dirty = false
        let gone = a.context.createFolder(named: "Only synced things")
        gone.serverVersion = 1; gone.dirty = false
        let synced = a.context.createNote(in: .folder(old.id), body: "Readable from before")
        synced.serverVersion = 4; synced.dirty = false
        let local = a.context.createNote(in: .folder(old.id), body: "Written signed out")
        local.dirty = true
        let before = Pane.Attachment(filename: "old.txt", contentType: "public.plain-text", size: 3)
        before.uploaded = true; before.dirty = false
        a.context.insert(before)
        a.defaults.set(Date.now, forKey: "syncCursor.\(user.uuidString)")

        await a.engine.sync()
        #expect(a.context.note(synced.id) == nil && a.context.attachment(before.id) == nil, "what synced before is gone here")
        #expect(a.context.folder(gone.id) == nil)
        #expect(a.context.note(local.id) != nil && StubSupabase.body(local.id) == "Written signed out", "a note that never synced goes up sealed")
        #expect(local.folder?.id == old.id && StubSupabase.rows("folders").count == 1, "with the folder it's in")
        #expect(a.defaults.bool(forKey: SyncEngine.resetKey(user)))

        // Once: what syncs from now on stays.
        let now = a.context.createNote(in: .all, body: "Synced sealed")
        now.dirty = true
        await a.engine.sync()
        await a.engine.sync()
        #expect(a.context.note(now.id) != nil && !now.dirty)
        #expect(a.context.note(local.id) != nil)
        await a.engine.stop()
    }

    @Test func aNewAccountKeySendsEverythingUpAgain() async throws {
        let a = try device()
        let n = a.context.createNote(in: .all, body: "Kept on this device")
        n.dirty = true
        await a.engine.sync()
        #expect(!n.dirty && n.serverVersion > 0)
        // Start fresh on another device: the server's notes went with the old key.
        StubSupabase.reset()
        let fresh = Sealer(key: SymmetricKey(size: .bits256), user: user)
        await Wire.$testSealer.withValue(fresh) { await a.engine.sync() }
        let box = StubSupabase.rows("notes").first?["body_ct"] as? String
        #expect(StubSupabase.rows("notes").count == 1, "this device's notes go up again")
        #expect(box.flatMap { fresh.open($0, context: E2EE.body(n.id)) } == "Kept on this device", "sealed with the new key")
        #expect(a.defaults.string(forKey: SyncEngine.keyIDKey(user)) == fresh.keyID)
        await a.engine.stop()
    }

    @Test func aNoteDeletedForGoodKeepsNoBoxes() async throws {
        let a = try device()
        let n = a.context.createNote(in: .all, body: "Short-lived")
        n.dirty = true
        await a.engine.sync()
        n.deletedAt = .now
        n.touch()
        await a.engine.sync()
        let row = try #require(StubSupabase.note(n.id))
        #expect(row["body_ct"] is NSNull && row["head_ct"] is NSNull && row["deleted_at"] is String)
        let b = try device()
        await b.engine.sync()
        #expect(b.context.note(n.id)?.deletedAt != nil && b.engine.problem == nil, "the tombstone arrives, and isn't unreadable")
        await a.engine.stop(); await b.engine.stop()
    }

    @Test func aRealtimeRowWithoutItsTextIsFetchedNotApplied() throws {
        let row: [String: Any] = ["id": UUID().uuidString, "created_at": 0, "updated_at": 0, "is_pinned": false]
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(NoteDTO.self, from: JSONSerialization.data(withJSONObject: row)) }
    }

    @Test func versionHistoryOpensSealedVersionsHere() throws {
        let id = UUID()
        let box = try #require(Wire.sealer?.seal("An older text", context: E2EE.body(id)))
        #expect(try SupabaseHistoryStore.open(box, head: nil, locked: false, note: id) == "An older text")
        let head = try #require(Wire.sealer?.sealHead(NoteHead(title: "Bank"), note: id))
        #expect(try SupabaseHistoryStore.open(nil, head: head, locked: true, note: id) == "Bank", "a locked version shows its title")
        #expect(throws: HistoryError.self) { try SupabaseHistoryStore.open(box, head: nil, locked: false, note: UUID()) }
    }

    // MARK: Sharing

    @Test func theShareCopyHasOnlyLiveUnlockedSubNotesAndEmbeddedFiles() throws {
        let a = try device()
        let root = a.context.createNote(in: .all, body: "Trip\nSee below")
        let kept = a.context.createNote(in: .all, body: "Day one")
        kept.parentID = root.id
        let grandchild = a.context.createNote(in: .all, body: "Morning")
        grandchild.parentID = kept.id
        let locked = a.context.createNote(in: .all, body: "Passport")
        locked.parentID = root.id
        locked.lockedBody = "amb2.0123456789abcdef.AAAA"
        let underLocked = a.context.createNote(in: .all, body: "Under the lock")
        underLocked.parentID = locked.id
        let trashed = a.context.createNote(in: .all, body: "Old idea")
        trashed.parentID = root.id
        trashed.trashedAt = .now
        let embedded = Pane.Attachment(filename: "map.pdf", contentType: "com.adobe.pdf", size: 10)
        let elsewhere = Pane.Attachment(filename: "other.pdf", contentType: "com.adobe.pdf", size: 10)
        a.context.insert(embedded); a.context.insert(elsewhere)
        grandchild.body += "\n" + embedded.markdown
        underLocked.body += "\n" + elsewhere.markdown

        let copy = try #require(SharePublisher.copy(of: root.id, includeSubNotes: true, in: a.context))
        #expect(copy.title == "Trip" && copy.body == root.body)
        #expect(Set(copy.pages.map(\.id)) == Set([kept.id, grandchild.id].map { $0.uuidString.lowercased() }))
        #expect(copy.pages.first { $0.id == grandchild.id.uuidString.lowercased() }?.parent_id == kept.id.uuidString.lowercased())
        #expect(copy.files == [embedded.id.uuidString.lowercased()])
        let alone = try #require(SharePublisher.copy(of: root.id, includeSubNotes: false, in: a.context))
        #expect(alone.pages.isEmpty && alone.files.isEmpty)
        #expect(SharePublisher.copy(of: locked.id, includeSubNotes: true, in: a.context) == nil, "a locked note is never published")
    }

    @Test func sharingPublishesTheCopyAndItsMissingFilesAndEditsRepublish() async throws {
        let saved = SyncEngine.publishDelay
        SyncEngine.publishDelay = .milliseconds(100)
        defer { SyncEngine.publishDelay = saved }
        let a = try device()
        let file = try attach("the map", named: "map.txt", to: a.context)
        defer { removeLocalCopy(file) }
        let n = a.context.createNote(in: .all, body: "Trip\n\(file.markdown)")
        n.dirty = true
        await a.engine.sync()
        let fileID = file.id.uuidString.lowercased()
        StubSupabase.answer("share_note") { _ in ["slug": "abcdefghijklmnopqrstuvwx", "missing_files": [fileID]] }
        StubSupabase.answer("publish_share") { _ in ["slug": "abcdefghijklmnopqrstuvwx", "missing_files": [String]()] }

        let slug = try await SharePublisher.share(note: n.id, includeSubNotes: false, client: StubSupabase.client(), container: a.context.container, user: user)
        #expect(slug == "abcdefghijklmnopqrstuvwx")
        let share = try #require(StubSupabase.rpcCalls.first { $0.name == "share_note" })
        let sent = try #require(share.params["p_copy"] as? [String: Any])
        #expect(sent["body"] as? String == n.body && sent["files"] as? [String] == [fileID])
        let upload = try #require(StubSupabase.rpcCalls.first { $0.name == "publish_share_file" })
        #expect(upload.params["p_filename"] as? String == "map.txt" && upload.params["p_content_type"] as? String == "text/plain")
        #expect((upload.params["p_content"] as? String).flatMap { Data(base64Encoded: $0) } == Data("the map".utf8), "the file's readable bytes")

        // An edit that went up is published to the page a moment later.
        a.engine.shareChanged(n.id, includesSubNotes: false)
        n.body = "Trip, day two\n\(file.markdown)"
        n.touch()
        await a.engine.sync(pulling: false)
        let end = Date.now.addingTimeInterval(3)
        while !StubSupabase.rpcCalls.contains(where: { $0.name == "publish_share" }), Date.now < end { try await Task.sleep(for: .milliseconds(20)) }
        let again = try #require(StubSupabase.rpcCalls.last { $0.name == "publish_share" })
        #expect((again.params["p_copy"] as? [String: Any])?["title"] as? String == "Trip, day two")
        await a.engine.stop()
    }

    // MARK: Connecting an AI

    @Test func theDecisionCarriesTheExactReturnAddressAndACodeMadeHere() async throws {
        let redirect = "https://claude.ai/api/mcp/auth_callback"
        let secret = "amb_code_" + E2EE.randomHex()
        let code = (code: secret, hash: E2EE.sha256Hex(secret), wrap: "amb2.0123456789abcdef.AAAA")
        final class Sent: @unchecked Sendable { var body: [String: Any] = [:] }
        let box = Sent()
        let answer = try JSONSerialization.data(withJSONObject: ["redirect": redirect + "?state=xyz&iss=https%3A%2F%2Fmcp.ambernotes.app"])
        let decided = try await ConnectAPI.decide(id: UUID(), redirectURI: redirect, allow: true, write: true, code: code) { path, method, body in
            #expect(path == "/connect/decide" && method == "POST")
            box.body = body ?? [:]
            return answer
        }
        // Opened by the link on this device: the browser goes on from here, with the code.
        let url = try #require(decided.url)
        let sent = box.body
        #expect(sent["handoff"] == nil)
        #expect(sent["redirect_uri"] as? String == redirect, "what the person approved is where the code goes")
        #expect(sent["code_hash"] as? String == code.hash && sent["code_wrap"] as? String == code.wrap)
        #expect(!String(decoding: try JSONSerialization.data(withJSONObject: sent), as: UTF8.self).contains(secret), "the server never sees the code")
        #expect(!String(decoding: answer, as: UTF8.self).contains(secret))
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(items.first { $0.name == "code" }?.value == secret && items.first { $0.name == "state" }?.value == "xyz")

        // No key here, or no return address to send back: nothing is sent.
        await #expect(throws: ConnectAPI.Failure.self) {
            _ = try await ConnectAPI.decide(id: UUID(), redirectURI: redirect, allow: true, write: true, code: nil) { _, _, _ in Issue.record("sent"); return Data() }
        }
        await #expect(throws: ConnectAPI.Failure.self) {
            _ = try await ConnectAPI.decide(id: UUID(), redirectURI: nil, allow: false, write: false, code: nil) { _, _, _ in Issue.record("sent"); return Data() }
        }
    }

    @Test func anAskedRequestSealsTheCodeToThePageAndOpensNothingHere() async throws {
        let redirect = "https://chatgpt.com/connector_platform_oauth_redirect"
        let id = UUID()
        let page = P256.KeyAgreement.PrivateKey()
        let secret = "amb_code_" + E2EE.randomHex()
        let code = (code: secret, hash: E2EE.sha256Hex(secret), wrap: "amb2.0123456789abcdef.AAAA")
        final class Sent: @unchecked Sendable { var bodies: [[String: Any]] = [] }
        let box = Sent()
        let answer = try JSONSerialization.data(withJSONObject: ["redirect": redirect + "?state=xyz", "client_name": "ChatGPT", "can_write": true, "handoff": true])
        let send: ConnectAPI.Send = { _, _, body in box.bodies.append(body ?? [:]); return answer }

        let decided = try await ConnectAPI.decide(id: id, redirectURI: redirect, allow: true, write: true, code: code,
                                                  browserKey: page.publicKey.x963Representation, send: send)
        #expect(decided == .handedOff && decided.url == nil, "the page picks the code up; nothing opens here")
        let sent = try #require(box.bodies.first)
        #expect(sent["redirect_uri"] as? String == redirect && sent["code_hash"] as? String == code.hash)
        let handoff = try #require(sent["handoff"] as? String)
        #expect(try E2EE.openHandoff(handoff, browserPrivate: page, requestID: id) == secret, "only the page's key opens it")
        #expect(throws: E2EE.Failure.wrongKey) { try E2EE.openHandoff(handoff, browserPrivate: .init(), requestID: id) }
        #expect(!String(decoding: try JSONSerialization.data(withJSONObject: sent), as: UTF8.self).contains(secret), "the server never sees the code")

        // Don't Allow: no code, no handoff, and the page goes on by itself too.
        let denied = try await ConnectAPI.decide(id: id, redirectURI: redirect, allow: false, write: false, code: nil,
                                                 browserKey: page.publicKey.x963Representation, send: send)
        #expect(denied == .handedOff)
        #expect(box.bodies.last?["handoff"] == nil && box.bodies.last?["code_hash"] == nil)

        // A page key that isn't one: nothing is sent.
        await #expect(throws: ConnectAPI.Failure.self) {
            _ = try await ConnectAPI.decide(id: id, redirectURI: redirect, allow: true, write: true, code: code, browserKey: Data(repeating: 4, count: 65)) { _, _, _ in
                Issue.record("sent"); return Data()
            }
        }
    }

    @Test func aRequestFromALinkHereStillOpensTheReturnAddressWithTheCode() async throws {
        let redirect = "https://claude.ai/api/mcp/auth_callback"
        let secret = "amb_code_" + E2EE.randomHex()
        let code = (code: secret, hash: E2EE.sha256Hex(secret), wrap: "amb2.0123456789abcdef.AAAA")
        let answer = try JSONSerialization.data(withJSONObject: ["redirect": redirect + "?state=abc"])
        let decided = try await ConnectAPI.decide(id: UUID(), redirectURI: redirect, allow: true, write: false, code: code) { _, _, body in
            #expect(body?["handoff"] == nil)
            return answer
        }
        let url = try #require(decided.url)
        #expect(url.absoluteString.hasPrefix(redirect) && URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "code" }?.value == secret)
    }

    @Test func waitingAsksAreFetchedAndAnExpiredOrAnsweredOneIsIgnored() async throws {
        let now = Date.now
        func row(_ id: UUID, from: String, created: TimeInterval, expires: TimeInterval, answered: Bool = false) -> [String: Any] {
            ["request_id": id.uuidString.lowercased(), "user_id": user.uuidString.lowercased(),
             "browser_key": P256.KeyAgreement.PrivateKey().publicKey.x963Representation.base64EncodedString(),
             "started_from": from, "created_at": StubSupabase.stamp(now.addingTimeInterval(created)),
             "expires_at": StubSupabase.stamp(now.addingTimeInterval(expires)),
             "answered_at": answered ? StubSupabase.stamp(now) : NSNull()]
        }
        let open = UUID(), older = UUID(), expired = UUID(), answered = UUID()
        StubSupabase.insert("connect_asks", row(expired, from: "Safari on an iPhone", created: -700, expires: -100))
        StubSupabase.insert("connect_asks", row(answered, from: "Firefox on a PC", created: -60, expires: 540, answered: true))
        StubSupabase.insert("connect_asks", row(older, from: "Edge on a PC", created: -240, expires: 360))
        StubSupabase.insert("connect_asks", row(open, from: "Chrome on a Mac", created: -30, expires: 570))

        final class Posted: @unchecked Sendable { var asks: [(UUID, String?)] = []; var asked = 0; var withdrawn: [UUID] = [] }
        let posted = Posted()
        var frontmost = true
        let notifier = ConnectNotifier(isFrontmost: { frontmost }, askPermission: { posted.asked += 1 },
                                       post: { ask, who in posted.asks.append((ask.id, who)) }, withdraw: { posted.withdrawn.append($0) })
        let center = ConnectCenter()
        let asks = ConnectAsks(client: StubSupabase.client(), user: user, center: center, notifier: notifier, describe: { _ in "ChatGPT" })
        await asks.refresh()

        #expect(StubSupabase.requests.contains { $0.contains("/rest/v1/connect_asks") && $0.lowercased().contains("answered_at=is.null") && $0.contains("expires_at=gt.") })
        #expect(center.pending == open, "the newest opens")
        #expect(center.queue == [older], "the other waits its turn")
        #expect(Set(center.askIDs) == [open, older], "an expired or answered ask is ignored")
        #expect(posted.asked == 2 && posted.asks.isEmpty, "in front: the sheet shows, no notification")

        // Looking again finds nothing new; nothing opens twice.
        await asks.refresh()
        #expect(center.pending == open && center.queue == [older] && posted.asked == 2)

        // Answered on another device: its sheet closes and the next one shows.
        center.nextDelay = .zero
        center.withdraw(open)
        #expect(center.pending == nil)
        center.showNext()
        #expect(center.pending == older && center.queue.isEmpty)

        // One that arrives while the app is in the background also says so.
        frontmost = false
        let late = UUID()
        let ask = ConnectAsk(request_id: late, browser_key: "", started_from: "Chrome on a Mac", created_at: now, expires_at: now.addingTimeInterval(600))
        await asks.take(ask)
        #expect(posted.asks.count == 1 && posted.asks.first?.0 == late && posted.asks.first?.1 == "ChatGPT")
        #expect(center.queue == [late])
        let text = ConnectNotifier.content(ask, who: "ChatGPT")
        #expect(text.title == "Allow ChatGPT to use your notes?")
        #expect(text.body == "Requested from Chrome on a Mac. Open Amber Notes to allow it.")
        // An expired one never opens or notifies.
        let stale = ConnectAsk(request_id: UUID(), browser_key: "", started_from: "Chrome on a Mac", created_at: now.addingTimeInterval(-700), expires_at: now.addingTimeInterval(-1))
        await asks.take(stale)
        #expect(posted.asks.count == 1 && !center.askIDs.contains(stale.id))
    }

    @Test func startFreshCanRemoveTheFilesBeforeSyncEverStarts() async throws {
        let crypto = AccountCrypto(store: MemoryAccountKeyStore(), defaults: MemoryDefaults())
        #expect(crypto.removeAccountFiles == nil)
        let context = ModelContext(try ModelContainer(for: Folder.self, Note.self, Pane.Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true)))
        let engine = SyncEngine(backend: Backend(testClient: StubSupabase.client(), email: "qa@example.com", userID: user), context: context,
                                defaults: MemoryDefaults(), crypto: crypto)
        // Never started (this device has no key): the hook is already there, and reaches Storage.
        let remove = try #require(crypto.removeAccountFiles)
        await remove(user)
        #expect(StubSupabase.requests.contains { $0.contains("/storage/v1/object/list/files") })
        _ = engine
    }

    @Test func aPaneTokenNeverAppearsInAnyAddress() async throws {
        let token = "pane_" + E2EE.randomHex()
        let made = try await ConnectTokens.create(StubSupabase.client(), name: "Claude Code", write: true) {
            (token, E2EE.sha256Hex(token), "amb2.0123456789abcdef.AAAA")
        }
        #expect(made == token)
        let call = try #require(StubSupabase.rpcCalls.first { $0.name == "create_mcp_token" })
        #expect(call.params["token_hash"] as? String == E2EE.sha256Hex(token) && call.params["dk_wrap"] as? String == "amb2.0123456789abcdef.AAAA")
        #expect(!StubSupabase.requests.joined().contains("pane_"), "no address carries it")
        #expect(!StubSupabase.bodies.joined().contains(token), "and the server gets only its hash")
        let command = ConnectSnippets.claudeCode(url: "https://mcp.ambernotes.app", token: token)
        #expect(command.contains("--header \"Authorization: Bearer \(token)\"") && !command.contains("?"))
    }
}
}
