import Supabase
import SwiftUI

/// What the account stores, as the server counts it (storage_usage(), 20261008100100): sealed
/// sizes of notes, files, apps, Recently Deleted and earlier versions, against a limit of 2 GB.
struct StorageUsage: Codable, Equatable {
    var used: Int64
    var limit: Int64
    var notes: Int64
    var files: Int64
    var apps: Int64
    var deleted: Int64
    var versions: Int64

    enum Level: Equatable { case fine, nearlyFull, full }

    /// A warning from 90%; full when the next write would be refused.
    var level: Level {
        guard limit > 0 else { return .fine }
        if used >= limit { return .full }
        return Double(used) / Double(limit) >= 0.9 ? .nearlyFull : .fine
    }

    var fraction: Double { limit > 0 ? min(Double(used) / Double(limit), 1) : 0 }

    static func size(_ n: Int64) -> String {
        n >= 1_073_741_824 ? String(format: "%.2f GB", Double(n) / 1_073_741_824).replacingOccurrences(of: ".00 GB", with: " GB")
            : ByteCountFormatter.string(fromByteCount: n, countStyle: .file)
    }

    /// "1.2 GB of 2 GB used"
    var summary: String { "\(Self.size(used)) of \(Self.size(limit)) used" }

    /// The kinds by size, largest first, for what to remove.
    var parts: [(name: String, bytes: Int64)] {
        [("Files", files), ("Recently Deleted", deleted), ("Earlier versions", versions), ("Notes", notes), ("Apps", apps)]
    }

    /// What the list says near and at the limit, naming what takes the room.
    var warning: (title: String, detail: String)? {
        let big = parts.filter { $0.bytes > 0 && ($0.name == "Files" || $0.name == "Recently Deleted") }
            .map { "\($0.name.lowercased() == "files" ? "files" : "Recently Deleted") \(Self.size($0.bytes))" }.joined(separator: ", ")
        switch level {
        case .fine: return nil
        case .nearlyFull:
            return ("Amber Notes is almost full", "\(summary). Empty Recently Deleted or remove large files to keep adding notes and files.")
        case .full:
            return ("Amber Notes is full", "All \(Self.size(limit)) are used\(big.isEmpty ? "" : " (\(big))"). New notes, changes that add text, and files won't sync until you empty Recently Deleted or remove large files.")
        }
    }
}

/// The account's usage, fetched now and then and whenever the server says the account is full.
@MainActor @Observable
final class StorageStore {
    static let shared = StorageStore()
    var usage: StorageUsage? = StorageStore.demo

    /// Captures: `-uitest -demoStorage 1.86` is an account with 1.86 GB of 2 GB used.
    private static var demo: StorageUsage? {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-uitest"), let i = args.firstIndex(of: "-demoStorage"), i + 1 < args.count, let gb = Double(args[i + 1]) else { return nil }
        let g = 1_073_741_824.0
        return StorageUsage(used: Int64(gb * g), limit: Int64(2 * g), notes: 41_000_000, files: Int64((gb - 0.31) * g), apps: 12_000_000, deleted: 230_000_000, versions: 64_000_000)
    }

    func refresh(_ client: SupabaseClient?) async {
        guard let client, Self.demo == nil else { return }
        if let u: StorageUsage = try? await client.rpc("storage_usage").execute().value { usage = u }
    }
}

/// Settings: "X of 2 GB used", what takes the room, and what counts.
struct StorageSection: View {
    let client: SupabaseClient
    @State private var store = StorageStore.shared

    var body: some View {
        StorageSectionBody(usage: store.usage)
            .task { await store.refresh(client) }
    }
}

struct StorageSectionBody: View {
    let usage: StorageUsage?
    @Environment(\.networkReach) private var reach

    var body: some View {
        Section {
            if let u = usage {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(u.summary).monospacedDigit()
                        Spacer()
                        if u.level != .fine {
                            Text(u.level == .full ? "Full" : "Almost full")
                                .font(.callout.weight(.semibold))
                                .foregroundStyle(u.level == .full ? Color.red : Color.orange)
                        }
                    }
                    // A bar of its own: the Mac's progress bar doesn't take a tint.
                    Capsule().fill(Color.ink.opacity(0.1))
                        .frame(height: 6)
                        .overlay(alignment: .leading) {
                            GeometryReader { g in
                                Capsule().fill(u.level == .full ? Color.red : u.level == .nearlyFull ? Color.orange : Color.accentColor)
                                    .frame(width: max(6, g.size.width * u.fraction))
                            }
                        }
                        .accessibilityElement()
                        .accessibilityLabel("Storage used")
                        .accessibilityValue(u.summary)
                }
                .accessibilityIdentifier("settings.storage")
                ForEach(u.parts, id: \.name) { part in
                    LabeledContent(part.name) {
                        Text(StorageUsage.size(part.bytes)).monospacedDigit()
                    }
                }
            } else if reach != .online {
                Text("Counted when you\u{2019}re online.").foregroundStyle(.secondary)
                    .accessibilityIdentifier("settings.storageOffline")
            } else {
                Text("Counting\u{2026}").foregroundStyle(.secondary)
            }
        } header: {
            Text("Storage")
        } footer: {
            Text("Notes, files and apps count as stored, encrypted. Recently Deleted and earlier versions count until they're deleted for good, after 30 days. Files can be up to 100 MB each.")
        }
    }
}

/// At the top of the list near the limit and at it: plain words, what to remove.
struct StorageWarningRow: View {
    let usage: StorageUsage

    var body: some View {
        if let w = usage.warning {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: usage.level == .full ? "externaldrive.fill.badge.xmark" : "externaldrive.fill.badge.exclamationmark")
                    .font(.title3)
                    .foregroundStyle(usage.level == .full ? Color.red : Color.orange)
                    .frame(width: 32, height: 32)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(w.title).font(.body.weight(.semibold))
                    Text(w.detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.vertical, 2)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("storage.warning")
        }
    }
}
