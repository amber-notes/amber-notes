import Foundation
import Supabase
import Testing
@testable import Pane

/// What the sync engine does when the server won't take a row.
@Suite struct SyncRefusalTests {
    @Test func tooFastWaitsAndLimitsSetTheRowAside() {
        #expect(SyncEngine.refusal(PostgrestError(code: "PT429", message: "Too many changes too quickly.")) == .tooFast)
        #expect(SyncEngine.refusal(PostgrestError(code: "PT413", message: "This note is too long")) == .refused("This note is too long"))
        #expect(SyncEngine.refusal(PostgrestError(code: "22P05", message: "unsupported Unicode escape sequence")) != nil)
        #expect(SyncEngine.refusal(StorageError(statusCode: "413", message: "Payload too large")) == .refused("Payload too large"))
        #expect(SyncEngine.refusal(StorageError(statusCode: "429", message: "slow down")) == .tooFast)
    }

    @Test func networkTroubleIsNotARefusal() {
        #expect(SyncEngine.refusal(URLError(.notConnectedToInternet)) == nil)
        #expect(SyncEngine.refusal(PostgrestError(code: "08006", message: "connection failure")) == nil)
        #expect(SyncEngine.refusal(StorageError(statusCode: "503", message: "unavailable")) == nil)
    }

    /// A file's place in Storage names only whose it is and which file: never its name.
    @Test func aStoragePathSaysNothingAboutTheFile() {
        let user = UUID(), id = UUID()
        #expect(SyncEngine.storagePath(user: user, id: id) == "\(user.uuidString.lowercased())/\(id.uuidString.lowercased())")
    }

    @Test func aRowThatCantBeSealedIsSetAsideNotRetried() {
        #expect(SyncEngine.refusal(Wire.Unsealable()) == .refused("it couldn't be encrypted"))
    }
}
