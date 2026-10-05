import Contacts
import CoreLocation
import EventKit
import ImageIO
import MapKit
import SwiftData
import SwiftUI
import UniformTypeIdentifiers
import UserNotifications
#if canImport(FoundationModels)
import FoundationModels
#endif
#if os(iOS)
import ContactsUI
import PhotosUI
#else
import AppKit
#endif

/// What a note that is an app can use of the device (prototype; see NotePage), each through the
/// system's own permission prompt or picker: Reminders, Calendar, notifications, the browser, photos,
/// the camera, a contact, a file, the location once, Maps, and the on-device language model.
///
/// What comes back goes to the page only. Nothing reaches the note's text unless the page writes it
/// with a note op (amber.update), which shows as a change with Undo like any other.
@MainActor
enum NotePageDevice {
    struct Unavailable: LocalizedError {
        let errorDescription: String?
        init(_ s: String) { errorDescription = s }
    }

    static func handle(_ m: [String: Any], context: ModelContext) async throws -> [String: Any] {
        switch m["op"] as? String {
        case "reminders.create": return try await createReminder(m)
        case "calendar.today": return try await today()
        case "notify": return try await notify(m)
        case "openURL": return try openURL(m)
        case "photos.pick": return try await pickPhotos(m, context: context)
        case "camera.take": return try await takePhoto(context: context)
        case "contacts.pick": return try await pickContact()
        case "files.pick": return try await pickFiles(context: context)
        case "location.once": return try await Locator().once()
        case "maps.open": return try openMaps(m)
        case "maps.snapshot": return try await mapSnapshot(m)
        case "weather.current":
            throw Unavailable("Weather isn't available in this build: WeatherKit needs a capability this app doesn't have yet. Use amber.fetch with a weather service.")
        case "ai.available": return aiAvailability()
        case "ai.respond": return try await respond(m)
        default: throw NotePage.OpError("Unknown op \(m["op"] as? String ?? "").")
        }
    }

    // MARK: Reminders and Calendar

    private static let events = EKEventStore()

    static func parseDate(_ v: Any?) -> Date? {
        guard let s = v as? String else { return nil }
        if let d = ISO8601DateFormatter().date(from: s) { return d }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        for format in ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd", "HH:mm"] {
            f.dateFormat = format
            if let d = f.date(from: s) {
                guard format == "HH:mm" else { return d }
                let c = Calendar.current.dateComponents([.hour, .minute], from: d)
                return Calendar.current.date(bySettingHour: c.hour ?? 9, minute: c.minute ?? 0, second: 0, of: .now)
            }
        }
        return nil
    }

    private static func createReminder(_ m: [String: Any]) async throws -> [String: Any] {
        guard let title = m["title"] as? String, !title.isEmpty, title.count <= 300 else { throw NotePage.OpError("A reminder needs a title.") }
        guard try await events.requestFullAccessToReminders() else { throw Unavailable("Reminders isn't allowed for Amber Notes. You can allow it in Settings.") }
        let r = EKReminder(eventStore: events)
        r.title = title
        r.notes = (m["notes"] as? String).map { String($0.prefix(2000)) }
        r.calendar = events.defaultCalendarForNewReminders()
        if let due = parseDate(m["due"]) {
            r.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: due)
            r.addAlarm(EKAlarm(absoluteDate: due))
        }
        if (m["repeat"] as? String) == "daily" { r.addRecurrenceRule(EKRecurrenceRule(recurrenceWith: .daily, interval: 1, end: nil)) }
        try events.save(r, commit: true)
        return ["id": r.calendarItemIdentifier, "title": title]
    }

    private static func today() async throws -> [String: Any] {
        guard try await events.requestFullAccessToEvents() else { throw Unavailable("Calendar isn't allowed for Amber Notes. You can allow it in Settings.") }
        let start = Calendar.current.startOfDay(for: .now)
        let end = Calendar.current.date(byAdding: .day, value: 1, to: start)!
        let iso = ISO8601DateFormatter()
        let list = events.events(matching: events.predicateForEvents(withStart: start, end: end, calendars: nil)).sorted { $0.startDate < $1.startDate }
        return ["events": list.map { e -> [String: Any] in
            [
                "title": e.title ?? "", "start": iso.string(from: e.startDate), "end": iso.string(from: e.endDate), "allDay": e.isAllDay,
                "location": e.location ?? "", "notes": String((e.notes ?? "").prefix(1000)), "calendar": e.calendar?.title ?? "",
                "attendees": (e.attendees ?? []).map { a in ["name": a.name ?? "", "email": a.url.absoluteString.replacingOccurrences(of: "mailto:", with: "")] },
            ]
        }]
    }

    // MARK: Notifications, the browser, Maps

    private static func notify(_ m: [String: Any]) async throws -> [String: Any] {
        guard let title = m["title"] as? String, !title.isEmpty else { throw NotePage.OpError("A notification needs a title.") }
        let center = UNUserNotificationCenter.current()
        guard try await center.requestAuthorization(options: [.alert, .sound]) else { throw Unavailable("Notifications aren't allowed for Amber Notes.") }
        let content = UNMutableNotificationContent()
        content.title = String(title.prefix(200))
        content.body = String(((m["body"] as? String) ?? "").prefix(1000))
        let trigger: UNNotificationTrigger
        if let at = parseDate(m["at"]), at > .now {
            trigger = UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at), repeats: false)
        } else {
            trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, (m["in"] as? Double) ?? 1), repeats: false)
        }
        let id = UUID().uuidString
        try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
        return ["id": id]
    }

    private static func openURL(_ m: [String: Any]) throws -> [String: Any] {
        guard let s = m["url"] as? String, let url = URL(string: s), ["https", "http", "mailto", "tel", "maps"].contains(url.scheme?.lowercased() ?? "") else {
            throw NotePage.OpError("Only web, mail, phone and Maps links open.")
        }
        #if os(iOS)
        UIApplication.shared.open(url)
        #else
        NSWorkspace.shared.open(url)
        #endif
        return [:]
    }

    private static func openMaps(_ m: [String: Any]) throws -> [String: Any] {
        let item: MKMapItem
        if let lat = m["lat"] as? Double, let lon = m["lon"] as? Double {
            item = MKMapItem(location: CLLocation(latitude: lat, longitude: lon), address: nil)
        } else if let q = m["query"] as? String, var c = URLComponents(string: "maps://") {
            c.queryItems = [URLQueryItem(name: (m["directions"] as? Bool) == true ? "daddr" : "q", value: q)]
            return try openURL(["url": c.url!.absoluteString])
        } else {
            throw NotePage.OpError("Send { lat, lon } or { query }.")
        }
        item.name = m["name"] as? String
        item.openInMaps(launchOptions: (m["directions"] as? Bool) == true ? [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDefault] : nil)
        return [:]
    }

    /// A picture of the map around a place, for the page to show (it can't load map tiles itself).
    private static func mapSnapshot(_ m: [String: Any]) async throws -> [String: Any] {
        guard let lat = m["lat"] as? Double, let lon = m["lon"] as? Double else { throw NotePage.OpError("Send { lat, lon }.") }
        let km = min(max((m["km"] as? Double) ?? 2, 0.2), 500)
        let o = MKMapSnapshotter.Options()
        let center = CLLocationCoordinate2D(latitude: lat, longitude: lon)
        o.region = MKCoordinateRegion(center: center, latitudinalMeters: km * 1000, longitudinalMeters: km * 1000)
        o.size = CGSize(width: min(max((m["width"] as? Double) ?? 600, 100), 1200), height: min(max((m["height"] as? Double) ?? 300, 100), 900))
        if let dark = m["dark"] as? Bool {
            #if os(iOS)
            o.traitCollection = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)
            #else
            o.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
            #endif
        }
        let shot = try await MKMapSnapshotter(options: o).start()
        let point = shot.point(for: center)
        #if os(iOS)
        let image = UIGraphicsImageRenderer(size: o.size).image { _ in
            shot.image.draw(at: .zero)
            UIColor(red: 0.85, green: 0.42, blue: 0.02, alpha: 1).setFill()
            UIBezierPath(ovalIn: CGRect(x: point.x - 8, y: point.y - 8, width: 16, height: 16)).fill()
            UIColor.white.setStroke()
            let ring = UIBezierPath(ovalIn: CGRect(x: point.x - 8, y: point.y - 8, width: 16, height: 16)); ring.lineWidth = 3; ring.stroke()
        }
        let png = image.pngData()
        #else
        let image = NSImage(size: o.size, flipped: false) { _ in
            shot.image.draw(at: .zero, from: .zero, operation: .copy, fraction: 1)
            NSColor(red: 0.85, green: 0.42, blue: 0.02, alpha: 1).setFill()
            NSBezierPath(ovalIn: CGRect(x: point.x - 8, y: point.y - 8, width: 16, height: 16)).fill()
            return true
        }
        let png = image.tiffRepresentation.flatMap { NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:]) }
        #endif
        guard let png else { throw Unavailable("The map couldn't be drawn.") }
        return ["dataURL": "data:image/png;base64," + png.base64EncodedString()]
    }

    // MARK: Photos, the camera, files, contacts

    /// Keeps a picked image as a file of the note's account (encrypted with the rest), downscaled
    /// to 2048 px, and returns its reference with a small preview for the page.
    static func keepImage(_ data: Data, name: String, context: ModelContext) throws -> [String: Any] {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil),
              let big = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 2048, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary),
              let small = CGImageSourceCreateThumbnailAtIndex(src, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceThumbnailMaxPixelSize: 480, kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary)
        else { throw NotePage.OpError("That isn't an image.") }
        func jpeg(_ i: CGImage, _ q: Double) -> Data? {
            let out = NSMutableData()
            guard let dst = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
            CGImageDestinationAddImage(dst, i, [kCGImageDestinationLossyCompressionQuality: q] as CFDictionary)
            return CGImageDestinationFinalize(dst) ? out as Data : nil
        }
        guard let full = jpeg(big, 0.85), let thumb = jpeg(small, 0.75) else { throw NotePage.OpError("That image couldn't be read.") }
        let a = try FileStore.importData(full, filename: (name as NSString).deletingPathExtension + ".jpg", type: .jpeg)
        context.insert(a)
        try? context.save()
        SyncSignal.changed()
        return ["$file": a.id.uuidString.lowercased(), "name": a.filename, "type": "image/jpeg", "size": a.size,
                "width": big.width, "height": big.height, "thumb": "data:image/jpeg;base64," + thumb.base64EncodedString()]
    }

    static func keepFile(_ url: URL, context: ModelContext) throws -> [String: Any] {
        let a = try FileStore.importFile(at: url)
        context.insert(a)
        try? context.save()
        SyncSignal.changed()
        return ["$file": a.id.uuidString.lowercased(), "name": a.filename, "type": a.type.preferredMIMEType ?? "application/octet-stream", "size": a.size]
    }

    #if os(iOS)
    static func top() throws -> UIViewController {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard var vc = scenes.flatMap(\.windows).first(where: \.isKeyWindow)?.rootViewController else { throw Unavailable("Nothing to show it on.") }
        while let next = vc.presentedViewController { vc = next }
        return vc
    }

    private final class PhotoDelegate: NSObject, PHPickerViewControllerDelegate {
        var done: ([PHPickerResult]) -> Void = { _ in }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            done(results)
        }
    }
    private static var photoDelegate: PhotoDelegate?

    private static func pickPhotos(_ m: [String: Any], context: ModelContext) async throws -> [String: Any] {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = min(max((m["limit"] as? Int) ?? 1, 1), 20)
        let picker = PHPickerViewController(configuration: config)
        let d = PhotoDelegate()
        photoDelegate = d
        picker.delegate = d
        let results: [PHPickerResult] = await withCheckedContinuation { c in
            d.done = { c.resume(returning: $0) }
            (try? top())?.present(picker, animated: true) ?? c.resume(returning: [])
        }
        photoDelegate = nil
        var files: [[String: Any]] = []
        for r in results {
            let data: Data? = await withCheckedContinuation { c in
                r.itemProvider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in c.resume(returning: data) }
            }
            if let data { files.append(try keepImage(data, name: r.itemProvider.suggestedName ?? "Photo", context: context)) }
        }
        return ["files": files]
    }

    private final class CameraDelegate: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        var done: (UIImage?) -> Void = { _ in }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            picker.dismiss(animated: true)
            done(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true); done(nil) }
    }
    private static var cameraDelegate: CameraDelegate?

    private static func takePhoto(context: ModelContext) async throws -> [String: Any] {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { throw Unavailable("This device has no camera.") }
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        let d = CameraDelegate()
        cameraDelegate = d
        picker.delegate = d
        let image: UIImage? = await withCheckedContinuation { c in
            d.done = { c.resume(returning: $0) }
            (try? top())?.present(picker, animated: true) ?? c.resume(returning: nil)
        }
        cameraDelegate = nil
        guard let data = image?.jpegData(compressionQuality: 0.9) else { return ["files": []] }
        return ["files": [try keepImage(data, name: "Photo", context: context)]]
    }

    private final class ContactDelegate: NSObject, CNContactPickerDelegate {
        var done: (CNContact?) -> Void = { _ in }
        func contactPicker(_ picker: CNContactPickerViewController, didSelect contact: CNContact) { done(contact) }
        func contactPickerDidCancel(_ picker: CNContactPickerViewController) { done(nil) }
    }
    private static var contactDelegate: ContactDelegate?

    /// One contact, through the system's picker: no access to the address book.
    private static func pickContact() async throws -> [String: Any] {
        let picker = CNContactPickerViewController()
        let d = ContactDelegate()
        contactDelegate = d
        picker.delegate = d
        let contact: CNContact? = await withCheckedContinuation { c in
            d.done = { c.resume(returning: $0) }
            (try? top())?.present(picker, animated: true) ?? c.resume(returning: nil)
        }
        contactDelegate = nil
        guard let contact else { return ["contact": NSNull()] }
        return ["contact": [
            "name": CNContactFormatter.string(from: contact, style: .fullName) ?? "",
            "organization": contact.organizationName,
            "emails": contact.emailAddresses.map { $0.value as String },
            "phones": contact.phoneNumbers.map { $0.value.stringValue },
        ]]
    }

    private final class FileDelegate: NSObject, UIDocumentPickerDelegate {
        var done: ([URL]) -> Void = { _ in }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(urls) }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done([]) }
    }
    private static var fileDelegate: FileDelegate?

    private static func pickFiles(context: ModelContext) async throws -> [String: Any] {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        let d = FileDelegate()
        fileDelegate = d
        picker.delegate = d
        let urls: [URL] = await withCheckedContinuation { c in
            d.done = { c.resume(returning: $0) }
            (try? top())?.present(picker, animated: true) ?? c.resume(returning: [])
        }
        fileDelegate = nil
        return ["files": try urls.map { try keepFile($0, context: context) }]
    }
    #else
    private static func open(_ types: [UTType], many: Bool) async -> [URL] {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = types
        panel.allowsMultipleSelection = many
        return await panel.begin() == .OK ? panel.urls : []
    }

    private static func pickPhotos(_ m: [String: Any], context: ModelContext) async throws -> [String: Any] {
        let urls = await open([.image], many: ((m["limit"] as? Int) ?? 1) > 1)
        return ["files": try urls.map { url in
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            return try keepImage(try Data(contentsOf: url), name: url.lastPathComponent, context: context)
        }]
    }

    private static func takePhoto(context: ModelContext) async throws -> [String: Any] {
        throw Unavailable("Taking a photo isn't available on the Mac yet. Use photos.pick.")
    }

    private static func pickContact() async throws -> [String: Any] {
        throw Unavailable("Picking a contact isn't available on the Mac yet.")
    }

    private static func pickFiles(context: ModelContext) async throws -> [String: Any] {
        ["files": try await open([.item], many: true).map { try keepFile($0, context: context) }]
    }
    #endif

    // MARK: On-device AI

    private static func aiAvailability() -> [String: Any] {
        #if canImport(FoundationModels)
        switch SystemLanguageModel.default.availability {
        case .available: return ["available": true]
        case .unavailable(let why): return ["available": false, "reason": "\(why)"]
        }
        #else
        return ["available": false, "reason": "not supported on this system"]
        #endif
    }

    /// Apple's on-device model (Foundation Models): the prompt and the answer never leave the device.
    private static func respond(_ m: [String: Any]) async throws -> [String: Any] {
        guard let prompt = m["prompt"] as? String, !prompt.isEmpty, prompt.count <= 20_000 else { throw NotePage.OpError("Send { prompt } (at most 20,000 characters).") }
        #if canImport(FoundationModels)
        guard case .available = SystemLanguageModel.default.availability else {
            throw Unavailable("On-device AI isn't available here (\(aiAvailability()["reason"] ?? "")). It needs Apple Intelligence turned on.")
        }
        let session = LanguageModelSession(instructions: (m["instructions"] as? String) ?? "Answer briefly and plainly.")
        let answer = try await session.respond(to: prompt)
        return ["text": answer.content]
        #else
        throw Unavailable("On-device AI isn't available on this system.")
        #endif
    }
}

/// The location, once, through the system's prompt.
@MainActor
private final class Locator: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var done: ((Result<CLLocation, Error>) -> Void)?
    private static var current: Locator?

    func once() async throws -> [String: Any] {
        Locator.current = self
        defer { Locator.current = nil }
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        let loc: CLLocation = try await withCheckedThrowingContinuation { c in
            done = { c.resume(with: $0) }
            if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() } else { manager.requestLocation() }
        }
        var out: [String: Any] = ["lat": loc.coordinate.latitude, "lon": loc.coordinate.longitude, "accuracy": loc.horizontalAccuracy]
        if let place = try? await CLGeocoder().reverseGeocodeLocation(loc).first {
            out["place"] = [place.locality, place.country].compactMap { $0 }.joined(separator: ", ")
        }
        return out
    }

    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        let status = m.authorizationStatus
        Task { @MainActor in
            switch status {
            case .notDetermined: break
            case .denied, .restricted: finish(.failure(NotePageDevice.Unavailable("Location isn't allowed for Amber Notes.")))
            default: manager.requestLocation()
            }
        }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in if let l = locations.last { finish(.success(l)) } }
    }

    nonisolated func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in finish(.failure(error)) }
    }

    private func finish(_ r: Result<CLLocation, Error>) {
        done?(r)
        done = nil
    }
}
