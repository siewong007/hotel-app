//! RBAC business workflows.

use super::repository::RbacRepository;
use crate::core::db::DbPool;
use crate::core::error::ApiError;
use crate::models::*;
use crate::modules::users::repository::UserRepository;
use crate::services::audit::AuditLog;
use std::collections::HashSet;

/// Post-incident reconstruction of "how was privilege gained?" needs every
/// role/permission DEFINITION change on the record, not just user-role
/// assignments (which were already audited). One shared emitter so all nine
/// mutating workflows stay consistent.
async fn log_rbac_definition_change(
    pool: &DbPool,
    actor_user_id: i64,
    action: &str,
    resource_type: &'static str,
    resource_id: Option<i64>,
    details: serde_json::Value,
) {
    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_user_id),
            action,
            resource_type,
            resource_id,
            details: Some(details),
            ..Default::default()
        },
    )
    .await;
}

pub async fn roles(pool: &DbPool) -> Result<Vec<Role>, ApiError> {
    RbacRepository::find_all_roles(pool).await
}

pub async fn create_role(
    pool: &DbPool,
    actor_user_id: i64,
    input: RoleInput,
) -> Result<Role, ApiError> {
    let role = RbacRepository::create_role(pool, &input.name, input.description.as_deref()).await?;
    log_rbac_definition_change(
        pool,
        actor_user_id,
        "role_created",
        "role",
        Some(role.id),
        serde_json::json!({ "name": role.name }),
    )
    .await;
    Ok(role)
}

pub async fn permissions(pool: &DbPool) -> Result<Vec<Permission>, ApiError> {
    RbacRepository::find_all_permissions(pool).await
}

pub async fn snapshot(pool: &DbPool) -> Result<RbacSnapshot, ApiError> {
    let roles = RbacRepository::find_all_roles(pool).await?;
    let permissions = RbacRepository::find_all_permissions(pool).await?;
    let users = UserRepository::list_all(pool)
        .await?
        .into_iter()
        .map(UserResponse::from)
        .collect();
    let role_permissions = RbacRepository::role_permission_assignments(pool).await?;
    let user_roles = RbacRepository::user_role_assignments(pool).await?;
    let route_policies = RbacRepository::find_all_route_access_policies(pool).await?;

    Ok(RbacSnapshot {
        roles,
        permissions,
        users,
        role_permissions,
        user_roles,
        route_policies,
    })
}

pub async fn route_policies(pool: &DbPool) -> Result<Vec<RouteAccessPolicy>, ApiError> {
    RbacRepository::find_all_route_access_policies(pool).await
}

/// The Access Control page's own route id. A bad page rule is undone from
/// that page, so a change to its rule must leave the person saving it able to
/// open it.
const ACCESS_CONTROL_ROUTE_ID: &str = "rbac";

pub async fn update_route_policy(
    pool: &DbPool,
    actor_user_id: i64,
    route_id: String,
    input: RouteAccessPolicyInput,
) -> Result<RouteAccessPolicy, ApiError> {
    validate_route_policy_input(&input)?;

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;
    let before = RbacRepository::find_route_access_policy_for_update(&mut *tx, &route_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Route access policy not found".to_string()))?;
    ensure_route_policy_names_exist(pool, &before, &input).await?;
    if route_id == ACCESS_CONTROL_ROUTE_ID {
        ensure_actor_keeps_page_access(pool, actor_user_id, &input).await?;
    }
    let policy = RbacRepository::update_route_access_policy(&mut *tx, &route_id, &input).await?;
    tx.commit()
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?;

    let _ = AuditLog::log_event(
        pool,
        AuditEvent {
            user_id: Some(actor_user_id),
            action: "route_policy_updated",
            resource_type: "route_access_policy",
            resource_id: None,
            details: Some(serde_json::json!({
                "route_id": policy.route_id,
                "before": route_policy_audit_values(&before),
                "after": route_policy_audit_values(&policy),
            })),
            ..Default::default()
        },
    )
    .await;
    Ok(policy)
}

/// The editable fields of a route policy, for the audit trail's before/after
/// pair (the audit log page lists only the fields that changed).
fn route_policy_audit_values(policy: &RouteAccessPolicy) -> serde_json::Value {
    serde_json::json!({
        "nav_label": policy.nav_label,
        "nav_group": policy.nav_group,
        "required_permissions": policy.required_permissions,
        "required_roles": policy.required_roles,
        "excluded_roles": policy.excluded_roles,
        "nav_permissions": policy.nav_permissions,
        "nav_roles": policy.nav_roles,
        "nav_excluded_roles": policy.nav_excluded_roles,
        "is_navigation": policy.is_navigation,
    })
}

/// Every permission and role a rule newly names must exist: a misspelt name
/// matches nobody, so it would quietly hide a page from everyone it was meant
/// for. Names the stored rule already carries are left alone, so a rule that
/// predates a renamed permission can still be saved while it is tidied up.
async fn ensure_route_policy_names_exist(
    pool: &DbPool,
    before: &RouteAccessPolicy,
    input: &RouteAccessPolicyInput,
) -> Result<(), ApiError> {
    let known_permissions: HashSet<&str> = before
        .required_permissions
        .iter()
        .chain(&before.nav_permissions)
        .map(String::as_str)
        .collect();
    let new_permissions = newly_named(
        [&input.required_permissions, &input.nav_permissions],
        &known_permissions,
    );
    let existing = RbacRepository::existing_permission_names(pool, &new_permissions).await?;
    reject_unknown(&new_permissions, &existing, "permission")?;

    let known_roles: HashSet<&str> = before
        .required_roles
        .iter()
        .chain(&before.excluded_roles)
        .chain(&before.nav_roles)
        .chain(&before.nav_excluded_roles)
        .map(String::as_str)
        .collect();
    let new_roles = newly_named(
        [
            &input.required_roles,
            &input.excluded_roles,
            &input.nav_roles,
            &input.nav_excluded_roles,
        ],
        &known_roles,
    );
    let existing = RbacRepository::existing_role_names(pool, &new_roles).await?;
    reject_unknown(&new_roles, &existing, "role")
}

/// Distinct names across `lists` that `known` does not already contain.
fn newly_named<const N: usize>(lists: [&[String]; N], known: &HashSet<&str>) -> Vec<String> {
    let mut seen = HashSet::new();
    lists
        .into_iter()
        .flatten()
        .filter(|name| !known.contains(name.as_str()) && seen.insert(name.as_str()))
        .cloned()
        .collect()
}

fn reject_unknown(
    names: &[String],
    existing: &HashSet<String>,
    kind: &str,
) -> Result<(), ApiError> {
    let mut unknown: Vec<&str> = names
        .iter()
        .filter(|name| !existing.contains(*name))
        .map(String::as_str)
        .collect();
    if unknown.is_empty() {
        return Ok(());
    }
    unknown.sort_unstable();
    Err(ApiError::BadRequest(format!(
        "Unknown {kind} in route policy: {}",
        unknown.join(", ")
    )))
}

async fn ensure_actor_keeps_page_access(
    pool: &DbPool,
    actor_user_id: i64,
    input: &RouteAccessPolicyInput,
) -> Result<(), ApiError> {
    let permissions = RbacRepository::permission_names_for_user(pool, actor_user_id).await?;
    let roles: HashSet<String> = crate::core::AuthService::get_user_roles(pool, actor_user_id)
        .await
        .map_err(|e| ApiError::Database(e.to_string()))?
        .into_iter()
        .collect();

    if page_rule_admits(input, &permissions, &roles) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "This change would lock you out of Access Control. Keep a permission or role \
             you hold among those that can open it."
                .to_string(),
        ))
    }
}

/// Whether a page rule lets someone holding `permissions` and `roles` open the
/// page. Mirrors `policyAdmits` in `hotel-web-fe/src/navigation/routeAccess.ts`,
/// the check the app applies before rendering a page: any listed permission
/// or any listed role admits, an empty rule admits everyone, and an excluded
/// role always refuses.
fn page_rule_admits(
    input: &RouteAccessPolicyInput,
    permissions: &HashSet<String>,
    roles: &HashSet<String>,
) -> bool {
    let has_role = |role: &String| roles.contains(role);
    let has_permission = |permission: &String| holds(permissions, permission);

    let admitted = if !input.required_permissions.is_empty() {
        input.required_permissions.iter().any(has_permission)
            || input.required_roles.iter().any(has_role)
    } else if !input.required_roles.is_empty() {
        input.required_roles.iter().any(has_role)
    } else {
        true
    };

    admitted && !input.excluded_roles.iter().any(has_role)
}

pub async fn create_permission(
    pool: &DbPool,
    actor_user_id: i64,
    input: PermissionInput,
) -> Result<Permission, ApiError> {
    let permission = RbacRepository::create_permission(
        pool,
        &input.name,
        &input.resource,
        &input.action,
        input.description.as_deref(),
    )
    .await?;
    log_rbac_definition_change(
        pool,
        actor_user_id,
        "permission_created",
        "permission",
        Some(permission.id),
        serde_json::json!({ "name": permission.name }),
    )
    .await;
    Ok(permission)
}

pub async fn assign_role_to_user(
    pool: &DbPool,
    actor_user_id: i64,
    input: AssignRoleInput,
) -> Result<(), ApiError> {
    ensure_actor_can_manage_roles(pool, actor_user_id, &[input.role_id]).await?;
    RbacRepository::assign_role_to_user(pool, input.user_id, input.role_id, actor_user_id).await?;
    // Name lookup is audit enrichment only — never fail the assignment for it.
    let role_name = RbacRepository::find_role_by_id(pool, input.role_id)
        .await
        .ok()
        .flatten()
        .map(|role| role.name);
    let _ = AuditLog::log_role_assignment(
        pool,
        actor_user_id,
        input.user_id,
        input.role_id,
        role_name.as_deref(),
    )
    .await;
    crate::core::rbac_cache::invalidate_all(pool).await;
    Ok(())
}

pub async fn remove_role_from_user(
    pool: &DbPool,
    actor_user_id: i64,
    user_id: i64,
    role_id: i64,
) -> Result<(), ApiError> {
    ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;
    RbacRepository::remove_role_from_user(pool, user_id, role_id).await?;
    let role_name = RbacRepository::find_role_by_id(pool, role_id)
        .await
        .ok()
        .flatten()
        .map(|role| role.name);
    let _ = AuditLog::log_role_removal(pool, actor_user_id, user_id, role_id, role_name.as_deref())
        .await;
    crate::core::rbac_cache::invalidate_all(pool).await;
    Ok(())
}

pub async fn assign_permission_to_role(
    pool: &DbPool,
    actor_user_id: i64,
    input: AssignPermissionInput,
) -> Result<(), ApiError> {
    ensure_can_mutate_role_permissions(pool, actor_user_id, input.role_id).await?;
    ensure_actor_can_manage_roles(pool, actor_user_id, &[input.role_id]).await?;
    ensure_actor_can_grant_permissions(pool, actor_user_id, &[input.permission_id]).await?;
    RbacRepository::assign_permission_to_role(
        pool,
        input.role_id,
        input.permission_id,
        actor_user_id,
    )
    .await?;
    log_rbac_definition_change(
        pool,
        actor_user_id,
        "permission_assigned_to_role",
        "role",
        Some(input.role_id),
        serde_json::json!({ "permission_id": input.permission_id }),
    )
    .await;
    crate::core::rbac_cache::invalidate_all(pool).await;
    Ok(())
}

pub async fn remove_permission_from_role(
    pool: &DbPool,
    actor_user_id: i64,
    role_id: i64,
    permission_id: i64,
) -> Result<(), ApiError> {
    ensure_can_mutate_role_permissions(pool, actor_user_id, role_id).await?;
    ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;
    RbacRepository::remove_permission_from_role(pool, role_id, permission_id).await?;
    log_rbac_definition_change(
        pool,
        actor_user_id,
        "permission_removed_from_role",
        "role",
        Some(role_id),
        serde_json::json!({ "permission_id": permission_id }),
    )
    .await;
    crate::core::rbac_cache::invalidate_all(pool).await;
    Ok(())
}

pub async fn replace_role_permissions(
    pool: &DbPool,
    actor_user_id: i64,
    role_id: i64,
    input: RolePermissionIdsInput,
) -> Result<usize, ApiError> {
    if !RbacRepository::role_exists(pool, role_id).await? {
        return Err(ApiError::NotFound("Role not found".to_string()));
    }
    ensure_can_mutate_role_permissions(pool, actor_user_id, role_id).await?;
    ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;

    let permission_ids = unique_ids(input.permission_ids);
    ensure_actor_can_grant_permissions(pool, actor_user_id, &permission_ids).await?;
    let previous: HashSet<i64> = RbacRepository::get_role_permissions(pool, role_id)
        .await?
        .into_iter()
        .map(|permission| permission.id)
        .collect();
    RbacRepository::replace_role_permissions(pool, role_id, &permission_ids, actor_user_id).await?;
    let next: HashSet<i64> = permission_ids.iter().copied().collect();
    log_rbac_definition_change(
        pool,
        actor_user_id,
        "role_permissions_replaced",
        "role",
        Some(role_id),
        serde_json::json!({
            "granted": next.difference(&previous).collect::<Vec<_>>(),
            "revoked": previous.difference(&next).collect::<Vec<_>>(),
        }),
    )
    .await;
    crate::core::rbac_cache::invalidate_all(pool).await;
    Ok(permission_ids.len())
}

pub async fn replace_user_roles(
    pool: &DbPool,
    admin_user_id: i64,
    user_id: i64,
    input: UserRoleIdsInput,
) -> Result<usize, ApiError> {
    if !UserRepository::exists(pool, user_id).await? {
        return Err(ApiError::NotFound("User not found".to_string()));
    }

    let current_role_ids = RbacRepository::user_role_ids(pool, user_id).await?;
    let role_ids = unique_ids(input.role_ids);
    ensure_actor_can_manage_roles(pool, admin_user_id, &current_role_ids).await?;
    ensure_actor_can_manage_roles(pool, admin_user_id, &role_ids).await?;
    RbacRepository::replace_user_roles(pool, user_id, &role_ids, admin_user_id).await?;

    let current: HashSet<i64> = current_role_ids.into_iter().collect();
    let next: HashSet<i64> = role_ids.iter().copied().collect();

    // One bulk name lookup for the changed roles — audit enrichment only.
    let changed: Vec<i64> = next.symmetric_difference(&current).copied().collect();
    let role_names = RbacRepository::role_names_for_ids(pool, &changed)
        .await
        .unwrap_or_default();

    for role_id in next.difference(&current) {
        let _ = AuditLog::log_role_assignment(
            pool,
            admin_user_id,
            user_id,
            *role_id,
            role_names.get(role_id).map(String::as_str),
        )
        .await;
    }
    for role_id in current.difference(&next) {
        let _ = AuditLog::log_role_removal(
            pool,
            admin_user_id,
            user_id,
            *role_id,
            role_names.get(role_id).map(String::as_str),
        )
        .await;
    }

    crate::core::rbac_cache::invalidate_all(pool).await;
    Ok(role_ids.len())
}

pub async fn role_permissions(
    pool: &DbPool,
    role_id: i64,
) -> Result<RoleWithPermissions, ApiError> {
    let role = RbacRepository::find_role_by_id(pool, role_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Role not found".to_string()))?;
    let permissions = RbacRepository::get_role_permissions(pool, role_id).await?;
    Ok(RoleWithPermissions { role, permissions })
}

pub async fn update_role(
    pool: &DbPool,
    actor_user_id: i64,
    role_id: i64,
    input: RoleInput,
) -> Result<Role, ApiError> {
    match RbacRepository::role_system_status(pool, role_id).await? {
        None => Err(ApiError::NotFound("Role not found".to_string())),
        Some(true) => Err(ApiError::BadRequest(
            "Cannot modify system roles".to_string(),
        )),
        Some(false) => {
            ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;
            let role = RbacRepository::update_role(
                pool,
                role_id,
                &input.name,
                input.description.as_deref(),
            )
            .await?;
            log_rbac_definition_change(
                pool,
                actor_user_id,
                "role_updated",
                "role",
                Some(role_id),
                serde_json::json!({ "name": role.name }),
            )
            .await;
            crate::core::rbac_cache::invalidate_all(pool).await;
            Ok(role)
        }
    }
}

pub async fn delete_role(pool: &DbPool, actor_user_id: i64, role_id: i64) -> Result<(), ApiError> {
    match RbacRepository::role_system_status(pool, role_id).await? {
        None => return Err(ApiError::NotFound("Role not found".to_string())),
        Some(true) => {
            return Err(ApiError::BadRequest(
                "Cannot delete system roles".to_string(),
            ));
        }
        Some(false) => {}
    }
    ensure_actor_can_manage_roles(pool, actor_user_id, &[role_id]).await?;

    let user_count = RbacRepository::user_count_for_role(pool, role_id).await?;
    if user_count > 0 {
        return Err(ApiError::BadRequest(format!(
            "Cannot delete role: {} user(s) still have this role assigned",
            user_count
        )));
    }

    RbacRepository::delete_role(pool, role_id).await?;
    log_rbac_definition_change(
        pool,
        actor_user_id,
        "role_deleted",
        "role",
        Some(role_id),
        serde_json::Value::Null,
    )
    .await;
    crate::core::rbac_cache::invalidate_all(pool).await;
    Ok(())
}

pub async fn update_permission(
    pool: &DbPool,
    actor_user_id: i64,
    permission_id: i64,
    input: PermissionInput,
) -> Result<Permission, ApiError> {
    match RbacRepository::permission_system_status(pool, permission_id).await? {
        None => Err(ApiError::NotFound("Permission not found".to_string())),
        Some(true) => Err(ApiError::BadRequest(
            "Cannot modify system permissions".to_string(),
        )),
        Some(false) => {
            let current_name = RbacRepository::permission_name(pool, permission_id)
                .await?
                .ok_or_else(|| ApiError::NotFound("Permission not found".to_string()))?;
            if input.name != current_name {
                ensure_no_page_rule_names(pool, &current_name, "rename").await?;
            }
            let permission = RbacRepository::update_permission(
                pool,
                permission_id,
                &input.name,
                &input.resource,
                &input.action,
                input.description.as_deref(),
            )
            .await?;
            log_rbac_definition_change(
                pool,
                actor_user_id,
                "permission_updated",
                "permission",
                Some(permission_id),
                serde_json::json!({ "name": permission.name }),
            )
            .await;
            crate::core::rbac_cache::invalidate_all(pool).await;
            Ok(permission)
        }
    }
}

pub async fn delete_permission(
    pool: &DbPool,
    actor_user_id: i64,
    permission_id: i64,
) -> Result<(), ApiError> {
    match RbacRepository::permission_system_status(pool, permission_id).await? {
        None => return Err(ApiError::NotFound("Permission not found".to_string())),
        Some(true) => {
            return Err(ApiError::BadRequest(
                "Cannot delete system permissions".to_string(),
            ));
        }
        Some(false) => {}
    }

    let role_count = RbacRepository::role_count_for_permission(pool, permission_id).await?;
    if role_count > 0 {
        return Err(ApiError::BadRequest(format!(
            "Cannot delete permission: {} role(s) still have this permission assigned",
            role_count
        )));
    }
    let name = RbacRepository::permission_name(pool, permission_id)
        .await?
        .ok_or_else(|| ApiError::NotFound("Permission not found".to_string()))?;
    ensure_no_page_rule_names(pool, &name, "delete").await?;

    RbacRepository::delete_permission(pool, permission_id).await?;
    log_rbac_definition_change(
        pool,
        actor_user_id,
        "permission_deleted",
        "permission",
        Some(permission_id),
        serde_json::json!({ "name": name }),
    )
    .await;
    crate::core::rbac_cache::invalidate_all(pool).await;
    Ok(())
}

/// Page access rules hold permission names, so deleting or renaming one a
/// rule still names would leave the rule matching nobody: a page could
/// quietly disappear for everyone it was meant for.
async fn ensure_no_page_rule_names(
    pool: &DbPool,
    permission: &str,
    verb: &str,
) -> Result<(), ApiError> {
    let rules = RbacRepository::route_policy_count_for_permission(pool, permission).await?;
    if rules == 0 {
        return Ok(());
    }
    Err(ApiError::BadRequest(format!(
        "Cannot {verb} permission {permission}: {rules} page access rule(s) still use it"
    )))
}

fn unique_ids(ids: Vec<i64>) -> Vec<i64> {
    let mut seen = HashSet::new();
    ids.into_iter().filter(|id| seen.insert(*id)).collect()
}

fn validate_access_code(value: &str, kind: &str) -> Result<(), ApiError> {
    let valid = value
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-' || c == ':')
        && value.len() <= 100
        && !value.is_empty();

    if valid {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "Invalid {kind} value in route policy: {value}"
        )))
    }
}

fn validate_access_codes(values: &[String], kind: &str) -> Result<(), ApiError> {
    for value in values {
        validate_access_code(value, kind)?;
    }
    Ok(())
}

fn validate_route_policy_input(input: &RouteAccessPolicyInput) -> Result<(), ApiError> {
    validate_access_codes(&input.required_permissions, "permission")?;
    validate_access_codes(&input.nav_permissions, "permission")?;
    validate_access_codes(&input.required_roles, "role")?;
    validate_access_codes(&input.excluded_roles, "role")?;
    validate_access_codes(&input.nav_roles, "role")?;
    validate_access_codes(&input.nav_excluded_roles, "role")
}

/// Reject any attempt to act on a role the actor may not manage.
///
/// Two independent conditions, both required:
///
/// 1. **Priority** — the actor must strictly outrank the role.
/// 2. **Superset** — the actor must already hold every permission the role
///    confers.
///
/// Priority alone is not sufficient, and that gap was exploitable: the seeded
/// `manager` role (priority 80) outranks `senior_reviewer` (priority 75) but
/// holds none of its `ekyc:*` permissions, so a manager could assign
/// *themselves* `senior_reviewer` and acquire `ekyc:override`. The superset
/// rule is what makes "you cannot hand out what you do not have" true.
///
/// Super admins bypass both conditions — they are the ceiling of the
/// hierarchy, not a participant in it.
///
/// Shared with [`crate::modules::users::service`], which applies it to user records.
pub(crate) async fn ensure_actor_can_manage_roles(
    pool: &DbPool,
    actor_user_id: i64,
    role_ids: &[i64],
) -> Result<(), ApiError> {
    if role_ids.is_empty() {
        return Ok(());
    }

    if crate::core::middleware::is_super_admin(pool, actor_user_id).await? {
        return Ok(());
    }

    let actor_priority = RbacRepository::max_role_priority_for_user(pool, actor_user_id).await?;
    for role_id in role_ids {
        let role_priority = RbacRepository::role_priority(pool, *role_id)
            .await?
            .ok_or_else(|| {
                ApiError::BadRequest(format!("Role with id {} does not exist", role_id))
            })?;

        if role_priority >= actor_priority {
            return Err(ApiError::Forbidden(
                "Cannot manage a role at or above your access priority".to_string(),
            ));
        }
    }

    let conferred = RbacRepository::permission_names_for_roles(pool, role_ids).await?;
    ensure_actor_holds_all(pool, actor_user_id, &conferred).await
}

/// Reject a direct permission grant the actor does not itself hold.
///
/// The role-shaped guard above cannot cover this path: `assign_permission_to_role`
/// and `replace_role_permissions` name permissions by id, not through a role.
pub(crate) async fn ensure_actor_can_grant_permissions(
    pool: &DbPool,
    actor_user_id: i64,
    permission_ids: &[i64],
) -> Result<(), ApiError> {
    if permission_ids.is_empty() {
        return Ok(());
    }

    if crate::core::middleware::is_super_admin(pool, actor_user_id).await? {
        return Ok(());
    }

    let conferred = RbacRepository::permission_names_for_ids(pool, permission_ids).await?;
    ensure_actor_holds_all(pool, actor_user_id, &conferred).await
}

/// A system role's permission set may only be changed by a super admin.
///
/// `update_role` and `delete_role` already refuse system roles outright; the
/// three permission-membership paths had no equivalent guard, so any actor who
/// merely outranked a system role could empty its permission set.
async fn ensure_can_mutate_role_permissions(
    pool: &DbPool,
    actor_user_id: i64,
    role_id: i64,
) -> Result<(), ApiError> {
    match RbacRepository::role_system_status(pool, role_id).await? {
        None => Err(ApiError::NotFound("Role not found".to_string())),
        Some(true) => crate::core::middleware::ensure_super_admin(pool, actor_user_id).await,
        Some(false) => Ok(()),
    }
}

/// The superset rule: every permission in `conferred` must already be held by
/// the actor.
async fn ensure_actor_holds_all(
    pool: &DbPool,
    actor_user_id: i64,
    conferred: &HashSet<String>,
) -> Result<(), ApiError> {
    if conferred.is_empty() {
        return Ok(());
    }

    let held = RbacRepository::permission_names_for_user(pool, actor_user_id).await?;
    match conferred.iter().find(|name| !holds(&held, name)) {
        Some(missing) => Err(ApiError::Forbidden(format!(
            "Cannot grant a permission you do not hold: {missing}"
        ))),
        None => Ok(()),
    }
}

/// Membership test mirroring [`crate::core::rbac_cache::has_permission`]:
/// holding `<resource>:manage` implies every action on that resource.
fn holds(held: &HashSet<String>, permission: &str) -> bool {
    held.contains(permission)
        || permission
            .split_once(':')
            .is_some_and(|(resource, _)| held.contains(&format!("{resource}:manage")))
}

/// Priority guard for a whole user: the actor must outrank every role the
/// target holds.
pub(crate) async fn ensure_actor_can_manage_user(
    pool: &DbPool,
    actor_user_id: i64,
    target_user_id: i64,
) -> Result<(), ApiError> {
    let target_role_ids = RbacRepository::user_role_ids(pool, target_user_id).await?;
    ensure_actor_can_manage_roles(pool, actor_user_id, &target_role_ids).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(
        required_permissions: &[&str],
        required_roles: &[&str],
        excluded_roles: &[&str],
    ) -> RouteAccessPolicyInput {
        let owned = |values: &[&str]| values.iter().map(|value| value.to_string()).collect();
        RouteAccessPolicyInput {
            nav_label: None,
            nav_group: None,
            required_permissions: owned(required_permissions),
            required_roles: owned(required_roles),
            excluded_roles: owned(excluded_roles),
            nav_permissions: Vec::new(),
            nav_roles: Vec::new(),
            nav_excluded_roles: Vec::new(),
            is_navigation: true,
        }
    }

    fn set(values: &[&str]) -> HashSet<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn an_empty_page_rule_admits_everyone() {
        assert!(page_rule_admits(&rule(&[], &[], &[]), &set(&[]), &set(&[])));
    }

    #[test]
    fn any_listed_permission_admits() {
        let input = rule(&["roles:read", "users:read"], &[], &[]);
        assert!(page_rule_admits(&input, &set(&["users:read"]), &set(&[])));
        assert!(!page_rule_admits(
            &input,
            &set(&["bookings:read"]),
            &set(&[])
        ));
    }

    #[test]
    fn holding_manage_admits_a_rule_that_asks_for_another_action() {
        let input = rule(&["roles:read"], &[], &[]);
        assert!(page_rule_admits(&input, &set(&["roles:manage"]), &set(&[])));
    }

    #[test]
    fn a_listed_role_admits_without_the_permissions() {
        let input = rule(&["users:manage"], &["auditor"], &[]);
        assert!(page_rule_admits(&input, &set(&[]), &set(&["auditor"])));
        assert!(!page_rule_admits(&input, &set(&[]), &set(&["staff"])));
    }

    #[test]
    fn a_roles_only_rule_needs_one_of_its_roles() {
        let input = rule(&[], &["admin"], &[]);
        assert!(page_rule_admits(
            &input,
            &set(&["users:manage"]),
            &set(&["admin"])
        ));
        assert!(!page_rule_admits(
            &input,
            &set(&["users:manage"]),
            &set(&["staff"])
        ));
    }

    #[test]
    fn an_excluded_role_refuses_even_with_the_permission() {
        let input = rule(&["roles:read"], &[], &["guest"]);
        assert!(!page_rule_admits(
            &input,
            &set(&["roles:read"]),
            &set(&["guest"])
        ));
        assert!(!page_rule_admits(
            &rule(&[], &[], &["guest"]),
            &set(&[]),
            &set(&["guest"])
        ));
    }

    #[test]
    fn newly_named_skips_known_and_repeated_names() {
        let known: HashSet<&str> = ["rooms:read"].into_iter().collect();
        let first = vec!["rooms:read".to_string(), "bookings:read".to_string()];
        let second = vec!["bookings:read".to_string(), "audit:read".to_string()];
        assert_eq!(
            newly_named([first.as_slice(), second.as_slice()], &known),
            vec!["bookings:read".to_string(), "audit:read".to_string()]
        );
    }

    #[test]
    fn reject_unknown_lists_every_missing_name_sorted() {
        let names = vec![
            "zeta:read".to_string(),
            "rooms:read".to_string(),
            "alpha:read".to_string(),
        ];
        let existing = set(&["rooms:read"]);
        match reject_unknown(&names, &existing, "permission") {
            Err(ApiError::BadRequest(message)) => assert_eq!(
                message,
                "Unknown permission in route policy: alpha:read, zeta:read"
            ),
            other => panic!("expected BadRequest, got {other:?}"),
        }
        assert!(reject_unknown(&names[1..2], &existing, "permission").is_ok());
    }
}
