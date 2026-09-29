import Foundation

/// Holds a note's latest text while you type and writes it to the model once
/// typing pauses, so the note list and sync don't redo their work on every key.
/// Pending text is written at once when you switch notes, the window closes, or
/// the app goes to the background or quits (`flushAll`).
@MainActor
final class DebouncedSave {
    static let delay: TimeInterval = 0.4
    private static let live = NSHashTable<DebouncedSave>.weakObjects()

    private var work: DispatchWorkItem?
    private var pending: (() -> Void)?
    /// The note's text when this run of typing began. If something else (sync,
    /// an AI) changes the note before the write, the stale write is dropped.
    private(set) var base: String?

    init() { Self.live.add(self) }

    var isPending: Bool { pending != nil }

    /// Remembers what to write; `base` is the note's current text, kept from the first call.
    func schedule(base current: String, _ write: @escaping () -> Void) {
        if base == nil { base = current }
        pending = write
        work?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.flush() }
        work = w
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.delay, execute: w)
    }

    func flush() {
        work?.cancel()
        work = nil
        let write = pending
        pending = nil
        write?()
        base = nil
    }

    func cancel() {
        work?.cancel()
        work = nil
        pending = nil
        base = nil
    }

    /// Writes every pending note now.
    static func flushAll() {
        for s in live.allObjects { s.flush() }
    }
}
