//! `GuestService` gRPC adapter.
//!
//! Every method is a thin translator: protobuf request → the same domain
//! inputs the REST handlers build → the same `modules::guests::service`
//! functions REST calls → protobuf response. Route-level REST guards are
//! repeated verbatim (`guests:read`/`create`/`update`/`delete`); the
//! service-level checks (link access on credits, guests:reveal on sensitive
//! fields, guests:read widening on credit lists) live in the service layer
//! and run unchanged for both transports.

use tonic::{Request, Response, Status};

use crate::constants::{GuestType, TourismType};
use crate::core::db::DbPool;
use crate::core::middleware::check_permission;
use crate::models::{GuestInput, GuestPaginationParams, GuestUpdateInput};
use crate::modules::guests::{models as gm, service as svc};

use super::auth::authenticate;
use super::convert as c;
use super::error::to_status;
use super::idempotency::IdempotencyCache;
use super::pb::hotel::guests::v1 as pb;
use super::pb::hotel::guests::v1::guest_service_server::GuestService;

// ── Enum mappings (stored vocabularies stay the REST snake strings) ─────

fn guest_type_pb(t: &GuestType) -> pb::GuestType {
    match t {
        GuestType::Member => pb::GuestType::Member,
        GuestType::NonMember => pb::GuestType::NonMember,
    }
}

fn guest_type_model(t: pb::GuestType) -> Option<GuestType> {
    match t {
        pb::GuestType::Member => Some(GuestType::Member),
        pb::GuestType::NonMember => Some(GuestType::NonMember),
        pb::GuestType::Unspecified => None,
    }
}

fn guest_type_rest(t: pb::GuestType) -> Option<String> {
    match t {
        pb::GuestType::Member => Some("member".to_string()),
        pb::GuestType::NonMember => Some("non_member".to_string()),
        pb::GuestType::Unspecified => None,
    }
}

fn tourism_type_pb(t: &TourismType) -> pb::TourismType {
    match t {
        TourismType::Local => pb::TourismType::Local,
        TourismType::Foreign => pb::TourismType::Foreign,
    }
}

fn tourism_type_model(t: pb::TourismType) -> Option<TourismType> {
    match t {
        pb::TourismType::Local => Some(TourismType::Local),
        pb::TourismType::Foreign => Some(TourismType::Foreign),
        pb::TourismType::Unspecified => None,
    }
}

fn tourism_type_rest(t: pb::TourismType) -> Option<String> {
    match t {
        pb::TourismType::Local => Some("local".to_string()),
        pb::TourismType::Foreign => Some("foreign".to_string()),
        pb::TourismType::Unspecified => None,
    }
}

fn segment_rest(s: pb::GuestSegment) -> Option<String> {
    match s {
        pb::GuestSegment::Returning => Some("returning".to_string()),
        pb::GuestSegment::InHouse => Some("in_house".to_string()),
        pb::GuestSegment::Upcoming => Some("upcoming".to_string()),
        pb::GuestSegment::Inactive => Some("inactive".to_string()),
        pb::GuestSegment::Unspecified => None,
    }
}

// ── Model → proto converters ─────────────────────────────────────────────

fn ekyc_pb(e: &gm::GuestEkycStatusSummary) -> pb::GuestEkycStatusSummary {
    pb::GuestEkycStatusSummary {
        guest: c::guest_name(e.guest_id),
        ekyc_verification_id: e.ekyc_verification_id,
        status: e.status.clone(),
        self_checkin_enabled: e.self_checkin_enabled,
        verified_at: c::opt_ts(&e.verified_at),
        can_auto_checkin: e.can_auto_checkin,
        auto_checkin_block_reason: e.auto_checkin_block_reason.clone(),
        auto_checkin_block_code: e.auto_checkin_block_code.clone(),
    }
}

fn guest_pb(g: &gm::Guest) -> pb::Guest {
    pb::Guest {
        name: c::guest_name(g.id),
        nick_name: g.nick_name.clone(),
        first_name: g.first_name.clone(),
        last_name: g.last_name.clone(),
        email: g.email.clone(),
        phone: g.phone.clone(),
        ic_number: g.ic_number.clone(),
        nationality: g.nationality.clone(),
        address_line1: g.address_line1.clone(),
        city: g.city.clone(),
        state_province: g.state_province.clone(),
        postal_code: g.postal_code.clone(),
        country: g.country.clone(),
        title: g.title.clone(),
        alt_phone: g.alt_phone.clone(),
        is_active: g.is_active,
        guest_type: guest_type_pb(&g.guest_type).into(),
        tourism_type: g.tourism_type.as_ref().map(|t| tourism_type_pb(t).into()),
        discount_percentage: Some(g.discount_percentage),
        company_name: g.company_name.clone(),
        complimentary_nights_credit: g.complimentary_nights_credit,
        created_at: Some(c::ts(&g.created_at)),
        updated_at: Some(c::ts(&g.updated_at)),
        vip_status: g.vip_status.clone(),
        tags: g.tags.clone().unwrap_or_default(),
        job_title: g.job_title.clone(),
        notes: g.notes.clone(),
        special_requests: g.special_requests.clone(),
        marketing_opt_in: g.marketing_opt_in,
        communication_preference: g.communication_preference.clone(),
        language_preference: g.language_preference.clone(),
        is_blacklisted: g.is_blacklisted,
        blacklist_reason: g.blacklist_reason.clone(),
        account_username: g.account_username.clone(),
        account_is_active: g.account_is_active,
        bookings_count: g.bookings_count,
        last_stay_date: c::opt_date(&g.last_stay_date),
        has_open_support: g.has_open_support,
        ekyc_summary: Some(ekyc_pb(&g.ekyc_summary)),
        date_of_birth: None,
        id_type: None,
        id_number: None,
        id_expiry: None,
        id_country: None,
    }
}

fn summary_pb(s: &gm::GuestSummary, cur: &str) -> pb::GuestSummary {
    pb::GuestSummary {
        completed_stays: s.completed_stays,
        total_nights: s.total_nights,
        total_room_revenue: Some(c::money(&s.total_room_revenue, cur)),
        last_stay_at: c::opt_date(&s.last_stay_at),
        next_stay_at: c::opt_date(&s.next_stay_at),
        outstanding_balance: Some(c::money(&s.outstanding_balance, cur)),
        total_bookings: s.total_bookings,
        active_booking: s.active_booking_id.map(c::booking_name).unwrap_or_default(),
        active_booking_number: s.active_booking_number.clone(),
    }
}

fn profile_booking_pb(b: &gm::GuestProfileBooking, cur: &str) -> pb::GuestProfileBooking {
    pb::GuestProfileBooking {
        name: c::booking_name(b.id),
        booking_number: b.booking_number.clone(),
        check_in_date: Some(c::date(&b.check_in_date)),
        check_out_date: Some(c::date(&b.check_out_date)),
        nights: b.nights,
        status: b.status.clone(),
        payment_status: b.payment_status.clone(),
        total_amount: Some(c::money(&b.total_amount, cur)),
        total_paid: Some(c::money(&b.total_paid, cur)),
        balance_due: Some(c::money(&b.balance_due, cur)),
        created_at: Some(c::ts(&b.created_at)),
        room_number: b.room_number.clone(),
        room_type: b.room_type.clone(),
        special_requests: b.special_requests.clone(),
        source: b.source.clone(),
    }
}

fn profile_pb(p: &gm::GuestProfile, cur: &str) -> pb::GuestProfile {
    pb::GuestProfile {
        guest: Some(guest_pb(&p.guest)),
        summary: Some(summary_pb(&p.summary, cur)),
        ekyc_summary: Some(ekyc_pb(&p.ekyc_summary)),
        reservations: p
            .reservations
            .iter()
            .map(|b| profile_booking_pb(b, cur))
            .collect(),
        duplicate_candidates: p
            .duplicate_candidates
            .iter()
            .map(|d| pb::GuestDuplicateCandidate {
                guest: Some(guest_pb(&d.guest)),
                score: d.score,
                match_reasons: d.match_reasons.clone(),
                blocking_reasons: d.blocking_reasons.clone(),
                recommended_action: d.recommended_action.clone(),
            })
            .collect(),
        sensitive: p.sensitive.as_ref().map(|s| pb::GuestSensitiveProfile {
            date_of_birth: c::opt_date(&s.date_of_birth),
            id_type: s.id_type.clone(),
            id_number: s.id_number.clone(),
            id_expiry: c::opt_date(&s.id_expiry),
            id_country: s.id_country.clone(),
        }),
    }
}

fn booking_pb(b: &gm::GuestBookingRow, cur: &str) -> pb::GuestBooking {
    pb::GuestBooking {
        name: c::booking_name(b.id),
        booking_number: b.booking_number.clone(),
        check_in_date: Some(c::date(&b.check_in_date)),
        check_out_date: Some(c::date(&b.check_out_date)),
        nights: b.nights,
        status: b.status.clone(),
        total_amount: Some(c::money(&b.total_amount, cur)),
        created_at: Some(c::ts(&b.created_at)),
        room_number: b.room_number.clone(),
        room_type: b.room_type.clone(),
    }
}

fn credit_pb(cr: &gm::GuestCreditRow) -> pb::GuestRoomTypeCredit {
    pb::GuestRoomTypeCredit {
        id: cr.id as i64,
        guest: c::guest_name(cr.guest_id),
        room_type: c::room_type_name(cr.room_type_id),
        room_type_name: cr.room_type_name.clone(),
        room_type_code: cr.room_type_code.clone(),
        nights_available: cr.nights_available,
        created_at: Some(c::ts(&cr.created_at)),
        updated_at: Some(c::ts(&cr.updated_at)),
    }
}

fn room_credit_pb(cr: &gm::GuestRoomCreditRow) -> pb::GuestRoomTypeCredit {
    // The my-guests-with-credits rows carry no id/guest/timestamps in REST —
    // proto defaults match (0 id, empty names, absent timestamps).
    pb::GuestRoomTypeCredit {
        id: 0,
        guest: String::new(),
        room_type: c::room_type_name(cr.room_type_id),
        room_type_name: cr.room_type_name.clone(),
        room_type_code: cr.room_type_code.clone(),
        nights_available: cr.nights_available,
        created_at: None,
        updated_at: None,
    }
}

// ── Service implementation ───────────────────────────────────────────────

#[derive(Clone)]
pub struct GuestGrpc {
    pool: DbPool,
    idem: std::sync::Arc<IdempotencyCache>,
}

impl GuestGrpc {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            idem: std::sync::Arc::new(IdempotencyCache::default()),
        }
    }

    /// Property currency for `Money` outputs — same settings accessor the
    /// other adapters use.
    async fn currency(&self) -> Result<String, Status> {
        crate::modules::settings::service::get_setting_value(&self.pool, "currency")
            .await
            .map_err(to_status)
    }
}

#[tonic::async_trait]
impl GuestService for GuestGrpc {
    async fn list_guests(
        &self,
        request: Request<pb::ListGuestsRequest>,
    ) -> Result<Response<pb::ListGuestsResponse>, Status> {
        // REST guards this route with bare require_auth — the service itself
        // decides access (empty page without guests:read).
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let req = request.into_inner();
        let guest_type = guest_type_rest(req.guest_type());
        let tourism_type = tourism_type_rest(req.tourism_type());
        let segment = segment_rest(req.segment());
        let params = GuestPaginationParams {
            page: (req.page > 0).then_some(req.page),
            page_size: (req.page_size > 0).then_some(req.page_size),
            search: (!req.search.is_empty()).then_some(req.search),
            guest_type,
            tourism_type,
            missing_tourism: req.missing_tourism,
            missing_info: req.missing_info,
            vip: req.vip,
            blacklisted: req.blacklisted,
            has_open_support: req.has_open_support,
            segment,
        };
        let res = svc::list_guests(&self.pool, auth.user_id, params)
            .await
            .map_err(to_status)?;
        Ok(Response::new(pb::ListGuestsResponse {
            total: res.total,
            page: res.page,
            page_size: res.page_size,
            guests: res.data.iter().map(guest_pb).collect(),
        }))
    }

    async fn get_guest(
        &self,
        request: Request<pb::GetGuestRequest>,
    ) -> Result<Response<pb::GetGuestResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "guests:read")
            .await
            .map_err(to_status)?;
        let id = c::require_name(&request.into_inner().name, "guests")?;
        let guest = svc::get_guest(&self.pool, id).await.map_err(to_status)?;
        Ok(Response::new(pb::GetGuestResponse {
            guest: Some(guest_pb(&guest)),
        }))
    }

    async fn get_guest_profile(
        &self,
        request: Request<pb::GetGuestProfileRequest>,
    ) -> Result<Response<pb::GetGuestProfileResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "guests:read")
            .await
            .map_err(to_status)?;
        let id = c::require_name(&request.into_inner().name, "guests")?;
        let currency = self.currency().await?;
        let profile = svc::guest_profile(&self.pool, auth.user_id, id)
            .await
            .map_err(to_status)?;
        Ok(Response::new(pb::GetGuestProfileResponse {
            profile: Some(profile_pb(&profile, &currency)),
        }))
    }

    async fn list_guest_bookings(
        &self,
        request: Request<pb::ListGuestBookingsRequest>,
    ) -> Result<Response<pb::ListGuestBookingsResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "guests:read")
            .await
            .map_err(to_status)?;
        let id = c::require_name(&request.into_inner().name, "guests")?;
        let currency = self.currency().await?;
        let rows = svc::guest_bookings(&self.pool, id)
            .await
            .map_err(to_status)?;
        Ok(Response::new(pb::ListGuestBookingsResponse {
            bookings: rows.iter().map(|b| booking_pb(b, &currency)).collect(),
        }))
    }

    async fn get_guest_credits(
        &self,
        request: Request<pb::GetGuestCreditsRequest>,
    ) -> Result<Response<pb::GetGuestCreditsResponse>, Status> {
        // REST uses bare require_auth — the link/permission check is inside
        // the service and stays there.
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let id = c::require_name(&request.into_inner().name, "guests")?;
        let credits = svc::guest_credits(&self.pool, auth.user_id, id)
            .await
            .map_err(to_status)?;
        Ok(Response::new(pb::GetGuestCreditsResponse {
            credits: Some(pb::GuestCredits {
                guest: c::guest_name(credits.guest_id),
                guest_name: credits.guest_name,
                total_nights: credits.total_nights,
                legacy_total_nights: credits.legacy_total_nights,
                credits_by_room_type: credits.credits_by_room_type.iter().map(credit_pb).collect(),
            }),
        }))
    }

    async fn list_my_guests(
        &self,
        request: Request<pb::ListMyGuestsRequest>,
    ) -> Result<Response<pb::ListMyGuestsResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let guests = svc::my_guests(&self.pool, auth.user_id)
            .await
            .map_err(to_status)?;
        Ok(Response::new(pb::ListMyGuestsResponse {
            guests: guests.iter().map(guest_pb).collect(),
        }))
    }

    async fn list_my_guests_with_credits(
        &self,
        request: Request<pb::ListMyGuestsWithCreditsRequest>,
    ) -> Result<Response<pb::ListMyGuestsWithCreditsResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        let rows = svc::my_guests_with_credits(&self.pool, auth.user_id)
            .await
            .map_err(to_status)?;
        Ok(Response::new(pb::ListMyGuestsWithCreditsResponse {
            summaries: rows
                .iter()
                .map(|r| pb::GuestCreditSummary {
                    guest: c::guest_name(r.id),
                    nick_name: r.nick_name.clone(),
                    email: r.email.clone(),
                    legacy_complimentary_nights_credit: r.legacy_complimentary_nights_credit,
                    total_complimentary_credits: r.total_complimentary_credits,
                    credits_by_room_type: r
                        .credits_by_room_type
                        .iter()
                        .map(room_credit_pb)
                        .collect(),
                })
                .collect(),
        }))
    }

    async fn create_guest(
        &self,
        request: Request<pb::CreateGuestRequest>,
    ) -> Result<Response<pb::CreateGuestResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "guests:create")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("CreateGuest", &req.request_id, || async {
                let g = req.guest.clone().unwrap_or_default();
                let guest_type = guest_type_model(g.guest_type());
                let tourism_type = tourism_type_model(g.tourism_type());
                let input = GuestInput {
                    first_name: g.first_name.unwrap_or_default(),
                    last_name: g.last_name.unwrap_or_default(),
                    email: g.email,
                    phone: g.phone,
                    ic_number: g.ic_number,
                    nationality: g.nationality,
                    address_line1: g.address_line1,
                    city: g.city,
                    state_province: g.state_province,
                    postal_code: g.postal_code,
                    country: g.country,
                    guest_type,
                    tourism_type,
                    discount_percentage: g.discount_percentage,
                    company_name: g.company_name,
                };
                let guest = svc::create_guest(&self.pool, auth.user_id, input)
                    .await
                    .map_err(to_status)?;
                Ok(Response::new(pb::CreateGuestResponse {
                    guest: Some(guest_pb(&guest)),
                }))
            })
            .await
    }

    async fn update_guest(
        &self,
        request: Request<pb::UpdateGuestRequest>,
    ) -> Result<Response<pb::UpdateGuestResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "guests:update")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("UpdateGuest", &req.request_id, || async {
                let g = req.guest.clone().unwrap_or_default();
                let guest_id = c::require_name(&g.name, "guests")?;
                let mut input = GuestUpdateInput::default();
                for path in &req
                    .update_mask
                    .as_ref()
                    .map(|m| m.paths.clone())
                    .unwrap_or_default()
                {
                    match path.as_str() {
                        "first_name" => input.first_name = g.first_name.clone(),
                        "last_name" => input.last_name = g.last_name.clone(),
                        "email" => input.email = g.email.clone(),
                        "phone" => input.phone = g.phone.clone(),
                        "title" => input.title = g.title.clone(),
                        "alt_phone" => input.alt_phone = g.alt_phone.clone(),
                        "ic_number" => input.ic_number = g.ic_number.clone(),
                        "nationality" => input.nationality = g.nationality.clone(),
                        "address_line1" => input.address_line1 = g.address_line1.clone(),
                        "city" => input.city = g.city.clone(),
                        "state_province" => input.state_province = g.state_province.clone(),
                        "postal_code" => input.postal_code = g.postal_code.clone(),
                        "country" => input.country = g.country.clone(),
                        // Accepted-but-ignored in REST — passed through so the
                        // service's own ignore/apply rules stay authoritative.
                        "is_active" => input.is_active = Some(g.is_active),
                        "guest_type" => input.guest_type = guest_type_model(g.guest_type()),
                        "tourism_type" => input.tourism_type = tourism_type_model(g.tourism_type()),
                        "discount_percentage" => input.discount_percentage = g.discount_percentage,
                        "company_name" => input.company_name = g.company_name.clone(),
                        "vip_status" => input.vip_status = g.vip_status.clone(),
                        "tags" => input.tags = Some(g.tags.clone()),
                        "job_title" => input.job_title = g.job_title.clone(),
                        "notes" => input.notes = g.notes.clone(),
                        "special_requests" => input.special_requests = g.special_requests.clone(),
                        "marketing_opt_in" => input.marketing_opt_in = g.marketing_opt_in,
                        "communication_preference" => {
                            input.communication_preference = g.communication_preference.clone()
                        }
                        "language_preference" => {
                            input.language_preference = g.language_preference.clone()
                        }
                        "is_blacklisted" => input.is_blacklisted = g.is_blacklisted,
                        "blacklist_reason" => input.blacklist_reason = g.blacklist_reason.clone(),
                        "date_of_birth" => {
                            input.date_of_birth = c::date_from_pb(g.date_of_birth.as_ref())?
                        }
                        "id_type" => input.id_type = g.id_type.clone(),
                        "id_number" => input.id_number = g.id_number.clone(),
                        "id_expiry" => input.id_expiry = c::date_from_pb(g.id_expiry.as_ref())?,
                        "id_country" => input.id_country = g.id_country.clone(),
                        other => {
                            return Err(Status::invalid_argument(format!(
                                "update_mask contains unsupported field '{other}'"
                            )));
                        }
                    }
                }
                let guest = svc::update_guest(&self.pool, auth.user_id, guest_id, input)
                    .await
                    .map_err(to_status)?;
                Ok(Response::new(pb::UpdateGuestResponse {
                    guest: Some(guest_pb(&guest)),
                }))
            })
            .await
    }

    async fn delete_guest(
        &self,
        request: Request<pb::DeleteGuestRequest>,
    ) -> Result<Response<pb::DeleteGuestResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "guests:delete")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("DeleteGuest", &req.request_id, || async {
                let guest_id = c::require_name(&req.name, "guests")?;
                svc::delete_guest(&self.pool, guest_id)
                    .await
                    .map_err(to_status)?;
                Ok(Response::new(pb::DeleteGuestResponse {}))
            })
            .await
    }

    async fn apply_tourism_type_from_last_check_in(
        &self,
        request: Request<pb::ApplyTourismTypeFromLastCheckInRequest>,
    ) -> Result<Response<pb::ApplyTourismTypeFromLastCheckInResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "guests:update")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run(
                "ApplyTourismTypeFromLastCheckIn",
                &req.request_id,
                || async {
                    let guest_id = c::require_name(&req.name, "guests")?;
                    let currency = self.currency().await?;
                    let res = svc::apply_tourism_type_from_last_check_in(
                        &self.pool,
                        auth.user_id,
                        guest_id,
                    )
                    .await
                    .map_err(to_status)?;
                    let s = &res.source;
                    Ok(Response::new(pb::ApplyTourismTypeFromLastCheckInResponse {
                        conversion: Some(pb::GuestTourismConversion {
                            guest: Some(guest_pb(&res.guest)),
                            booking: c::booking_name(s.booking_id),
                            booking_number: s.booking_number.clone(),
                            check_in_date: Some(c::date(&s.check_in_date)),
                            check_out_date: Some(c::date(&s.check_out_date)),
                            tourism_tax_amount: Some(c::money(&s.tourism_tax_amount, &currency)),
                            net_paid_amount: Some(c::money(&s.net_paid_amount, &currency)),
                            paid_tourism_tax: s.paid_tourism_tax,
                            inferred_tourism_type: tourism_type_pb(&s.inferred_tourism_type).into(),
                        }),
                    }))
                },
            )
            .await
    }

    async fn transfer_guest_portal_account(
        &self,
        request: Request<pb::TransferGuestPortalAccountRequest>,
    ) -> Result<Response<pb::TransferGuestPortalAccountResponse>, Status> {
        let auth = authenticate(&self.pool, request.metadata()).await?;
        check_permission(&self.pool, auth.user_id, "guests:update")
            .await
            .map_err(to_status)?;
        let req = request.into_inner();
        self.idem
            .run("TransferGuestPortalAccount", &req.request_id, || async {
                let guest_id = c::require_name(&req.name, "guests")?;
                let input = crate::models::TransferGuestPortalAccountInput {
                    username: req.username.clone(),
                };
                svc::transfer_guest_portal_account(&self.pool, auth.user_id, guest_id, input)
                    .await
                    .map_err(to_status)?;
                Ok(Response::new(pb::TransferGuestPortalAccountResponse {}))
            })
            .await
    }
}
