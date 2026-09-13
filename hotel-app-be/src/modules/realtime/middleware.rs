use crate::modules::realtime::hub::DataChangeHub;
use axum::{
    extract::{Request, State},
    http::Method,
    middleware::Next,
    response::Response,
};

/// Maps a successful mutation's request path to the data domain it changed.
/// Mirrors `domainForApiPath` in the web client's `api/queryInvalidation.ts` —
/// the socket event carries the domain string verbatim, so both maps must
/// agree. Runs inside the `/api` nest, so the path arrives already stripped
/// of the `/api` prefix. Unmapped paths (auth, guest-portal, settings, ...)
/// return `None` and publish nothing.
fn domain_for_path(path: &str) -> Option<&'static str> {
    let first = path.split('/').find(|segment| !segment.is_empty())?;
    match first {
        "bookings" | "payments" | "invoices" | "services" | "complimentary" => Some("bookings"),
        "guests" => Some("guests"),
        "rooms" | "room-types" | "rates" => Some("rooms"),
        "ledgers" | "companies" => Some("ledgers"),
        "housekeeping" => Some("housekeeping"),
        "night-audit" => Some("night-audit"),
        _ => None,
    }
}

/// After any successful mutating `/api/**` request, broadcast the changed
/// domain to every connected staff client so their TanStack Query caches
/// invalidate without polling. Read-only methods and failures publish
/// nothing — a failed mutation changed no data.
pub async fn publish_data_changes(
    State(hub): State<DataChangeHub>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();

    let response = next.run(request).await;

    if matches!(
        method,
        Method::POST | Method::PUT | Method::PATCH | Method::DELETE
    ) && response.status().is_success()
        && let Some(domain) = domain_for_path(&path)
    {
        hub.publish_data_changed(domain);
    }

    response
}

#[cfg(test)]
mod tests {
    use super::domain_for_path;

    // The client treats the emitted string as a cache-invalidation domain; a
    // path slipping unmapped means that page never refreshes for other users.
    #[test]
    fn maps_mutation_paths_to_domains() {
        assert_eq!(domain_for_path("/bookings/5/check-in"), Some("bookings"));
        assert_eq!(
            domain_for_path("/payments/refund-deposit/3"),
            Some("bookings")
        );
        assert_eq!(domain_for_path("/invoices/9/send"), Some("bookings"));
        assert_eq!(domain_for_path("/guests/12"), Some("guests"));
        assert_eq!(domain_for_path("/rooms/4/status"), Some("rooms"));
        assert_eq!(domain_for_path("/room-types/2"), Some("rooms"));
        assert_eq!(domain_for_path("/rates/1"), Some("rooms"));
        assert_eq!(domain_for_path("/ledgers/7/payments"), Some("ledgers"));
        assert_eq!(domain_for_path("/companies/3"), Some("ledgers"));
        assert_eq!(
            domain_for_path("/housekeeping/tasks/1"),
            Some("housekeeping")
        );
        assert_eq!(domain_for_path("/night-audit/run"), Some("night-audit"));
    }

    #[test]
    fn ignores_paths_without_a_data_domain() {
        assert_eq!(domain_for_path("/auth/login"), None);
        assert_eq!(domain_for_path("/guest-portal/bookings/1"), None);
        assert_eq!(domain_for_path("/updates/socket"), None);
        assert_eq!(domain_for_path("/settings/hotel"), None);
        assert_eq!(domain_for_path("/"), None);
    }
}
