import CoreImage.CIFilterBuiltins
import LocalAuthentication
import Observation
import SwiftUI
#if os(iOS)
import AVFoundation
import UIKit
#endif

/// Add a device, in words: the new device's screen, and the sheet on the device that has the key.
enum AddDeviceCopy {
    static var gateTitle: String { "Open your notes on this \(InstallID.kind)" }
    static let gateMessage = "On a device where Amber Notes already works, go to Settings \u{203A} Add a device and scan this code."
    static let codeLead = "Can\u{2019}t scan? Type this code there:"
    static let useRecovery = "Use a recovery key instead"
    static let noDevice = "No device left?"
    static let expired = "This code expired."
    static let newCode = "Show a new code"
    static let offline = "Can\u{2019}t reach Amber Notes. Connect to the internet to show a code."
    static let notAccountsKey = "What the other device sent isn\u{2019}t this account\u{2019}s key, so it wasn\u{2019}t used. Here is a new code."

    static let noDeviceMessage = "We don\u{2019}t have your key. One of these can still open your notes."
    static let keychainTitle = "iCloud Keychain"
    static var keychainDetail: String { "If it\u{2019}s on for this \(InstallID.kind), your key arrives by itself." }
    static let recoveryTitle = "A recovery key"
    static let recoveryDetail = "Only if you saved one."
    static let aiNote = "An AI you connected can still read your notes until you start fresh."
    static let noneWork = "None of these work"

    static let sheetTitle = "Add a device"
    static let scanMessage = "Point the camera at the code on your new device."
    static let typeMessage = "Sign in to Amber Notes on the new device, then type the code it shows under its QR code."
    static let typeInstead = "Type the code instead"
    static let scanInstead = "Scan the code instead"
    static let cameraOff = "Amber Notes can\u{2019}t use the camera. Allow it in Settings \u{203A} Amber Notes, or type the code."
    static func confirmTitle(_ kind: String) -> String { "Add this \(kind)?" }
    static let confirmMessage = "It will open all your notes until you remove it in Settings."
    static let warning = "Only add a device that is in front of you. Never use a code that someone sent you."
    static let add = "Add device"
    static let dontAdd = "Don\u{2019}t add"
    static func asked(_ at: Date, now: Date = .now) -> String {
        let seconds = now.timeIntervalSince(at)
        let when = seconds < 60 ? "just now" : "\(Int(seconds / 60)) min ago"
        return "Asked \(when) from your own account."
    }
    static let doneTitle = "Added"
    static func doneMessage(_ name: String) -> String { "Your notes are opening on \(name)." }
    static func authReason(_ kind: String) -> String { "add this \(kind) to your notes" }
}

// MARK: The code

/// A QR code, dark on white in both appearances so any camera reads it.
struct QRCodeImage: View {
    let text: String
    var side: CGFloat = 176
    /// The default code's size on screen, with its white margin.
    static let outside: CGFloat = 176 + 2 * 14

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        Group {
            if let image = Self.make(text) {
                Image(decorative: image, scale: 1)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: side, height: side)
            } else {
                Color.white.frame(width: side, height: side)
            }
        }
        .padding(14)
        .background(.white, in: shape)
        .overlay(shape.strokeBorder(.black.opacity(0.08), lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel("QR code")
        .accessibilityIdentifier("addDevice.qr")
    }

    /// One pixel per module, with the quiet zone the generator adds.
    static func make(_ text: String) -> CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        return CIContext().createCGImage(output, from: output.extent)
    }
}

// MARK: The new device

/// The new device while its code shows: makes the offer, files it, asks every two seconds
/// whether it was answered, and hands the key to `AccountCrypto` once it opens and checks out.
/// A code lives five minutes; a new one replaces it by itself a few times, then on request.
@MainActor
@Observable
final class NewDeviceSession {
    enum State: Equatable {
        case preparing
        case showing(qr: String, code: String)
        /// Enough codes went unused: the next one is shown on request.
        case expired
        case failed(String)
    }

    private(set) var state: State
    /// Said under the code: what went wrong with the last one.
    private(set) var problem: String?
    /// Bumped when the person asks for a new code, so the view runs the session again.
    private(set) var round = 0
    @ObservationIgnored private let crypto: AccountCrypto
    @ObservationIgnored private let server: AddDeviceServer?
    @ObservationIgnored private let device: UUID
    @ObservationIgnored private let platform: String
    @ObservationIgnored private let name: String
    @ObservationIgnored private let poll: Duration
    @ObservationIgnored private let offers: Int
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private var offer: (NewDeviceOffer, expires: Date)?
    @ObservationIgnored private var shown = 0

    init(crypto: AccountCrypto, server: AddDeviceServer?, device: UUID = DeviceIdentity.shared.id ?? UUID(), platform: String = InstallID.platform,
         name: String = AddDeviceNames.thisDevice, poll: Duration = .seconds(2), offers: Int = 6, preview: State? = nil,
         sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }) {
        self.crypto = crypto
        self.server = preview == nil ? server : nil
        self.device = device
        self.platform = platform
        self.name = name
        self.poll = poll
        self.offers = offers
        self.sleep = sleep
        state = preview ?? .preparing
    }

    /// How long a code shows before a new one replaces it: the server's five minutes.
    static let life: TimeInterval = 300

    /// "Show a new code".
    func again() {
        shown = 0
        problem = nil
        state = .preparing
        round += 1
    }

    /// Runs while the screen shows; ends when the key arrives, when the codes run out, or when
    /// the task is cancelled (the screen went away). The code on screen carries over.
    func run() async {
        guard let server else { return }
        while !Task.isCancelled {
            guard let user = crypto.account, crypto.phase == .waiting || crypto.phase == .mismatch else { return }
            if offer == nil || offer!.expires <= .now {
                offer = nil
                guard shown < offers else { state = .expired; return }
                let (device, platform, name) = (device, platform, name)
                // Stretching the typed code takes a moment: off the main actor.
                let made = await Task.detached { NewDeviceOffer.make(user: user, device: device, platform: platform, name: name) }.value
                do {
                    _ = try await server.request(made.request)
                    // Timed by this device's own clock from now, not by the server's timestamp: a
                    // clock that's off mustn't make every code look expired. The server keeps its own time.
                    offer = (made, Date.now.addingTimeInterval(Self.life))
                } catch AddDeviceError.tooMany {
                    state = .failed(AddDeviceError.tooMany.localizedDescription)
                    return
                } catch {
                    if Task.isCancelled { return }
                    state = .failed(AddDeviceCopy.offline)
                    do { try await sleep(.seconds(5)) } catch { return }
                    continue
                }
                shown += 1
            }
            guard let (current, expires) = offer else { continue }
            state = .showing(qr: current.qrText, code: current.codeText)
            do { try await sleep(poll) } catch { return }
            guard let answer = try? await server.pickup(id: current.id, pickup: current.pickup) else { continue }
            switch answer.state {
            case .waiting:
                if expires <= .now { offer = nil }
            case .answered:
                offer = nil
                // Used or refused, the server's sealed copy has done its work.
                defer { Task { try? await server.done(id: current.id, pickup: current.pickup) } }
                do {
                    try crypto.adopt(added: try current.open(answer))
                    AddDeviceMoment.here = .now
                    return
                } catch {
                    // Not this account's key, or not sealed by someone who read this screen: never used.
                    problem = AddDeviceCopy.notAccountsKey
                }
            case .expired, .taken, .gone:
                offer = nil
            }
        }
    }
}

/// The code a new device shows: the QR code, and the same thing to type.
struct NewDeviceCodeView: View {
    let session: NewDeviceSession

    var body: some View {
        VStack(spacing: 14) {
            switch session.state {
            case .preparing:
                // The code's own room, empty, so the card doesn't grow when the code comes.
                VStack(spacing: 14) {
                    Color.clear.frame(width: QRCodeImage.outside, height: QRCodeImage.outside)
                    codeLines("XXXX-XXXX-XXXX")
                }
                .hidden()
                .overlay(alignment: .top) { ProgressView().controlSize(.regular).frame(height: QRCodeImage.outside) }
                .accessibilityHidden(true)
            case .showing(let qr, let code):
                QRCodeImage(text: qr)
                codeLines(code)
                    .transition(.opacity)
            case .expired:
                message(AddDeviceCopy.expired)
                Button(AddDeviceCopy.newCode) { session.again() }
                    .accessibilityIdentifier("addDevice.newCode")
            case .failed(let text):
                message(text)
                Button("Try again") { session.again() }
                    .accessibilityIdentifier("addDevice.retry")
            }
            if let problem = session.problem {
                Text(problem)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("addDevice.problem")
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func codeLines(_ code: String) -> some View {
        VStack(spacing: 4) {
            Text(AddDeviceCopy.codeLead)
                .font(.footnote)
                .foregroundStyle(Color.muted)
                .fixedSize(horizontal: false, vertical: true)
            Text(code)
                .font(.system(.title3, design: .monospaced).weight(.semibold))
                .foregroundStyle(Color.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.4)
                .textSelection(.enabled)
                .accessibilityLabel(code.map(String.init).joined(separator: " "))
                .accessibilityIdentifier("addDevice.code")
        }
        .multilineTextAlignment(.center)
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Color.muted)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 8)
    }
}

// MARK: The device that has the key

/// Settings › Add a device: read the new device's code (the camera on iPhone, typed on a Mac),
/// confirm which device it is, then Face ID or Touch ID, and the key goes over sealed.
struct AddDeviceSheet: View {
    let crypto: AccountCrypto
    let server: AddDeviceServer?
    @Environment(\.dismiss) private var dismiss

    enum Phase: Equatable { case reading, finding, confirm(AddDeviceApproval.Candidate), adding(AddDeviceApproval.Candidate), done(AddDeviceApproval.Candidate) }
    enum Camera: Equatable { case unknown, on, off, none }

    @State private var phase: Phase
    @State private var typing: Bool
    @State private var code = ""
    @State private var problem: String?
    @State private var camera: Camera
    /// Add waits a moment after the question shows, so a tap meant for the scanner doesn't land on it.
    @State private var armed = false
    @FocusState private var codeFocused: Bool
    @State private var sightings = Sightings()
    /// Face ID, Touch ID or the passcode before the key goes; tests and captures answer for it.
    var confirm: (String) async -> Bool = { reason in
        (try? await LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
    var canConfirm: () -> Bool = { ConnectApproval.canConfirm }
    var added: () -> Void = {}

    init(crypto: AccountCrypto, server: AddDeviceServer?, initial: Phase = .reading, typing: Bool? = nil, camera: Camera = .unknown,
         previewProblem: String? = nil) {
        self.crypto = crypto
        self.server = server
        _phase = State(initialValue: initial)
        #if os(iOS)
        _typing = State(initialValue: typing ?? false)
        #else
        _typing = State(initialValue: true)
        #endif
        _camera = State(initialValue: camera)
        _problem = State(initialValue: previewProblem)
    }

    var body: some View {
        #if os(iOS)
        ScrollView {
            VStack(spacing: 16) {
                if reads { header }
                content
            }
            .padding(.horizontal, 24)
            .padding(.top, reads ? 16 : 32)
            .padding(.bottom, 16)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        // Reading the code takes the whole sheet (the camera); the question and "Added" are as
        // tall as what they say, like the sheet that allows an AI.
        .presentationDetents(reads || contentHeight == 0 ? [.large] : [.height(contentHeight + 24)])
        .presentationDragIndicator(.visible)
        .task { await prepareCamera() }
        .task(id: phase) { await arm() }
        #else
        content
            .padding(28)
            .frame(width: 420)
            .task(id: phase) { await arm() }
        #endif
    }

    /// Reading the new device's code (or looking it up), before the question.
    private var reads: Bool { phase == .reading || phase == .finding }

    #if os(iOS)
    @State private var contentHeight: CGFloat = 0

    @Environment(\.dynamicTypeSize) private var typeSize

    @ViewBuilder private var header: some View {
        let cancel = Button("Cancel") { dismiss() }
            .frame(minHeight: 44)
            .accessibilityIdentifier("addDevice.cancel")
        if typeSize.isAccessibilitySize {
            // The largest text sizes: one under the other, nothing overlapping.
            VStack(alignment: .leading, spacing: 4) {
                cancel
                Text(AddDeviceCopy.sheetTitle).font(.headline).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            ZStack {
                Text(AddDeviceCopy.sheetTitle).font(.headline)
                HStack {
                    cancel
                    Spacer()
                }
            }
        }
    }
    #endif

    @ViewBuilder private var content: some View {
        switch phase {
        case .reading, .finding: reading
        case .confirm(let c), .adding(let c): asking(c)
        case .done(let c): finished(c)
        }
    }

    private func arm() async {
        armed = false
        try? await Task.sleep(for: .seconds(1))
        if !Task.isCancelled { armed = true }
    }

    // MARK: Reading the code

    private var reading: some View {
        VStack(spacing: 18) {
            #if os(macOS)
            AppMark(size: 56)
            Text(AddDeviceCopy.sheetTitle).font(.title2.weight(.semibold))
            #endif
            if typing {
                typed
            } else {
                scanner
            }
            if let problem {
                Text(problem)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("addDevice.problem")
            }
            #if os(iOS)
            if camera != .none {
                Button(typing ? AddDeviceCopy.scanInstead : AddDeviceCopy.typeInstead) {
                    problem = nil
                    typing.toggle()
                    codeFocused = typing
                }
                .frame(minHeight: 44)
                .accessibilityIdentifier("addDevice.switch")
            }
            #else
            Button("Cancel") { dismiss() }
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("addDevice.cancel")
            #endif
        }
        .frame(maxWidth: .infinity)
    }

    private var typed: some View {
        VStack(spacing: 14) {
            Text(AddDeviceCopy.typeMessage)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Code", text: $code, prompt: Text("XXXX-XXXX-XXXX"))
                .font(.system(.title3, design: .monospaced))
                .multilineTextAlignment(.center)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.characters)
                .keyboardType(.asciiCapable)
                .padding(.horizontal, 12)
                .frame(minHeight: 48)
                .background(.fill.tertiary, in: .rect(cornerRadius: 12, style: .continuous))
                #else
                .textFieldStyle(.roundedBorder)
                .controlSize(.large)
                #endif
                .focused($codeFocused)
                .onSubmit { if canSubmit { find(.typed(code)) } }
                .accessibilityIdentifier("addDevice.codeField")
            Button { find(.typed(code)) } label: { Text("Continue").frame(maxWidth: .infinity) }
                .buttonStyle(.amberProminent)
                .controlSize(.large)
                .amberBusy(phase == .finding)
                .disabled(!canSubmit)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("addDevice.continue")
        }
        .onAppear { codeFocused = true }
    }

    private var canSubmit: Bool { phase == .reading && code.filter { $0.isLetter || $0.isNumber }.count >= 12 }

    @ViewBuilder private var scanner: some View {
        let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
        VStack(spacing: 16) {
            ZStack {
                Color.black
                #if os(iOS)
                if camera == .on {
                    CodeScanner { text in scanned(text) }
                }
                #endif
                if camera == .on, phase == .reading {
                    Image(systemName: "viewfinder")
                        .font(.system(size: 150, weight: .ultraLight))
                        .foregroundStyle(.white.opacity(0.55))
                        .accessibilityHidden(true)
                }
                if camera == .off {
                    Text(AddDeviceCopy.cameraOff)
                        .font(.callout)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(20)
                        .accessibilityIdentifier("addDevice.cameraOff")
                }
                if phase == .finding { ProgressView().controlSize(.large).tint(.white) }
            }
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: 320)
            .clipShape(shape)
            .overlay(shape.strokeBorder(.white.opacity(0.18), lineWidth: 1))
            .accessibilityIdentifier("addDevice.scanner")
            Text(AddDeviceCopy.scanMessage)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func prepareCamera() async {
        #if os(iOS)
        guard camera == .unknown else { return }
        guard AVCaptureDevice.default(for: .video) != nil else {
            // No camera (a simulator): the code is typed.
            camera = .none
            typing = true
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: camera = .on
        case .notDetermined: camera = await AVCaptureDevice.requestAccess(for: .video) ? .on : .off
        default: camera = .off
        }
        #endif
    }

    /// The camera reports a code many times a second while it's in view. Each code is tried
    /// once, and again only after it has been out of view for a few seconds.
    private func scanned(_ text: String) {
        let now = Date()
        defer { sightings.last[text] = now }
        if let seen = sightings.last[text], now.timeIntervalSince(seen) < 4 { return }
        find(.scanned(text))
    }

    private func find(_ input: AddDeviceApproval.Input) {
        guard phase == .reading, let server, let user = crypto.account else { return }
        problem = nil
        phase = .finding
        Task {
            do {
                // Stretching a typed code takes a moment: off the main actor.
                let candidate = try await Task.detached { try await AddDeviceApproval.find(input, user: user, server: server) }.value
                phase = .confirm(candidate)
            } catch {
                problem = error.localizedDescription
                phase = .reading
            }
        }
    }

    // MARK: The question

    private func marks(_ c: AddDeviceApproval.Candidate) -> some View {
        HStack(spacing: 14) {
            Image(systemName: c.platform == "macos" ? "laptopcomputer" : "iphone")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 56, height: 56)
                .background(.fill.tertiary, in: .rect(cornerRadius: 56 * 0.3, style: .continuous))
            Image(systemName: "link")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.tertiary)
            AppMark(size: 56)
        }
        .accessibilityHidden(true)
    }

    private func asking(_ c: AddDeviceApproval.Candidate) -> some View {
        VStack(spacing: 0) {
            marks(c)
            Text(AddDeviceCopy.confirmTitle(c.kind))
                .font(.title2.weight(.semibold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 18)
                .accessibilityIdentifier("addDevice.title")
            VStack(spacing: 6) {
                if c.name != c.kind {
                    Text(c.name)
                        .fontWeight(.medium)
                        .accessibilityIdentifier("addDevice.name")
                }
                Text(AddDeviceCopy.confirmMessage).foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 8)
            Label(AddDeviceCopy.warning, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(.orange)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 14)
                .accessibilityIdentifier("addDevice.warning")
            if let problem {
                Text(problem)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                    .accessibilityIdentifier("addDevice.problem")
            }
            VStack(spacing: 4) {
                Button { add(c) } label: { Text(AddDeviceCopy.add).frame(maxWidth: .infinity) }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.amberProminent)
                    .controlSize(.large)
                    .amberBusy(phase == .adding(c))
                    .disabled(!armed || phase != .confirm(c))
                    .accessibilityIdentifier("addDevice.add")
                Button(AddDeviceCopy.dontAdd) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                    .frame(minHeight: 44)
                    .disabled(phase != .confirm(c))
                    .accessibilityIdentifier("addDevice.dontAdd")
            }
            .padding(.top, 22)
            Text(AddDeviceCopy.asked(c.askedAt))
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
    }

    private func add(_ c: AddDeviceApproval.Candidate) {
        guard phase == .confirm(c), let server, let user = crypto.account else { return }
        problem = nil
        phase = .adding(c)
        Task {
            do {
                guard canConfirm() else { throw AddDeviceError.noDeviceLock }
                guard await confirm(AddDeviceCopy.authReason(c.kind)) else { phase = .confirm(c); return }
                guard let key = crypto.keyToHandOver else { throw AddDeviceError.notReady }
                try await AddDeviceApproval.approve(c, key: key, user: user, device: DeviceIdentity.shared.id ?? UUID(), server: server)
                AddDeviceMoment.here = .now
                phase = .done(c)
                added()
            } catch AddDeviceError.expired {
                // The code ran out while the question was up: back to reading the one showing now.
                problem = AddDeviceError.expired.localizedDescription
                phase = .reading
            } catch {
                problem = error.localizedDescription
                phase = .confirm(c)
            }
        }
    }

    private func finished(_ c: AddDeviceApproval.Candidate) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 52))
                .foregroundStyle(.green)
                .accessibilityHidden(true)
            Text(AddDeviceCopy.doneTitle).font(.title2.weight(.semibold)).accessibilityIdentifier("addDevice.done")
            Text(AddDeviceCopy.doneMessage(c.name == c.kind ? "your \(c.kind)" : c.name))
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button { dismiss() } label: { Text("Done").frame(maxWidth: .infinity) }
                .buttonStyle(.amberProminent)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
                .padding(.top, 14)
                .accessibilityIdentifier("addDevice.close")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
}

/// When the camera last saw each code. Not observed: it changes many times a second.
private final class Sightings {
    var last: [String: Date] = [:]
}

#if os(iOS)
// MARK: The scanner

/// The camera, reading QR codes. Only this view acts on an add-device code: it isn't a link, so
/// the system camera and web pages have nothing to open.
private struct CodeScanner: UIViewRepresentable {
    let found: @MainActor (String) -> Void

    func makeCoordinator() -> Reader { Reader(found: found) }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.preview.videoGravity = .resizeAspectFill
        context.coordinator.start(on: view)
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}

    static func dismantleUIView(_ view: PreviewView, coordinator: Reader) { coordinator.stop() }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    /// The capture session lives on a queue of its own; codes come back on the main queue.
    final class Reader: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
        private let found: @MainActor (String) -> Void
        private let session = AVCaptureSession()
        private let queue = DispatchQueue(label: "dev.emilwagman.pane.scanner")

        init(found: @escaping @MainActor (String) -> Void) { self.found = found }

        @MainActor func start(on view: PreviewView) {
            guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            if output.availableMetadataObjectTypes.contains(.qr) { output.metadataObjectTypes = [.qr] }
            view.preview.session = session
            queue.async { [session] in session.startRunning() }
        }

        func stop() { queue.async { [session] in session.stopRunning() } }

        func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
            guard let text = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
            Task { @MainActor in found(text) }
        }
    }
}
#endif

// MARK: Captures

/// Captures only (`-uitest -captureScreen …`): Add a device on a real screen, with no account.
///   `new-device`: the code a device without the key shows. `add-device`: the sheet as this device
///   opens it (the camera, or the typed code where there's no camera, as on a simulator).
///   `add-device-type`, `add-device-confirm`, `add-device-done`: the typed code, the question, "Added".
///   `key-kept` (safe), `key-kept-unconfirmed`, `key-kept-only`: Privacy & Security in its three
///   states (PaneUITests/AddDeviceUITests taps Remove and Add a device on them).
///   `device-added-notice`: what every other device says after one is added.
struct AddDeviceCapture: View {
    let name: String
    @State private var crypto: AccountCrypto
    @State private var devices = KeyDevices(device: UUID(), identity: DeviceIdentity(store: MemoryDeviceIdentityStore()))
    @State private var ready = false
    @State private var notice = true

    init(name: String) {
        self.name = name
        // "Only this device": a build whose Keychain doesn't sync.
        _crypto = State(initialValue: AccountCrypto(store: MemoryAccountKeyStore(syncs: name != "key-kept-only"),
                                                    defaults: UserDefaults(suiteName: "capture-add-device-\(UUID())") ?? .standard))
    }

    /// An account that has a key (the new device waits) or has none yet (this device makes it).
    private struct Server: AccountKeyServer {
        let key: ServerKey?
        func fetch() async throws -> ServerKeyState { ServerKeyState(key: key) }
        func create(_ key: ServerKey, generation: Int) async throws -> (key: ServerKey, created: Bool) { (key, true) }
        func markRecoveryKeySaved() async throws -> Date? { .now }
        func startFresh(keyID: String) async throws -> Bool { false }
    }

    private static let mac = AddDeviceApproval.Candidate(id: UUID(), name: "Sara\u{2019}s MacBook Air", platform: "macos", publicKey: Data(),
                                                         askedAt: .now, answer: "", bind: Data())
    private static let added = KeyDevice(id: UUID(), name: "Sara\u{2019}s MacBook Air", platform: "macos", how: .added, backedUp: false,
                                         addedAt: .now.addingTimeInterval(-6 * 86400), seenAt: .now, removing: false)
    private static let stale = KeyDevice(id: UUID(), name: "iPhone", platform: "ios", how: .keychain, backedUp: true,
                                         addedAt: .now.addingTimeInterval(-200 * 86400), seenAt: .now.addingTimeInterval(-44 * 86400), removing: false)

    var body: some View {
        Group {
            if ready { screen } else { Color.clear }
        }
        .task {
            let user = UUID()
            let waits = name == "new-device"
            await crypto.attach(account: user, server: Server(key: waits ? try? StoredKey.generate().serverRow(user: user) : nil))
            crypto.welcomeShown()
            switch name {
            case "key-kept-unconfirmed": devices.setForTesting([Self.stale])
            case "key-kept-only": devices.setForTesting([])
            default: devices.setForTesting([Self.added, Self.stale])
            }
            ready = true
        }
    }

    @ViewBuilder private var screen: some View {
        switch name {
        case "new-device":
            KeyGateView(crypto: crypto, backend: Backend(),
                        session: NewDeviceSession(crypto: crypto, server: nil,
                                                  preview: .showing(qr: E2EE.addDeviceQR(secret: Data((0x80 ..< 0x90).map { UInt8($0) })), code: "J699-754N-JTBS")))
        case let state where state.hasPrefix("key-kept"):
            NavigationStack {
                Form { PrivacySecuritySection(crypto: crypto, devices: devices) }
                    .formStyle(.grouped)
                    .navigationTitle(PrivacyCopy.title)
                    #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                    #endif
            }
        case "device-added-notice":
            let text = AccountNotice(id: 1, kind: .deviceAdded, created_at: .now).text()
            Color.secondary.opacity(0.15).ignoresSafeArea()
                .alert(text.title, isPresented: $notice) { Button("OK", role: .cancel) {} } message: { Text(text.message) }
        default:
            Color.secondary.opacity(0.15).ignoresSafeArea()
                .sheet(isPresented: .constant(true)) { sheet }
        }
    }

    private var sheet: AddDeviceSheet {
        switch name {
        case "add-device-type": AddDeviceSheet(crypto: crypto, server: nil, typing: true, camera: .none)
        case "add-device-confirm": AddDeviceSheet(crypto: crypto, server: nil, initial: .confirm(Self.mac))
        case "add-device-done": AddDeviceSheet(crypto: crypto, server: nil, initial: .done(Self.mac))
        default: AddDeviceSheet(crypto: crypto, server: nil)
        }
    }
}
