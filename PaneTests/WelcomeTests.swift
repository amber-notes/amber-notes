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

    @Test func everyLookHasItsPicture() {
        for look in WelcomeLook.allCases {
            #expect(look.imageName == "Welcome\(look.rawValue.uppercased())")
        }
    }
}
