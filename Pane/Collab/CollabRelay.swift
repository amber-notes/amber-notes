import Foundation
import os

private let log = Logger(subsystem: "dev.emilwagman.pane", category: "collab")

/// Collaboration (prototype): talks to `scripts/collab-relay.ts`, the local stand-in for Supabase.
/// In the product these are PostgREST calls (`rpc`, the tables) and a Realtime private channel
/// `note:<id>` (broadcast for new updates, presence for who's here); the shapes are the same.
@MainActor
final class CollabRelay {
    let base: URL
    let user: UUID

    init(base: URL, user: UUID) {
        self.base = base
        self.user = user
    }

    struct Problem: LocalizedError { let message: String; var errorDescription: String? { message } }

    static func makeUser(base: URL, email: String, name: String) async throws -> UUID {
        var req = URLRequest(url: base.appending(path: "dev/user"))
        req.httpMethod = "POST"
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "name": name])
        let (data, _) = try await URLSession.shared.data(for: req)
        struct R: Decodable { let id: UUID }
        return try JSONDecoder().decode(R.self, from: data).id
    }

    private func request(_ path: String, query: [String: String] = [:], body: Any? = nil) async throws -> Data {
        var comps = URLComponents(url: base.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var req = URLRequest(url: comps.url!)
        req.setValue("Bearer proto.\(user.uuidString.lowercased())", forHTTPHeaderField: "Authorization")
        if let body {
            req.httpMethod = "POST"
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String ?? "HTTP \(http.statusCode)"
            log.error("relay \(path, privacy: .public): \(message, privacy: .public)")
            throw Problem(message: message)
        }
        return data
    }

    func rpc<T: Decodable>(_ name: String, _ args: [Any], as: T.Type = [AnyRow].self) async throws -> T {
        try JSONDecoder.collab.decode(T.self, from: try await request("rpc/\(name)", body: ["args": args]))
    }

    func rpc(_ name: String, _ args: [Any]) async throws { _ = try await request("rpc/\(name)", body: ["args": args]) }

    func get<T: Decodable>(_ path: String, query: [String: String] = [:], as: T.Type) async throws -> T {
        try JSONDecoder.collab.decode(T.self, from: try await request(path, query: query))
    }

    func post<T: Decodable>(_ path: String, _ body: [String: Any], as: T.Type) async throws -> T {
        try JSONDecoder.collab.decode(T.self, from: try await request(path, body: body))
    }

    // MARK: Rows

    struct AnyRow: Decodable {}

    struct Person: Decodable, Sendable {
        let user_id: UUID
        let display_name: String?
        let public_key: String
    }

    struct Member: Decodable, Sendable, Equatable {
        let user_id: UUID
        let role: String
        let display_name: String?
        let public_key: String?
        let accepted: Bool
    }

    struct Membership: Decodable, Sendable {
        let note_id: UUID
        let role: String
        let epoch: Int
        let key_wrap: String
        let wrapped_by: UUID
        let self_wrap: String?
        let invited_by: UUID?
        let accepted_at: String?
        let head_ct: String?
        let owner_id: UUID
    }

    struct Update: Decodable, Sendable {
        let id: Int64
        let note_id: UUID
        let author_id: UUID
        let epoch: Int
        let ct: String
        let client: String?
    }

    struct Snapshot: Decodable, Sendable {
        let note_id: UUID
        let upto: Int64
        let epoch: Int
        let ct: String
    }

    struct Pull: Decodable, Sendable {
        let snapshot: Snapshot?
        let updates: [Update]
    }

    // MARK: Live channel

    enum Event: Sendable {
        case update(Update)
        case presence(user: UUID, ct: String)
        case leave(UUID)
    }

    /// Joins the note's channel; events arrive on the main actor until `close()`.
    final class Channel {
        private let task: URLSessionWebSocketTask
        private var open = true

        init(task: URLSessionWebSocketTask) { self.task = task }

        func send(presence ct: String) {
            guard open, let data = try? JSONSerialization.data(withJSONObject: ["type": "presence", "ct": ct]) else { return }
            task.send(.string(String(decoding: data, as: UTF8.self))) { _ in }
        }

        func close() {
            open = false
            task.cancel(with: .goingAway, reason: nil)
        }
    }

    func join(note: UUID, onEvent: @escaping @MainActor (Event) -> Void) -> Channel {
        var comps = URLComponents(url: base.appending(path: "ws"), resolvingAgainstBaseURL: false)!
        comps.scheme = base.scheme == "https" ? "wss" : "ws"
        comps.queryItems = [URLQueryItem(name: "note", value: note.uuidString.lowercased())]
        var req = URLRequest(url: comps.url!)
        req.setValue("Bearer proto.\(user.uuidString.lowercased())", forHTTPHeaderField: "Authorization")
        let task = URLSession.shared.webSocketTask(with: req)
        task.resume()
        @Sendable func receive() {
            task.receive { result in
                guard case .success(let message) = result else { return }
                if case .string(let s) = message, let event = Self.event(s) {
                    Task { @MainActor in onEvent(event) }
                }
                receive()
            }
        }
        receive()
        return Channel(task: task)
    }

    nonisolated private static func event(_ s: String) -> Event? {
        guard let data = s.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = obj["type"] as? String else { return nil }
        switch type {
        case "update":
            guard let row = obj["row"], let rowData = try? JSONSerialization.data(withJSONObject: row),
                  let u = try? JSONDecoder.collab.decode(Update.self, from: rowData) else { return nil }
            return .update(u)
        case "presence":
            guard let user = (obj["user"] as? String).flatMap(UUID.init(uuidString:)), let ct = obj["ct"] as? String else { return nil }
            return .presence(user: user, ct: ct)
        case "leave":
            return (obj["user"] as? String).flatMap(UUID.init(uuidString:)).map(Event.leave)
        default:
            return nil
        }
    }
}

extension JSONDecoder {
    /// Postgres sends bigints as strings or numbers depending on size; ids here are small.
    nonisolated static var collab: JSONDecoder { JSONDecoder() }
}
