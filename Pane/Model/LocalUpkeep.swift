import Foundation
import SwiftData

/// What the app keeps on disk beside the notes themselves, kept small.
enum LocalUpkeep {
    /// The system's shared cache wrote the server's answers to disk (Caches/<bundle id>/Cache.db):
    /// megabytes of sync pulls that nothing reads back, since the notes are in the library. Answers
    /// stay in memory only, and what was already written goes. Before the first request.
    static func keepServerAnswersOffDisk() {
        URLCache.shared.removeAllCachedResponses()
        URLCache.shared = URLCache(memoryCapacity: 4 * 1024 * 1024, diskCapacity: 0)
    }

    /// How long the store's own change history is kept.
    static let historyKept: TimeInterval = 7 * 24 * 3600

    /// SwiftData writes down every change to every note, for good (the store's ACHANGE and
    /// ATRANSACTION tables): after a first sync of 20,000 notes and a few account switches that was
    /// 13 MB, a quarter of the library, and it only grew. Nothing in the app reads it, so the part
    /// older than a week goes. On its own context, off the main thread.
    @discardableResult
    static func forgetOldHistory(in container: ModelContainer, before cutoff: Date = .now.addingTimeInterval(-historyKept)) -> Bool {
        let context = ModelContext(container)
        var old = HistoryDescriptor<DefaultHistoryTransaction>()
        old.predicate = #Predicate { $0.timestamp < cutoff }
        do {
            try context.deleteHistory(old)
            return true
        } catch {
            return false
        }
    }
}
