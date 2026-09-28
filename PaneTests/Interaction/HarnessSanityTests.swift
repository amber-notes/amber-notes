import Testing

@Suite struct HarnessSanityTests {
    /// Checks how long the runner takes to report a failure (it has hung here before).
    @Test(.disabled("run by hand")) func failureReportsPromptly() { #expect(Bool(false)) }
}
