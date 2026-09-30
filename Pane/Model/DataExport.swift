import Foundation
import Supabase
import SwiftUI
import UniformTypeIdentifiers

/// Export My Data: the server builds a zip of everything in the account (notes as Markdown and
/// JSON, folders, the list of files, earlier versions, AI connections and the profile), and the
/// app saves it wherever you choose.
///
///   GET /functions/v1/account/export   Authorization: Bearer <access token>
///   → 200 application/zip, Content-Disposition: attachment; filename="amber-notes-export-YYYY-MM-DD.zip"
///   → 401/429/500 { "error": "<a sentence to show>" }
enum DataExport {
    struct Archive: Equatable {
        var filename: String
        var data: Data
    }

    struct Failure: Error, Equatable {
        var message: String
    }

    static let fallbackMessage = "Couldn't export your data. Check your connection and try again."
    static let signInMessage = "Sign in again, then try exporting your data."

    /// The request, built from the backend's address, its public key and your access token.
    static func request(base: URL, anonKey: String, accessToken: String) -> URLRequest {
        var r = URLRequest(url: base.appending(path: "functions/v1/account/export"))
        r.httpMethod = "GET"
        r.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        r.setValue(anonKey, forHTTPHeaderField: "apikey")
        r.setValue("application/zip, application/json", forHTTPHeaderField: "Accept")
        r.timeoutInterval = 120
        return r
    }

    /// The zip, or the sentence the server gave for why not.
    static func parse(data: Data, response: URLResponse, now: Date = .now) -> Result<Archive, Failure> {
        guard let http = response as? HTTPURLResponse else { return .failure(Failure(message: fallbackMessage)) }
        let type = http.value(forHTTPHeaderField: "Content-Type")?.lowercased() ?? ""
        if http.statusCode == 200, type.hasPrefix("application/zip"), !data.isEmpty {
            let name = filename(fromDisposition: http.value(forHTTPHeaderField: "Content-Disposition")) ?? defaultFilename(now)
            return .success(Archive(filename: name, data: data))
        }
        struct ServerError: Decodable { var error: String }
        if let said = try? JSONDecoder().decode(ServerError.self, from: data), !said.error.isEmpty {
            return .failure(Failure(message: said.error))
        }
        return .failure(Failure(message: http.statusCode == 401 ? signInMessage : fallbackMessage))
    }

    /// `attachment; filename="x.zip"` → "x.zip". Only a plain name ending in .zip is taken, so a
    /// header can't point the file somewhere else.
    static func filename(fromDisposition header: String?) -> String? {
        guard let header, let range = header.range(of: #"filename="?([^";]+)"?"#, options: .regularExpression) else { return nil }
        let name = header[range]
            .replacingOccurrences(of: "filename=", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
        guard name.hasSuffix(".zip"), !name.contains("/"), !name.contains("\\"), !name.hasPrefix(".") else { return nil }
        return name
    }

    static func defaultFilename(_ now: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return "amber-notes-export-\(f.string(from: now)).zip"
    }
}

extension Backend {
    /// Fetches the account's export from the server.
    func exportData() async throws -> DataExport.Archive {
        guard let client, let base = BackendConfig.url, let key = BackendConfig.key else {
            throw DataExport.Failure(message: DataExport.signInMessage)
        }
        let token: String
        do { token = try await client.auth.session.accessToken } catch { throw DataExport.Failure(message: DataExport.signInMessage) }
        let request = DataExport.request(base: base, anonKey: key, accessToken: token)
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await AppNetwork.session.data(for: request) } catch {
            throw DataExport.Failure(message: DataExport.fallbackMessage)
        }
        return try DataExport.parse(data: data, response: response).get()
    }
}

/// The zip handed to the save dialog.
struct ExportArchiveDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.zip]
    var data: Data

    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
