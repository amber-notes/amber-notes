import ApplicationServices
import Foundation
// Moves and resizes the first window of a process: swift scripts/place-window.swift <pid> <x> <y> <width> <height>
let a = CommandLine.arguments
let pid = pid_t(a[1])!
var origin = CGPoint(x: Double(a[2])!, y: Double(a[3])!)
var size = CGSize(width: Double(a[4])!, height: Double(a[5])!)
let app = AXUIElementCreateApplication(pid)
var windows: CFTypeRef?
AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windows)
guard let first = (windows as? [AXUIElement])?.first,
      let p = AXValueCreate(.cgPoint, &origin), let s = AXValueCreate(.cgSize, &size) else { exit(1) }
AXUIElementSetAttributeValue(first, kAXPositionAttribute as CFString, p)
AXUIElementSetAttributeValue(first, kAXSizeAttribute as CFString, s)
