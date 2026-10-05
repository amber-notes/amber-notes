# Vendored packages

## automerge-swift 0.7.2

A copy of https://github.com/automerge/automerge-swift at 0.7.2 (MIT, see its LICENSE), without
its tests, for the collaboration prototype. One change: `Cursor` gets public initializers from its
bytes and from the hex its `description` gives (`Sources/Automerge/Cursor.swift`), so a cursor one
device sends can be resolved on another. The binary XCFramework is still the released one (the
URL and checksum in `Package.swift`). Drop this copy once upstream has a public initializer.
