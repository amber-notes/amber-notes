import SwiftUI
import UniformTypeIdentifiers

/// Getting a file out of Amber Notes: dragging it to Finder, Mail or the Desktop, Export… (a save
/// panel, Downloads first), Share, and on iPhone Save to Files.
enum FileOut {
    #if os(macOS)
    static let exportTitle = "Export…"
    static let exportSymbol = "square.and.arrow.down"
    #else
    static let exportTitle = "Save to Files"
    static let exportSymbol = "folder"
    #endif

    /// What a drag of a file carries. Finder and Mail take the file itself, under its own type and
    /// name; the sidebar takes the item (to move the file to a folder).
    ///
    /// The earlier drag offered only the in-app item and nameless `public.data`, which Finder has no
    /// use for, so nothing could be dropped outside the app.
    @MainActor
    static func provider(for file: Attachment, download: @escaping @MainActor (Attachment) async -> Bool) -> NSItemProvider {
        let p = NSItemProvider()
        let id = file.id, name = file.filename, type = file.type
        if let data = try? JSONEncoder().encode(PaneDragItem(kind: .file, id: id)) {
            p.registerDataRepresentation(forTypeIdentifier: UTType.paneItem.identifier, visibility: .ownProcess) { done in
                done(data, nil)
                return nil
            }
        }
        p.suggestedName = name
        let url = FileStore.url(for: id, filename: name)
        // Used on the main actor only (the download below), never from the loader's own thread.
        nonisolated(unsafe) let target = file
        // The file itself, copied by the receiver (never moved out of the app). A file not on this
        // device yet is downloaded first.
        p.registerFileRepresentation(forTypeIdentifier: (type == .data ? UTType(filenameExtension: (name as NSString).pathExtension) ?? .data : type).identifier,
                                     fileOptions: [], visibility: .all) { done in
            if FileManager.default.fileExists(atPath: url.path) {
                done(url, false, nil)
                return nil
            }
            Task { @MainActor in
                let ok = await download(target)
                done(ok ? url : nil, false, ok ? nil : CocoaError(.fileNoSuchFile))
            }
            return nil
        }
        return p
    }
}

/// A file's bytes for the save panel (Export…) and Save to Files.
struct ExportedFile: FileDocument {
    static var readableContentTypes: [UTType] { [.item] }
    var url: URL

    init(url: URL) { self.url = url }
    init(configuration: ReadConfiguration) throws { throw CocoaError(.fileReadUnsupportedScheme) }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { try wrapper() }

    /// The file as written by the save panel: its bytes, read now.
    func wrapper() throws -> FileWrapper { try FileWrapper(url: url, options: .immediate) }
}

extension View {
    /// Export… as a save panel (Mac: it opens in Downloads) or Save to Files (iPhone).
    func fileExport(_ file: Attachment?, isPresented: Binding<Bool>) -> some View {
        let ready = file.flatMap { FileStore.exists($0) ? $0 : nil }
        return fileExporter(isPresented: isPresented,
                            document: ready.map { ExportedFile(url: FileStore.url(for: $0.id, filename: $0.filename)) },
                            contentType: ready.map { $0.type == .data ? .item : $0.type } ?? .item,
                            defaultFilename: ready?.filename) { _ in }
            .fileExporterFilenameLabel("Export As:")
            .fileDialogDefaultDirectory(FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first)
    }
}
