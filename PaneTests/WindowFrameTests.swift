#if os(macOS)
import Foundation
import Testing
@testable import Pane

/// The notes window reopens where you left it, like Notes; a frame that's no longer
/// on a screen falls back to the centred default.
@Suite struct WindowFrameTests {
    let laptop = CGRect(x: 0, y: 0, width: 1512, height: 944)
    let external = CGRect(x: 1512, y: 0, width: 2560, height: 1415)

    @Test func firstLaunchIsCentredAtTheDefaultSize() {
        let f = WindowFrameMemory.frame(saved: nil, screens: [laptop], main: laptop)
        #expect(f.size == WindowFrameMemory.defaultSize)
        #expect(abs(f.midX - laptop.midX) < 1 && abs(f.midY - laptop.midY) < 1)
    }

    @Test func aCardSizedFrameIsNeverRestored() {
        // Signing out shrinks the window to the sign-in card; that size must not come back after sign-in.
        let card = CGRect(x: 500, y: 300, width: 380, height: 340)
        #expect(WindowFrameMemory.frame(saved: card, screens: [laptop], main: laptop).size == WindowFrameMemory.defaultSize)
    }

    @Test func savedFrameComesBackExactly() {
        let saved = CGRect(x: 1700, y: 200, width: 1400, height: 900)
        #expect(WindowFrameMemory.frame(saved: saved, screens: [laptop, external], main: laptop) == saved)
    }

    @Test func frameOnADisconnectedScreenFallsBack() {
        let saved = CGRect(x: 1700, y: 200, width: 1400, height: 900)
        let f = WindowFrameMemory.frame(saved: saved, screens: [laptop], main: laptop)
        #expect(laptop.contains(f))
    }

    @Test func titleBarMustBeReachable() {
        // Pushed up so the title bar sits above the screen: can't be dragged back.
        let saved = CGRect(x: 100, y: 900, width: 1000, height: 700)
        #expect(WindowFrameMemory.frame(saved: saved, screens: [laptop], main: laptop) != saved)
    }

    @Test func savesAndReadsTheFrameString() {
        let d = UserDefaults.standard, keep = d.object(forKey: WindowFrameMemory.key)
        defer { if let keep { d.set(keep, forKey: WindowFrameMemory.key) } else { d.removeObject(forKey: WindowFrameMemory.key) } }
        let r = CGRect(x: 40, y: 60, width: 1200, height: 800)
        WindowFrameMemory.save(r)
        #expect(WindowFrameMemory.saved == r)
    }
}
#endif
