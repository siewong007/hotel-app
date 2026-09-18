//! Code generation for the gRPC contract.
//!
//! The protobuf source of truth is the buf-managed module in ../proto (linted
//! and breaking-checked by CI). This crate compiles the mirrored copy under
//! ./proto — a plain duplicate kept in sync by `make proto-mirror-check` /
//! scripts/check-proto-mirror.sh — because the Docker build context is this
//! directory only and cannot reach ../proto. The google.api/google.type
//! imports resolve against the vendored subset in the same tree, and
//! google.protobuf.* well-known types map to prost-types.
//!
//! Requires `protoc` on PATH (CI installs protobuf-compiler).

use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let proto_root = "proto";

    // Message types imported by the hotel.* services must be compiled too:
    // google.type.Date/Decimal appear as field types, and field_behavior.proto
    // must be present for the descriptor set used by tonic-reflection.
    let protos = [
        "hotel/common/v1/types.proto",
        "hotel/rooms/v1/room.proto",
        "hotel/rooms/v1/room_service.proto",
        "hotel/rooms/v1/room_type_service.proto",
        "hotel/housekeeping/v1/housekeeping.proto",
        "hotel/housekeeping/v1/housekeeping_service.proto",
        "hotel/housekeeping/v1/maintenance.proto",
        "hotel/housekeeping/v1/maintenance_service.proto",
        "hotel/guests/v1/guest.proto",
        "hotel/guests/v1/guest_service.proto",
        "google/type/date.proto",
        "google/type/decimal.proto",
        "google/api/field_behavior.proto",
    ];

    let out_dir = PathBuf::from(std::env::var("OUT_DIR")?);

    tonic_prost_build::configure()
        .build_client(false)
        .build_server(true)
        .build_transport(false)
        .file_descriptor_set_path(out_dir.join("hotel_descriptor.bin"))
        .compile_protos(&protos, &[proto_root])?;

    println!("cargo:rerun-if-changed={proto_root}");
    Ok(())
}
