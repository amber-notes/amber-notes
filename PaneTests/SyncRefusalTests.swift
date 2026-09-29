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

    @Test func ordinaryFileNamesKeepTheirStorageKey() {
        for name in ["Flight itinerary.pdf", "Sunset.png", "räksmörgås 2026.xlsx", "photo (1).jpeg", "日本語.txt"] {
            #expect(SyncEngine.storageName(name) == name)
        }
    }

    @Test func hostileFileNamesBecomeOneSafeSegment() {
        #expect(!SyncEngine.storageName("../../etc/passwd").contains("/"))
        #expect(!SyncEngine.storageName("a\\b").contains("\\"))
        #expect(SyncEngine.storageName("line\nbreak.txt") == "line_break.txt")
        #expect(SyncEngine.storageName("..") == "file")
        #expect(SyncEngine.storageName("   ") == "file")
        #expect(SyncEngine.storageName("rtl\u{202E}gnp.exe").contains("\u{202E}") == false)
        let long = String(repeating: "å", count: 400) + ".pdf"
        let short = SyncEngine.storageName(long)
        #expect(short.utf8.count <= 200)
        #expect(short.hasSuffix(".pdf"))
    }
}
