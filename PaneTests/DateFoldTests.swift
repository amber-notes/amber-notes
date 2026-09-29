import CoreGraphics
import Testing
@testable import Pane

/// iPhone notes open with the date just above the top, like Notes.
@Suite struct DateFoldTests {
    @Test func opensScrolledPastTheDate() {
        // Under a 100 pt bar, the note starts 32 pt down: the date row and a little air.
        #expect(DateFold.offset(top: 100) == -68)
        #expect(DateFold.hide == 32)
    }

    @Test func aShortNoteStillScrollsPastTheDate() {
        // 400 pt of note in an 800 pt view with 100 pt of bars on top and 34 at the bottom.
        let extra = DateFold.bottomInset(viewHeight: 800, contentHeight: 400, top: 100, bottom: 34)
        #expect(extra == 800 - 100 - 34 + 32 - 400)
        // With it, the content reaches the offset that hides the date.
        #expect(400 + extra + 34 >= 800 - 100 + 32)
    }

    @Test func aLongNoteNeedsNoExtraRoom() {
        #expect(DateFold.bottomInset(viewHeight: 800, contentHeight: 3000, top: 100, bottom: 34) == 0)
    }
}
