import Foundation
import Observation
import Testing
@testable import Pane

/// Flags kept in UserDefaults tell their views only when their own key changes. The split view
/// writes its column state to the defaults on every sidebar toggle, and opening a note writes
/// `lastNote`: with @AppStorage those rebuilt the whole window (AppGate) and re-set the menu bar
/// item mid-layout, a loop that kept the app busy at idle and could crash it.
@MainActor @Suite(.serialized) struct DefaultsFlagTests {
    final class Count: @unchecked Sendable { var value = 0 }

    @Test func removalNoticeChangesOnlyWithItsOwnKey() async throws {
        let defaults = try #require(UserDefaults(suiteName: "DefaultsFlagTests.\(UUID().uuidString)"))
        let flag = DefaultsFlag(DeviceRemoval.noticeFlag, defaults: defaults)
        let count = Count()
        func watch() { withObservationTracking { _ = flag.value } onChange: { count.value += 1 } }

        watch()
        defaults.set(Data([1, 2, 3]), forKey: "NSSplitView Subview Frames main, SidebarNavigationSplitView")
        defaults.set("x", forKey: "lastNote")
        try await Task.sleep(for: .milliseconds(100))
        #expect(count.value == 0, "other keys leave the flag's views alone")

        defaults.set(true, forKey: DeviceRemoval.noticeFlag)
        try await Task.sleep(for: .milliseconds(100))
        #expect(count.value == 1)
        #expect(flag.value)

        watch()
        flag.value = false
        #expect(count.value == 2)
        #expect(defaults.bool(forKey: DeviceRemoval.noticeFlag) == false)
    }

    @Test func menuBarSettingIsOnByDefaultAndChangesOnlyWithItsKey() async throws {
        let defaults = try #require(UserDefaults(suiteName: "DefaultsFlagTests.\(UUID().uuidString)"))
        let shown = DefaultsFlag(MenuBarSettings.key, default: true, defaults: defaults)
        #expect(shown.value)
        let count = Count()
        withObservationTracking { _ = shown.value } onChange: { count.value += 1 }
        defaults.set("main", forKey: "lastNote")
        defaults.set(Data([1]), forKey: "lastScope")
        try await Task.sleep(for: .milliseconds(100))
        #expect(count.value == 0)
        defaults.set(false, forKey: MenuBarSettings.key)
        try await Task.sleep(for: .milliseconds(100))
        #expect(count.value == 1)
        #expect(!shown.value)
    }
}
