// Writes a Foundation bookmark for a file: the record Finder itself stores as a window's background
// picture (.DS_Store pBBk). It finds the volume by its UUID, so it holds when another volume with
// the same name is mounted.
//   xcrun swift scripts/dmg/bookmark.swift <file> <out>
import Foundation

let args = CommandLine.arguments
let data = try URL(fileURLWithPath: args[1]).bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
try data.write(to: URL(fileURLWithPath: args[2]))
