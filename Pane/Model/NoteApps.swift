import Foundation

/// Notes that are apps (prototype; see NotePage, MakeAnApp) are not released: this is the one
/// switch every way in asks. Off, nothing offers to make an app, Settings has no app sections, a
/// template's app isn't fetched, and a note that already has an app opens as its text. The app and
/// its data stay stored and synced untouched.
///
/// The released app (Release, Pinto Notes' own bundle id) is always off. Development builds (Debug,
/// QA) and Pinto Notes Beta are on; `-noteApps NO` (a launch argument, or `defaults write
/// dev.emilwagman.pane.beta noteApps -bool NO`) shows them as released.
enum NoteApps {
    static let key = "noteApps"

    static let enabled: Bool = {
        #if DEBUG || QA
        let development = true
        #else
        let development = false
        #endif
        let defaults = UserDefaults.standard
        return isEnabled(development: development, beta: AppIdentity.keychainPrefix.hasSuffix(".beta"),
                         setting: defaults.object(forKey: key) == nil ? nil : defaults.bool(forKey: key))
    }()

    static func isEnabled(development: Bool, beta: Bool, setting: Bool?) -> Bool {
        development || beta ? setting ?? true : false
    }

    /// The app a note runs, as NotePageStore.live: none while apps are off.
    @MainActor static func page(_ id: UUID, in store: NotePageStore = .shared, enabled: Bool = NoteApps.enabled) -> NotePageStore.Page? {
        enabled ? store.live(id) : nil
    }
}
