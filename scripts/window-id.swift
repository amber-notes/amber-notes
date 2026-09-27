import CoreGraphics
import Foundation
// Prints "<id> <x> <y> <w> <h>" of the frontmost on-screen window owned by the given app name.
let name = CommandLine.arguments.dropFirst().first ?? "Pane"
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list where (w[kCGWindowOwnerName as String] as? String) == name && (w[kCGWindowLayer as String] as? Int) == 0 {
    let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
    print(w[kCGWindowNumber as String]!, Int(b["X"] ?? 0), Int(b["Y"] ?? 0), Int(b["Width"] ?? 0), Int(b["Height"] ?? 0))
    break
}
