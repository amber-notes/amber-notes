import Foundation
import PDFKit
import SwiftData
import Testing
import UniformTypeIdentifiers
@testable import Pane

/// Getting files out (drag, Export…), the PDF reader's controls, and the short refusal.
@MainActor @Suite(.serialized) struct FileOutTests {
    private func container() throws -> ModelContainer {
        try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
    }

    @Test func aDraggedFileIsTheFileItselfUnderItsOwnTypeAndName() async throws {
        let c = try container()
        let a = try FileStore.importData(DemoData.paperPDF(title: "Fluent Python", lines: 10), filename: "Fluent Python.pdf", type: .pdf)
        c.mainContext.insert(a)
        defer { FileStore.remove(a) }
        let p = FileOut.provider(for: a) { _ in false }
        // Finder and Mail need a file of a real type with a name; the old drag had only public.data.
        #expect(p.registeredTypeIdentifiers.contains(UTType.pdf.identifier))
        #expect(p.registeredTypeIdentifiers(fileOptions: []).contains(UTType.pdf.identifier))
        #expect(p.suggestedName == "Fluent Python.pdf")
        #expect(p.hasItemConformingToTypeIdentifier(UTType.paneItem.identifier), "the sidebar still takes it")
        let copied: Data = try await withCheckedThrowingContinuation { c in
            _ = p.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { url, error in
                if let url, let d = try? Data(contentsOf: url) { c.resume(returning: d) } else { c.resume(throwing: error ?? CocoaError(.fileNoSuchFile)) }
            }
        }
        #expect(copied == (try Data(contentsOf: FileStore.url(for: a.id, filename: a.filename))))
        #expect(FileStore.exists(a), "a drag copies; the file stays in Amber Notes")
        // Moving it to a folder in the sidebar decodes as before.
        let item: Data = try await withCheckedThrowingContinuation { c in
            _ = p.loadDataRepresentation(forTypeIdentifier: UTType.paneItem.identifier) { d, e in if let d { c.resume(returning: d) } else { c.resume(throwing: e ?? CocoaError(.fileNoSuchFile)) } }
        }
        let decoded = try JSONDecoder().decode(PaneDragItem.self, from: item)
        #expect(decoded.kind == .file && decoded.id == a.id)
    }

    @Test func aFileNotOnThisDeviceIsDownloadedForTheDrag() async throws {
        let c = try container()
        let a = Attachment(filename: "Later.pdf", contentType: UTType.pdf.identifier, size: 4)
        c.mainContext.insert(a)
        defer { FileStore.remove(a) }
        var asked = false
        let p = FileOut.provider(for: a) { file in
            asked = true
            let url = FileStore.url(for: file.id, filename: file.filename)
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? Data("%PDF".utf8).write(to: url)
            return true
        }
        let ok: Bool = await withCheckedContinuation { c in
            _ = p.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { url, _ in c.resume(returning: url != nil) }
        }
        #expect(asked && ok)
    }

    @Test func exportWritesTheFileItself() throws {
        let c = try container()
        let a = try FileStore.importData(Data("Book,Pages\nFluent Python,1014\n".utf8), filename: "Reading log.csv", type: .commaSeparatedText)
        c.mainContext.insert(a)
        defer { FileStore.remove(a) }
        let wrapper = try ExportedFile(url: FileStore.url(for: a.id, filename: a.filename)).wrapper()
        #expect(wrapper.regularFileContents == Data("Book,Pages\nFluent Python,1014\n".utf8))
    }

    @Test func thePDFReaderZoomsPagesAndFinds() throws {
        let doc = try #require(PDFDocument(data: DemoData.bookPDF(title: "Fluent Python", chapters: DemoData.fluentPythonChapters)))
        let m = PDFReaderModel(document: doc)
        #expect(m.pageCount == 7 && m.pageLabel == "1 of 7")
        #expect(m.outline.map { $0.label } == DemoData.fluentPythonChapters, "the table of contents")
        // Preview's zoom steps.
        #expect(PDFReaderModel.step(from: 1, up: true) == 1.1)
        #expect(PDFReaderModel.step(from: 1, up: false) == 0.9)
        #expect(PDFReaderModel.step(from: 6, up: true) == 6)
        #expect(PDFReaderModel.step(from: 0.25, up: false) == 0.25)
        #expect(PDFReaderModel.step(from: 1.17, up: true) == 1.25)
        // Find highlights every match and steps through them.
        m.query = "python"
        m.find()
        #expect(m.matches.count > 2, "the title and every chapter say Python")
        #expect(m.findLabel == "1 of \(m.matches.count)")
        m.next()
        #expect(m.findLabel == "2 of \(m.matches.count)")
        m.next(false); m.next(false)
        #expect(m.match == m.matches.count - 1, "wraps around")
        m.query = "zebra"
        m.find()
        #expect(m.findLabel == "Not found")
        // Going to a page is clamped.
        m.go(to: 99)
        #expect(m.page == 7)
        m.go(to: 0)
        #expect(m.page == 1)
    }

    @Test func refusalsAreShortAndNameTheKind() {
        let video = FileRefusal(unsupported: ["Holiday.mov"], tooBig: [])
        #expect(video.title == "Can't add videos yet")
        #expect(video.message == "\u{201C}Holiday.mov\u{201D}\n\nAmber Notes takes PDFs, pictures, text, CSV, HTML and code, and Office and iWork files.")
        #expect(FileRefusal(unsupported: ["a.mp3", "b.m4a"], tooBig: []).title == "Can't add audio yet")
        #expect(FileRefusal(unsupported: ["Book.epub"], tooBig: []).title == "Can't add e-books yet")
        #expect(FileRefusal(unsupported: ["x.exe"], tooBig: []).title == "Can't add this kind of file")
        #expect(FileRefusal(unsupported: [], tooBig: ["Scan.pdf"]).title == "File too large")
        #expect(FileRefusal(unsupported: [], tooBig: ["Scan.pdf"]).message.hasSuffix("Files can be up to 100 MB."))
        let many = FileRefusal(unsupported: (1...8).map { "Clip \($0).mov" }, tooBig: [])
        #expect(many.title == "Can't add videos yet", "one alert for several files")
        #expect(many.message.components(separatedBy: "\n").count == 7, "four names, how many more, a blank line, what works")
        #expect(many.message.contains("and 4 more"))
        #expect(FileRefusal(unsupported: ["a.mov"], tooBig: ["b.pdf"]).title == "Can't add these files")
    }
}
