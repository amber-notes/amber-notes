import Foundation
import Testing
@testable import Pane

@Suite struct PrivacySecurityTests {
    private let base = URL(string: "https://example.supabase.co")!

    @Test func theRequestAsksForTheSignedInAccountsExport() {
        let r = DataExport.request(base: base, anonKey: "anon", accessToken: "jwt")
        #expect(r.url?.absoluteString == "https://example.supabase.co/functions/v1/account/export")
        #expect(r.httpMethod == "GET")
        #expect(r.value(forHTTPHeaderField: "Authorization") == "Bearer jwt")
        #expect(r.value(forHTTPHeaderField: "apikey") == "anon")
    }

    private func response(_ status: Int, _ headers: [String: String]) -> HTTPURLResponse {
        HTTPURLResponse(url: base, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
    }

    @Test func aZipIsKeptWithTheServersName() throws {
        let zip = Data([0x50, 0x4B, 0x03, 0x04])
        let r = DataExport.parse(data: zip, response: response(200, [
            "Content-Type": "application/zip",
            "Content-Disposition": #"attachment; filename="amber-notes-export-2026-09-30.zip""#,
        ]))
        #expect(try r.get() == DataExport.Archive(filename: "amber-notes-export-2026-09-30.zip", data: zip))
    }

    @Test func aMissingOrUnsafeNameFallsBackToTodays() throws {
        let day = ISO8601DateFormatter().date(from: "2026-09-30T12:00:00Z")!
        let zip = Data([1])
        for header in [nil, #"attachment; filename="../../evil.zip""#, #"attachment; filename="notes.exe""#] {
            var h = ["Content-Type": "application/zip"]
            h["Content-Disposition"] = header
            let a = try DataExport.parse(data: zip, response: response(200, h), now: day).get()
            #expect(a.filename.hasPrefix("amber-notes-export-2026-09-"))
            #expect(a.filename.hasSuffix(".zip"))
        }
    }

    @Test func theServersSentenceIsShown() {
        let body = Data(#"{"error":"Too many exports. Try again in an hour."}"#.utf8)
        let r = DataExport.parse(data: body, response: response(429, ["Content-Type": "application/json"]))
        #expect(r == .failure(DataExport.Failure(message: "Too many exports. Try again in an hour.")))
    }

    @Test func withoutASentenceTheStatusDecides() {
        let unauthorized = DataExport.parse(data: Data(), response: response(401, [:]))
        #expect(unauthorized == .failure(DataExport.Failure(message: DataExport.signInMessage)))
        let broken = DataExport.parse(data: Data("oops".utf8), response: response(502, ["Content-Type": "text/html"]))
        #expect(broken == .failure(DataExport.Failure(message: DataExport.fallbackMessage)))
        // A 200 that isn't a zip is not an export.
        let html = DataExport.parse(data: Data("<html>".utf8), response: response(200, ["Content-Type": "text/html"]))
        #expect(html == .failure(DataExport.Failure(message: DataExport.fallbackMessage)))
    }

    /// The facts must stay true today: unlocked notes aren't end-to-end encrypted yet, so nothing
    /// may say only you can read your notes, and the copy follows the site's rules.
    @Test func theFactsClaimOnlyWhatIsTrue() {
        let copy = ([PrivacyFacts.intro] + PrivacyFacts.all.flatMap { [$0.title, $0.detail] }).joined(separator: "\n")
        #expect(!copy.contains("\u{2014}"), "no em dashes")
        #expect(!copy.lowercased().contains("ipad"))
        #expect(!copy.lowercased().contains("only you can read your notes"))
        #expect(!copy.lowercased().contains("all notes are end-to-end"))
        let e2ee = PrivacyFacts.all.filter { $0.title.lowercased().contains("end-to-end") }
        #expect(e2ee.map(\.title) == ["Locked notes are end-to-end encrypted."])
        #expect(PrivacyFacts.page.absoluteString == "https://ambernotes.app/privacy-security")
        #expect(PrivacyFacts.all.contains { $0.link == PrivacyFacts.source })
    }
}

#if os(macOS)
import AppKit
import SwiftUI

/// Renders Privacy & Security offscreen, light and dark, at iPhone and Mac widths, when
/// PANE_SNAPSHOT_DIR is set. Nothing appears on screen.
@MainActor
@Suite struct PrivacySecuritySnapshots {
    @Test func screen() throws {
        guard let dir = ProcessInfo.processInfo.environment["PANE_SNAPSHOT_DIR"] else { return }
        try FileManager.default.createDirectory(at: URL(fileURLWithPath: dir), withIntermediateDirectories: true)
        let backend = Backend()
        for (name, size) in [("narrow", CGSize(width: 390, height: 760)), ("mac", CGSize(width: 480, height: 600))] {
            for dark in [false, true] {
                let view = PrivacySecurityView(backend: backend, sync: nil)
                    .tint(Color(PColor.paneAccent))
                    .frame(width: size.width, height: size.height)
                let host = NSHostingView(rootView: view)
                host.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                host.frame = CGRect(origin: .zero, size: size)
                host.layoutSubtreeIfNeeded()
                let rep = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
                host.cacheDisplay(in: host.bounds, to: rep)
                let png = try #require(rep.representation(using: .png, properties: [:]))
                try png.write(to: URL(fileURLWithPath: dir).appending(path: "privacy-\(name)-\(dark ? "dark" : "light").png"))
            }
        }
    }
}
#endif
