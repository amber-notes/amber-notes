// Finds text lines in a capture with Vision and prints them as JSON, in image pixels, top-left origin:
//   swift scripts/store-art/locate.swift capture.png > capture.json
import Foundation
import Vision
import AppKit

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let w = CGFloat(cg.width), h = CGFloat(cg.height)
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([request])
var out: [[String: Any]] = []
for o in request.results ?? [] {
    guard let t = o.topCandidates(1).first else { continue }
    let b = o.boundingBox
    out.append(["text": t.string, "x": Int(b.minX * w), "y": Int((1 - b.maxY) * h), "w": Int(b.width * w), "h": Int(b.height * h)])
}
let data = try JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(data)
