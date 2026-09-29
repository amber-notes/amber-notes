import Foundation
import SwiftData
import Testing
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
#endif
@testable import Pane

/// The share extension's route, end to end minus the share sheet itself: what another app
/// hands over → markdown and files → the App Group inbox → a real note in the library.
@MainActor @Suite(.serialized) struct SharedItemTests {
    private let tmp = FileManager.default.temporaryDirectory.appending(path: "shared-\(UUID().uuidString)")

    /// A note the way Notes writes HTML: a title, a dashed list, bold, a link.
    private let notesHTML = """
    <div><h1>Weekend</h1></div>
    <div>Pick up <b>groceries</b> and see <a href="https://example.com">the plan</a>.</div>
    <ul class="Apple-dash-list"><li>Olive oil</li><li>Lemons</li></ul>
    <ul><li>Bullet one</li></ul>
    """

    @Test func sharedHTMLConvertsExactlyLikeTheMacImport() async throws {
        let p = NSItemProvider(item: notesHTML.data(using: .utf8)! as NSData, typeIdentifier: UTType.html.identifier)
        let got = await SharedItem.read([p], filesInto: tmp)
        let macImport = RichPaste.clean(RichTextToMarkdown.markdown(fromHTML: notesHTML))
        #expect(got.markdown == macImport)
        #expect(got.markdown.hasPrefix("# Weekend"))
        #expect(got.markdown.contains("**groceries**"))
        #expect(got.markdown.contains("- Olive oil"), "Notes' dashed lists stay dashes")
        #expect(got.markdown.contains("[the plan](https://example.com/)"))
    }

    @Test func picturesInRichTextBecomeFiles() async throws {
        let text = NSMutableAttributedString(string: "Receipt\nPaid in full ")
        let png = Self.tinyPNG()
        let wrapper = FileWrapper(regularFileWithContents: png)
        wrapper.preferredFilename = "receipt.png"
        let attachment = NSTextAttachment()
        attachment.fileWrapper = wrapper
        text.append(NSAttributedString(attachment: attachment))
        let rtfd = try text.data(from: NSRange(location: 0, length: text.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.rtfd])
        let p = NSItemProvider(item: rtfd as NSData, typeIdentifier: UTType.flatRTFD.identifier)
        let got = await SharedItem.read([p], filesInto: tmp)
        #expect(got.markdown.hasPrefix("Receipt"))
        #expect(!got.markdown.contains("\u{FFFC}"))
        #expect(got.files.count == 1, "the picture used to be dropped")
        #expect(got.files.first?.lastPathComponent == "receipt.png")
    }

    @Test func plainTextLinksAndPhotos() async throws {
        let text = NSItemProvider(object: "Call the plumber" as NSString)
        let link = NSItemProvider(object: URL(string: "https://example.com/recipe")! as NSURL)
        let photoURL = tmp.appending(path: "photo.png")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        try Self.tinyPNG().write(to: photoURL)
        let photo = NSItemProvider(contentsOf: photoURL)!
        let got = await SharedItem.read([text, link, photo], filesInto: tmp)
        #expect(got.markdown == "Call the plumber\n\nhttps://example.com/recipe")
        #expect(got.files.map(\.pathExtension) == ["png"])
    }

    @Test func titleIsTheFirstLine() {
        #expect(SharedItem.title(markdown: "\n# Weekend\nmore", files: []) == "Weekend")
        #expect(SharedItem.title(markdown: "", files: [URL(fileURLWithPath: "/x/scan.pdf")]) == "scan.pdf")
    }

    @Test func throughTheInboxIntoANote() async throws {
        let inbox = tmp.appending(path: "Inbox")
        Inbox.rootOverride = inbox
        defer { Inbox.rootOverride = nil; try? FileManager.default.removeItem(at: tmp) }
        let p = NSItemProvider(item: notesHTML.data(using: .utf8)! as NSData, typeIdentifier: UTType.html.identifier)
        let photoURL = tmp.appending(path: "photo.png")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        try Self.tinyPNG().write(to: photoURL)
        let got = await SharedItem.read([p, NSItemProvider(contentsOf: photoURL)!], filesInto: tmp)
        try Inbox.add(markdown: got.markdown, files: got.files)

        let container = try ModelContainer(for: Folder.self, Note.self, Attachment.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        var brought = false
        let observer = NotificationCenter.default.addObserver(forName: .paneNotesBrought, object: nil, queue: nil) { _ in brought = true }
        defer { NotificationCenter.default.removeObserver(observer) }
        let made = container.mainContext.drainInbox()
        #expect(made.count == 1)
        let note = try #require(made.first)
        #expect(note.title == "Weekend")
        #expect(note.body.contains("- Olive oil"))
        #expect(note.body.contains("pane-file:"), "the photo is attached to the note")
        #expect(brought, "setup step 1 ticks when a shared note arrives")
        #expect(Inbox.pending().isEmpty)
    }

    static func tinyPNG() -> Data {
        // A 1×1 PNG.
        Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!
    }
}
