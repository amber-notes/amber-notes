import Foundation

/// Timing budgets are set for a developer's Mac. Slower machines, like CI runners, set
/// PANE_PERF_SLACK (for example 4) to widen every budget by that factor. The budgets still
/// catch real regressions there, just with more room.
enum PerfBudget {
    static let slack: Double = Double(ProcessInfo.processInfo.environment["PANE_PERF_SLACK"] ?? "") ?? 1
}
