import Foundation
import Testing
@testable import Pane

/// Signed out, the app opens on the welcome; sign-in is one step in.
@Suite struct WelcomeTests {
    @Test func aSignedOutLaunchStartsOnTheWelcome() {
        #expect(WelcomeFlow.Stage.first(arguments: []) == .welcome)
        #expect(WelcomeFlow.Stage.first(arguments: ["-synctest", "-signout"]) == .welcome)
    }

    @Test func testsCanGoStraightToSignIn() {
        #expect(WelcomeFlow.Stage.first(arguments: ["-signout", "-skipWelcome"]) == .signIn(returning: true))
    }
}

#if os(macOS)
import AppKit

/// The Mac welcome window: it could be resized, filled or made full screen, and the
/// picture then sat in a band of empty background. The card holds its size now, and the picture
/// is cut for exactly its half.
@MainActor @Suite struct WelcomeWindowTests {
    @Test func thePictureIsCutForItsHalf() throws {
        let picture = try #require(NSImage(named: "Welcome"))
        let half = CGSize(width: WelcomeFlow.size.width / 2, height: WelcomeFlow.size.height)
        #expect(abs(picture.size.width / picture.size.height - half.width / half.height) < 0.01)
    }

    @Test func theCardCantGoFullScreenAndTheNotesCan() {
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 1180, height: 760),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: true)
        window.collectionBehavior.insert(.fullScreenPrimary)
        CardWindow.lock(window)
        #expect(window.collectionBehavior.contains(.fullScreenNone))
        #expect(!window.collectionBehavior.contains(.fullScreenPrimary))
        CardWindow.unlock(window)
        #expect(window.collectionBehavior.contains(.fullScreenPrimary))
        #expect(!window.collectionBehavior.contains(.fullScreenNone))
    }

    @Test func theWindowWrapsTheCardAndItsTitleBar() {
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 1180, height: 760),
                              styleMask: [.titled, .closable, .fullSizeContentView], backing: .buffered, defer: true)
        let titleBar = window.frame.height - window.contentLayoutRect.height
        #expect(titleBar > 0)
        #expect(CardWindow.frameSize(window, card: WelcomeFlow.size) == CGSize(width: 900, height: 600 + titleBar))
    }
}
#endif
