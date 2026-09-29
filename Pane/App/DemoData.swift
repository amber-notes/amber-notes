import Foundation
import ImageIO
import SwiftData
import UniformTypeIdentifiers

/// Realistic sample notes for recordings and UI tests (`-demo`).
@MainActor
enum DemoData {
    static func load(into context: ModelContext, main: Folder) {
        let ideas = context.createFolder(named: "Ideas")
        let travel = context.createFolder(named: "Travel")
        let work = context.createFolder(named: "Work")
        let q4 = context.createFolder(named: "Q4 planning", parent: work)

        let day: TimeInterval = 86400
        let items: [(Folder, String, TimeInterval, Bool)] = [
            (main, "Groceries\n\nFor the weekend, and Sunday dinner with Sara and Jonas.\n\n- [ ] Oat milk\n- [ ] Lemons\n- [ ] Coffee beans\n- [ ] Fresh basil\n- [ ] Burrata\n- [ ] Cherry tomatoes\n- [ ] Olive oil\n- [ ] Dark chocolate\n- [x] Sourdough\n- [x] Eggs\n- [x] Spinach", -600, true),
            (work, "Standup notes\n\nShipped the sync fix. **Blocked** on the review for the importer.\n\n- Next: table editing\n- Ask about the CI flake", -3 * 3600, false),
            (ideas, "App ideas\n\n1. A calmer inbox\n2. Voice notes that file themselves\n3. A reading list that forgets", -day, false),
            (travel, "Lisbon\n\nFour days of tiles, trams and pastries in May.\n\n## Plan\n- [ ] Tram 28 early, before the crowds\n- [ ] Day trip to Sintra\n- [x] Book flights\n- [x] Hotel in Príncipe Real\n\n## Places\n- Time Out Market\n- Miradouro da Senhora do Monte\n- LX Factory on Sunday\n\n[Hotel booking](pane-note:6d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55)\n\n## Food\n| Place | Dish |\n| --- | --- |\n| Manteigaria | Pastel de nata |\n| Ramiro | Seafood |\n| Time Out Market | A bit of everything |\n\n> Pack comfortable shoes. The hills are real.", -3 * day, false),
            (q4, "Q4 goals\n\n> Ship less, finish more.\n\n- [ ] Launch the new onboarding\n- [ ] Hire a designer\n- [x] Close the books for Q3", -5 * day, false),
            (ideas, "Reading list\n\n- *The Design of Everyday Things*\n- *Shape Up*\n- [Interfaces](https://interfaces.dev)", -12 * day, false),
            (main, "Snippets\n\n```swift\nlet greeting = \"Hello\"\nprint(greeting)\n```", -45 * day, false),
            (travel, "Packing\n\n- [ ] Passport\n- [ ] Chargers\n- [ ] Rain jacket", -80 * day, false),
        ]
        // Files: a PDF, a spreadsheet and an image, generated so the demo needs nothing external.
        if let pdf = try? FileStore.importData(samplePDF(), filename: "Flight itinerary.pdf", type: .pdf),
           let csv = try? FileStore.importData(Data("Day,Energy,Mood,Diet\nMon,7,8,Yes\nTue,6,7,No\nWed,8,8,Yes\n".utf8), filename: "Tracker export.csv", type: .commaSeparatedText),
           let png = try? FileStore.importData(samplePNG(), filename: "Sunset.png", type: .png) {
            [pdf, csv, png].forEach(context.insert)
            let n = context.createNote(in: .folder(travel.id), body: "Trip documents\n\nEverything for the Lisbon trip in one place.\n\n\(pdf.markdown)\n\(csv.markdown)\n\n\(png.markdown)\n\nhttps://www.visitlisboa.com\n")
            n.updatedAt = .now.addingTimeInterval(-1800)
        }

        // A tracker like an evening check-in spreadsheet, as a typed table.
        var tracker = TypedTable(columns: [
            .init(name: "Date", type: .date),
            .init(name: "Work hours", type: .number),
            .init(name: "Energy (1-10)", type: .scale(1, 10)),
            .init(name: "Mood (1-10)", type: .scale(1, 10)),
            .init(name: "Diet on plan", type: .choice(["Yes", "No"])),
            .init(name: "Strength", type: .choice(["Yes", "No", "N/A"])),
            .init(name: "What helped today?", type: .text),
        ], rows: [])
        let sample = [("6", "7", "8", "Yes", "Yes", "Early night"), ("4", "5", "6", "No", "N/A", ""), ("7", "8", "7", "Yes", "No", "Walk after lunch"),
                      ("5", "6", "6", "Yes", "Yes", ""), ("8", "8", "9", "Yes", "N/A", "Deep work morning"), ("3", "4", "5", "No", "No", "Too much coffee")]
        for (i, r) in sample.enumerated() {
            let d = Calendar.current.date(byAdding: .day, value: -(sample.count - i), to: .now)!
            tracker.rows.append([TypedTable.day(d), r.0, r.1, r.2, r.3, r.4, r.5])
        }
        let t = context.createNote(in: .folder(main.id), body: "Evening tracker\n\nFill in once a day, it takes a minute.\n\n\(tracker.markdown)\n")
        t.updatedAt = .now.addingTimeInterval(-300)
        t.isPinned = true

        for (folder, body, offset, pinned) in items {
            let n = context.createNote(in: .folder(folder.id), body: storeScene(body))
            if body.hasPrefix("Lisbon") {
                // Lisbon keeps its hotel details in a sub-note.
                let hotel = Note(body: "Hotel booking\n\nMemmo Príncipe Real, 12–15 May\nConfirmation **LX-48213**\n\n- [x] Paid deposit\n- [ ] Ask for a late checkout\n- [ ] Airport transfer\n\n> Check-in from 15:00", folder: folder)
                hotel.id = UUID(uuidString: "6d1f2c9a-1b7e-4c3a-9f0e-2a4b8c1d7e55")!
                hotel.parentID = n.id
                context.insert(hotel)
            }
            n.updatedAt = .now.addingTimeInterval(offset)
            n.createdAt = n.updatedAt
            n.isPinned = pinned
        }
        try? context.save()
    }

    /// App Store captures: `-uitest -demo -storeScene paella`, `lisbon` or `tick` puts in the lines an AI
    /// just added, and `-highlight` (ChangeHighlight) tints them.
    static func storeScene(_ body: String) -> String {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-uitest"), let i = args.firstIndex(of: "-storeScene"), i + 1 < args.count else { return body }
        switch args[i + 1] {
        case "paella" where body.hasPrefix("Groceries"):
            return body.replacingOccurrences(of: "- [ ] Oat milk", with: "- [ ] Paella rice\n- [ ] Saffron\n- [ ] Chorizo\n- [ ] Chicken thighs\n- [ ] Smoked paprika\n- [ ] Oat milk")
        case "tick" where body.hasPrefix("Groceries"):
            // The moment after a tap: ticked, before it slides to the bottom.
            return body.replacingOccurrences(of: "- [ ] Olive oil", with: "- [x] Olive oil")
        case "lisbon" where body.hasPrefix("Lisbon"):
            return body.replacingOccurrences(of: "- [ ] Day trip to Sintra", with: "- [ ] Day trip to Sintra\n- [ ] Late checkout requested, confirm by 10 May")
        default:
            return body
        }
    }

    static func samplePDF() -> Data {
        let data = NSMutableData()
        var box = CGRect(x: 0, y: 0, width: 595, height: 842)
        guard let consumer = CGDataConsumer(data: data), let ctx = CGContext(consumer: consumer, mediaBox: &box, nil) else { return Data() }
        ctx.beginPDFPage(nil)
        ctx.setFillColor(CGColor(red: 0.96, green: 0.68, blue: 0.2, alpha: 1))
        ctx.fill(CGRect(x: 48, y: 740, width: 499, height: 56))
        ctx.setFillColor(CGColor(gray: 0.85, alpha: 1))
        for i in 0..<12 { ctx.fill(CGRect(x: 48, y: 680 - i * 36, width: [499, 420, 460, 380][i % 4], height: 12)) }
        ctx.endPDFPage()
        ctx.closePDF()
        return data as Data
    }

    static func samplePNG() -> Data {
        let w = 800, h = 440
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return Data() }
        let colors = [CGColor(red: 0.98, green: 0.62, blue: 0.25, alpha: 1), CGColor(red: 0.55, green: 0.3, blue: 0.6, alpha: 1)] as CFArray
        if let g = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1]) {
            ctx.drawLinearGradient(g, start: CGPoint(x: 0, y: h), end: CGPoint(x: 0, y: 0), options: [])
        }
        ctx.setFillColor(CGColor(red: 1, green: 0.85, blue: 0.5, alpha: 1))
        ctx.fillEllipse(in: CGRect(x: 320, y: 120, width: 160, height: 160))
        ctx.setFillColor(CGColor(red: 0.15, green: 0.1, blue: 0.2, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: 120))
        guard let img = ctx.makeImage() else { return Data() }
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, "public.png" as CFString, 1, nil) else { return Data() }
        CGImageDestinationAddImage(dest, img, nil)
        CGImageDestinationFinalize(dest)
        return out as Data
    }
}
