// Re-encodes a PNG without an alpha channel (App Store icons must be opaque).
//   swift scripts/flatten-png.swift in.png out.png
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let src = NSImage(contentsOfFile: args[1]),
      let cg = src.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fatalError("usage: in.png out.png") }
let ctx = CGContext(data: nil, width: cg.width, height: cg.height, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
ctx.setFillColor(NSColor.white.cgColor)
ctx.fill(CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
ctx.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
