//! Assembles the tonic services into an `axum::Router` merged at the server
//! root — gRPC paths live at `/{package}.{Service}/{Method}` next to the
//! existing `/api/*` REST tree on the same port and process.
//!
//! - Each service is mounted at its canonical `/{NAME}/{*rest}` gRPC path (no
//!   `/api` prefix — that prefix is REST-only), exactly what
//!   `Routes::add_service` does internally. `Routes` itself is NOT used: its
//!   pre-set `unimplemented` fallback would merge into the app router and
//!   swallow every unrouted REST path.
//! - `GrpcWebLayer` wraps each service route individually so every service
//!   speaks native gRPC *and* Connect/gRPC-Web to the browser without an
//!   envoy sidecar. It must NOT wrap the router: `GrpcWebService` answers
//!   HTTP 400 to any non-grpc-web h1 request, and a layered router fallback
//!   would merge that 400 into every unrouted REST path.
//! - `tonic-health` and `tonic-reflection` (v1 + v1alpha) make grpcurl and
//!   Postman work out of the box.

use std::convert::Infallible;

use axum::{Router, http::Request};
use tonic::{
    body::Body as GrpcBody,
    codegen::{Body as HttpBody, Bytes, http::Response},
    server::NamedService,
};
use tower::Service;

use super::guests::GuestGrpc;
use super::pb::hotel::guests::v1::guest_service_server::GuestServiceServer;
use super::pb::hotel::housekeeping::v1::housekeeping_service_server::HousekeepingServiceServer;
use super::pb::hotel::housekeeping::v1::maintenance_service_server::MaintenanceServiceServer;
use super::pb::hotel::rooms::v1::room_service_server::RoomServiceServer;
use super::pb::hotel::rooms::v1::room_type_service_server::RoomTypeServiceServer;
use super::{housekeeping::HousekeepingGrpc, housekeeping::MaintenanceGrpc};
use super::{rooms::RoomGrpc, rooms::RoomTypeGrpc};
use crate::core::db::DbPool;

/// File descriptor set emitted by build.rs — powers server reflection.
const DESCRIPTORS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/hotel_descriptor.bin"));

/// Mounts one tonic service at `/{NAME}/{*rest}` — identical to
/// `Routes::add_service`, plus the per-service `GrpcWebLayer` that translates
/// grpc-web-text/grpc-web-proto to native gRPC (and vice versa). The layer
/// does the axum-Body → tonic-Body coercion itself, so no map_request here.
fn add_grpc_service<S, ResBody>(router: Router, svc: S) -> Router
where
    S: Service<Request<GrpcBody>, Response = Response<ResBody>, Error = Infallible>
        + NamedService
        + Clone
        + Send
        + Sync
        + 'static,
    S::Future: Send + 'static,
    ResBody: HttpBody<Data = Bytes> + Send + 'static,
    ResBody::Error: Into<Box<dyn std::error::Error + Send + Sync>> + std::fmt::Display,
{
    router.route_service(
        &format!("/{}/{{*rest}}", S::NAME),
        tower::ServiceBuilder::new()
            .layer(tonic_web::GrpcWebLayer::new())
            .service(svc),
    )
}

/// Builds the gRPC router merged into the top-level Axum router.
pub fn grpc_router(pool: DbPool) -> Router {
    let (health_reporter, health_service) = tonic_health::server::health_reporter();

    // Mark every domain service SERVING once the runtime is up (the reporter
    // is async; create_router itself is sync, so this is spawned).
    tokio::spawn(async move {
        health_reporter
            .set_serving::<RoomServiceServer<RoomGrpc>>()
            .await;
        health_reporter
            .set_serving::<RoomTypeServiceServer<RoomTypeGrpc>>()
            .await;
        health_reporter
            .set_serving::<HousekeepingServiceServer<HousekeepingGrpc>>()
            .await;
        health_reporter
            .set_serving::<MaintenanceServiceServer<MaintenanceGrpc>>()
            .await;
        health_reporter
            .set_serving::<GuestServiceServer<GuestGrpc>>()
            .await;
    });

    // Reflection v1 (current) + v1alpha (legacy grpcurl/Postman clients).
    let reflection_v1 = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(DESCRIPTORS)
        .build_v1()
        .expect("reflection v1 build failed");
    let reflection_v1alpha = tonic_reflection::server::Builder::configure()
        .register_encoded_file_descriptor_set(DESCRIPTORS)
        .build_v1alpha()
        .expect("reflection v1alpha build failed");

    let router = Router::new();
    let router = add_grpc_service(router, health_service);
    let router = add_grpc_service(router, reflection_v1);
    let router = add_grpc_service(router, reflection_v1alpha);
    let router = add_grpc_service(router, RoomServiceServer::new(RoomGrpc::new(pool.clone())));
    let router = add_grpc_service(
        router,
        RoomTypeServiceServer::new(RoomTypeGrpc::new(pool.clone())),
    );
    let router = add_grpc_service(
        router,
        HousekeepingServiceServer::new(HousekeepingGrpc::new(pool.clone())),
    );
    let router = add_grpc_service(
        router,
        MaintenanceServiceServer::new(MaintenanceGrpc::new(pool.clone())),
    );
    add_grpc_service(router, GuestServiceServer::new(GuestGrpc::new(pool)))
}
