#if os(macOS)
import AppKit
import Testing
@testable import Pane

/// Renders a note with every kind of block, in light and dark, wide and narrow,
/// for looking at (snapshots land in $AMBER_QA_SHOTS/amber-qa).
@MainActor @Suite(.serialized) struct GalleryTests {
    static let note = """
    Weekend plans

    A normal paragraph with **bold**, *italic*, <u>underlined</u>, ~~struck~~ and `inline code`, plus a [link](https://example.com).

    ## Groceries
    - [ ] Oat milk
    - [ ] Coffee beans
    - [x] Bread

    ### Ideas
    - Walk by the water
      - Bring a camera
    1. First
    2. Second

    > A quote that runs long enough to wrap onto a second line when the window is narrow.

    ```
    let x = 42
    print(x)
    ```

    | Shortcut | Does |
    | --- | --- |
    | ⌘B | Bold |
    | ⌘⇧L | Checklist |

    <!-- pane-table: Date=date; Energy=scale 1-10; Walk=choice Yes|No -->
    | Date | Energy | Walk |
    | --- | --- | --- |
    | 2026-09-27 | 7 | Yes |
    | 2026-09-28 | 5 | No |

    https://www.apple.com

    ---

    The end.
    """

    @Test(arguments: [(false, 720), (true, 720), (false, 420), (true, 420)] as [(Bool, Int)])
    func gallery(dark: Bool, width: Int) async {
        let h = await EditorHarness(Self.note, width: CGFloat(width), height: 1500, dark: dark, focus: false)
        defer { h.close() }
        await h.settle(0.3)
        await h.snapshot("gallery-\(dark ? "dark" : "light")-\(width)")
    }
}
#endif
