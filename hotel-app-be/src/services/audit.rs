use crate::core::db::{DbPool, DbTransaction};
use crate::core::error::ApiError;
use crate::models::AuditEvent;
use crate::models::{
    AuditCategoryCounts, AuditLogEntryWithUser, AuditLogExportJson, AuditLogQuery,
    AuditLogResponse, AuditLogRow, DbStatementsQuery,
};
use crate::repositories::audit::AuditRepository;
use crate::utils::pagination::normalize_pagination;
use chrono::Utc;
use serde_json::Value;

/// Client identity captured by the request middleware and copied onto audit
/// rows that omit `ip_address` / `user_agent` (most staff CRUD).
#[derive(Clone, Debug, Default)]
pub struct RequestAuditMeta {
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

tokio::task_local! {
    pub static REQUEST_AUDIT: RequestAuditMeta;
}

fn apply_request_meta(event: &mut AuditEvent<'_>) {
    if event.ip_address.is_some() && event.user_agent.is_some() {
        return;
    }
    let _ = REQUEST_AUDIT.try_with(|meta| {
        if event.ip_address.is_none() {
            event.ip_address = meta.ip_address.clone();
        }
        if event.user_agent.is_none() {
            event.user_agent = meta.user_agent.clone();
        }
    });
}

/// Audit logging service for tracking sensitive operations
pub struct AuditLog;

/// `details` keys whose values are replaced with `[redacted]` before the event
/// is persisted. Matching is substring-based on the lowercase key so variants
/// (`new_password`, `clientSecret`, `x-api-key`) are all caught. This is the
/// last line of defense — call sites should still never build details from
/// credential material.
const SENSITIVE_DETAIL_MARKERS: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "credential",
    "private_key",
    "totp",
    "recovery_code",
    "cvv",
    "card_number",
    "bearer",
    "signature",
    "email",
    "id_number",
    "ic_number",
    "passport",
    "phone",
    "nick_name",
    "full_name",
];

fn is_sensitive_detail_key(key: &str) -> bool {
    let key = key.to_lowercase();
    SENSITIVE_DETAIL_MARKERS
        .iter()
        .any(|marker| key.contains(marker))
}

/// Recursively redact sensitive keys in an audit `details` payload. Applied to
/// every event — both the non-fatal [`AuditLog::log_event`] path and the
/// transactional [`AuditLog::log_event_tx`] path — so a call site that
/// accidentally includes a secret degrades to `[redacted]` instead of
/// persisting it.
pub(crate) fn scrub_details(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                if is_sensitive_detail_key(key) {
                    *item = Value::String("[redacted]".to_string());
                } else {
                    scrub_details(item);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(scrub_details),
        _ => {}
    }
}

impl AuditLog {
    /// Log an audit event to the database
    ///
    /// # Arguments
    /// * `pool` - Database connection pool
    /// * `user_id` - ID of user performing the action (None for system actions)
    /// * `action` - Action being performed (e.g., "login_success", "role_assigned")
    /// * `resource_type` - Type of resource affected (e.g., "user", "booking", "room")
    /// * `resource_id` - ID of the resource affected
    /// * `details` - Additional details as JSON
    /// * `ip_address` - IP address of the requester
    /// * `user_agent` - User agent string from the request
    pub async fn log_event(pool: &DbPool, mut event: AuditEvent<'_>) -> Result<(), ApiError> {
        // Deliberately non-fatal: a failed audit write must not abort the
        // business operation it describes. The failure is still observable via
        // the AUDIT_WRITE_FAILURES metric and the warn log below.
        let action = event.action;
        let resource_type = event.resource_type;

        apply_request_meta(&mut event);
        if let Some(details) = &mut event.details {
            scrub_details(details);
        }
        let result = AuditRepository::insert_event(pool, event, Utc::now()).await;

        if let Err(e) = &result {
            // Every alert rule built on audit_logs inherits this swallow, so a
            // broken audit trail must be observable on its own. Non-zero here
            // means detection is silently degraded.
            crate::core::metrics::incr(&crate::core::metrics::AUDIT_WRITE_FAILURES);
            log::warn!(
                "Audit log failed (table may not exist): {} - Action: {}, Resource: {}",
                e,
                action,
                resource_type
            );
        }

        // Return Ok even if insert fails - don't block operations due to audit log issues
        Ok(())
    }

    pub async fn log_event_tx(
        tx: &mut DbTransaction<'_>,
        mut event: AuditEvent<'_>,
    ) -> Result<(), ApiError> {
        apply_request_meta(&mut event);
        if let Some(details) = &mut event.details {
            scrub_details(details);
        }
        AuditRepository::insert_event_tx(tx, event, Utc::now())
            .await
            .map_err(ApiError::from)
    }

    /// Log a successful login attempt
    pub async fn log_login_success(
        pool: &DbPool,
        user_id: i64,
        method: &str, // "password", "passkey", "2fa"
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "method": method,
            "success": true
        });

        Self::log_event(
            pool,
            AuditEvent {
                user_id: Some(user_id),
                action: "login_success",
                resource_type: "user",
                resource_id: Some(user_id),
                details: Some(details),
                ip_address,
                user_agent,
            },
        )
        .await
    }

    /// Log a failed login attempt
    pub async fn log_login_failure(
        pool: &DbPool,
        username: &str,
        reason: &str,
        ip_address: Option<String>,
        user_agent: Option<String>,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "username": username,
            "reason": reason,
            "success": false
        });

        Self::log_event(
            pool,
            AuditEvent {
                user_id: None,
                action: "login_failure",
                resource_type: "user",
                resource_id: None,
                details: Some(details),
                ip_address,
                user_agent,
            },
        )
        .await
    }

    /// Log role assignment. `role_name` is captured at write time so the event
    /// stays readable after the role is renamed or deleted.
    pub async fn log_role_assignment(
        pool: &DbPool,
        admin_id: i64,
        user_id: i64,
        role_id: i64,
        role_name: Option<&str>,
    ) -> Result<(), ApiError> {
        let mut details = serde_json::json!({
            "user_id": user_id,
            "role_id": role_id,
            "assigned_by": admin_id
        });
        if let Some(name) = role_name {
            details["role_name"] = serde_json::json!(name);
        }

        Self::log_event(
            pool,
            AuditEvent {
                user_id: Some(admin_id),
                action: "role_assigned",
                resource_type: "user_role",
                resource_id: Some(user_id),
                details: Some(details),
                ..Default::default()
            },
        )
        .await
    }

    /// Log role removal. `role_name` is captured at write time so the event
    /// stays readable after the role is renamed or deleted.
    pub async fn log_role_removal(
        pool: &DbPool,
        admin_id: i64,
        user_id: i64,
        role_id: i64,
        role_name: Option<&str>,
    ) -> Result<(), ApiError> {
        let mut details = serde_json::json!({
            "user_id": user_id,
            "role_id": role_id,
            "removed_by": admin_id
        });
        if let Some(name) = role_name {
            details["role_name"] = serde_json::json!(name);
        }

        Self::log_event(
            pool,
            AuditEvent {
                user_id: Some(admin_id),
                action: "role_removed",
                resource_type: "user_role",
                resource_id: Some(user_id),
                details: Some(details),
                ..Default::default()
            },
        )
        .await
    }

    /// Log booking creation
    pub async fn log_booking_created(
        pool: &DbPool,
        user_id: i64,
        booking_id: i64,
        guest_id: i64,
        room_id: i64,
    ) -> Result<(), ApiError> {
        let details = serde_json::json!({
            "booking_id": booking_id,
            "guest_id": guest_id,
            "room_id": room_id
        });

        Self::log_event(
            pool,
            AuditEvent {
                user_id: Some(user_id),
                action: "booking_created",
                resource_type: "booking",
                resource_id: Some(booking_id),
                details: Some(details),
                ..Default::default()
            },
        )
        .await
    }

    /// Log booking voiding with the current audit action name.
    pub async fn log_booking_voided_tx(
        tx: &mut DbTransaction<'_>,
        user_id: i64,
        booking_id: i64,
    ) -> Result<(), ApiError> {
        Self::log_event_tx(
            tx,
            AuditEvent {
                user_id: Some(user_id),
                action: "booking_voided",
                resource_type: "booking",
                resource_id: Some(booking_id),
                details: None,
                ..Default::default()
            },
        )
        .await
    }

    /// Log password change
    pub async fn log_password_changed(pool: &DbPool, user_id: i64) -> Result<(), ApiError> {
        Self::log_event(
            pool,
            AuditEvent {
                user_id: Some(user_id),
                action: "password_changed",
                resource_type: "user",
                resource_id: Some(user_id),
                details: None,
                ..Default::default()
            },
        )
        .await
    }
}

/// Single source of truth mapping an activity stream to the `resource_type`
/// values that belong to it.
const CATEGORY_MAP: &[(&str, &[&str])] = &[
    (
        "rooms",
        &[
            "room",
            "rooms",
            "room_type",
            "room_types",
            "rate",
            "rate_plan",
            "room_rate",
            "housekeeping",
            "maintenance",
            "online_inventory",
        ],
    ),
    (
        "guests",
        &[
            "guest",
            "guests",
            "ekyc_verification",
            "ekyc",
            "loyalty_member",
            "consent",
            "guest_segment",
        ],
    ),
    (
        "bookings",
        &[
            "booking",
            "bookings",
            "payment",
            "invoice",
            "customer_ledger",
            "voucher",
            "promotion",
            "booking_channel",
            "channel_pricing_rule",
            "channel_commission_rule",
        ],
    ),
    (
        "system",
        &[
            "user",
            "users",
            "user_role",
            "role",
            "roles",
            "permission",
            "permissions",
            "system_setting",
            "system_settings",
            "settings",
            "system",
            "team",
            "route_access_policy",
            "data_transfer",
            "support_conversation",
            "email_campaign",
            "email_template",
            "email_suppression",
            "company",
        ],
    ),
    (
        "reports",
        &[
            "report",
            "reports",
            "night_audit",
            "reconciliation",
            "export",
        ],
    ),
];

fn all_mapped_resource_types() -> Vec<String> {
    CATEGORY_MAP
        .iter()
        .flat_map(|(_, list)| list.iter().map(|value| (*value).to_string()))
        .collect()
}

/// Include-list for a named stream, or the mapped types to *exclude* for `other`.
struct CategoryBind {
    types: Vec<String>,
    invert: bool,
}

fn category_bind(category: Option<&str>) -> Option<CategoryBind> {
    match category.map(str::trim) {
        None | Some("") | Some("all") => None,
        Some("other") => Some(CategoryBind {
            types: all_mapped_resource_types(),
            invert: true,
        }),
        Some(name) => resource_types_for_category(name).map(|types| CategoryBind {
            types,
            invert: false,
        }),
    }
}

pub async fn get_audit_logs(
    pool: &DbPool,
    params: AuditLogQuery,
) -> Result<AuditLogResponse, ApiError> {
    let pagination = normalize_pagination(params.page, params.page_size, 25, 100);
    let sort_column = valid_sort_column(params.sort_by.as_deref());
    let sort_direction = sort_direction(params.sort_order.as_deref());
    let category = category_bind(params.category.as_deref());

    let (total, rows) = AuditRepository::list_logs(
        pool,
        &params,
        category.as_ref().map(|bind| bind.types.as_slice()),
        category.as_ref().is_some_and(|bind| bind.invert),
        sort_column,
        sort_direction,
        pagination.page_size,
        pagination.offset,
    )
    .await?;

    let total_pages = (total as f64 / pagination.page_size as f64).ceil() as i64;

    Ok(AuditLogResponse {
        data: rows.into_iter().map(row_to_entry).collect(),
        total,
        page: pagination.page,
        page_size: pagination.page_size,
        total_pages,
    })
}

/// Recent audit entries for a caller-pinned action set — the shape the
/// payment-approvals conflict banner needs without granting `audit:read`.
/// Returns `(entries, total)`; entries are capped at `limit`, `total` is the
/// untruncated count so callers can say "Showing N of M".
pub async fn get_recent_events_by_actions(
    pool: &DbPool,
    actions: &[&str],
    lookback_days: i64,
    limit: i64,
) -> Result<(Vec<AuditLogEntryWithUser>, i64), ApiError> {
    let (total, rows) =
        AuditRepository::list_recent_logs_by_actions(pool, actions, lookback_days, limit).await?;
    Ok((rows.into_iter().map(row_to_entry).collect(), total))
}

pub async fn get_audit_actions(pool: &DbPool) -> Result<Vec<String>, ApiError> {
    AuditRepository::list_actions(pool).await
}

pub async fn get_audit_resource_types(pool: &DbPool) -> Result<Vec<String>, ApiError> {
    AuditRepository::list_resource_types(pool).await
}

pub async fn export_audit_logs_csv(
    pool: &DbPool,
    user_id: i64,
    params: AuditLogQuery,
) -> Result<(String, String), ApiError> {
    let category = category_bind(params.category.as_deref());
    let rows = AuditRepository::list_logs_for_export(
        pool,
        &params,
        category.as_ref().map(|bind| bind.types.as_slice()),
        category.as_ref().is_some_and(|bind| bind.invert),
    )
    .await?;
    let truncated = rows.len() as i64 >= 10_000;
    let row_count = rows.len();
    let exported_by = AuditRepository::username_by_id(pool, user_id)
        .await?
        .unwrap_or_else(|| format!("user:{user_id}"));
    let exported_at = Utc::now();
    let details = serde_json::json!({
        "user_id": params.user_id,
        "action": params.action,
        "resource_type": params.resource_type,
        "resource_id": params.resource_id,
        "category": params.category,
        "start_date": params.start_date,
        "end_date": params.end_date,
        "search": params.search,
        "row_count": row_count,
        "truncated": truncated,
        "exported_by": exported_by,
    });

    // `Timestamp (UTC)` cells are RFC3339 — labeled because the screen shows
    // hotel-local time and the two must not be read as the same clock.
    let mut csv_content = format!(
        "# Exported by {exported_by} (user_id={user_id}) at {}\n# Times: UTC\n# Filters: user_id={:?} action={:?} resource_type={:?} resource_id={:?} category={:?} start_date={:?} end_date={:?} search={:?}\n# Rows: {row_count}; truncated={truncated}\n",
        exported_at.to_rfc3339(),
        params.user_id,
        params.action,
        params.resource_type,
        params.resource_id,
        params.category,
        params.start_date,
        params.end_date,
        params.search,
    );
    csv_content.push_str(
        "ID,Timestamp (UTC),User ID,Username,Action,Category,Resource Type,Resource ID,Display Ref,Change Kind,IP Address,User Agent,Details\n",
    );

    for row in rows.into_iter().map(row_to_entry) {
        let details_str = row
            .details
            .map(|details| serde_json::to_string(&details).unwrap_or_default())
            .unwrap_or_default();

        // Every cell goes through csv_cell: username and user_agent are
        // attacker-influenced (self-registration + HTTP header), so bare
        // formatting allowed both column-count breakage and formula
        // injection in the exported spreadsheet.
        let cells = [
            row.id.to_string(),
            row.created_at.to_rfc3339(),
            row.user_id.map(|id| id.to_string()).unwrap_or_default(),
            row.username.unwrap_or_default(),
            row.action,
            row.category,
            row.resource_type,
            row.resource_id.map(|id| id.to_string()).unwrap_or_default(),
            row.display_ref.clone().unwrap_or_default(),
            row.change_kind,
            row.ip_address.unwrap_or_default(),
            row.user_agent.unwrap_or_default(),
            details_str,
        ];
        let escaped = cells
            .iter()
            .map(|cell| crate::utils::sanitization::csv_cell(cell))
            .collect::<Vec<_>>()
            .join(",");

        csv_content.push_str(&escaped);
        csv_content.push('\n');
    }

    let filename = format!("audit_logs_{}.csv", Utc::now().format("%Y%m%d_%H%M%S"));

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "audit_logs_exported",
            resource_type: "export",
            resource_id: None,
            details: Some(details),
            ..Default::default()
        },
    )
    .await;

    Ok((filename, csv_content))
}

pub async fn export_audit_logs_json(
    pool: &DbPool,
    user_id: i64,
    params: AuditLogQuery,
) -> Result<AuditLogExportJson, ApiError> {
    let category = category_bind(params.category.as_deref());
    let rows = AuditRepository::list_logs_for_export(
        pool,
        &params,
        category.as_ref().map(|bind| bind.types.as_slice()),
        category.as_ref().is_some_and(|bind| bind.invert),
    )
    .await?;
    let truncated = rows.len() as i64 >= 10_000;
    let exported_by = AuditRepository::username_by_id(pool, user_id)
        .await?
        .unwrap_or_else(|| format!("user:{user_id}"));
    let exported_at = Utc::now();
    let data: Vec<AuditLogEntryWithUser> = rows.into_iter().map(row_to_entry).collect();
    let row_count = data.len() as i64;
    let details = serde_json::json!({
        "format": "json",
        "user_id": params.user_id,
        "action": params.action,
        "resource_type": params.resource_type,
        "resource_id": params.resource_id,
        "category": params.category,
        "start_date": params.start_date,
        "end_date": params.end_date,
        "search": params.search,
        "row_count": row_count,
        "truncated": truncated,
        "exported_by": exported_by,
    });
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(user_id),
            action: "audit_logs_exported",
            resource_type: "export",
            resource_id: None,
            details: Some(details),
            ..Default::default()
        },
    )
    .await;

    Ok(AuditLogExportJson {
        exported_by,
        exported_at,
        truncated,
        row_count,
        data,
    })
}

pub async fn get_audit_users(pool: &DbPool) -> Result<Vec<Value>, ApiError> {
    Ok(AuditRepository::list_users(pool)
        .await?
        .into_iter()
        .map(|user| serde_json::json!({"id": user.id, "username": user.username}))
        .collect())
}

pub async fn get_audit_category_counts(
    pool: &DbPool,
    params: AuditLogQuery,
) -> Result<AuditCategoryCounts, ApiError> {
    let rows = AuditRepository::count_by_resource_type(pool, &params).await?;
    let mut counts = AuditCategoryCounts::default();

    for row in rows {
        counts.total += row.count;
        match category_for_resource(&row.resource_type).as_str() {
            "rooms" => counts.rooms += row.count,
            "guests" => counts.guests += row.count,
            "bookings" => counts.bookings += row.count,
            "system" => counts.system += row.count,
            "reports" => counts.reports += row.count,
            _ => counts.other += row.count,
        }
    }

    Ok(counts)
}

pub async fn get_db_statements(
    pool: &DbPool,
    params: DbStatementsQuery,
) -> Result<Value, ApiError> {
    let limit = params.limit.unwrap_or(20).clamp(1, 200);

    {
        match AuditRepository::list_db_statements(pool, limit).await {
            Ok(statements) => Ok(serde_json::json!({
                "available": true,
                "statements": statements,
            })),
            Err(error) => {
                log::warn!("pg_stat_statements unavailable: {error}");
                Ok(serde_json::json!({
                    "available": false,
                    "reason": "pg_stat_statements is not installed or not accessible on this database.",
                    "statements": [],
                }))
            }
        }
    }
}

fn row_to_entry(row: AuditLogRow) -> AuditLogEntryWithUser {
    let mut details = row.details;
    if let Some(value) = details.as_mut() {
        scrub_details(value);
    }
    let has_changes = details_has_changes(details.as_ref());
    let display_ref = display_ref_from(details.as_ref());

    AuditLogEntryWithUser {
        id: row.id,
        user_id: row.user_id,
        username: row.username,
        action: row.action,
        category: category_for_resource(&row.resource_type),
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        display_ref,
        has_changes,
        change_kind: if has_changes {
            "field_change"
        } else {
            "action_only"
        }
        .to_string(),
        details,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: row.created_at,
    }
}

fn display_ref_from(details: Option<&Value>) -> Option<String> {
    let Value::Object(map) = details? else {
        return None;
    };
    for key in [
        "booking_number",
        "room_number",
        "folio_number",
        "invoice_number",
    ] {
        match map.get(key) {
            Some(Value::String(value)) if !value.is_empty() => return Some(value.clone()),
            Some(Value::Number(value)) => return Some(value.to_string()),
            _ => {}
        }
    }
    None
}

fn details_has_changes(details: Option<&Value>) -> bool {
    match details {
        Some(Value::Object(map)) => object_has_changes(map),
        _ => false,
    }
}

fn object_has_changes(map: &serde_json::Map<String, Value>) -> bool {
    has_pair_change(map, "old_value", "new_value")
        || has_pair_change(map, "old_values", "new_values")
        || has_pair_change(map, "before", "after")
        || has_prefixed_pair_change(map, "old_", "new_")
        || has_prefixed_pair_change(map, "from_", "to_")
        || has_prefixed_pair_change(map, "previous_", "new_")
        || map
            .get("changes")
            .map(changes_value_has_meaningful_change)
            .unwrap_or(false)
        // `changed_fields` is a list of field names (no values) emitted when a
        // caller knows what changed but cannot safely store the values — a
        // non-empty list means a field change happened.
        || map
            .get("changed_fields")
            .map(changes_value_has_meaningful_change)
            .unwrap_or(false)
}

fn has_pair_change(map: &serde_json::Map<String, Value>, old_key: &str, new_key: &str) -> bool {
    map.contains_key(old_key)
        && map.contains_key(new_key)
        && pair_indicates_change(map.get(old_key), map.get(new_key))
}

fn has_prefixed_pair_change(
    map: &serde_json::Map<String, Value>,
    old_prefix: &str,
    new_prefix: &str,
) -> bool {
    map.iter().any(|(key, old_value)| {
        let Some(suffix) = key.strip_prefix(old_prefix) else {
            return false;
        };
        map.get(&format!("{}{}", new_prefix, suffix))
            .map(|new_value| pair_indicates_change(Some(old_value), Some(new_value)))
            .unwrap_or(false)
    })
}

fn pair_indicates_change(old_value: Option<&Value>, new_value: Option<&Value>) -> bool {
    match (old_value, new_value) {
        (Some(old_value), Some(new_value)) => old_value != new_value,
        (Some(value), None) | (None, Some(value)) => is_meaningful_change_value(value),
        (None, None) => false,
    }
}

fn changes_value_has_meaningful_change(value: &Value) -> bool {
    match value {
        Value::Object(map) => {
            object_has_changes(map) || map.values().any(is_meaningful_change_value)
        }
        Value::Array(values) => values.iter().any(changes_value_has_meaningful_change),
        _ => is_meaningful_change_value(value),
    }
}

fn is_meaningful_change_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Array(values) => !values.is_empty(),
        Value::Object(map) => !map.is_empty(),
        _ => true,
    }
}

fn resource_types_for_category(category: &str) -> Option<Vec<String>> {
    CATEGORY_MAP
        .iter()
        .find(|(candidate, _)| *candidate == category)
        .map(|(_, list)| list.iter().map(|value| value.to_string()).collect())
}

fn category_for_resource(resource_type: &str) -> String {
    CATEGORY_MAP
        .iter()
        .find(|(_, list)| list.contains(&resource_type))
        .map(|(category, _)| (*category).to_string())
        .unwrap_or_else(|| "other".to_string())
}

fn valid_sort_column(sort_by: Option<&str>) -> &'static str {
    match sort_by {
        Some("id") => "id",
        Some("created_at") => "created_at",
        Some("action") => "action",
        Some("resource_type") => "resource_type",
        Some("user_id") => "user_id",
        _ => "created_at",
    }
}

fn sort_direction(sort_order: Option<&str>) -> &'static str {
    if sort_order
        .map(|value| value.eq_ignore_ascii_case("asc"))
        .unwrap_or(false)
    {
        "ASC"
    } else {
        "DESC"
    }
}

#[cfg(test)]
mod tests {
    use super::details_has_changes;
    use super::display_ref_from;
    use super::scrub_details;
    use super::{category_for_resource, resource_types_for_category};
    use serde_json::json;

    #[test]
    fn scrub_details_redacts_sensitive_keys_at_any_depth() {
        let mut details = json!({
            "username": "jdoe",
            "password": "hunter2",
            "nested": {
                "client_secret": "abc",
                "apiKey": "xyz",
                "note": "safe"
            },
            "items": [{"refresh_token": "rt"}, {"count": 3}]
        });
        scrub_details(&mut details);
        assert_eq!(details["username"], "jdoe");
        assert_eq!(details["password"], "[redacted]");
        let mut pii = json!({"email": "a@b.c", "id_number": "990101-01-1234", "note": "ok"});
        scrub_details(&mut pii);
        assert_eq!(pii["email"], "[redacted]");
        assert_eq!(pii["id_number"], "[redacted]");
        assert_eq!(pii["note"], "ok");
        assert_eq!(details["nested"]["client_secret"], "[redacted]");
        assert_eq!(details["nested"]["apiKey"], "[redacted]");
        assert_eq!(details["nested"]["note"], "safe");
        assert_eq!(details["items"][0]["refresh_token"], "[redacted]");
        assert_eq!(details["items"][1]["count"], 3);
    }

    #[test]
    fn scrub_details_leaves_non_objects_untouched() {
        let mut value = json!("plain");
        scrub_details(&mut value);
        assert_eq!(value, "plain");
    }

    #[test]
    fn classifies_null_or_metadata_only_details_as_action_only() {
        assert!(!details_has_changes(None));
        assert!(!details_has_changes(Some(&json!({
            "method": "password",
            "success": true
        }))));
    }

    #[test]
    fn classifies_old_new_payloads_as_field_changes_only_when_values_differ() {
        assert!(details_has_changes(Some(&json!({
            "key": "night_shift_time",
            "old_value": "22:00",
            "new_value": "23:00"
        }))));
        assert!(!details_has_changes(Some(&json!({
            "key": "night_shift_time",
            "old_value": "23:00",
            "new_value": "23:00"
        }))));
    }

    #[test]
    fn classifies_prefixed_before_after_pairs_as_field_changes() {
        assert!(details_has_changes(Some(&json!({
            "room_number": "101",
            "from_status": "cleaning",
            "to_status": "available"
        }))));
        assert!(!details_has_changes(Some(&json!({
            "room_number": "101",
            "from_status": "available",
            "to_status": "available"
        }))));
    }

    #[test]
    fn classifies_changes_payloads_by_meaningful_values() {
        assert!(!details_has_changes(Some(&json!({
            "changes": {
                "room_id": null,
                "status": null
            }
        }))));
        assert!(details_has_changes(Some(&json!({
            "changes": {
                "room_id": 12,
                "status": null
            }
        }))));
    }

    #[test]
    fn classifies_changed_fields_lists_by_content() {
        assert!(details_has_changes(Some(&json!({
            "changed_fields": ["is_active", "email"]
        }))));
        assert!(!details_has_changes(Some(&json!({
            "changed_fields": []
        }))));
    }

    #[test]
    fn maps_report_resources_to_report_activity() {
        assert_eq!(category_for_resource("report"), "reports");
        assert_eq!(category_for_resource("night_audit"), "reports");
        assert_eq!(category_for_resource("export"), "reports");

        let report_types = resource_types_for_category("reports").expect("reports category");
        assert!(report_types.contains(&"report".to_string()));
        assert!(report_types.contains(&"night_audit".to_string()));
        assert!(report_types.contains(&"export".to_string()));
    }

    #[test]
    fn maps_money_and_ops_resources_out_of_other() {
        assert_eq!(category_for_resource("payment"), "bookings");
        assert_eq!(category_for_resource("customer_ledger"), "bookings");
        assert_eq!(category_for_resource("invoice"), "bookings");
        assert_eq!(category_for_resource("maintenance"), "rooms");
        assert_eq!(category_for_resource("room_rate"), "rooms");
        assert_eq!(category_for_resource("data_transfer"), "system");
        assert_eq!(category_for_resource("unknown_widget"), "other");
    }

    #[test]
    fn display_ref_prefers_confirmation_numbers() {
        assert_eq!(
            display_ref_from(Some(&json!({"booking_number": "BK-4471", "room_id": 9}))),
            Some("BK-4471".to_string())
        );
        assert_eq!(display_ref_from(Some(&json!({"room_id": 9}))), None);
    }

    #[tokio::test]
    async fn request_scope_fills_missing_ip_and_user_agent() {
        super::REQUEST_AUDIT
            .scope(
                super::RequestAuditMeta {
                    ip_address: Some("203.0.113.9".to_string()),
                    user_agent: Some("front-desk-tablet".to_string()),
                },
                async {
                    let mut event = crate::models::AuditEvent {
                        action: "ping",
                        resource_type: "system",
                        ..Default::default()
                    };
                    super::apply_request_meta(&mut event);
                    assert_eq!(event.ip_address.as_deref(), Some("203.0.113.9"));
                    assert_eq!(event.user_agent.as_deref(), Some("front-desk-tablet"));
                },
            )
            .await;
    }
}
