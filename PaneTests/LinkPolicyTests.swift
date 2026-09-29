import Foundation
import Testing
@testable import Pane

@Suite struct LinkPolicyTests {
    @Test func webMailAndPhoneOpen() {
        for s in ["https://example.com/a?b=c", "http://localhost:3000", "mailto:hi@example.com", "tel:+46701234567", "HTTPS://EXAMPLE.COM"] {
            #expect(LinkPolicy.action(for: URL(string: s)!) == .open(URL(string: s)!), "\(s)")
        }
    }

    @Test func noteLinksStayInTheApp() {
        let id = UUID()
        #expect(LinkPolicy.action(for: URL(string: "pane-note:\(id.uuidString.lowercased())")!) == .note(id))
        #expect(LinkPolicy.action(for: URL(string: "pane-note:not-a-uuid")!) == .nothing)
    }

    @Test func everythingElseIsInert() {
        for s in ["file:///Applications/Terminal.app", "smb://attacker.example/share", "javascript:alert(1)",
                  "ambernotes://connect?request=00000000-0000-0000-0000-000000000000", "x-apple.systempreferences:com.apple.preference.security",
                  "data:text/html,<script>alert(1)</script>", "vnc://host", "afp://host/share", "ssh://host", "shortcuts://run-shortcut?name=x"] {
            #expect(LinkPolicy.action(for: URL(string: s)!) == .nothing, "\(s)")
        }
        #expect(LinkPolicy.action(for: "file:///etc/passwd" as Any) == .nothing)
        #expect(LinkPolicy.action(for: 42 as Any) == .nothing)
    }
}
