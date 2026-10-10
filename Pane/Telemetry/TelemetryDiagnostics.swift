import Foundation
import MetricKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// Crashes and hangs, from Apple's MetricKit: the system writes a diagnostic when the app crashes
// or stops answering, and hands it over at the next launch. No crash SDK is linked. What's sent is
// a summary in numbers: the exception and signal, the version that crashed, and where in the
// app's own binary it was (offsets, to look up against that build's symbols). The system's
// reports also hold a termination reason in words and the names of other binaries; those stay here.

/// A crash or hang report's stack, cut down to the app's own frames.
enum StackReader {
    static let kept = 8

    /// `json`: a diagnostic's `callStackTree.jsonRepresentation()`. `binary`: the app's executable
    /// name (frames of anything else are skipped). The stack of the thread the report is about,
    /// or the first one.
    static func summary(_ json: Data, binary: String) -> StackSummary {
        guard let top = try? JSONSerialization.jsonObject(with: json) as? [String: Any] else { return StackSummary() }
        // The tree itself, or wrapped as it is inside a whole payload.
        let tree = top["callStackTree"] as? [String: Any] ?? top
        guard let stacks = tree["callStacks"] as? [[String: Any]], !stacks.isEmpty else { return StackSummary() }
        let stack = stacks.first { $0["threadAttributed"] as? Bool == true } ?? stacks[0]
        var frames: [[String: Any]] = []
        var next = (stack["callStackRootFrames"] as? [[String: Any]])?.first
        // Each frame holds the one it called (or was called by) as its first sub-frame.
        while let frame = next, frames.count < 512 {
            frames.append(frame)
            next = (frame["subFrames"] as? [[String: Any]])?.first
        }
        let own = frames.filter { $0["binaryName"] as? String == binary }
        let offsets = own.compactMap { ($0["offsetIntoBinaryTextSegment"] as? NSNumber)?.intValue }
        let id = own.compactMap { $0["binaryUUID"] as? String }.first.flatMap(UUID.init(uuidString:))
        // Both ends of a deep stack: where it started and where it was.
        let shown = offsets.count <= kept ? offsets : Array(offsets.prefix(kept / 2) + offsets.suffix(kept / 2))
        return StackSummary(binary: id, offsets: shown, frames: offsets.count)
    }
}

/// Receives MetricKit's diagnostics and turns each into events.
final class DiagnosticReports: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
    static let shared = DiagnosticReports()
    /// At most this many crashes and hangs from one delivery: a crash loop says the same thing.
    static let most = 5

    private let telemetry: Telemetry
    private let binary: String

    init(telemetry: Telemetry = .shared, binary: String = Bundle.main.executableURL?.lastPathComponent ?? "") {
        self.telemetry = telemetry
        self.binary = binary
    }

    func start() {
        MXMetricManager.shared.add(self)
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            for c in (payload.crashDiagnostics ?? []).prefix(Self.most) {
                telemetry.record(.crash(exceptionType: c.exceptionType?.intValue, exceptionCode: c.exceptionCode?.intValue,
                                        signal: c.signal?.intValue, version: VersionNumber(c.applicationVersion),
                                        build: VersionNumber(c.metaData.applicationBuildVersion),
                                        stack: StackReader.summary(c.callStackTree.jsonRepresentation(), binary: binary)))
            }
            let hangs = payload.hangDiagnostics ?? []
            for h in hangs.prefix(Self.most) {
                telemetry.record(.hang(milliseconds: Int(h.hangDuration.converted(to: .milliseconds).value),
                                       version: VersionNumber(h.applicationVersion), build: VersionNumber(h.metaData.applicationBuildVersion),
                                       stack: StackReader.summary(h.callStackTree.jsonRepresentation(), binary: binary)))
            }
            if !hangs.isEmpty { telemetry.record(.hangs(count: hangs.count)) }
        }
    }
}

/// Sends what's waiting when the app leaves the front, and counts "app opened" when it comes back.
@MainActor
enum TelemetryLifecycle {
    private static var observers: [NSObjectProtocol] = []

    static func start(signedIn: @escaping @MainActor @Sendable () -> Bool) {
        guard observers.isEmpty, Telemetry.shared.sends else { return }
        let center = NotificationCenter.default
        #if os(iOS)
        let active = UIApplication.didBecomeActiveNotification
        let leaving = [(UIApplication.didEnterBackgroundNotification, false)]
        #else
        let active = NSApplication.didBecomeActiveNotification
        let leaving = [(NSApplication.didResignActiveNotification, false), (NSApplication.willTerminateNotification, true)]
        #endif
        observers.append(center.addObserver(forName: active, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Telemetry.shared.becameActive(signedIn: signedIn()) }
        })
        for (name, quitting) in leaving {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { _ in
                MainActor.assumeIsolated { leave(quitting: quitting) }
            })
        }
    }

    private static func leave(quitting: Bool) {
        #if os(iOS)
        // A little time from the system to finish the send after the app has left the screen.
        let time = BackgroundTime()
        time.begin()
        Task {
            await Telemetry.shared.resigning(quitting: quitting)
            time.end()
        }
        #else
        Task { await Telemetry.shared.resigning(quitting: quitting) }
        #endif
    }
}

#if os(iOS)
@MainActor
private final class BackgroundTime {
    private var id = UIBackgroundTaskIdentifier.invalid

    func begin() {
        id = UIApplication.shared.beginBackgroundTask { [weak self] in
            Task { @MainActor in self?.end() }
        }
    }

    func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id)
        id = .invalid
    }
}
#endif
