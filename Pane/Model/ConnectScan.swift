import CryptoKit
import Foundation

/// What the connect page's QR code carries besides the request: a one-time scan secret, and the
/// SHA-256 of the page's public key. ambernotes.app/connect shows
/// https://ambernotes.app/open/connect?request=<id>#s=<secret>&k=<key hash> (and, on a Mac, the same
/// as ambernotes://connect?...). The fragment never reaches a server.
///
/// Scanning the code is the person's presence: the device that read it is next to the screen
/// that shows it. The device checks the page's key from the server against `keyHash` before it
/// seals anything to it, and answers with `secret`, whose hash the server checks once.
struct ConnectScan: Equatable, Sendable {
    let secret: String
    let keyHash: String

    /// From the link's fragment, `s=<22 base64url>&k=<43 base64url>`. Nil for anything else.
    init?(url: URL) {
        guard let fragment = URLComponents(url: url, resolvingAgainstBaseURL: false)?.fragment else { return nil }
        var fields: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { fields[kv[0]] = kv[1] }
        }
        guard let s = fields["s"], Self.isBase64url(s, count: 22),
              let k = fields["k"], Self.isBase64url(k, count: 43) else { return nil }
        secret = s
        keyHash = k
    }

    /// The key the server says the page has is the one the code was made for.
    func holds(browserKey: Data) -> Bool {
        Self.base64url(Data(SHA256.hash(data: browserKey))) == keyHash
    }

    private static func isBase64url(_ s: String, count: Int) -> Bool {
        s.count == count && s.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_") }
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
