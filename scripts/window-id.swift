import CoreGraphics
import Foundation
// Prints "<id> <x> <y> <w> <h>" of the frontmost on-screen window owned by an app name or a process id.
let arg = CommandLine.arguments.dropFirst().first ?? "Amber Notes"
let pid = Int32(arg)
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list where (w[kCGWindowLayer as String] as? Int) == 0 {
    let owner = w[kCGWindowOwnerName as String] as? String
    let ownerPID = w[kCGWindowOwnerPID as String] as? Int32
    guard pid.map({ $0 == ownerPID }) ?? (owner == arg) else { continue }
    let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
    print(w[kCGWindowNumber as String]!, Int(b["X"] ?? 0), Int(b["Y"] ?? 0), Int(b["Width"] ?? 0), Int(b["Height"] ?? 0))
    break
}
