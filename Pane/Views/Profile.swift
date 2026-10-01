import Foundation
import ImageIO
import Observation
import Supabase
import SwiftUI
import UniformTypeIdentifiers

/// Your own name and photo. Shown in the app and on the notes you share.
///
/// Edits apply on screen at once and go to the server as soon as it can be reached; until
/// then they wait on this device (per account), so nothing is lost offline. Everything is
/// keyed by account, and another account's cached profile is removed when you switch.
@MainActor
@Observable
final class ProfileStore {
    static let shared = ProfileStore()

    private(set) var name: String?
    private(set) var photo: PImage?
    private(set) var working = false
    private(set) var problem: String?

    @ObservationIgnored private var user: UUID?
    /// Screenshots and previews: a fixed profile, never touched by bind().
    @ObservationIgnored private var previewing = false
    @ObservationIgnored private var client: SupabaseClient?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let folder: URL

    struct Pending: Codable, Equatable {
        /// nil: the name wasn't changed; "": cleared.
        var name: String?
        /// A prepared JPEG waiting to be uploaded.
        var photoFile: String?
        var removePhoto = false
        var isEmpty: Bool { name == nil && photoFile == nil && !removePhoto }
    }

    init(defaults: UserDefaults = .standard, folder: URL? = nil) {
        self.defaults = defaults
        self.folder = folder ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "Pane/Profile", directoryHint: .isDirectory)
    }

    // MARK: Account

    /// Shows the signed-in account's profile: the cached copy at once, then the server's.
    func bind(_ backend: Backend) async {
        if previewing { return }
        guard case .signedIn = backend.state, let id = backend.userID, let client = backend.client else { reset(); return }
        if user != id {
            forgetOthers(than: id)
            user = id
            self.client = client
            name = defaults.string(forKey: key("name"))
            photo = (try? Data(contentsOf: file("photo.jpg"))).flatMap(PImage.init(data:))
        }
        self.client = client
        await flush()
        await refresh()
    }

    /// For screenshots and previews only.
    func showForPreview(name: String?, photo: PImage?) {
        previewing = true
        self.name = name
        self.photo = photo
    }

    /// Signed out: nothing of the last account stays on screen.
    func reset() {
        user = nil
        client = nil
        name = nil
        photo = nil
        problem = nil
    }

    // MARK: Editing

    func setName(_ raw: String) async {
        let clean = ProfileName.normalized(raw)
        guard clean != name else { return }
        name = clean
        store("name", clean)
        var p = pending
        p.name = clean ?? ""
        pending = p
        await flush()
    }

    /// A picked image: squared, 512 px, re-encoded without its metadata, then uploaded.
    func setPhoto(_ data: Data) async {
        guard user != nil else { return }
        do {
            let jpeg = try ProfileImage.prepare(data)
            try ensureFolder()
            let staged = file("pending-\(UUID().uuidString).jpg")
            try jpeg.write(to: staged, options: .atomic)
            try jpeg.write(to: file("photo.jpg"), options: .atomic)
            photo = PImage(data: jpeg)
            var p = pending
            if let old = p.photoFile { try? FileManager.default.removeItem(at: folder.appending(path: old)) }
            p.photoFile = staged.lastPathComponent
            p.removePhoto = false
            pending = p
            problem = nil
        } catch {
            problem = "That image couldn’t be used. Try a JPEG or PNG."
            return
        }
        await flush()
    }

    func removePhoto() async {
        guard user != nil else { return }
        photo = nil
        try? FileManager.default.removeItem(at: file("photo.jpg"))
        var p = pending
        if let old = p.photoFile { try? FileManager.default.removeItem(at: folder.appending(path: old)) }
        p.photoFile = nil
        p.removePhoto = true
        pending = p
        await flush()
    }

    // MARK: Server

    private struct Row: Codable {
        var display_name: String?
        var avatar_path: String?
    }

    private func refresh() async {
        guard let client, let user, pending.isEmpty else { return }
        do {
            let rows: [Row] = try await client.from("profiles").select("display_name, avatar_path").eq("user_id", value: user).execute().value
            guard self.user == user else { return }
            let row = rows.first
            name = row?.display_name
            store("name", row?.display_name)
            let current = defaults.string(forKey: key("avatar"))
            if row?.avatar_path != current {
                if let path = row?.avatar_path, let url = Self.avatarURL(path) {
                    let (data, response) = try await AppNetwork.session.data(from: url)
                    guard (response as? HTTPURLResponse)?.statusCode == 200, let image = PImage(data: data), self.user == user else { return }
                    try ensureFolder()
                    try data.write(to: file("photo.jpg"), options: .atomic)
                    photo = image
                } else {
                    try? FileManager.default.removeItem(at: file("photo.jpg"))
                    photo = nil
                }
                store("avatar", row?.avatar_path)
            }
        } catch {
            // Offline: the cached profile stays on screen.
        }
    }

    /// Sends whatever is waiting. Stops at the first failure and tries again next time.
    private func flush() async {
        guard let client, let user, !pending.isEmpty, !working else { return }
        working = true
        defer { working = false }
        var p = pending
        do {
            var row: [String: AnyJSON] = ["user_id": .string(user.uuidString.lowercased())]
            let previous = defaults.string(forKey: key("avatar"))
            var uploaded: String?
            if let staged = p.photoFile {
                let data = try Data(contentsOf: folder.appending(path: staged))
                let name = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased() + ".jpg"
                try await client.storage.from("avatars").upload(name, data: data, options: FileOptions(contentType: "image/jpeg", upsert: false))
                uploaded = name
                row["avatar_path"] = .string(name)
            } else if p.removePhoto {
                row["avatar_path"] = .null
            }
            if let n = p.name { row["display_name"] = n.isEmpty ? .null : .string(n) }
            try await client.from("profiles").upsert(row, onConflict: "user_id").execute()
            // The old photo goes once the new one is in place.
            if let previous, uploaded != nil || p.removePhoto {
                _ = try? await client.storage.from("avatars").remove(paths: [previous])
            }
            if let staged = p.photoFile { try? FileManager.default.removeItem(at: folder.appending(path: staged)) }
            if uploaded != nil || p.removePhoto { store("avatar", uploaded) }
            p = Pending()
            pending = p
            problem = nil
        } catch {
            problem = Self.describe(error)
        }
    }

    static func describe(_ error: Error) -> String {
        if error is URLError { return "Saved on this device. It goes up when you’re back online." }
        let text = String(describing: error).lowercased()
        if text.contains("too many") { return "Too many changes too quickly. It will try again shortly." }
        return "Couldn’t save your profile. It will try again."
    }

    /// Photos are public by exact name (random, with nothing about the account in it).
    nonisolated static func avatarURL(_ name: String) -> URL? {
        guard name.range(of: #"^[0-9a-f]{32}\.(jpg|png)$"#, options: .regularExpression) != nil else { return nil }
        return BackendConfig.url?.appending(path: "storage/v1/object/public/avatars/\(name)")
    }

    // MARK: Per-account storage

    private func key(_ k: String) -> String { "profile.\(k).\(user?.uuidString.lowercased() ?? "none")" }
    private func file(_ name: String) -> URL { folder.appending(path: "\(user?.uuidString.lowercased() ?? "none")-\(name)") }
    private func ensureFolder() throws { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
    private func store(_ k: String, _ value: String?) {
        if let value { defaults.set(value, forKey: key(k)) } else { defaults.removeObject(forKey: key(k)) }
    }

    private var pending: Pending {
        get { defaults.data(forKey: key("pending")).flatMap { try? JSONDecoder().decode(Pending.self, from: $0) } ?? Pending() }
        set {
            if newValue.isEmpty { defaults.removeObject(forKey: key("pending")) }
            else { defaults.set(try? JSONEncoder().encode(newValue), forKey: key("pending")) }
        }
    }

    /// Another account's cached name, photo and unsent edits never linger on this device.
    private func forgetOthers(than id: UUID) {
        let mine = id.uuidString.lowercased()
        for k in defaults.dictionaryRepresentation().keys where k.hasPrefix("profile.") && !k.hasSuffix(mine) {
            defaults.removeObject(forKey: k)
        }
        for f in (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? [] where !f.hasPrefix(mine) {
            try? FileManager.default.removeItem(at: folder.appending(path: f))
        }
    }
}

/// What a display name may be: trimmed, no control characters, at most 60 characters.
enum ProfileName {
    static let maxLength = 60

    static func normalized(_ raw: String) -> String? {
        let cleaned = String(String.UnicodeScalarView(raw.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }
        return String(cleaned.prefix(maxLength)).trimmingCharacters(in: .whitespaces)
    }
}

/// Turns any picked image into a profile photo: the centre square, 512 × 512, JPEG, with no
/// metadata at all (no location, camera or date), whatever the source carried.
enum ProfileImage {
    static let side = 512
    enum Failure: Error { case unreadable, encode }

    static func prepare(_ data: Data) throws -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw Failure.unreadable }
        // A thumbnail applies the photo's orientation, so portraits come out upright.
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 4096,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw Failure.unreadable }
        let edge = min(image.width, image.height)
        let crop = CGRect(x: (image.width - edge) / 2, y: (image.height - edge) / 2, width: edge, height: edge)
        guard let square = image.cropping(to: crop),
              let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw Failure.encode }
        context.interpolationQuality = .high
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: side, height: side))
        context.draw(square, in: CGRect(x: 0, y: 0, width: side, height: side))
        guard let scaled = context.makeImage() else { throw Failure.encode }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { throw Failure.encode }
        // Only the pixels: no EXIF, GPS, TIFF or IPTC dictionaries are written.
        CGImageDestinationAddImage(dest, scaled, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { throw Failure.encode }
        return out as Data
    }
}

#if os(iOS)
typealias PImage = UIImage
extension Image { init(platform image: PImage) { self.init(uiImage: image) } }
#else
typealias PImage = NSImage
extension Image { init(platform image: PImage) { self.init(nsImage: image) } }
#endif

/// Your photo in a circle, or your initials on amber when there's no photo.
struct AvatarView: View {
    var photo: PImage?
    var name: String
    var size: CGFloat

    nonisolated static func initials(_ name: String) -> String {
        let words = name.replacingOccurrences(of: #"@.*"#, with: "", options: .regularExpression)
            .split(whereSeparator: { " ._-".contains($0) })
        guard let first = words.first?.first else { return "?" }
        if words.count > 1, let last = words.last?.first { return String([first, last]).uppercased() }
        return String(first).uppercased()
    }

    var body: some View {
        Group {
            if let photo {
                Image(platform: photo).resizable().scaledToFill()
            } else {
                Text(Self.initials(name))
                    .font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundStyle(.black.opacity(0.78))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    // The app's amber, not the environment's accent: a sheet's accent can still be
                    // the system blue for a moment, and the same person kept changing colour.
                    .background(Color(PColor.paneAccent))
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .overlay(Circle().strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}
