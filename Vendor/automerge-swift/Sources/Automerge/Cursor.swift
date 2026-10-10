import enum AutomergeUniffi.Position

typealias FfiPosition = AutomergeUniffi.Position

/// A opaque type that represents a stable location of the character following the location reference at creation within an array or text object that adjusts with insertions and deletions to
/// maintain its relative position.
///
/// Create a cursor using ``Document/cursor(obj:position:)``, or ``Document/cursor(obj:position:heads:)`` to place a
/// cursor at the point in time indicated by the `heads` parameter.
/// Retrieve the position of the cursor reference from the document using ``Document/position(obj:cursor:)``, or use
/// ``Document/position(obj:cursor:heads:)`` to get the position at a previous point in time.
public struct Cursor: Equatable, Hashable, Sendable {
    var bytes: [UInt8]

    // Amber Notes: a cursor sent to another device comes back from its bytes (the hex
    // `description`). Upstream has no public way to rebuild one; see Vendor/README.md.
    public init(bytes: [UInt8]) { self.bytes = bytes }

    /// A cursor from the hex its `description` gives, or nil when that isn't hex.
    public init?(hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var out: [UInt8] = []
        out.reserveCapacity(hex.count / 2)
        var i = hex.startIndex
        while i < hex.endIndex {
            let j = hex.index(i, offsetBy: 2)
            guard let b = UInt8(hex[i..<j], radix: 16) else { return nil }
            out.append(b)
            i = j
        }
        self.bytes = out
    }
}

extension Cursor: CustomStringConvertible {
    /// The bytes that describe the cursor.
    public var description: String {
        bytes.map { Swift.String(format: "%02hhx", $0) }.joined().uppercased()
    }
}

/// An umbrella type that represents a location within an array or text object.
///
/// ### See Also
/// - ``Document/cursor(obj:position:)``
/// - ``Document/cursor(obj:position:heads:)``
public enum Position {
    /// A stable location character or array position that follows that location regardless of Document changes.
    case cursor(Cursor)
    /// An absolute index position within an array or text object.
    case index(UInt64)
}

extension Position {
    func toFfi() -> FfiPosition {
        switch self {
        case let .cursor(cursor):
            return .cursor(position: cursor.bytes)
        case let .index(index):
            return .index(position: index)
        }
    }
}
