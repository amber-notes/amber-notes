import Foundation
import Supabase

/// Adding a device, on the server (`device_adds`, through its functions only): the new device's
/// request and pickup, and the approving device's find and answer. The server keeps the key only
/// as ciphertext for the new device, and only until that device says it has it.
struct SupabaseAddDevice: AddDeviceServer {
    let client: SupabaseClient

    private func run<T>(_ call: () async throws -> T) async throws -> T {
        do { return try await call() } catch let e as PostgrestError where e.hint == "rate_limited" { throw AddDeviceError.tooMany }
    }

    func request(_ r: AddDeviceRequest) async throws -> Date {
        try await run { try await client.rpc("device_add_request", params: r).execute().value }
    }

    func pickup(id: UUID, pickup: String) async throws -> AddDevicePickup {
        try await run { try await client.rpc("device_add_pickup", params: ["p_id": id.uuidString.lowercased(), "p_pickup": pickup]).execute().value }
    }

    func done(id: UUID, pickup: String) async throws {
        try await client.rpc("device_add_done", params: ["p_id": id.uuidString.lowercased(), "p_pickup": pickup]).execute()
    }

    func find(answer: String) async throws -> AddDeviceFound? {
        let rows: [AddDeviceFound] = try await run { try await client.rpc("device_add_find", params: ["p_answer": answer]).execute().value }
        return rows.first
    }

    func answer(id: UUID, answer: String, sealed: String, device: UUID) async throws -> AddDeviceAnswer {
        try await run {
            try await client.rpc("device_add_answer", params: ["p_id": id.uuidString.lowercased(), "p_answer": answer, "p_sealed": sealed,
                                                               "p_device": device.uuidString.lowercased()]).execute().value
        }
    }
}

/// The devices that hold the key (`key_devices`): read directly, written through its functions.
struct SupabaseKeyDevices: KeyDeviceServer {
    let client: SupabaseClient

    func list() async throws -> [KeyDeviceRow] {
        try await client.from("key_devices").select(KeyDeviceRow.columns).order("added_at", ascending: true).limit(40).execute().value
    }

    func checkIn(device: UUID, platform: String, nameCT: String, how: String, backedUp: Bool, keyID: String, epoch: String, tag: String) async throws {
        struct Params: Encodable {
            var p_device: String; var p_platform: String; var p_name_ct: String; var p_how: String
            var p_backed_up: Bool; var p_key_id: String; var p_epoch: String; var p_tag: String
        }
        try await client.rpc("key_device_check_in", params: Params(p_device: device.uuidString.lowercased(), p_platform: platform, p_name_ct: nameCT,
                                                                   p_how: how, p_backed_up: backedUp, p_key_id: keyID, p_epoch: epoch, p_tag: tag)).execute()
    }

    func remove(device: UUID, removalTag: String) async throws -> Bool {
        try await client.rpc("remove_key_device", params: ["p_device": device.uuidString.lowercased(), "p_removal_tag": removalTag]).execute().value
    }

    func forget(device: UUID) async throws {
        try await client.rpc("forget_key_device", params: ["p_device": device.uuidString.lowercased()]).execute()
    }
}
