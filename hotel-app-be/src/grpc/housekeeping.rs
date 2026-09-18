//! `HousekeepingService` + `MaintenanceService` gRPC adapters.
//!
//! Same adapter discipline as `rooms.rs`: protobuf request → existing domain
//! inputs → the same service functions → protobuf response. The REST route
//! guards are repeated verbatim (`housekeeping:read/create/update`,
//! `maintenance:read/write`, and the assignable-staff any-of set); the
//! service functions take `(pool, user_id, input)` directly.

use tonic::{Request, Response, Status};

use crate::core::db::DbPool;
use crate::core::middleware::{check_any_permission, check_permission};
use crate::modules::housekeeping::{models as hm, service as hk_service};
use crate::modules::maintenance::{models as mm, service as mt_service};

use super::auth::authenticate;
use super::convert as c;
use super::error::to_status;
use super::idempotency::IdempotencyCache;
use super::pb::hotel::housekeeping::v1 as pb;
use super::pb::hotel::housekeeping::v1::housekeeping_service_server::HousekeepingService;
use super::pb::hotel::housekeeping::v1::maintenance_service_server::MaintenanceService;
use super::rooms::status_enum as room_status_enum;

// ── Housekeeping enum ↔ stored-string mappings ─────────────────────────

fn hk_type_str(t: pb::HousekeepingTaskType) -> Option<String> {
    match t {
        pb::HousekeepingTaskType::Cleaning => Some("cleaning".into()),
        pb::HousekeepingTaskType::CheckoutClean => Some("checkout_clean".into()),
        pb::HousekeepingTaskType::Inspection => Some("inspection".into()),
        pb::HousekeepingTaskType::MaintenanceFollowup => Some("maintenance_followup".into()),
        pb::HousekeepingTaskType::Unspecified => None,
    }
}

fn hk_type_enum(s: &str) -> pb::HousekeepingTaskType {
    match s {
        "cleaning" => pb::HousekeepingTaskType::Cleaning,
        "checkout_clean" => pb::HousekeepingTaskType::CheckoutClean,
        "inspection" => pb::HousekeepingTaskType::Inspection,
        "maintenance_followup" => pb::HousekeepingTaskType::MaintenanceFollowup,
        _ => pb::HousekeepingTaskType::Unspecified,
    }
}

fn hk_status_str(s: pb::HousekeepingTaskStatus) -> Option<String> {
    match s {
        pb::HousekeepingTaskStatus::Pending => Some("pending".into()),
        pb::HousekeepingTaskStatus::InProgress => Some("in_progress".into()),
        pb::HousekeepingTaskStatus::Completed => Some("completed".into()),
        pb::HousekeepingTaskStatus::Void => Some("void".into()),
        pb::HousekeepingTaskStatus::Unspecified => None,
    }
}

fn hk_status_enum(s: &str) -> pb::HousekeepingTaskStatus {
    match s {
        "pending" => pb::HousekeepingTaskStatus::Pending,
        "in_progress" => pb::HousekeepingTaskStatus::InProgress,
        "completed" => pb::HousekeepingTaskStatus::Completed,
        "void" => pb::HousekeepingTaskStatus::Void,
        _ => pb::HousekeepingTaskStatus::Unspecified,
    }
}

fn hk_priority_str(p: pb::HousekeepingPriority) -> Option<String> {
    match p {
        pb::HousekeepingPriority::Low => Some("low".into()),
        pb::HousekeepingPriority::Normal => Some("normal".into()),
        pb::HousekeepingPriority::High => Some("high".into()),
        pb::HousekeepingPriority::Urgent => Some("urgent".into()),
        pb::HousekeepingPriority::Unspecified => None,
    }
}

fn hk_priority_enum(s: &str) -> pb::HousekeepingPriority {
    match s {
        "low" => pb::HousekeepingPriority::Low,
        "normal" => pb::HousekeepingPriority::Normal,
        "high" => pb::HousekeepingPriority::High,
        "urgent" => pb::HousekeepingPriority::Urgent,
        _ => pb::HousekeepingPriority::Unspecified,
    }
}

// ── Maintenance enum ↔ stored-string mappings ──────────────────────────

fn mt_status_str(s: pb::MaintenanceStatus) -> Option<String> {
    match s {
        pb::MaintenanceStatus::Open => Some("open".into()),
        pb::MaintenanceStatus::InProgress => Some("in_progress".into()),
        pb::MaintenanceStatus::OnHold => Some("on_hold".into()),
        pb::MaintenanceStatus::Resolved => Some("resolved".into()),
        pb::MaintenanceStatus::Closed => Some("closed".into()),
        pb::MaintenanceStatus::Unspecified => None,
    }
}

fn mt_status_enum(s: &str) -> pb::MaintenanceStatus {
    match s {
        "open" => pb::MaintenanceStatus::Open,
        "in_progress" => pb::MaintenanceStatus::InProgress,
        "on_hold" => pb::MaintenanceStatus::OnHold,
        "resolved" => pb::MaintenanceStatus::Resolved,
        "closed" => pb::MaintenanceStatus::Closed,
        _ => pb::MaintenanceStatus::Unspecified,
    }
}

fn mt_category_str(cat: pb::MaintenanceCategory) -> Option<String> {
    match cat {
        pb::MaintenanceCategory::Electrical => Some("electrical".into()),
        pb::MaintenanceCategory::Plumbing => Some("plumbing".into()),
        pb::MaintenanceCategory::Hvac => Some("hvac".into()),
        pb::MaintenanceCategory::Furniture => Some("furniture".into()),
        pb::MaintenanceCategory::Appliance => Some("appliance".into()),
        pb::MaintenanceCategory::Structural => Some("structural".into()),
        pb::MaintenanceCategory::Other => Some("other".into()),
        pb::MaintenanceCategory::Unspecified => None,
    }
}

fn mt_category_enum(s: &str) -> pb::MaintenanceCategory {
    match s {
        "electrical" => pb::MaintenanceCategory::Electrical,
        "plumbing" => pb::MaintenanceCategory::Plumbing,
        "hvac" => pb::MaintenanceCategory::Hvac,
        "furniture" => pb::MaintenanceCategory::Furniture,
        "appliance" => pb::MaintenanceCategory::Appliance,
        "structural" => pb::MaintenanceCategory::Structural,
        "other" => pb::MaintenanceCategory::Other,
        _ => pb::MaintenanceCategory::Unspecified,
    }
}

fn mt_priority_str(p: pb::MaintenancePriority) -> Option<String> {
    match p {
        pb::MaintenancePriority::Low => Some("low".into()),
        pb::MaintenancePriority::Medium => Some("medium".into()),
        pb::MaintenancePriority::High => Some("high".into()),
        pb::MaintenancePriority::Critical => Some("critical".into()),
        pb::MaintenancePriority::Unspecified => None,
    }
}

fn mt_priority_enum(s: &str) -> pb::MaintenancePriority {
    match s {
        "low" => pb::MaintenancePriority::Low,
        "medium" => pb::MaintenancePriority::Medium,
        "high" => pb::MaintenancePriority::High,
        "critical" => pb::MaintenancePriority::Critical,
        _ => pb::MaintenancePriority::Unspecified,
    }
}

// ── Model → proto converters ───────────────────────────────────────────

fn task_pb(t: &hm::HousekeepingTask) -> pb::HousekeepingTask {
    pb::HousekeepingTask {
        name: c::task_name(t.id),
        room: c::room_name(t.room_id),
        room_number: t.room_number.clone(),
        room_type: t.room_type.clone(),
        task_type: hk_type_enum(&t.task_type).into(),
        priority: hk_priority_enum(&t.priority).into(),
        status: hk_status_enum(&t.status).into(),
        assigned_to: t.assigned_to.map(c::user_name).unwrap_or_default(),
        assigned_to_name: t.assigned_to_name.clone().unwrap_or_default(),
        scheduled_date: c::opt_date(&t.scheduled_date),
        task_date: Some(c::date(&t.task_date)),
        started_at: c::opt_ts(&t.started_at),
        completed_at: c::opt_ts(&t.completed_at),
        notes: t.notes.clone().unwrap_or_default(),
        inspection_notes: t.inspection_notes.clone().unwrap_or_default(),
        items_used: t.items_used.as_ref().map(c::json_to_value),
        created_at: Some(c::ts(&t.created_at)),
        created_by: t.created_by.map(c::user_name).unwrap_or_default(),
        updated_at: Some(c::ts(&t.updated_at)),
    }
}

fn ticket_pb(t: &mm::MaintenanceTicket, cur: &str) -> pb::MaintenanceTicket {
    pb::MaintenanceTicket {
        name: c::ticket_name(t.id),
        room: t.room_id.map(c::room_name).unwrap_or_default(),
        room_number: t.room_number.clone().unwrap_or_default(),
        ticket_number: t.ticket_number.clone(),
        title: t.title.clone(),
        description: t.description.clone().unwrap_or_default(),
        category: mt_category_enum(&t.category).into(),
        priority: mt_priority_enum(&t.priority).into(),
        status: mt_status_enum(&t.status).into(),
        assigned_to: t.assigned_to.map(c::user_name).unwrap_or_default(),
        assigned_to_name: t.assigned_to_name.clone().unwrap_or_default(),
        reported_by: t.reported_by.map(c::user_name).unwrap_or_default(),
        estimated_cost: c::opt_money(t.estimated_cost.as_ref(), cur),
        actual_cost: c::opt_money(t.actual_cost.as_ref(), cur),
        estimated_hours: c::opt_decimal(t.estimated_hours.as_ref()),
        actual_hours: c::opt_decimal(t.actual_hours.as_ref()),
        scheduled_date: c::opt_ts(&t.scheduled_date),
        started_at: c::opt_ts(&t.started_at),
        resolved_at: c::opt_ts(&t.resolved_at),
        resolution_notes: t.resolution_notes.clone().unwrap_or_default(),
        images: t.images.as_ref().map(c::json_to_value),
        created_at: Some(c::ts(&t.created_at)),
        updated_at: Some(c::ts(&t.updated_at)),
    }
}

/// page_token ↔ the service's page-number pagination (REST `page`/`page_size`).
/// Token "" → page 1; `page_size <= 0` → None so the service default applies.
fn page_params(page_size: i32, page_token: &str) -> (Option<i64>, Option<i64>) {
    let page = page_token
        .parse::<i64>()
        .ok()
        .filter(|p| *p >= 1)
        .unwrap_or(1);
    let size = (page_size > 0).then_some(page_size as i64);
    (Some(page), size)
}

fn next_page_token(page: i64, page_size: i64, total: i64) -> String {
    if page_size > 0 && page * page_size < total {
        (page + 1).to_string()
    } else {
        String::new()
    }
}

// ── HousekeepingService ────────────────────────────────────────────────

#[derive(Clone)]
pub struct HousekeepingGrpc {
    pool: DbPool,
    idem: std::sync::Arc<IdempotencyCache>,
}

impl HousekeepingGrpc {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            idem: std::sync::Arc::new(IdempotencyCache::default()),
        }
    }
}

#[tonic::async_trait]
impl HousekeepingService for HousekeepingGrpc {
    async fn list_housekeeping_tasks(
        &self,
        request: Request<pb::ListHousekeepingTasksRequest>,
    ) -> Result<Response<pb::ListHousekeepingTasksResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "housekeeping:read")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        let (page, size) = page_params(req.page_size, &req.page_token);
        let params = hm::ListHousekeepingTasksQuery {
            status: hk_status_str(req.status()),
            task_type: hk_type_str(req.task_type()),
            room_id: c::parse_name(&req.room, "rooms")?,
            assigned_to: c::parse_name(&req.assigned_to, "users")?,
            unassigned: req.unassigned,
            scheduled_date: c::date_from_pb(req.scheduled_date.as_ref())?,
            page,
            page_size: size,
        };
        let res = hk_service::list_tasks(&self.pool, params)
            .await
            .map_err(to_status)?;
        Ok(Response::new(pb::ListHousekeepingTasksResponse {
            tasks: res.items.iter().map(task_pb).collect(),
            next_page_token: next_page_token(res.page, res.page_size, res.total),
            total_size: res.total,
        }))
    }

    async fn create_housekeeping_task(
        &self,
        request: Request<pb::CreateHousekeepingTaskRequest>,
    ) -> Result<Response<pb::CreateHousekeepingTaskResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "housekeeping:create")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("CreateHousekeepingTask", &req.request_id, || async {
                let t = req.task.clone().unwrap_or_default();
                let room_id = c::require_name(&t.room, "rooms")?;
                let input = hm::CreateHousekeepingTaskRequest {
                    room_id,
                    task_type: hk_type_str(t.task_type()),
                    priority: hk_priority_str(t.priority()),
                    assigned_to: c::parse_name(&t.assigned_to, "users")?,
                    scheduled_date: c::date_from_pb(t.scheduled_date.as_ref())?,
                    notes: (!t.notes.is_empty()).then(|| t.notes.clone()),
                    inspection_notes: (!t.inspection_notes.is_empty())
                        .then(|| t.inspection_notes.clone()),
                    items_used: t.items_used.as_ref().map(c::value_to_json),
                };
                let task = hk_service::create_task(&self.pool, auth.user_id, input)
                    .await
                    .map_err(to_status)?;
                Ok(Response::new(pb::CreateHousekeepingTaskResponse {
                    task: Some(task_pb(&task)),
                }))
            })
            .await
    }

    async fn update_housekeeping_task(
        &self,
        request: Request<pb::UpdateHousekeepingTaskRequest>,
    ) -> Result<Response<pb::UpdateHousekeepingTaskResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "housekeeping:update")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("UpdateHousekeepingTask", &req.request_id, || async {
                let t = req.task.clone().unwrap_or_default();
                let task_id = c::require_name(&t.name, "housekeepingTasks")?;
                let mut input = hm::UpdateHousekeepingTaskRequest {
                    priority: None,
                    status: None,
                    assigned_to: None,
                    scheduled_date: None,
                    notes: None,
                    inspection_notes: None,
                    items_used: None,
                    clear_assignee: (req.clear_assignee).then_some(true),
                };
                for path in &req
                    .update_mask
                    .as_ref()
                    .map(|m| m.paths.clone())
                    .unwrap_or_default()
                {
                    match path.as_str() {
                        "priority" => input.priority = hk_priority_str(t.priority()),
                        "status" => input.status = hk_status_str(t.status()),
                        "assigned_to" => {
                            input.assigned_to = c::parse_name(&t.assigned_to, "users")?
                        }
                        "scheduled_date" => {
                            input.scheduled_date = c::date_from_pb(t.scheduled_date.as_ref())?
                        }
                        "notes" => input.notes = Some(t.notes.clone()),
                        "inspection_notes" => {
                            input.inspection_notes = Some(t.inspection_notes.clone())
                        }
                        "items_used" => {
                            input.items_used = t.items_used.as_ref().map(c::value_to_json)
                        }
                        other => {
                            return Err(Status::invalid_argument(format!(
                                "update_mask contains unsupported field '{other}'"
                            )));
                        }
                    }
                }
                let task = hk_service::update_task(&self.pool, auth.user_id, task_id, input)
                    .await
                    .map_err(to_status)?;
                Ok(Response::new(pb::UpdateHousekeepingTaskResponse {
                    task: Some(task_pb(&task)),
                }))
            })
            .await
    }

    async fn get_housekeeping_board(
        &self,
        request: Request<pb::GetHousekeepingBoardRequest>,
    ) -> Result<Response<pb::GetHousekeepingBoardResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "housekeeping:read")
            .await
            .map_err(to_status)?;
        let board = hk_service::board(&self.pool).await.map_err(to_status)?;
        Ok(Response::new(pb::GetHousekeepingBoardResponse {
            rooms: board
                .rooms
                .iter()
                .map(|r| pb::HousekeepingBoardRoom {
                    room: c::room_name(r.id),
                    room_number: r.room_number.clone(),
                    room_type: r.room_type.clone(),
                    floor: r.floor,
                    status: room_status_enum(&r.status).into(),
                    open_task: r.open_task.as_ref().map(task_pb),
                })
                .collect(),
        }))
    }

    async fn list_assignable_staff(
        &self,
        request: Request<pb::ListAssignableStaffRequest>,
    ) -> Result<Response<pb::ListAssignableStaffResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        // REST guards this endpoint with an any-of permission set covering
        // both scopes — same set here, before resolving the scope filter.
        check_any_permission(
            &self.pool,
            auth.user_id,
            &[
                "housekeeping:update",
                "housekeeping:manage",
                "maintenance:write",
                "maintenance:manage",
            ],
        )
        .await
        .map_err(to_status)?;
        let scope = match request.into_inner().scope() {
            pb::AssignableStaffScope::Housekeeping => Some("housekeeping"),
            pb::AssignableStaffScope::Maintenance => Some("maintenance"),
            pb::AssignableStaffScope::Unspecified => None,
        };
        let staff = hk_service::assignable_staff(&self.pool, scope)
            .await
            .map_err(to_status)?;
        Ok(Response::new(pb::ListAssignableStaffResponse {
            staff: staff
                .iter()
                .map(|s| pb::AssignableStaffMember {
                    user: c::user_name(s.id),
                    full_name: s.full_name.clone().unwrap_or_default(),
                    username: s.username.clone(),
                })
                .collect(),
        }))
    }
}

// ── MaintenanceService ─────────────────────────────────────────────────

#[derive(Clone)]
pub struct MaintenanceGrpc {
    pool: DbPool,
    idem: std::sync::Arc<IdempotencyCache>,
}

impl MaintenanceGrpc {
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
impl MaintenanceService for MaintenanceGrpc {
    async fn list_maintenance_tickets(
        &self,
        request: Request<pb::ListMaintenanceTicketsRequest>,
    ) -> Result<Response<pb::ListMaintenanceTicketsResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "maintenance:read")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        let (page, size) = page_params(req.page_size, &req.page_token);
        let params = mm::ListMaintenanceTicketsQuery {
            status: mt_status_str(req.status()),
            room_id: c::parse_name(&req.room, "rooms")?,
            assigned_to: c::parse_name(&req.assigned_to, "users")?,
            category: mt_category_str(req.category()),
            priority: mt_priority_str(req.priority()),
            page,
            page_size: size,
        };
        let res = mt_service::list_tickets(&self.pool, params)
            .await
            .map_err(to_status)?;
        let currency = self.currency().await?;
        Ok(Response::new(pb::ListMaintenanceTicketsResponse {
            tickets: res.items.iter().map(|t| ticket_pb(t, &currency)).collect(),
            next_page_token: next_page_token(res.page, res.page_size, res.total),
            total_size: res.total,
        }))
    }

    async fn get_maintenance_ticket(
        &self,
        request: Request<pb::GetMaintenanceTicketRequest>,
    ) -> Result<Response<pb::GetMaintenanceTicketResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "maintenance:read")
            .await
            .map_err(to_status)?;
        let id = c::require_name(&request.into_inner().name, "maintenanceTickets")?;
        let t = mt_service::get_ticket(&self.pool, id)
            .await
            .map_err(to_status)?;
        let currency = self.currency().await?;
        Ok(Response::new(pb::GetMaintenanceTicketResponse {
            ticket: Some(ticket_pb(&t, &currency)),
        }))
    }

    async fn create_maintenance_ticket(
        &self,
        request: Request<pb::CreateMaintenanceTicketRequest>,
    ) -> Result<Response<pb::CreateMaintenanceTicketResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "maintenance:write")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("CreateMaintenanceTicket", &req.request_id, || async {
                let t = req.ticket.clone().unwrap_or_default();
                if t.title.is_empty() {
                    return Err(Status::invalid_argument("ticket.title is required"));
                }
                // Compute before the struct literal — enum accessors borrow
                // all of t and can't run after t.title moves.
                let category = mt_category_str(t.category());
                let priority = mt_priority_str(t.priority());
                let input = mm::CreateMaintenanceTicketRequest {
                    room_id: c::parse_name(&t.room, "rooms")?,
                    title: t.title,
                    description: (!t.description.is_empty()).then(|| t.description.clone()),
                    category,
                    priority,
                    assigned_to: c::parse_name(&t.assigned_to, "users")?,
                    estimated_cost: c::money_to_decimal(t.estimated_cost.as_ref()),
                    estimated_hours: c::decimal_from_pb(t.estimated_hours.as_ref())?,
                    scheduled_date: c::ts_to_datetime(t.scheduled_date.as_ref())?,
                    images: t.images.as_ref().map(c::value_to_json),
                };
                let ticket = mt_service::create_ticket(&self.pool, auth.user_id, input)
                    .await
                    .map_err(to_status)?;
                let currency = self.currency().await?;
                Ok(Response::new(pb::CreateMaintenanceTicketResponse {
                    ticket: Some(ticket_pb(&ticket, &currency)),
                }))
            })
            .await
    }

    async fn update_maintenance_ticket(
        &self,
        request: Request<pb::UpdateMaintenanceTicketRequest>,
    ) -> Result<Response<pb::UpdateMaintenanceTicketResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "maintenance:write")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("UpdateMaintenanceTicket", &req.request_id, || async {
                let t = req.ticket.clone().unwrap_or_default();
                let ticket_id = c::require_name(&t.name, "maintenanceTickets")?;
                let mut input = mm::UpdateMaintenanceTicketRequest {
                    title: None,
                    description: None,
                    category: None,
                    priority: None,
                    status: None,
                    assigned_to: None,
                    estimated_cost: None,
                    actual_cost: None,
                    estimated_hours: None,
                    actual_hours: None,
                    scheduled_date: None,
                    resolution_notes: None,
                    images: None,
                    clear_assignee: (req.clear_assignee).then_some(true),
                };
                for path in &req
                    .update_mask
                    .as_ref()
                    .map(|m| m.paths.clone())
                    .unwrap_or_default()
                {
                    match path.as_str() {
                        "title" => input.title = Some(t.title.clone()),
                        "description" => input.description = Some(t.description.clone()),
                        "category" => input.category = mt_category_str(t.category()),
                        "priority" => input.priority = mt_priority_str(t.priority()),
                        "status" => input.status = mt_status_str(t.status()),
                        "assigned_to" => {
                            input.assigned_to = c::parse_name(&t.assigned_to, "users")?
                        }
                        "estimated_cost" => {
                            input.estimated_cost = c::money_to_decimal(t.estimated_cost.as_ref())
                        }
                        "actual_cost" => {
                            input.actual_cost = c::money_to_decimal(t.actual_cost.as_ref())
                        }
                        "estimated_hours" => {
                            input.estimated_hours = c::decimal_from_pb(t.estimated_hours.as_ref())?
                        }
                        "actual_hours" => {
                            input.actual_hours = c::decimal_from_pb(t.actual_hours.as_ref())?
                        }
                        "scheduled_date" => {
                            input.scheduled_date = c::ts_to_datetime(t.scheduled_date.as_ref())?
                        }
                        "resolution_notes" => {
                            input.resolution_notes = Some(t.resolution_notes.clone())
                        }
                        "images" => input.images = t.images.as_ref().map(c::value_to_json),
                        other => {
                            return Err(Status::invalid_argument(format!(
                                "update_mask contains unsupported field '{other}'"
                            )));
                        }
                    }
                }
                let ticket = mt_service::update_ticket(&self.pool, auth.user_id, ticket_id, input)
                    .await
                    .map_err(to_status)?;
                let currency = self.currency().await?;
                Ok(Response::new(pb::UpdateMaintenanceTicketResponse {
                    ticket: Some(ticket_pb(&ticket, &currency)),
                }))
            })
            .await
    }
}
