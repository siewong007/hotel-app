//! `RoomService` + `RoomTypeService` gRPC adapters.
//!
//! Every method is a thin translator: protobuf request → the same domain
//! inputs the REST handlers build → the same service function the REST
//! wrappers call → protobuf response. Route-level REST guards are repeated
//! here verbatim (`require_permission_helper`/`require_any_permission_helper`
//! with the same permission strings); service-level guards are preserved by
//! passing the reconstructed `HeaderMap` into the service functions.

use axum::Json;
use axum::extract::{Path, Query, State};
use tonic::{Request, Response, Status};

use crate::core::db::DbPool;
use crate::core::middleware::{check_any_permission, check_permission};
use crate::models::{
    BookingWithDetails, RoomCreateInput, RoomEventInput, RoomStatusUpdateInput,
    RoomTypeCreateInput, RoomTypeUpdateInput, RoomUpdateInput, SearchQuery,
};
use crate::modules::rooms::{models as rm, queries as rq, service as room_service};

use super::auth::authenticate;
use super::convert as c;
use super::error::to_status;
use super::idempotency::IdempotencyCache;
use super::pb::hotel::rooms::v1 as pb;
use super::pb::hotel::rooms::v1::room_service_server::RoomService;
use super::pb::hotel::rooms::v1::room_type_service_server::RoomTypeService;

const ROOM_OPERATIONS_READ: &[&str] = &["bookings:read", "housekeeping:read"];

// ── Enum/string mappings (stored vocabularies stay strings internally) ──

pub(crate) fn status_enum(s: &str) -> pb::RoomStatus {
    match s {
        "available" | "clean" => pb::RoomStatus::Available,
        "occupied" => pb::RoomStatus::Occupied,
        "maintenance" => pb::RoomStatus::Maintenance,
        "reserved" => pb::RoomStatus::Reserved,
        "reserved_dirty" => pb::RoomStatus::ReservedDirty,
        "dirty" => pb::RoomStatus::Dirty,
        "cleaning" => pb::RoomStatus::Cleaning,
        "out_of_order" => pb::RoomStatus::OutOfOrder,
        _ => pb::RoomStatus::Unspecified,
    }
}

fn status_str(s: pb::RoomStatus) -> &'static str {
    match s {
        pb::RoomStatus::Available => "available",
        pb::RoomStatus::Occupied => "occupied",
        pb::RoomStatus::Maintenance => "maintenance",
        pb::RoomStatus::Reserved => "reserved",
        pb::RoomStatus::ReservedDirty => "reserved_dirty",
        pb::RoomStatus::Dirty => "dirty",
        pb::RoomStatus::Cleaning => "cleaning",
        // Write-only alias; the service maps it to "available" exactly like REST.
        pb::RoomStatus::Clean => "clean",
        // Stored-only status (DB triggers set it; the REST update input
        // rejects it) — must round-trip on reads.
        pb::RoomStatus::OutOfOrder => "out_of_order",
        pb::RoomStatus::Unspecified => "",
    }
}

// ── Model → proto converters ───────────────────────────────────────────

fn room_pb(r: &rm::Room, cur: &str) -> pb::Room {
    pb::Room {
        name: c::room_name(r.id),
        room_number: r.room_number.clone(),
        room_type: r.room_type.clone(),
        room_type_code: String::new(),
        price_per_night: Some(c::money(&r.price_per_night, cur)),
        available: r.available,
        status: r
            .status
            .as_deref()
            .map(status_enum)
            .unwrap_or_default()
            .into(),
        description: r.description.clone().unwrap_or_default(),
        max_occupancy: r.max_occupancy,
        notes: r.notes.clone().unwrap_or_default(),
        is_smoking: r.is_smoking,
        created_at: Some(c::ts(&r.created_at)),
        updated_at: Some(c::ts(&r.updated_at)),
        average_rating: None,
        review_count: None,
        reserved_start_date: None,
        reserved_end_date: None,
        maintenance_start_date: None,
        maintenance_end_date: None,
        cleaning_start_date: None,
        cleaning_end_date: None,
        floor: None,
        building: String::new(),
        is_accessible: None,
        room_type_link: String::new(),
        custom_price: None,
    }
}

fn room_with_rating_pb(r: &rm::RoomWithRating, cur: &str) -> pb::Room {
    pb::Room {
        room_type_code: r.room_type_code.clone().unwrap_or_default(),
        average_rating: r
            .average_rating
            .map(|d| c::decimal(&rust_decimal::Decimal::try_from(d).unwrap_or_default())),
        review_count: r.review_count,
        reserved_start_date: c::opt_ts(&r.reserved_start_date),
        reserved_end_date: c::opt_ts(&r.reserved_end_date),
        maintenance_start_date: c::opt_ts(&r.maintenance_start_date),
        maintenance_end_date: c::opt_ts(&r.maintenance_end_date),
        cleaning_start_date: c::opt_ts(&r.cleaning_start_date),
        cleaning_end_date: c::opt_ts(&r.cleaning_end_date),
        ..room_pb(
            &rm::Room {
                id: r.id,
                room_number: r.room_number.clone(),
                room_type: r.room_type.clone(),
                price_per_night: r.price_per_night,
                available: r.available,
                status: r.status.clone(),
                description: r.description.clone(),
                max_occupancy: r.max_occupancy,
                created_at: r.created_at,
                updated_at: r.updated_at,
                notes: r.notes.clone(),
                is_smoking: r.is_smoking,
            },
            cur,
        )
    }
}

fn room_type_pb(t: &rm::RoomType, cur: &str) -> pb::RoomType {
    pb::RoomType {
        name: c::room_type_name(t.id),
        display_name: t.name.clone(),
        code: t.code.clone(),
        description: t.description.clone().unwrap_or_default(),
        base_price: Some(c::money(&t.base_price, cur)),
        weekday_rate: c::opt_money(t.weekday_rate.as_ref(), cur),
        weekend_rate: c::opt_money(t.weekend_rate.as_ref(), cur),
        max_occupancy: t.max_occupancy,
        bed_type: t.bed_type.clone().unwrap_or_default(),
        bed_count: t.bed_count,
        allows_extra_bed: t.allows_extra_bed,
        max_extra_beds: t.max_extra_beds,
        extra_bed_charge: Some(c::money(&t.extra_bed_charge, cur)),
        is_active: t.is_active,
        sort_order: t.sort_order,
        images: t.images.clone(),
        created_at: Some(c::ts(&t.created_at)),
        updated_at: Some(c::ts(&t.updated_at)),
    }
}

fn event_pb(e: &rm::RoomEvent) -> pb::RoomEvent {
    pb::RoomEvent {
        name: format!("rooms/{}/events/{}", e.room_id, e.id),
        room: c::room_name(e.room_id),
        event_type: e.event_type.clone(),
        status: e.status.clone().unwrap_or_default(),
        priority: e.priority.clone().unwrap_or_default(),
        notes: e.notes.clone().unwrap_or_default(),
        scheduled_date: c::opt_ts(&e.scheduled_date),
        created_by: e.created_by.map(c::user_name).unwrap_or_default(),
        created_at: Some(c::ts(&e.created_at)),
        updated_at: c::opt_ts(&e.updated_at),
    }
}

fn booking_summary_pb(b: &BookingWithDetails, cur: &str) -> pb::RoomBookingSummary {
    pb::RoomBookingSummary {
        name: c::booking_name(b.id),
        booking_number: b.booking_number.clone(),
        guest: c::guest_name(b.guest_id),
        guest_name: b.guest_name.clone(),
        room: c::room_name(b.room_id),
        check_in_date: Some(c::date(&b.check_in_date)),
        check_out_date: Some(c::date(&b.check_out_date)),
        status: b.status.clone(),
        adults: b.adults,
        children: b.children,
        room_rate: Some(c::money(&b.room_rate, cur)),
        total_amount: Some(c::money(&b.total_amount, cur)),
        payment_status: b.payment_status.clone().unwrap_or_default(),
    }
}

fn occupancy_pb(o: &rm::RoomCurrentOccupancy) -> pb::RoomOccupancy {
    pb::RoomOccupancy {
        room: c::room_name(o.room_id),
        room_number: o.room_number.clone(),
        room_type: o.room_type_id.map(c::room_type_name).unwrap_or_default(),
        room_type_name: o.room_type_name.clone().unwrap_or_default(),
        max_occupancy: o.max_occupancy,
        room_status: o
            .room_status
            .as_deref()
            .map(status_enum)
            .unwrap_or_default()
            .into(),
        current_adults: o.current_adults,
        current_children: o.current_children,
        current_infants: o.current_infants,
        current_total_guests: o.current_total_guests,
        occupancy_percentage: c::opt_decimal(o.occupancy_percentage.as_ref()),
        current_booking: o
            .current_booking_id
            .map(c::booking_name)
            .unwrap_or_default(),
        current_booking_number: o.current_booking_number.clone().unwrap_or_default(),
        current_guest: o.current_guest_id.map(c::guest_name).unwrap_or_default(),
        check_in_date: c::opt_date(&o.check_in_date),
        check_out_date: c::opt_date(&o.check_out_date),
        is_occupied: o.is_occupied,
    }
}

// ── Service implementation ─────────────────────────────────────────────

#[derive(Clone)]
pub struct RoomGrpc {
    pool: DbPool,
    idem: std::sync::Arc<IdempotencyCache>,
}

impl RoomGrpc {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            idem: std::sync::Arc::new(IdempotencyCache::default()),
        }
    }

    /// Property currency for `Money` outputs — read per-RPC via the same
    /// settings accessor booking_channels uses.
    async fn currency(&self) -> Result<String, Status> {
        crate::modules::settings::service::get_setting_value(&self.pool, "currency")
            .await
            .map_err(to_status)
    }
}

#[tonic::async_trait]
impl RoomService for RoomGrpc {
    async fn list_rooms(
        &self,
        request: Request<pb::ListRoomsRequest>,
    ) -> Result<Response<pb::ListRoomsResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "rooms:read")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        let currency = self.currency().await?;
        let rooms = room_service::get_rooms_handler(State(self.pool.clone()))
            .await
            .map_err(to_status)?
            .0;
        let (page, next) = c::paginate(&rooms, req.page_size, &req.page_token);
        Ok(Response::new(pb::ListRoomsResponse {
            total_size: rooms.len() as i64,
            rooms: page
                .iter()
                .map(|r| room_with_rating_pb(r, &currency))
                .collect(),
            next_page_token: next,
        }))
    }

    async fn search_rooms(
        &self,
        request: Request<pb::SearchRoomsRequest>,
    ) -> Result<Response<pb::SearchRoomsResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "rooms:read")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        let query = SearchQuery {
            room_type: (!req.room_type.is_empty()).then_some(req.room_type),
            max_price: c::money_to_f64(req.max_price.as_ref()),
            check_in_date: c::date_to_ymd(req.check_in_date.as_ref())?,
            check_out_date: c::date_to_ymd(req.check_out_date.as_ref())?,
            exclude_booking_id: c::parse_name(&req.exclude_booking, "bookings")?,
        };
        let currency = self.currency().await?;
        let rooms = room_service::search_rooms_handler(State(self.pool.clone()), Query(query))
            .await
            .map_err(to_status)?
            .0;
        let (page, next) = c::paginate(&rooms, req.page_size, &req.page_token);
        Ok(Response::new(pb::SearchRoomsResponse {
            total_size: rooms.len() as i64,
            rooms: page
                .iter()
                .map(|r| room_with_rating_pb(r, &currency))
                .collect(),
            next_page_token: next,
        }))
    }

    async fn get_room(
        &self,
        request: Request<pb::GetRoomRequest>,
    ) -> Result<Response<pb::GetRoomResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "rooms:read")
            .await
            .map_err(to_status)?;
        let id = c::require_name(&request.into_inner().name, "rooms")?;
        let currency = self.currency().await?;
        let room = rq::fetch_room_by_id(&self.pool, id)
            .await
            .map_err(to_status)?;
        Ok(Response::new(pb::GetRoomResponse {
            room: Some(room_pb(&room, &currency)),
        }))
    }

    async fn create_room(
        &self,
        request: Request<pb::CreateRoomRequest>,
    ) -> Result<Response<pb::CreateRoomResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "rooms:write")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("CreateRoom", &req.request_id, || async {
                let r = req.room.clone().unwrap_or_default();
                let price = c::money_to_f64(r.price_per_night.as_ref())
                    .ok_or_else(|| Status::invalid_argument("room.price_per_night is required"))?;
                // Compute before the struct literal — r.status() borrows all
                // of r and can't run after fields move.
                let status = (r.status() != pb::RoomStatus::Unspecified)
                    .then(|| status_str(r.status()).to_string());
                let input = RoomCreateInput {
                    room_number: r.room_number,
                    room_type: r.room_type,
                    room_type_id: c::parse_name(&r.room_type_link, "roomTypes")?,
                    price_per_night: price,
                    custom_price: c::money_to_f64(r.custom_price.as_ref()),
                    description: (!r.description.is_empty()).then_some(r.description),
                    max_occupancy: r.max_occupancy,
                    floor: r.floor,
                    building: (!r.building.is_empty()).then_some(r.building),
                    is_accessible: r.is_accessible,
                    is_smoking: r.is_smoking,
                    status,
                };
                let room = room_service::create_room_handler(
                    State(self.pool.clone()),
                    auth.user_id,
                    Json(input),
                )
                .await
                .map_err(to_status)?
                .0;
                let currency = self.currency().await?;
                Ok(Response::new(pb::CreateRoomResponse {
                    room: Some(room_pb(&room, &currency)),
                }))
            })
            .await
    }

    async fn update_room(
        &self,
        request: Request<pb::UpdateRoomRequest>,
    ) -> Result<Response<pb::UpdateRoomResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "rooms:update")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("UpdateRoom", &req.request_id, || async {
                let r = req.room.clone().unwrap_or_default();
                let room_id = c::require_name(&r.name, "rooms")?;
                let mut input = RoomUpdateInput {
                    room_number: None,
                    room_type: None,
                    price_per_night: None,
                    available: None,
                    description: None,
                    max_occupancy: None,
                    notes: None,
                    is_smoking: None,
                };
                for path in &req
                    .update_mask
                    .as_ref()
                    .map(|m| m.paths.clone())
                    .unwrap_or_default()
                {
                    match path.as_str() {
                        "room_number" => input.room_number = Some(r.room_number.clone()),
                        "room_type" => input.room_type = Some(r.room_type.clone()),
                        "price_per_night" => {
                            input.price_per_night = c::money_to_f64(r.price_per_night.as_ref())
                        }
                        "available" => input.available = Some(r.available),
                        "description" => input.description = Some(r.description.clone()),
                        "max_occupancy" => input.max_occupancy = Some(r.max_occupancy),
                        "notes" => input.notes = Some(r.notes.clone()),
                        "is_smoking" => input.is_smoking = r.is_smoking,
                        other => {
                            return Err(Status::invalid_argument(format!(
                                "update_mask contains unsupported field '{other}'"
                            )));
                        }
                    }
                }
                let room = room_service::update_room_handler(
                    State(self.pool.clone()),
                    auth.user_id,
                    Path(room_id),
                    Json(input),
                )
                .await
                .map_err(to_status)?
                .0;
                let currency = self.currency().await?;
                Ok(Response::new(pb::UpdateRoomResponse {
                    room: Some(room_pb(&room, &currency)),
                }))
            })
            .await
    }

    async fn delete_room(
        &self,
        request: Request<pb::DeleteRoomRequest>,
    ) -> Result<Response<pb::DeleteRoomResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "rooms:write")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("DeleteRoom", &req.request_id, || async {
                let room_id = c::require_name(&req.name, "rooms")?;
                let _ = room_service::delete_room_handler(
                    State(self.pool.clone()),
                    auth.user_id,
                    Path(room_id),
                )
                .await
                .map_err(to_status)?;
                Ok(Response::new(pb::DeleteRoomResponse {}))
            })
            .await
    }

    async fn update_room_status(
        &self,
        request: Request<pb::UpdateRoomStatusRequest>,
    ) -> Result<Response<pb::UpdateRoomStatusResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        self.idem
            .run("UpdateRoomStatus", &req.request_id, || async {
                let status = status_str(req.status());
                if status.is_empty() {
                    return Err(Status::invalid_argument("status is required"));
                }
                let input = RoomStatusUpdateInput {
                    status: status.to_string(),
                    reason: (!req.reason.is_empty()).then(|| req.reason.clone()),
                    notes: (!req.notes.is_empty()).then(|| req.notes.clone()),
                    reserved_start_date: c::date_to_ymd(req.reserved_start_date.as_ref())?,
                    reserved_end_date: c::date_to_ymd(req.reserved_end_date.as_ref())?,
                    maintenance_start_date: c::date_to_ymd(req.maintenance_start_date.as_ref())?,
                    maintenance_end_date: c::date_to_ymd(req.maintenance_end_date.as_ref())?,
                    cleaning_start_date: c::date_to_ymd(req.cleaning_start_date.as_ref())?,
                    cleaning_end_date: c::date_to_ymd(req.cleaning_end_date.as_ref())?,
                    target_room_id: c::parse_name(&req.target_room, "rooms")?,
                    booking_id: c::parse_name(&req.booking, "bookings")?,
                    guest_id: c::parse_name(&req.guest, "guests")?,
                    reward_id: c::parse_name(&req.reward, "rewards")?,
                };
                let room = room_service::update_room_status_handler(
                    State(self.pool.clone()),
                    Path(c::require_name(&req.name, "rooms")?),
                    auth.headers.clone(),
                    Json(input),
                )
                .await
                .map_err(to_status)?
                .0;
                let currency = self.currency().await?;
                Ok(Response::new(pb::UpdateRoomStatusResponse {
                    room: Some(room_pb(&room, &currency)),
                }))
            })
            .await
    }

    async fn end_room_maintenance(
        &self,
        request: Request<pb::EndRoomMaintenanceRequest>,
    ) -> Result<Response<pb::EndRoomMaintenanceResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        self.idem
            .run("EndRoomMaintenance", &req.request_id, || async {
                let room = room_service::end_maintenance_handler(
                    State(self.pool.clone()),
                    Path(c::require_name(&req.name, "rooms")?),
                    auth.headers.clone(),
                )
                .await
                .map_err(to_status)?
                .0;
                let currency = self.currency().await?;
                Ok(Response::new(pb::EndRoomMaintenanceResponse {
                    room: Some(room_pb(&room, &currency)),
                }))
            })
            .await
    }

    async fn end_room_cleaning(
        &self,
        request: Request<pb::EndRoomCleaningRequest>,
    ) -> Result<Response<pb::EndRoomCleaningResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        self.idem
            .run("EndRoomCleaning", &req.request_id, || async {
                let room_id = c::require_name(&req.name, "rooms")?;
                // Service returns a JSON envelope — audit + transition side
                // effects are inside, so unwrap the envelope here.
                let v = room_service::end_cleaning_handler(
                    State(self.pool.clone()),
                    Path(room_id),
                    auth.headers.clone(),
                )
                .await
                .map_err(to_status)?
                .0;
                let currency = self.currency().await?;
                let room = rq::fetch_room_by_id(&self.pool, room_id)
                    .await
                    .map_err(to_status)?;
                Ok(Response::new(pb::EndRoomCleaningResponse {
                    room: Some(room_pb(&room, &currency)),
                    previous_status: status_enum(
                        v.get("previous_status")
                            .and_then(|s| s.as_str())
                            .unwrap_or(""),
                    )
                    .into(),
                    new_status: status_enum(
                        v.get("new_status").and_then(|s| s.as_str()).unwrap_or(""),
                    )
                    .into(),
                    message: v
                        .get("message")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                }))
            })
            .await
    }

    async fn sync_room_statuses(
        &self,
        request: Request<pb::SyncRoomStatusesRequest>,
    ) -> Result<Response<pb::SyncRoomStatusesResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        self.idem
            .run("SyncRoomStatuses", &req.request_id, || async {
                let v = room_service::sync_room_statuses_handler(
                    State(self.pool.clone()),
                    auth.headers.clone(),
                )
                .await
                .map_err(to_status)?
                .0;
                let changes = v
                    .get("changes")
                    .and_then(|c| c.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .map(|c| pb::RoomStatusSyncChange {
                        room: c::room_name(
                            c.get("room_id")
                                .and_then(|i| i.as_i64())
                                .unwrap_or_default(),
                        ),
                        room_number: c
                            .get("room_number")
                            .and_then(|s| s.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        old_status: status_enum(
                            c.get("old_status").and_then(|s| s.as_str()).unwrap_or(""),
                        )
                        .into(),
                        new_status: status_enum(
                            c.get("new_status").and_then(|s| s.as_str()).unwrap_or(""),
                        )
                        .into(),
                    })
                    .collect();
                Ok(Response::new(pb::SyncRoomStatusesResponse {
                    synced_count: v
                        .get("synced_count")
                        .and_then(|n| n.as_i64())
                        .unwrap_or_default(),
                    changes,
                    message: v
                        .get("message")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                }))
            })
            .await
    }

    async fn get_room_detailed_status(
        &self,
        request: Request<pb::GetRoomDetailedStatusRequest>,
    ) -> Result<Response<pb::GetRoomDetailedStatusResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        let d = room_service::get_room_detailed_status_handler(
            State(self.pool.clone()),
            Path(c::require_name(&req.name, "rooms")?),
            auth.headers.clone(),
        )
        .await
        .map_err(to_status)?
        .0;
        let currency = self.currency().await?;
        let room = pb::Room {
            name: c::room_name(d.id),
            room_number: d.room_number.clone(),
            room_type: d.room_type.clone(),
            status: status_enum(&d.status).into(),
            available: d.available,
            reserved_start_date: c::opt_ts(&d.reserved_start_date),
            reserved_end_date: c::opt_ts(&d.reserved_end_date),
            maintenance_start_date: c::opt_ts(&d.maintenance_start_date),
            maintenance_end_date: c::opt_ts(&d.maintenance_end_date),
            cleaning_start_date: c::opt_ts(&d.cleaning_start_date),
            cleaning_end_date: c::opt_ts(&d.cleaning_end_date),
            ..Default::default()
        };
        Ok(Response::new(pb::GetRoomDetailedStatusResponse {
            detailed_status: Some(pb::RoomDetailedStatus {
                room: Some(room),
                current_booking: d
                    .current_booking
                    .as_ref()
                    .map(|b| booking_summary_pb(b, &currency)),
                next_booking: d
                    .next_booking
                    .as_ref()
                    .map(|b| booking_summary_pb(b, &currency)),
                recent_events: d.recent_events.iter().map(event_pb).collect(),
                maintenance_notes: d.maintenance_notes.clone().unwrap_or_default(),
                last_maintenance_date: c::opt_ts(&d.last_maintenance_date),
                next_maintenance_date: c::opt_ts(&d.next_maintenance_date),
                reserved_start_date: c::opt_ts(&d.reserved_start_date),
                reserved_end_date: c::opt_ts(&d.reserved_end_date),
                maintenance_start_date: c::opt_ts(&d.maintenance_start_date),
                maintenance_end_date: c::opt_ts(&d.maintenance_end_date),
                cleaning_start_date: c::opt_ts(&d.cleaning_start_date),
                cleaning_end_date: c::opt_ts(&d.cleaning_end_date),
                target_room: d.target_room_id.map(c::room_name).unwrap_or_default(),
                status_notes: d.status_notes.clone().unwrap_or_default(),
            }),
        }))
    }

    async fn list_room_status_history(
        &self,
        request: Request<pb::ListRoomStatusHistoryRequest>,
    ) -> Result<Response<pb::ListRoomStatusHistoryResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_any_permission(&self.pool, auth.user_id, ROOM_OPERATIONS_READ)
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        let room_id = c::require_name(&req.name, "rooms")?;
        // Same read path as the service fn: a missing room_history relation
        // is an empty list, not an error.
        let rows = match rq::fetch_room_history(&self.pool, room_id).await {
            Ok(rows) => rows,
            Err(crate::core::error::ApiError::Database(msg))
                if msg.contains("relation") && msg.contains("does not exist") =>
            {
                vec![]
            }
            Err(e) => return Err(to_status(e)),
        };
        let changes: Vec<pb::RoomStatusChange> = rows
            .iter()
            .map(|r| pb::RoomStatusChange {
                name: format!("roomStatusChanges/{}", r.id),
                room: c::room_name(r.room_id),
                from_status: r
                    .from_status
                    .as_deref()
                    .map(status_enum)
                    .unwrap_or_default()
                    .into(),
                to_status: status_enum(&r.to_status).into(),
                start_date: c::opt_ts(&r.start_date),
                end_date: c::opt_ts(&r.end_date),
                changed_by: r.changed_by.map(c::user_name).unwrap_or_default(),
                changed_by_name: r.changed_by_name.clone().unwrap_or_default(),
                created_at: Some(c::ts(&r.created_at)),
                notes: r.notes.clone().unwrap_or_default(),
                is_auto_generated: r.is_auto_generated,
            })
            .collect();
        let (page, next) = c::paginate(&changes, req.page_size, &req.page_token);
        Ok(Response::new(pb::ListRoomStatusHistoryResponse {
            total_size: changes.len() as i64,
            changes: page,
            next_page_token: next,
        }))
    }

    async fn create_room_event(
        &self,
        request: Request<pb::CreateRoomEventRequest>,
    ) -> Result<Response<pb::CreateRoomEventResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        self.idem
            .run("CreateRoomEvent", &req.request_id, || async {
                let e = req.event.clone().unwrap_or_default();
                if e.event_type.is_empty() {
                    return Err(Status::invalid_argument("event.event_type is required"));
                }
                let input = RoomEventInput {
                    event_type: e.event_type,
                    notes: (!e.notes.is_empty()).then(|| e.notes.clone()),
                    status: e.status,
                    scheduled_date: c::ts_to_rfc3339(e.scheduled_date.as_ref())?,
                    priority: (!e.priority.is_empty()).then(|| e.priority.clone()),
                };
                let event = room_service::create_room_event_handler(
                    State(self.pool.clone()),
                    Path(c::require_name(&req.parent, "rooms")?),
                    auth.headers.clone(),
                    Json(input),
                )
                .await
                .map_err(to_status)?
                .0;
                Ok(Response::new(pb::CreateRoomEventResponse {
                    event: Some(event_pb(&event)),
                }))
            })
            .await
    }

    async fn list_room_reviews(
        &self,
        request: Request<pb::ListRoomReviewsRequest>,
    ) -> Result<Response<pb::ListRoomReviewsResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "rooms:read")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        let reviews = room_service::get_room_reviews_handler(
            State(self.pool.clone()),
            Path(req.room_type_name.clone()),
        )
        .await
        .map_err(to_status)?
        .0;
        let all: Vec<pb::RoomReview> = reviews
            .iter()
            .map(|r| pb::RoomReview {
                name: c::review_name(r.id),
                guest: c::guest_name(r.guest_id),
                guest_name: r.guest_name.clone(),
                room_type: r.room_type_id.map(c::room_type_name).unwrap_or_default(),
                overall_rating: c::opt_decimal(r.overall_rating.as_ref()),
                cleanliness_rating: c::opt_decimal(r.cleanliness_rating.as_ref()),
                staff_rating: c::opt_decimal(r.staff_rating.as_ref()),
                facilities_rating: c::opt_decimal(r.facilities_rating.as_ref()),
                value_rating: c::opt_decimal(r.value_rating.as_ref()),
                location_rating: c::opt_decimal(r.location_rating.as_ref()),
                title: r.title.clone().unwrap_or_default(),
                review_text: r.review_text.clone().unwrap_or_default(),
                pros: r.pros.clone().unwrap_or_default(),
                cons: r.cons.clone().unwrap_or_default(),
                recommend: r.recommend,
                stay_type: r.stay_type.clone().unwrap_or_default(),
                is_verified: r.is_verified,
                helpful_count: r.helpful_count,
                created_at: Some(c::ts(&r.created_at)),
            })
            .collect();
        let (page, next) = c::paginate(&all, req.page_size, &req.page_token);
        Ok(Response::new(pb::ListRoomReviewsResponse {
            total_size: all.len() as i64,
            reviews: page,
            next_page_token: next,
        }))
    }

    async fn execute_room_change(
        &self,
        request: Request<pb::ExecuteRoomChangeRequest>,
    ) -> Result<Response<pb::ExecuteRoomChangeResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        self.idem
            .run("ExecuteRoomChange", &req.request_id, || async {
                let target = c::require_name(&req.target_room, "rooms")?;
                let mut body = serde_json::json!({ "target_room_id": target });
                if !req.reason.is_empty() {
                    body["reason"] = serde_json::Value::String(req.reason.clone());
                }
                if let Some(m) = &req.room_rate_override {
                    body["room_rate_override"] = serde_json::json!(m.amount_minor as f64 / 100.0);
                }
                let v = room_service::execute_room_change_handler(
                    State(self.pool.clone()),
                    Path(c::require_name(&req.name, "rooms")?),
                    auth.headers.clone(),
                    Json(body),
                )
                .await
                .map_err(to_status)?
                .0;
                Ok(Response::new(pb::ExecuteRoomChangeResponse {
                    from_room: c::room_name(
                        v.get("from_room_id")
                            .and_then(|i| i.as_i64())
                            .unwrap_or_default(),
                    ),
                    from_room_number: v
                        .get("from_room_number")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    to_room: c::room_name(
                        v.get("to_room_id")
                            .and_then(|i| i.as_i64())
                            .unwrap_or_default(),
                    ),
                    to_room_number: v
                        .get("to_room_number")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    booking: c::booking_name(
                        v.get("booking_id")
                            .and_then(|i| i.as_i64())
                            .unwrap_or_default(),
                    ),
                    reason: v
                        .get("reason")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    message: v
                        .get("message")
                        .and_then(|s| s.as_str())
                        .unwrap_or_default()
                        .to_string(),
                }))
            })
            .await
    }

    async fn list_room_change_history(
        &self,
        request: Request<pb::ListRoomChangeHistoryRequest>,
    ) -> Result<Response<pb::ListRoomChangeHistoryResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "bookings:read")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        // REST `limit` defaults to 50; page_size<=0 keeps that default.
        let limit = if req.page_size > 0 {
            req.page_size as i64
        } else {
            50
        };
        let rows = rq::fetch_room_change_history(
            &self.pool,
            c::parse_name(&req.booking, "bookings")?,
            c::parse_name(&req.guest, "guests")?,
            c::parse_name(&req.room, "rooms")?,
            limit,
        )
        .await
        .map_err(to_status)?;
        let records: Vec<pb::RoomChangeRecord> = rows
            .iter()
            .map(|r| pb::RoomChangeRecord {
                name: format!("roomChangeRecords/{}", r.id),
                booking: c::booking_name(r.booking_id),
                booking_number: r.booking_number.clone(),
                from_room: c::room_name(r.from_room_id),
                from_room_number: r.from_room_number.clone(),
                from_room_type: r.from_room_type.clone(),
                to_room: c::room_name(r.to_room_id),
                to_room_number: r.to_room_number.clone(),
                to_room_type: r.to_room_type.clone(),
                guest: c::guest_name(r.guest_id),
                guest_name: r.guest_name.clone(),
                reason: r.reason.clone().unwrap_or_default(),
                changed_by: r.changed_by.map(c::user_name).unwrap_or_default(),
                changed_by_name: r.changed_by_name.clone().unwrap_or_default(),
                changed_at: Some(c::ts(&r.changed_at)),
            })
            .collect();
        let next = if records.len() as i64 == limit {
            // The query is limit-based (no offset) — the token carries the
            // next page's start marker but REST has no offset either, so the
            // token simply echoes the page count for forward-only paging.
            String::new()
        } else {
            String::new()
        };
        Ok(Response::new(pb::ListRoomChangeHistoryResponse {
            total_size: records.len() as i64,
            records,
            next_page_token: next,
        }))
    }

    async fn list_room_occupancy(
        &self,
        request: Request<pb::ListRoomOccupancyRequest>,
    ) -> Result<Response<pb::ListRoomOccupancyResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        let rows = room_service::get_all_room_occupancy_handler(
            State(self.pool.clone()),
            auth.headers.clone(),
        )
        .await
        .map_err(to_status)?
        .0;
        let all: Vec<pb::RoomOccupancy> = rows.iter().map(occupancy_pb).collect();
        let (page, next) = c::paginate(&all, req.page_size, &req.page_token);
        Ok(Response::new(pb::ListRoomOccupancyResponse {
            total_size: all.len() as i64,
            occupancy: page,
            next_page_token: next,
        }))
    }

    async fn get_occupancy_summary(
        &self,
        request: Request<pb::GetOccupancySummaryRequest>,
    ) -> Result<Response<pb::GetOccupancySummaryResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let s = room_service::get_hotel_occupancy_summary_handler(
            State(self.pool.clone()),
            auth.headers.clone(),
        )
        .await
        .map_err(to_status)?
        .0;
        Ok(Response::new(pb::GetOccupancySummaryResponse {
            summary: Some(pb::OccupancySummary {
                total_rooms: s.total_rooms,
                occupied_rooms: s.occupied_rooms,
                available_rooms: s.available_rooms,
                occupancy_rate: c::opt_decimal(s.occupancy_rate.as_ref()),
                total_adults: s.total_adults,
                total_children: s.total_children,
                total_infants: s.total_infants,
                total_guests: s.total_guests,
                total_capacity: s.total_capacity,
                guest_occupancy_rate: c::opt_decimal(s.guest_occupancy_rate.as_ref()),
            }),
        }))
    }

    async fn list_room_type_occupancy(
        &self,
        request: Request<pb::ListRoomTypeOccupancyRequest>,
    ) -> Result<Response<pb::ListRoomTypeOccupancyResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let rows = room_service::get_occupancy_by_room_type_handler(
            State(self.pool.clone()),
            auth.headers.clone(),
        )
        .await
        .map_err(to_status)?
        .0;
        Ok(Response::new(pb::ListRoomTypeOccupancyResponse {
            occupancy: rows
                .iter()
                .map(|o| pb::RoomTypeOccupancy {
                    room_type: o.room_type_id.map(c::room_type_name).unwrap_or_default(),
                    room_type_name: o.room_type_name.clone().unwrap_or_default(),
                    capacity_per_room: o.capacity_per_room,
                    total_rooms: o.total_rooms,
                    occupied_rooms: o.occupied_rooms,
                    room_occupancy_rate: c::opt_decimal(o.room_occupancy_rate.as_ref()),
                    total_guests: o.total_guests,
                    total_capacity: o.total_capacity,
                    guest_occupancy_rate: c::opt_decimal(o.guest_occupancy_rate.as_ref()),
                })
                .collect(),
        }))
    }

    async fn list_rooms_with_occupancy(
        &self,
        request: Request<pb::ListRoomsWithOccupancyRequest>,
    ) -> Result<Response<pb::ListRoomsWithOccupancyResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        let rows = room_service::get_rooms_with_occupancy_handler(
            State(self.pool.clone()),
            auth.headers.clone(),
        )
        .await
        .map_err(to_status)?
        .0;
        let currency = self.currency().await?;
        let all: Vec<pb::RoomWithOccupancy> = rows
            .iter()
            .map(|r| pb::RoomWithOccupancy {
                room: Some(room_pb(&r.room, &currency)),
                current_adults: r.current_adults,
                current_children: r.current_children,
                current_infants: r.current_infants,
                current_total_guests: r.current_total_guests,
                is_occupied: r.is_occupied,
                current_booking: r
                    .current_booking_id
                    .map(c::booking_name)
                    .unwrap_or_default(),
                current_guest: r.current_guest_id.map(c::guest_name).unwrap_or_default(),
            })
            .collect();
        let (page, next) = c::paginate(&all, req.page_size, &req.page_token);
        Ok(Response::new(pb::ListRoomsWithOccupancyResponse {
            total_size: all.len() as i64,
            rooms: page,
            next_page_token: next,
        }))
    }

    async fn get_room_occupancy(
        &self,
        request: Request<pb::GetRoomOccupancyRequest>,
    ) -> Result<Response<pb::GetRoomOccupancyResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        let o = room_service::get_room_occupancy_handler(
            State(self.pool.clone()),
            Path(c::require_name(&req.name, "rooms")?),
            auth.headers.clone(),
        )
        .await
        .map_err(to_status)?
        .0;
        Ok(Response::new(pb::GetRoomOccupancyResponse {
            occupancy: Some(occupancy_pb(&o)),
        }))
    }
}

// ── RoomTypeService ────────────────────────────────────────────────────

#[derive(Clone)]
pub struct RoomTypeGrpc {
    pool: DbPool,
    idem: std::sync::Arc<IdempotencyCache>,
}

impl RoomTypeGrpc {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            idem: std::sync::Arc::new(IdempotencyCache::default()),
        }
    }

    async fn currency(&self) -> Result<String, Status> {
        crate::modules::settings::service::get_setting_value(&self.pool, "currency")
            .await
            .map_err(to_status)
    }
}

#[tonic::async_trait]
impl RoomTypeService for RoomTypeGrpc {
    async fn list_room_types(
        &self,
        request: Request<pb::ListRoomTypesRequest>,
    ) -> Result<Response<pb::ListRoomTypesResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        let types = if req.include_inactive {
            room_service::get_all_room_types_handler(State(self.pool.clone()), auth.headers.clone())
                .await
                .map_err(to_status)?
                .0
        } else {
            check_permission(&self.pool, auth.user_id, "rooms:read")
                .await
                .map_err(to_status)?;
            room_service::get_room_types_handler(State(self.pool.clone()))
                .await
                .map_err(to_status)?
                .0
        };
        let currency = self.currency().await?;
        let all: Vec<pb::RoomType> = types.iter().map(|t| room_type_pb(t, &currency)).collect();
        let (page, next) = c::paginate(&all, req.page_size, &req.page_token);
        Ok(Response::new(pb::ListRoomTypesResponse {
            total_size: all.len() as i64,
            room_types: page,
            next_page_token: next,
        }))
    }

    async fn get_room_type(
        &self,
        request: Request<pb::GetRoomTypeRequest>,
    ) -> Result<Response<pb::GetRoomTypeResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let id = c::require_name(&request.into_inner().name, "roomTypes")?;
        let t = room_service::get_room_type_handler(
            State(self.pool.clone()),
            Path(id),
            auth.headers.clone(),
        )
        .await
        .map_err(to_status)?
        .0;
        let currency = self.currency().await?;
        Ok(Response::new(pb::GetRoomTypeResponse {
            room_type: Some(room_type_pb(&t, &currency)),
        }))
    }

    async fn create_room_type(
        &self,
        request: Request<pb::CreateRoomTypeRequest>,
    ) -> Result<Response<pb::CreateRoomTypeResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        self.idem
            .run("CreateRoomType", &req.request_id, || async {
                let t = req.room_type.clone().unwrap_or_default();
                let input = RoomTypeCreateInput {
                    name: t.display_name,
                    code: t.code,
                    description: (!t.description.is_empty()).then_some(t.description),
                    base_price: c::money_to_f64(t.base_price.as_ref()).unwrap_or_default(),
                    weekday_rate: c::money_to_f64(t.weekday_rate.as_ref()),
                    weekend_rate: c::money_to_f64(t.weekend_rate.as_ref()),
                    max_occupancy: (t.max_occupancy != 0).then_some(t.max_occupancy),
                    bed_type: (!t.bed_type.is_empty()).then_some(t.bed_type),
                    bed_count: t.bed_count,
                    allows_extra_bed: (t.allows_extra_bed).then_some(t.allows_extra_bed),
                    max_extra_beds: (t.max_extra_beds != 0).then_some(t.max_extra_beds),
                    extra_bed_charge: c::money_to_f64(t.extra_bed_charge.as_ref()),
                    sort_order: (t.sort_order != 0).then_some(t.sort_order),
                };
                let rt = room_service::create_room_type_handler(
                    State(self.pool.clone()),
                    auth.headers.clone(),
                    Json(input),
                )
                .await
                .map_err(to_status)?
                .0;
                let currency = self.currency().await?;
                Ok(Response::new(pb::CreateRoomTypeResponse {
                    room_type: Some(room_type_pb(&rt, &currency)),
                }))
            })
            .await
    }

    async fn update_room_type(
        &self,
        request: Request<pb::UpdateRoomTypeRequest>,
    ) -> Result<Response<pb::UpdateRoomTypeResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        self.idem
            .run("UpdateRoomType", &req.request_id, || async {
                let t = req.room_type.clone().unwrap_or_default();
                let id = c::require_name(&t.name, "roomTypes")?;
                let mut input = RoomTypeUpdateInput {
                    name: None,
                    code: None,
                    description: None,
                    base_price: None,
                    weekday_rate: None,
                    weekend_rate: None,
                    max_occupancy: None,
                    bed_type: None,
                    bed_count: None,
                    allows_extra_bed: None,
                    max_extra_beds: None,
                    extra_bed_charge: None,
                    is_active: None,
                    sort_order: None,
                    images: None,
                };
                for path in &req
                    .update_mask
                    .as_ref()
                    .map(|m| m.paths.clone())
                    .unwrap_or_default()
                {
                    match path.as_str() {
                        "display_name" | "name" => input.name = Some(t.display_name.clone()),
                        "code" => input.code = Some(t.code.clone()),
                        "description" => input.description = Some(t.description.clone()),
                        "base_price" => input.base_price = c::money_to_f64(t.base_price.as_ref()),
                        "weekday_rate" => {
                            input.weekday_rate = c::money_to_f64(t.weekday_rate.as_ref())
                        }
                        "weekend_rate" => {
                            input.weekend_rate = c::money_to_f64(t.weekend_rate.as_ref())
                        }
                        "max_occupancy" => input.max_occupancy = Some(t.max_occupancy),
                        "bed_type" => input.bed_type = Some(t.bed_type.clone()),
                        "bed_count" => input.bed_count = t.bed_count,
                        "allows_extra_bed" => input.allows_extra_bed = Some(t.allows_extra_bed),
                        "max_extra_beds" => input.max_extra_beds = Some(t.max_extra_beds),
                        "extra_bed_charge" => {
                            input.extra_bed_charge = c::money_to_f64(t.extra_bed_charge.as_ref())
                        }
                        "is_active" => input.is_active = Some(t.is_active),
                        "sort_order" => input.sort_order = Some(t.sort_order),
                        "images" => input.images = Some(t.images.clone()),
                        other => {
                            return Err(Status::invalid_argument(format!(
                                "update_mask contains unsupported field '{other}'"
                            )));
                        }
                    }
                }
                let rt = room_service::update_room_type_handler(
                    State(self.pool.clone()),
                    Path(id),
                    auth.headers.clone(),
                    Json(input),
                )
                .await
                .map_err(to_status)?
                .0;
                let currency = self.currency().await?;
                Ok(Response::new(pb::UpdateRoomTypeResponse {
                    room_type: Some(room_type_pb(&rt, &currency)),
                }))
            })
            .await
    }

    async fn delete_room_type(
        &self,
        request: Request<pb::DeleteRoomTypeRequest>,
    ) -> Result<Response<pb::DeleteRoomTypeResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        self.idem
            .run("DeleteRoomType", &req.request_id, || async {
                let id = c::require_name(&req.name, "roomTypes")?;
                let _ = room_service::delete_room_type_handler(
                    State(self.pool.clone()),
                    Path(id),
                    auth.headers.clone(),
                )
                .await
                .map_err(to_status)?;
                Ok(Response::new(pb::DeleteRoomTypeResponse {}))
            })
            .await
    }
}
