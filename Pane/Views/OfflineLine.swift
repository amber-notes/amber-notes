import SwiftData
import SwiftUI

/// What the offline line says. Nil while the server can be reached: nothing shows then.
enum OfflineCopy {
    static func line(_ reach: SyncEngine.Reach, waiting: Bool) -> String? {
        let lead: String
        switch reach {
        case .online: return nil
        case .offline: lead = "Offline"
        case .unreachable: lead = "Can\u{2019}t reach Amber Notes"
        }
        return waiting ? "\(lead) \u{00B7} changes sync later" : lead
    }

    static func symbol(_ reach: SyncEngine.Reach) -> String {
        reach == .unreachable ? "wifi.exclamationmark" : "wifi.slash"
    }

    /// For an action that needs the server, said where its button is.
    static func needsNetwork(_ what: String) -> String {
        "You\u{2019}re offline. Connect to the internet to \(what)."
    }

    /// At the top of Settings while offline.
    static let settings = "You\u{2019}re offline. Your notes work as usual and sync when you\u{2019}re back. Connecting an AI, adding a device and changes to your account need the internet."
}

extension EnvironmentValues {
    /// Whether the server can be reached, for the controls that need it (set by the app's root and
    /// by Settings, which is its own window on the Mac).
    @Entry var networkReach: SyncEngine.Reach = .online
}

/// A calm line while sync can't reach the server: in the Mac sidebar under the folders, and in a
/// small capsule over the iPhone's lists. No alert and no spinner; editing goes on as usual and the
/// line goes as soon as a sync gets through.
struct OfflineLine: View {
    let sync: SyncEngine?

    var body: some View {
        if let sync, sync.reach != .online {
            OfflineLineContent(reach: sync.reach)
                .transition(.opacity)
        }
    }
}

/// Only drawn while offline, so its queries cost nothing otherwise.
private struct OfflineLineContent: View {
    let reach: SyncEngine.Reach
    @Query(filter: #Predicate<Note> { $0.dirty }) private var notes: [Note]
    @Query(filter: #Predicate<Folder> { $0.dirty }) private var folders: [Folder]
    @Query(filter: #Predicate<Attachment> { $0.dirty || !$0.uploaded }) private var files: [Attachment]

    var body: some View {
        let text = OfflineCopy.line(reach, waiting: !(notes.isEmpty && folders.isEmpty && files.isEmpty)) ?? ""
        #if os(iOS)
        Label(text, systemImage: OfflineCopy.symbol(reach))
            .font(.footnote)
            .foregroundStyle(Color.muted)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .glassEffect(.regular, in: .capsule)
            .padding(.bottom, 6)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("sync.offline")
        #else
        HStack(spacing: 6) {
            Image(systemName: OfflineCopy.symbol(reach))
                .imageScale(.small)
            Text(text)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.callout)
        .foregroundStyle(Color.muted)
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("sync.offline")
        #endif
    }
}
