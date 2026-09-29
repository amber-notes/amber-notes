import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import Pane

@Suite struct ProfileTests {
    /// A landscape JPEG carrying EXIF, GPS and TIFF metadata, like a phone photo.
    func photoWithMetadata(width: Int = 800, height: Int = 600) throws -> Data {
        let ctx = try #require(CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                         space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        ctx.setFillColor(CGColor(red: 0.9, green: 0.5, blue: 0.1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let image = try #require(ctx.makeImage())
        let out = NSMutableData()
        let dest = try #require(CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil))
        let meta: [CFString: Any] = [
            kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 59.33, kCGImagePropertyGPSLongitude: 18.06],
            kCGImagePropertyExifDictionary: [kCGImagePropertyExifUserComment: "secret"],
            kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFMake: "Phone"],
        ]
        CGImageDestinationAddImage(dest, image, meta as CFDictionary)
        #expect(CGImageDestinationFinalize(dest))
        return out as Data
    }

    @Test func photosBecomeSmallSquaresWithoutMetadata() throws {
        let source = try photoWithMetadata()
        let inSource = try #require(CGImageSourceCreateWithData(source as CFData, nil))
        let inProps = try #require(CGImageSourceCopyPropertiesAtIndex(inSource, 0, nil) as? [CFString: Any])
        #expect(inProps[kCGImagePropertyGPSDictionary] != nil, "the test photo carries a location")

        let out = try ProfileImage.prepare(source)
        let src = try #require(CGImageSourceCreateWithData(out as CFData, nil))
        #expect(CGImageSourceGetType(src) as String? == UTType.jpeg.identifier)
        let props = try #require(CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any])
        #expect(props[kCGImagePropertyPixelWidth] as? Int == 512)
        #expect(props[kCGImagePropertyPixelHeight] as? Int == 512)
        #expect(props[kCGImagePropertyGPSDictionary] == nil, "no location")
        #expect((props[kCGImagePropertyTIFFDictionary] as? [CFString: Any])?[kCGImagePropertyTIFFMake] == nil, "no camera")
        #expect((props[kCGImagePropertyExifDictionary] as? [CFString: Any])?[kCGImagePropertyExifUserComment] == nil, "no comments")
        #expect(out.count < 1_048_576, "fits the 1 MB photo limit")
    }

    @Test func tallAndTinyImagesStillWork() throws {
        #expect(try ProfileImage.prepare(try photoWithMetadata(width: 300, height: 1200)).count > 0)
        #expect(try ProfileImage.prepare(try photoWithMetadata(width: 40, height: 40)).count > 0)
        #expect(throws: (any Error).self) { try ProfileImage.prepare(Data("not an image".utf8)) }
    }

    @Test func namesAreTrimmedCleanAndShort() {
        #expect(ProfileName.normalized("  Emil Wagman  ") == "Emil Wagman")
        #expect(ProfileName.normalized("Emil\u{0007}\nWagman") == "EmilWagman")
        #expect(ProfileName.normalized("   ") == nil)
        #expect(ProfileName.normalized(String(repeating: "a", count: 80))?.count == 60)
    }

    @Test func initialsFromNamesOrEmails() {
        #expect(AvatarView.initials("Emil Wagman") == "EW")
        #expect(AvatarView.initials("emil@example.com") == "E")
        #expect(AvatarView.initials("anna-lena.berg@example.com") == "AB")
        #expect(AvatarView.initials("") == "?")
    }

    @Test func photoURLsNeverCarryAnythingButAPhotoName() {
        #expect(ProfileStore.avatarURL("../secret") == nil)
        #expect(ProfileStore.avatarURL("0123456789abcdef0123456789abcdef.jpg.html") == nil)
    }

    @Test func pendingEditsSurviveARestart() throws {
        var p = ProfileStore.Pending()
        #expect(p.isEmpty)
        p.name = "Emil"
        p.removePhoto = true
        let back = try JSONDecoder().decode(ProfileStore.Pending.self, from: JSONEncoder().encode(p))
        #expect(back == p && !back.isEmpty)
    }
}
