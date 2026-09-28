import ApplicationServices
import Foundation
// Resizes the first window of a process: swift scripts/resize.swift <pid> <width> <height>
let pid = pid_t(CommandLine.arguments[1])!
var size = CGSize(width: Double(CommandLine.arguments[2])!, height: Double(CommandLine.arguments[3])!)
let app = AXUIElementCreateApplication(pid)
var windows: CFTypeRef?
AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windows)
guard let first = (windows as? [AXUIElement])?.first, let value = AXValueCreate(.cgSize, &size) else { exit(1) }
AXUIElementSetAttributeValue(first, kAXSizeAttribute as CFString, value)
