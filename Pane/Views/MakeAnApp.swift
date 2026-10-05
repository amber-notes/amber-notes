import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// "Make it an app" (prototype; see NotePage): apps are made by the person's own AI, so this hands
/// their AI a ready prompt for this note, or, with no AI connected yet, leads to connecting one.
enum MakeAnApp {
    /// A note that would make a good app: a table, or a checklist of three items or more.
    static func looksLikeAnApp(_ body: String) -> Bool {
        let lines = body.components(separatedBy: "\n")
        return !NotePage.tables(in: lines).isEmpty || lines.filter { ListPrefix(line: $0)?.checkbox != nil }.count >= 3
    }

    /// What to ask for, from what the note holds.
    static func idea(for body: String) -> String {
        let lines = body.components(separatedBy: "\n")
        if let t = NotePage.tables(in: lines).first {
            let names = t.columns.map { $0.name.lowercased() }
            if names.contains(where: { $0.contains("amount") || $0.contains("cost") || $0.contains("price") || $0 == "kr" }) {
                return "a budget app with the total, spending by category, and a quick way to add an expense"
            }
            if names.contains("date") {
                return "a tracker app: today's entry at the top, streaks, and a chart of the last weeks"
            }
            return "an app that shows this table as cards I can sort, filter and add to"
        }
        if lines.contains(where: { ListPrefix(line: $0)?.checkbox != nil }) {
            return "a checklist app that shows what's left, groups the items, and lets me add and tick them"
        }
        return "an app for this note"
    }

    static func prompt(title: String, body: String) -> String {
        "In Amber Notes, make my note \u{201C}\(title)\u{201D} an app: \(idea(for: body)). Read the note first, keep its table or checklist as the data, and use set_note_page."
    }

    // Notes the suggestion was shown on: once per note, never again.
    private static let shownKey = "makeAppChipShown"
    static func chipShown(_ id: UUID) -> Bool { (UserDefaults.standard.stringArray(forKey: shownKey) ?? []).contains(id.uuidString) }
    static func markChipShown(_ id: UUID) {
        var all = UserDefaults.standard.stringArray(forKey: shownKey) ?? []
        guard !all.contains(id.uuidString) else { return }
        all.append(id.uuidString)
        UserDefaults.standard.set(Array(all.suffix(500)), forKey: shownKey)
    }
}

/// The small suggestion on a note that looks like it could be an app. Shown once per note.
struct MakeAppChip: View {
    let open: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: open) {
                Label("Make this an app", systemImage: NoteAppMark.symbol)
                    .font(.system(size: AIReceipt.text, weight: .semibold))
                    .foregroundStyle(Color.amberInk)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("makeApp.chip")
            Divider().frame(height: 14)
            Button(action: dismiss) {
                Image(systemName: "xmark").font(.system(size: AIReceipt.text - 2, weight: .semibold)).foregroundStyle(Color.amberInk.opacity(0.7))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Not now")
        }
        .padding(.horizontal, 14)
        .frame(height: AIReceipt.height)
        .background(Color.amberSoft, in: .capsule)
        .overlay(Capsule().strokeBorder(Color.amberInk.opacity(0.22), lineWidth: 0.5))
        .shadow(color: Color(red: 0.24, green: 0.12, blue: 0.02).opacity(0.12), radius: 12, y: 6)
    }
}

/// Make It an App: the prompt for your AI, or connecting one first.
struct MakeAppSheet: View {
    let title: String
    let body_: String
    @Environment(Backend.self) private var backend: Backend?
    @Environment(SyncEngine.self) private var sync: SyncEngine?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var connected: Bool?
    @State private var showPromptAnyway = false
    @State private var connecting = false
    @State private var copied = false

    private var prompt: String { MakeAnApp.prompt(title: title, body: body_) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if connected == true || showPromptAnyway { ask } else if connected == false { connect } else { ProgressView().frame(maxWidth: .infinity) }
                }
                .padding(20)
            }
            .navigationTitle("Make It an App")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await check() }
            .sheet(isPresented: $connecting, onDismiss: { Task { await check() } }) {
                if let backend { SettingsView(backend: backend, sync: sync) }
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 420)
        #endif
    }

    private var ask: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Ask your AI").font(.title2.weight(.bold))
            Text("Your AI writes the app and it shows up on this note. The note stays as it is; the app is a second side you can switch to.")
                .foregroundStyle(.secondary)
            Text(prompt)
                .font(.callout)
                .textSelection(.enabled)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.paneChip, in: .rect(cornerRadius: 14, style: .continuous))
                .accessibilityIdentifier("makeApp.prompt")
            Button { copy() } label: {
                Label(copied ? "Copied" : "Copy Prompt", systemImage: copied ? "checkmark" : "doc.on.doc").frame(maxWidth: .infinity)
            }
            .buttonStyle(.amberProminent(height: 44, cornerRadius: 12))
            .accessibilityIdentifier("makeApp.copy")
            HStack(spacing: 10) {
                Button("Open ChatGPT") { copy(); open("https://chatgpt.com/?q=") }.frame(maxWidth: .infinity)
                Button("Open Claude") { copy(); open("https://claude.ai/new?q=") }.frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    private var connect: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: NoteAppMark.symbol).font(.system(size: 34, weight: .semibold)).foregroundStyle(Color.amberInk)
            Text("Apps are made by your AI").font(.title2.weight(.bold))
            Text("Connect ChatGPT or Claude to Amber Notes, then ask it to make this note an app: a tracker with streaks, a budget with totals, whatever the note needs. Connecting takes about 2 minutes.")
                .foregroundStyle(.secondary)
            Button { connecting = true } label: { Text("Connect an AI").frame(maxWidth: .infinity) }
                .buttonStyle(.amberProminent(height: 44, cornerRadius: 12))
                .accessibilityIdentifier("makeApp.connect")
            Button("Show the Prompt") { withAnimation(.smooth) { showPromptAnyway = true } }
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("makeApp.showPrompt")
        }
    }

    /// Whether any AI is connected to this account.
    private func check() async {
        if ProcessInfo.processInfo.arguments.contains("-aiConnected") { connected = true; return }
        guard let client = backend?.client else { connected = false; return }
        let rows: [Connection] = (try? await client.from("mcp_tokens").select().execute().value) ?? []
        connected = rows.contains { $0.revoked_at == nil }
    }

    private func copy() {
        #if os(iOS)
        UIPasteboard.general.string = prompt
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(prompt, forType: .string)
        #endif
        withAnimation(.smooth) { copied = true }
    }

    private func open(_ base: String) {
        guard let q = prompt.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(.init(charactersIn: "&=?+"))),
              let url = URL(string: base + q) else { return }
        openURL(url)
    }
}

// MARK: App settings

/// Settings an app declares, shown as a native sheet, so changing a goal or a currency needs no AI:
///     <meta name="amber-settings" content='{"settings": [{"key": "budget", "label": "Monthly budget",
///       "type": "number", "default": 15000}, {"key": "currency", "type": "currency", "default": "SEK"}]}'>
/// Types: text, number, choice (with "options"), list (of text), color (#rrggbb), currency (a code).
/// Values are kept in the app's own data under values.settings; the page reads amber.settings.
enum NotePageSettings {
    struct Setting: Decodable, Identifiable {
        var key: String
        var label: String?
        var type: String
        var options: [Option]?
        var help: String?
        var `default`: JSONValue?
        /// Settings with the same section are grouped under it (in the order declared).
        var section: String?
        /// Numbers: the range (a slider when both ends are given) and the step.
        var min: Double?
        var max: Double?
        var step: Double?
        /// Shown only when another setting is on, or has a given value.
        var showIf: ShowIf?
        var id: String { key }
        var title: String { label ?? key }

        /// "showIf": "otherKey" (on, or not empty), or { "key": "otherKey", "equals": value }.
        struct ShowIf: Decodable {
            var key: String
            var equals: JSONValue?
            init(from d: Decoder) throws {
                if let k = try? d.singleValueContainer().decode(String.self) { key = k; equals = nil; return }
                enum K: String, CodingKey { case key, equals }
                let c = try d.container(keyedBy: K.self)
                key = try c.decode(String.self, forKey: .key)
                equals = try c.decodeIfPresent(JSONValue.self, forKey: .equals)
            }
            func holds(in values: [String: Any]) -> Bool {
                let v = values[key]
                if let equals { return "\(v ?? "")" == "\(equals.any)" }
                if let b = v as? Bool { return b }
                if let l = v as? [Any] { return !l.isEmpty }
                if let s = v as? String { return !s.isEmpty }
                return v != nil
            }
        }
    }

    /// A choice: "Oak", or { "value": 120, "label": "2 minutes" } when what's stored isn't what's shown.
    struct Option: Decodable, Identifiable {
        var value: JSONValue
        var label: String
        var id: String { "\(value.any)" }
        init(from d: Decoder) throws {
            if let s = try? d.singleValueContainer().decode(String.self) { value = .string(s); label = s; return }
            enum K: String, CodingKey { case value, label }
            let c = try d.container(keyedBy: K.self)
            value = try c.decode(JSONValue.self, forKey: .value)
            label = try c.decodeIfPresent(String.self, forKey: .label) ?? "\(value.any)"
        }
    }

    /// Any JSON value a default can be.
    enum JSONValue: Decodable {
        case string(String), number(Double), bool(Bool), list([String])
        init(from d: Decoder) throws {
            let c = try d.singleValueContainer()
            if let b = try? c.decode(Bool.self) { self = .bool(b) }
            else if let n = try? c.decode(Double.self) { self = .number(n) }
            else if let s = try? c.decode(String.self) { self = .string(s) }
            else { self = .list((try? c.decode([String].self)) ?? []) }
        }
        var any: Any {
            switch self {
            case .string(let s): s
            case .number(let n): n == n.rounded() ? Int(n) as Any : n
            case .bool(let b): b
            case .list(let l): l
            }
        }
    }

    private struct Declared: Decodable { var settings: [Setting] }

    static func declared(in html: String) -> [Setting] {
        guard let r = html.range(of: #"<meta[^>]*name=["']amber-settings["'][^>]*>"#, options: .regularExpression) else { return [] }
        let tag = String(html[r])
        guard let c = tag.range(of: #"content=(['"])([\s\S]*)\1"#, options: .regularExpression) else { return [] }
        let value = String(String(tag[c].dropFirst("content=".count)).dropFirst().dropLast()).replacingOccurrences(of: "&quot;", with: "\"")
        let types = ["text", "number", "choice", "list", "color", "currency", "toggle", "time", "date", "multi"]
        return ((try? JSONDecoder().decode(Declared.self, from: Data(value.utf8)))?.settings ?? []).filter { types.contains($0.type) }.prefix(30).map { $0 }
    }

    /// The defaults, as JSON for the bridge.
    static func defaults(in html: String) -> [String: Any] {
        Dictionary(declared(in: html).compactMap { s in s.default.map { (s.key, $0.any) } }, uniquingKeysWith: { a, _ in a })
    }

    static let currencies = ["SEK", "EUR", "USD", "GBP", "NOK", "DKK", "CHF", "JPY"]
}

/// App Settings: everything about a note's app in one sheet. Its own settings (when it declares
/// any), the internet (which addresses it may reach and what it sent), Previous App, Remove App.
struct AppSettingsSheet: View {
    let noteID: UUID
    let html: String
    var hasPrevious = false
    var previous: () -> Void = {}
    var remove: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var values: [String: Any] = [:]
    @State private var newItem: [String: String] = [:]

    private var settings: [NotePageSettings.Setting] { NotePageSettings.declared(in: html) }

    var body: some View {
        NavigationStack {
            Form {
                ForEach(groups, id: \.id) { g in
                    if let name = g.section {
                        // A section: its settings together, each with its label and help.
                        Section(name) {
                            ForEach(g.settings) { s in
                                if s.type == "list" || s.type == "multi" {
                                    // Its name, then its rows as rows of their own.
                                    Text(s.title).font(.subheadline.weight(.semibold))
                                    field(s)
                                } else {
                                    VStack(alignment: .leading, spacing: 4) {
                                        labelled(s)
                                        if let h = s.help { Text(h).font(.footnote).foregroundStyle(.secondary) }
                                    }
                                }
                            }
                        }
                    } else if let s = g.settings.first {
                        Section {
                            field(s)
                        } header: {
                            Text(s.title)
                        } footer: {
                            if let h = s.help { Text(h) }
                        }
                    }
                }
                internet
                Section {
                    if hasPrevious {
                        Button("Previous App") { previous(); dismiss() }
                            .accessibilityIdentifier("appSettings.previous")
                    }
                    Button("Remove App", role: .destructive) { remove(); dismiss() }
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("appSettings.remove")
                } footer: {
                    Text(hasPrevious ? "Removing the app keeps the note as it is. Previous App brings the one before back." : "Removing the app keeps the note as it is.")
                }
            }
            .formStyle(.grouped)
            .navigationTitle("App Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { save(); dismiss() }.accessibilityIdentifier("appSettings.done")
                }
            }
            .onAppear(perform: load)
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 420)
        #endif
    }

    /// The visible settings, grouped: consecutive ones of a section together, the rest one by one.
    private var groups: [(id: String, section: String?, settings: [NotePageSettings.Setting])] {
        var out: [(id: String, section: String?, settings: [NotePageSettings.Setting])] = []
        for s in settings where s.showIf?.holds(in: values) ?? true {
            if let sec = s.section, let last = out.last, last.section == sec {
                out[out.count - 1].settings.append(s)
            } else {
                out.append((id: s.key, section: s.section, settings: [s]))
            }
        }
        return out
    }

    /// A field inside a section, where its name has to show next to it.
    @ViewBuilder
    private func labelled(_ s: NotePageSettings.Setting) -> some View {
        switch s.type {
        case "text", "number":
            LabeledContent(s.title) { field(s).multilineTextAlignment(.trailing) }
        default:
            field(s)
        }
    }

    @ViewBuilder
    private func field(_ s: NotePageSettings.Setting) -> some View {
        switch s.type {
        case "number" where s.min != nil && s.max != nil:
            let lo = s.min ?? 0, hi = Swift.max(s.max ?? 1, lo), step = s.step ?? 1
            let value = (values[s.key] as? Double) ?? (values[s.key] as? Int).map(Double.init) ?? lo
            HStack {
                Slider(value: Binding(get: { Swift.min(Swift.max(value, lo), hi) }, set: { values[s.key] = Self.number($0) }), in: lo...hi, step: step)
                    .accessibilityIdentifier("appSettings.\(s.key)")
                Text(Self.shown(value)).monospacedDigit().frame(minWidth: 44, alignment: .trailing)
            }
        case "date":
            // "YYYY-MM-DD".
            DatePicker(s.title, selection: Binding(get: { Self.day(values[s.key] as? String) }, set: { values[s.key] = Self.ymd($0) }),
                       displayedComponents: .date)
                .accessibilityIdentifier("appSettings.\(s.key)")
        case "multi":
            // Several of the options: stored as a list of their values.
            let options = s.options ?? []
            let chosen = (values[s.key] as? [Any])?.map { "\($0)" } ?? []
            ForEach(options) { o in
                Button {
                    var now = (values[s.key] as? [Any]) ?? []
                    if chosen.contains(o.id) { now.removeAll { "\($0)" == o.id } } else { now.append(o.value.any) }
                    values[s.key] = now
                } label: {
                    HStack {
                        Text(o.label).foregroundStyle(Color.primary)
                        Spacer()
                        if chosen.contains(o.id) { Image(systemName: "checkmark").foregroundStyle(Color.amberInk) }
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(chosen.contains(o.id) ? .isSelected : [])
                .accessibilityIdentifier("appSettings.\(s.key).\(o.id)")
            }
        case "number":
            TextField(s.title, text: Binding(get: { (values[s.key]).map { "\($0)" } ?? "" },
                                             set: { values[s.key] = Double($0.replacingOccurrences(of: ",", with: ".")).map { $0 == $0.rounded() ? Int($0) as Any : $0 } ?? $0 }))
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
                .accessibilityIdentifier("appSettings.\(s.key)")
        case "choice":
            let options = s.options ?? []
            Picker(s.title, selection: Binding(get: { values[s.key].map { "\($0)" } ?? options.first?.id ?? "" },
                                               set: { id in values[s.key] = options.first { $0.id == id }?.value.any ?? id })) {
                ForEach(options) { Text($0.label).tag($0.id) }
            }
            .accessibilityIdentifier("appSettings.\(s.key)")
        case "toggle":
            Toggle(s.title, isOn: Binding(get: { values[s.key] as? Bool ?? false }, set: { values[s.key] = $0 }))
                .accessibilityIdentifier("appSettings.\(s.key)")
        case "time":
            // "HH:mm", 24-hour, whatever the device shows.
            DatePicker(s.title, selection: Binding(get: { Self.time(values[s.key] as? String) }, set: { values[s.key] = Self.hhmm($0) }),
                       displayedComponents: .hourAndMinute)
                .accessibilityIdentifier("appSettings.\(s.key)")
        case "currency":
            Picker(s.title, selection: Binding(get: { values[s.key] as? String ?? "SEK" }, set: { values[s.key] = $0 })) {
                ForEach(NotePageSettings.currencies, id: \.self) { Text($0).tag($0) }
            }
            .accessibilityIdentifier("appSettings.\(s.key)")
        case "color":
            ColorPicker(s.title, selection: Binding(get: { Color(hex: values[s.key] as? String ?? "#D96A06") }, set: { values[s.key] = $0.hex }))
        case "list":
            let items = values[s.key] as? [String] ?? []
            ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                Text(item).swipeActions { Button("Delete", role: .destructive) { var l = items; l.remove(at: i); values[s.key] = l } }
                    .contextMenu { Button("Delete", role: .destructive) { var l = items; l.remove(at: i); values[s.key] = l } }
            }
            HStack {
                TextField("Add…", text: Binding(get: { newItem[s.key] ?? "" }, set: { newItem[s.key] = $0 }))
                    .onSubmit { add(s.key, items) }
                    .accessibilityIdentifier("appSettings.\(s.key).new")
                Button("Add") { add(s.key, items) }.disabled((newItem[s.key] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("appSettings.\(s.key).add")
            }
        default:
            TextField(s.title, text: Binding(get: { values[s.key] as? String ?? "" }, set: { values[s.key] = $0 }))
                .accessibilityIdentifier("appSettings.\(s.key)")
        }
    }

    static func number(_ d: Double) -> Any { d == d.rounded() ? Int(d) as Any : d }
    static func shown(_ d: Double) -> String { d == d.rounded() ? "\(Int(d))" : String(format: "%.2g", d) }

    static func day(_ ymd: String?) -> Date {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return ymd.flatMap(f.date(from:)) ?? .now
    }

    static func ymd(_ date: Date) -> String {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    static func time(_ hhmm: String?) -> Date {
        let parts = (hhmm ?? "09:00").split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: parts.first ?? 9, minute: parts.count > 1 ? parts[1] : 0, second: 0, of: .now) ?? .now
    }

    static func hhmm(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// Which addresses the app may reach, and its last requests (keys hidden).
    @ViewBuilder
    private var internet: some View {
        let log = NotePageNetLog.shared
        let hosts = (log.approved[noteID] ?? []).sorted()
        let entries = Array((log.entries[noteID] ?? []).suffix(8).reversed())
        let libs = NotePageLibraries.downloaded(for: html)
        Section {
            if hosts.isEmpty && entries.isEmpty && libs.isEmpty {
                Text("This app hasn't used the internet.").foregroundStyle(.secondary)
            }
            ForEach(libs, id: \.self) { l in Label("Downloaded library: \(l)", systemImage: "shippingbox") }
            ForEach(hosts, id: \.self) { h in Label(h, systemImage: "checkmark.circle") }
            ForEach(entries) { e in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(e.method).font(.caption.monospaced().weight(.semibold))
                        Text(e.status.map(String.init) ?? e.error ?? "").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Text(e.at, style: .time).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(e.url).font(.caption.monospaced()).lineLimit(3).textSelection(.enabled)
                    if e.carriesNoteText {
                        Label("Includes text from this note", systemImage: "text.quote").font(.caption.weight(.semibold)).foregroundStyle(Color.amberInk)
                    }
                }
            }
            if !hosts.isEmpty {
                Button("Forget Allowed Addresses", role: .destructive) { log.forget(noteID) }
            }
        } header: {
            Text("Internet")
        } footer: {
            Text("The app asks before it reaches a new address. Everything it sends is listed here.")
        }
    }

    private func add(_ key: String, _ items: [String]) {
        let t = (newItem[key] ?? "").trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        values[key] = items + [t]
        newItem[key] = ""
    }

    private func load() {
        var v = NotePageSettings.defaults(in: html)
        if let saved = (NotePageDataStore.shared.doc(noteID)["values"] as? [String: Any])?["settings"] as? [String: Any] {
            v.merge(saved) { _, b in b }
        }
        values = v
    }

    /// Kept in the app's own data, like anything else it keeps; the app updates at once.
    private func save() {
        // Typed numbers stay inside the range the app declared.
        for s in settings where s.type == "number" {
            guard let d = (values[s.key] as? Double) ?? (values[s.key] as? Int).map(Double.init) else { continue }
            values[s.key] = Self.number(Swift.min(Swift.max(d, s.min ?? -.infinity), s.max ?? .infinity))
        }
        var doc = NotePageDataStore.shared.doc(noteID)
        var vals = doc["values"] as? [String: Any] ?? [:]
        vals["settings"] = values
        doc["values"] = vals
        NotePageDataStore.shared.set(noteID, doc)
    }
}

extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let v = UInt32(h, radix: 16) ?? 0xD96A06
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }

    var hex: String {
        #if os(iOS)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &a)
        #else
        let c = NSColor(self).usingColorSpace(.sRGB) ?? .black
        let r = c.redComponent, g = c.greenComponent, b = c.blueComponent
        #endif
        return String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}

import Supabase

/// Settings › Apps in Notes: whether an AI may preview a note's app with the note's real data
/// (pages-ai-tooling's preview_app; profiles.app_previews_real). Off by default: previews use made-up
/// data shaped like the note. Hidden on a backend without the setting.
struct AppPreviewSection: View {
    let client: SupabaseClient
    @State private var on = false
    @State private var available = false
    @State private var saving = false

    private struct Row: Codable { var user_id: UUID?; var app_previews_real: Bool }

    var body: some View {
        Group {
            if available {
                Section {
                    Toggle("Let AIs preview apps with my notes", isOn: Binding(get: { on }, set: { v in on = v; Task { await save(v) } }))
                        .disabled(saving)
                        .accessibilityIdentifier("settings.appPreviewsReal")
                } header: {
                    Text("Apps in Notes")
                } footer: {
                    Text("When your AI checks an app it made, it sees a picture of it. With this off, the picture uses made-up data shaped like your note. With it on, it shows your note's real data, decrypted for that check only.")
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let user = client.auth.currentUser?.id else { return }
        let rows: [Row]? = try? await client.from("profiles").select("app_previews_real").eq("user_id", value: user).execute().value
        guard let rows else { return }
        on = rows.first?.app_previews_real ?? false
        available = true
    }

    private func save(_ v: Bool) async {
        guard let user = client.auth.currentUser?.id else { return }
        saving = true
        defer { saving = false }
        do {
            try await client.from("profiles").upsert(Row(user_id: user, app_previews_real: v), onConflict: "user_id").execute()
        } catch {
            on = !v
        }
    }
}
