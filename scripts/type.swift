import AppKit
import CoreGraphics
import Foundation
// Types text (and \t as Tab) into the frontmost app, only if it's the given PID.
let pid = Int32(CommandLine.arguments[1])!
let text = CommandLine.arguments[2]
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { print("not frontmost; refusing to type"); exit(1) }
for ch in text {
    if ch == "\t" {
        for down in [true, false] { CGEvent(keyboardEventSource: nil, virtualKey: 48, keyDown: down)?.post(tap: .cghidEventTap) }
    } else {
        var u = Array(String(ch).utf16)
        for down in [true, false] {
            let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down)
            e?.keyboardSetUnicodeString(stringLength: u.count, unicodeString: &u)
            e?.post(tap: .cghidEventTap)
        }
    }
    usleep(30_000)
}
