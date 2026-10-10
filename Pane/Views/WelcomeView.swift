import SwiftUI

/// The first screen when you're signed out: what Amber Notes is, then the way in. "Get started"
/// and "I already have an account" both lead to sign-in in the same frame, with a way back.
/// On the Mac it's a wide window split in two, a paper-cut picture (an amber leaf on a stack of
/// notes, at dusk in dark mode) on the left and the words on the right; on iPhone the picture
/// sits on top.
struct WelcomeFlow: View {
    let backend: Backend
    /// Captures: sign-in opens with the cursor in the email field.
    var focusEmail = false
    /// Captures: the sign-in form at a given step (the code screen, say).
    var flow = EmailSignInFlow()
    /// Captures: an error under the form.
    var error: String?
    @State private var stage: Stage
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    enum Stage: Equatable {
        case welcome
        /// Sign-in, from "Get started" (new) or "I already have an account" (returning).
        case signIn(returning: Bool)

        /// Where a signed-out launch starts: the welcome, unless a test asks for sign-in
        /// straight away (`-skipWelcome`).
        static func first(arguments: [String] = ProcessInfo.processInfo.arguments) -> Stage {
            arguments.contains("-skipWelcome") ? .signIn(returning: true) : .welcome
        }
    }

    init(backend: Backend, stage: Stage = .first(), focusEmail: Bool = false, flow: EmailSignInFlow = EmailSignInFlow(), error: String? = nil) {
        self.backend = backend
        self.focusEmail = focusEmail
        self.flow = flow
        self.error = error
        _stage = State(initialValue: stage)
    }

    #if os(macOS)
    static let size = CGSize(width: 900, height: 600)
    #endif

    var body: some View {
        #if os(macOS)
        HStack(spacing: 0) {
            art
            words
                .padding(.horizontal, 52)
                .padding(.top, 48)
                .padding(.bottom, 36)
                .frame(width: Self.size.width / 2)
                .frame(maxHeight: .infinity)
        }
        // The window is held at this size (WindowShaper); whatever it ends up, the picture
        // takes the rest of it, so there's never a band beside or around it.
        .frame(minWidth: Self.size.width, maxWidth: .infinity, minHeight: 540, idealHeight: Self.size.height, maxHeight: .infinity)
        .background { Backdrop() }
        #else
        Group {
            if stage == .welcome {
                // The picture fills the top; the way in stays at the bottom, where the thumb is.
                ScrollView {
                    VStack(spacing: 0) {
                        // Large text gets the room: the picture gives some up.
                        phoneArt(share: typeSize.isAccessibilitySize ? 0.3 : 0.5)
                        words
                            .padding(.horizontal, 24)
                            .padding(.top, 24)
                    }
                }
                .scrollBounceBehavior(.basedOnSize)
                .safeAreaInset(edge: .bottom) { welcomeActions.padding(.horizontal, 24).padding(.bottom, 8).background { Backdrop() } }
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        phoneArt(share: 0.24)
                        words
                            .padding(.horizontal, 24)
                            .padding(.top, 20)
                            .padding(.bottom, 24)
                            .frame(maxWidth: 440)
                    }
                    .frame(maxWidth: .infinity)
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .ignoresSafeArea(.container, edges: .top)
        // Over the picture, but under the status bar: the overlay keeps the safe area.
        .overlay(alignment: .topLeading) { phoneBack }
        .background { Backdrop() }
        #endif
    }

    // MARK: The words side

    @ViewBuilder private var words: some View {
        ZStack(alignment: .topLeading) {
            switch stage {
            case .welcome:
                welcome
                    .transition(stageTransition(forward: false))
            case .signIn(let returning):
                signIn(returning: returning)
                    .transition(stageTransition(forward: true))
            }
        }
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .smooth(duration: 0.35), value: stage)
    }

    private func stageTransition(forward: Bool) -> AnyTransition {
        if reduceMotion { return .opacity }
        return .asymmetric(insertion: .opacity.combined(with: .offset(x: forward ? 24 : -24)), removal: .opacity)
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 0) {
            #if os(macOS)
            AppMark(size: 56)
            Spacer(minLength: 24)
            #endif
            VStack(alignment: .leading, spacing: 12) {
                // The website's display type, and its low amber marker under "your AI".
                Text("The notes app \(Text("your AI").customAttribute(Marker())) can use.")
                    .textRenderer(Marker.Renderer(color: Color(Palette.underline)))
                    .font(Self.titleFont)
                    .tracking(-0.8)
                    .foregroundStyle(Color.ink)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("welcome.title")
                Text("ChatGPT and Claude can read and edit your notes, with your approval. End-to-end encrypted, on iPhone and Mac.")
                    .font(Self.lineFont)
                    .foregroundStyle(Color.muted)
                    .lineSpacing(2)
                    .accessibilityIdentifier("welcome.line")
            }
            .fixedSize(horizontal: false, vertical: true)
            #if os(macOS)
            Spacer(minLength: 24)
            welcomeActions
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var welcomeActions: some View {
        VStack(spacing: 6) {
            Button("Get started") { stage = .signIn(returning: false) }
                .buttonStyle(.amberProminent(height: SignInView.Row.height, cornerRadius: SignInView.Row.radius))
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("welcome.start")
            Button {
                stage = .signIn(returning: true)
            } label: {
                Text("I already have an account")
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .contentShape(.rect)
            }
            .buttonStyle(.hoverLink)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.tint)
            .accessibilityIdentifier("welcome.signIn")
        }
    }

    private func signIn(returning: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            #if os(macOS)
            Button {
                stage = .welcome
            } label: {
                Label("Back", systemImage: "chevron.left")
                    .frame(minHeight: 24)
                    .contentShape(.rect)
            }
            .buttonStyle(.hoverText)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.tint)
            .keyboardShortcut(.cancelAction)
            .accessibilityIdentifier("welcome.back")
            #endif
            // The same neutral words from Get started and I already have an account: until the email
            // is checked, nobody knows which it is (SignInView then says Welcome back or Create your account).
            SignInView(backend: backend, flow: flow, heading: .beside(title: SignInView.startTitle, line: SignInView.startLine),
                       focusEmail: focusEmail, error: error)
                #if os(macOS)
                // Top-anchored, so the form keeps its place as its steps come and go, but low
                // enough that the first step sits near the middle of the window.
                .padding(.top, 44)
                #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    #if os(macOS)
    private static let titleFont = Font.system(size: 34, weight: .heavy)
    private static let lineFont = Font.system(size: 15)
    #else
    private static let titleFont = Font.largeTitle.weight(.heavy)
    private static let lineFont = Font.body
    #endif

    // MARK: The picture

    /// Decorative: the words say everything, so VoiceOver skips it.
    fileprivate static var picture: some View {
        Image("Welcome")
            .resizable()
            .interpolation(.high)
            .scaledToFill()
            .accessibilityHidden(true)
    }

    private var picture: some View { Self.picture }

    #if os(macOS)
    /// Edge to edge, the window buttons on it. It fills its panel and crops from the centre,
    /// where the leaf on the paper is.
    fileprivate static var art: some View {
        Color.clear
            .frame(minWidth: size.width / 2, maxWidth: .infinity, maxHeight: .infinity)
            .overlay { picture }
            .clipped()
    }

    private var art: some View { Self.art }
    #else
    /// The picture across the top, under the status bar. `share` is its part of the screen's height.
    private func phoneArt(share: CGFloat) -> some View {
        Color.clear
            .containerRelativeFrame(.vertical) { height, _ in height * share }
            .overlay { picture }
            .clipped()
            .animation(reduceMotion ? nil : .smooth(duration: 0.35), value: share)
    }

    @ViewBuilder private var phoneBack: some View {
        if stage != .welcome {
            Button {
                stage = .welcome
            } label: {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.ink)
            .glassEffect(.regular.interactive(), in: .circle)
            .accessibilityLabel("Back")
            .accessibilityIdentifier("welcome.back")
            .padding(.leading, 16)
            .padding(.top, 4)
            .transition(.opacity)
        }
    }
    #endif
}

#if os(macOS)
/// The steps after sign-in that come before the notes (adding this Mac, the recovery key, "No
/// device left?") in the welcome's window: the same picture on the left, the step on the right,
/// so the window keeps its size and place from the welcome until the notes open.
struct CardLayout<Side: View>: View {
    @ViewBuilder var side: Side

    var body: some View {
        HStack(spacing: 0) {
            WelcomeFlow.art
            side
                .frame(width: WelcomeFlow.size.width / 2)
                .frame(maxHeight: .infinity)
        }
        .frame(minWidth: WelcomeFlow.size.width, maxWidth: .infinity, maxHeight: .infinity)
        .background { Backdrop() }
    }
}
#endif
