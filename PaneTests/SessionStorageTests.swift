import Foundation
import Testing
@testable import Pane

@Suite struct SessionStorageTests {
    #if os(macOS)
    /// Unsigned test builds use the file fallback: it must be owner-only from the start.
    @Test func fallbackFileIsOwnerOnlyAndRoundTrips() throws {
        let storage = SessionStorage()
        let key = "test-\(UUID().uuidString)"
        let secret = Data("refresh-token-\(UUID())".utf8)
        try storage.store(key: key, value: secret)
        defer { try? storage.remove(key: key) }
        #expect(try storage.retrieve(key: key) == secret)
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Pane")
        let file = dir.appending(path: "session-\(key).bin")
        if FileManager.default.fileExists(atPath: file.path) {
            let mode = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? Int
            #expect(mode == 0o600)
        }
        // Overwriting keeps it private too.
        try storage.store(key: key, value: Data("second".utf8))
        #expect(try storage.retrieve(key: key) == Data("second".utf8))
        if FileManager.default.fileExists(atPath: file.path) {
            #expect((try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? Int) == 0o600)
        }
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".tmp") }
        #expect(leftovers.isEmpty)
    }
    #endif
}
