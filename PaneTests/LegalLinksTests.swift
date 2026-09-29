import Foundation
import Testing
@testable import Pane

@Suite struct LegalLinksTests {
    @Test func theSentenceLinksBothDocuments() {
        let s = Legal.consentSentence
        #expect(String(s.characters) == "By continuing, you agree to the Terms of Service and Privacy Policy.")
        let links = s.runs.compactMap { run -> (String, URL)? in
            guard let url = run.link else { return nil }
            return (String(s[run.range].characters), url)
        }
        #expect(links.count == 2)
        #expect(links.first?.0 == "Terms of Service")
        #expect(links.first?.1.absoluteString == "https://amber-notes.vercel.app/terms")
        #expect(links.last?.0 == "Privacy Policy")
        #expect(links.last?.1.absoluteString == "https://amber-notes.vercel.app/privacy")
    }
}
