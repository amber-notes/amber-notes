import CryptoKit
import Foundation
import SwiftData
import UniformTypeIdentifiers

extension UTType {
    /// An Evernote export. Evernote doesn't declare one, so Amber Notes does (see project.yml).
    static let enex = UTType(importedAs: "com.evernote.enex", conformingTo: .xml)
}

/// Creates notes from Evernote exports (.enex), one notebook per file. Reading happens off the main
/// thread, a few notes ahead; notes, folders and files are made through `ImportWriter`.
@MainActor
final class EvernoteImporter {
    private let writer: ImportWriter

    init(context: ModelContext) {
        writer = ImportWriter(context: context)
    }

    /// Looks a file over: is it an export, and how many notes does it hold. The notebook's name is
    /// the file's: Evernote names each export after it.
    nonisolated static func inspect(_ url: URL) -> ImportSource {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let name = url.deletingPathExtension().lastPathComponent
        let bytes = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        do {
            return ImportSource(url: url, name: name, notes: try ENEXReader.countNotes(in: url), bytes: bytes)
        } catch {
            return ImportSource(url: url, name: name, notes: 0, bytes: bytes, problem: error.localizedDescription)
        }
    }

    /// Imports the files in order. `progress(done, total)` is called as notes are made;
    /// `shouldStop` is asked between notes.
    func run(_ sources: [ImportSource], into destination: ImportDestination,
             progress: (Int, Int) -> Void = { _, _ in }, shouldStop: () -> Bool = { false }) async -> ImportSummary {
        let total = sources.reduce(0) { $0 + $1.notes }
        var done = 0
        let scratch = FileManager.default.temporaryDirectory.appending(path: "EvernoteImport-\(UUID().uuidString)", directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: scratch) }
        progress(0, total)
        outer: for source in sources where source.problem == nil {
            let access = source.url.startAccessingSecurityScopedResource()
            defer { if access { source.url.stopAccessingSecurityScopedResource() } }
            let feed = ENEXFeed(url: source.url, scratch: scratch)
            do {
                for try await note in feed.notes {
                    if shouldStop() {
                        feed.stop()
                        Self.discard(note)
                        writer.summary.stopped = true
                        break outer
                    }
                    add(note, from: source, to: destination)
                    Self.discard(note)
                    feed.taken()
                    done += 1
                    progress(min(done, total), total)
                    if done % 50 == 0 { await Task.yield() }
                }
            } catch {
                writer.summary.failedFiles.append("\(source.name): \(error.localizedDescription)")
            }
        }
        return writer.finish()
    }

    /// Scratch copies of a note's files, once they've been moved in or skipped.
    private static func discard(_ note: ENEXNote) {
        for r in note.resources { if let f = r.file { try? FileManager.default.removeItem(at: f.deletingLastPathComponent()) } }
    }

    private func add(_ en: ENEXNote, from source: ImportSource, to destination: ImportDestination) {
        let bodyEmpty = ENMLToMarkdown.plainText(en.content).isEmpty
        let rawTitle = en.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if rawTitle.isEmpty && bodyEmpty && en.resources.allSatisfy({ $0.file == nil }) {
            writer.summary.empty += 1
            return
        }
        let titleLine = ImportWriter.titleLine(rawTitle)
        let created = en.created ?? en.updated ?? .now
        if writer.alreadyImported(titleLine: titleLine, created: created) { return }

        // Files first, so the body can place them.
        var files: [String: Attachment] = [:]
        var order: [String] = []
        for r in en.resources {
            guard let file = r.file, !r.hash.isEmpty else { writer.summary.filesMissing += 1; continue }
            guard files[r.hash] == nil else { continue }
            let type = UTType(mimeType: r.mime)
            guard let a = writer.attachment(from: file, filename: r.filename, type: type, move: true) else { continue }
            files[r.hash] = a
            order.append(r.hash)
        }
        let converted = ENMLToMarkdown.convert(en.content) { files[$0]?.markdown }
        // Evernote notes often repeat their title as the first line.
        let body = ImportWriter.dropRepeatedTitle(converted.markdown, title: titleLine)
        var markdown = titleLine
        if !body.isEmpty { markdown += "\n" + body }
        // Files the body never placed (Evernote keeps some only as attachments) go at the end.
        let unplaced = order.filter { !converted.placed.contains($0) }.compactMap { files[$0]?.markdown }
        if !unplaced.isEmpty { markdown += "\n\n" + unplaced.joined(separator: "\n") }
        if let tags = ImportWriter.tagLine(en.tags) { markdown += "\n\n" + tags }

        let folder = writer.folder(source: source.name.isEmpty ? "Evernote" : source.name, destination)
        guard writer.add(markdown: markdown, created: created, updated: en.updated, in: folder, files: Array(files.values)) else { return }
        writer.summary.attachments += files.count
        writer.summary.encrypted += converted.encrypted
        writer.summary.filesMissing += converted.missing
    }
}

/// Notes read from one file on a thread of their own, at most a few ahead of the importer, so
/// memory stays flat however big the export.
final class ENEXFeed: @unchecked Sendable {
    let notes: AsyncThrowingStream<ENEXNote, Error>
    private let gate = DispatchSemaphore(value: 4)
    private let lock = NSLock()
    private var stopped = false

    init(url: URL, scratch: URL) {
        let (notes, continuation) = AsyncThrowingStream<ENEXNote, Error>.makeStream()
        self.notes = notes
        let thread = Thread { [self] in
            let reader = ENEXReader(url: url, scratch: scratch) { note in
                self.gate.wait()
                if self.isStopped {
                    for r in note.resources { if let f = r.file { try? FileManager.default.removeItem(at: f.deletingLastPathComponent()) } }
                    return false
                }
                continuation.yield(note)
                return true
            }
            do {
                try reader.read()
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
        thread.name = "ENEX reader"
        thread.stackSize = 4 << 20
        continuation.onTermination = { [weak self] _ in self?.stop() }
        thread.start()
    }

    private var isStopped: Bool { lock.withLock { stopped } }

    /// The importer is done with a note: the reader may read one more.
    func taken() { gate.signal() }

    func stop() {
        lock.withLock { stopped = true }
        // Wakes the reader if it's waiting, so it can see it should stop.
        for _ in 0..<8 { gate.signal() }
    }
}
