import Foundation

/// Timing budgets are set for a developer's Mac. Slower machines, like CI runners, set
/// PANE_PERF_SLACK (for example 4) to widen every budget by that factor. The budgets still
/// catch real regressions there, just with more room.
enum PerfBudget {
    static let slack: Double = Double(ProcessInfo.processInfo.environment["PANE_PERF_SLACK"] ?? "") ?? 1
}

/// How the timing tests take a number, in one place.
///
/// A CI runner stalls now and then for a second or more, whatever the test is doing. A test that
/// judged its single slowest sample (or one sample, or a ratio of two numbers taken minutes apart)
/// failed on those stalls and passed on the re-run: three tests did between 2026-10-08 and -10.
/// So every timing here is repeated and judged by its median, against the same limit as before.
/// What that keeps: a change that makes the thing slower makes every sample slower, so the median
/// moves with it and fails once it passes the limit. What it gives up: one slow sample among fast
/// ones no longer fails a run; it is still printed (each test prints its samples or its slowest).
/// The limits are wide on purpose (they were set to catch a list that sizes every row or a page
/// that blocks, many times the usual cost, not a 2x drift): a 2x slowdown shows in the PERF lines
/// of the CI log and in the release gate, and fails here only where the usual value is already
/// more than half the limit.
enum PerfTiming {
    static func median(_ samples: [Double]) -> Double {
        let sorted = samples.sorted()
        return sorted.isEmpty ? .infinity : sorted[sorted.count / 2]
    }

    /// Waits until the main queue has nothing of note left to do (what the test before left
    /// behind, such as a library of 20,000 notes going away): five turns in a row that each come
    /// back within 20 ms, or two seconds at most.
    @MainActor static func quietMainQueue() async {
        let clock = ContinuousClock()
        let deadline = clock.now + .seconds(2)
        var quiet = 0
        while quiet < 5, clock.now < deadline {
            let start = clock.now
            try? await Task.sleep(for: .milliseconds(2))
            let d = clock.now - start
            let took = Double(d.components.attoseconds) / 1e15 + Double(d.components.seconds) * 1000
            quiet = took < 20 ? quiet + 1 : 0
        }
    }
}
