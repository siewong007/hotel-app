//! PostgreSQL runtime coverage for the guest-portal eKYC self-submission path
//! (`modules/ekyc/portal.rs`), the guest->user bridge it relies on
//! (`repositories/guest_portal_session.rs::find_guest_user_id`), and the
//! shared service logic it delegates to (`modules/ekyc/service.rs::submit_ekyc`).
//!
//! There was previously ZERO test coverage of eKYC anywhere in this repo.
//! `submit_ekyc` writes real files under `EKYC_UPLOAD_DIR` and reads/writes
//! `ekyc_verifications` with plain `sqlx::query`/`query_as` (no compile-time
//! checking), so this can only be proven by executing it against a real
//! database. Opt-in through `DATABASE_URL`, matching the other PostgreSQL
//! tests (see `tests/guest_portal_credits.rs`, whose fixture style this
//! mirrors).
//!
//! Calls the `service`/`repository` layer directly, the same way
//! `guest_portal_credits.rs` does -- no HTTP server is spun up, so the
//! portal handlers' rate limiting (`enforce_ekyc_write_limit`) is not
//! exercised here.
//!
//! NOTE on scope: a "SANITIZATION" scenario (submit with `full_name`
//! containing `<script>alert(1)</script>` and assert the stored value has
//! the markup stripped) was requested but is NOT implemented here. Reading
//! `modules/ekyc/service.rs:172-180` and `utils/sanitization.rs` shows
//! `Sanitizer::sanitize_guest_name`/`sanitize_text` (used for `full_name`,
//! `nationality`, `current_address`, `id_issuing_country`) only strip
//! control characters -- neither calls `Sanitizer::sanitize_html`, so HTML
//! markup passes through unmodified despite the code comment at
//! `service.rs:167-171` claiming it is stripped. Asserting "markup is
//! stripped" would fail (it isn't); asserting the opposite would encode a
//! bug as expected behavior. Per this repo's `.claude/rules/lessons.md`
//! (2026-07-26s), the scenario is left out rather than shipped either way;
//! flagged separately instead.

mod postgres_tests {
    use hotel_app_be::models::EkycSubmissionRequest;
    use hotel_app_be::modules::ekyc::service::{self, SubmissionChannel};
    use hotel_app_be::modules::ekyc::validation;
    use hotel_app_be::repositories::ekyc::EkycRepository;
    use hotel_app_be::repositories::guest_portal_session::GuestPortalSessionRepository;
    use hotel_app_be::ApiError;
    use sqlx::{PgPool, Row, postgres::PgPoolOptions};
    use std::fs;
    use std::path::PathBuf;

    /// Every test fn in a binary runs concurrently, so each one owns a
    /// private slice of ids. The `964_` range was verified free across
    /// `tests/*.rs` before it was chosen (re-verify with
    /// `grep -rn "964_" tests/` if this file is being extended).
    struct Fixture {
        guest_id: i64,
        user_id: i64,
    }

    fn fixture(slot: i64) -> Fixture {
        Fixture {
            guest_id: 964_000 + slot * 10,
            user_id: 964_500 + slot * 10,
        }
    }

    /// A second, independent guest/user pair for scenarios that need two
    /// (only the bridge scenario does) -- offset by 1 so it never collides
    /// with another slot's `fixture(slot)` pair.
    fn inactive_fixture(slot: i64) -> Fixture {
        Fixture {
            guest_id: 964_000 + slot * 10 + 1,
            user_id: 964_500 + slot * 10 + 1,
        }
    }

    async fn pool() -> Option<PgPool> {
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(url) => url,
            Err(_) => {
                eprintln!("Skipping guest portal eKYC test because DATABASE_URL is not set");
                return None;
            }
        };
        Some(
            PgPoolOptions::new()
                .max_connections(2)
                .connect(&database_url)
                .await
                .expect("failed to connect to PostgreSQL test database"),
        )
    }

    /// Deletes everything a fixture guest/user pair could have written, in
    /// FK-safe (child-first) order. Run BOTH before and after every test so
    /// a crashed earlier run self-heals instead of poisoning the next one.
    ///
    /// `ekyc_verifications` children (`ekyc_access_events`,
    /// `ekyc_decision_history`, `ekyc_idempotency_keys`, `ekyc_notes`,
    /// `ekyc_sensitive_reveals`) all carry
    /// `ON DELETE CASCADE ... REFERENCES ekyc_verifications(id)`, and none of
    /// them are written by the guest-submission path exercised here (those
    /// only fill in on admin review actions), so deleting the verification
    /// row itself is sufficient -- no separate child-table deletes needed.
    async fn cleanup(pool: &PgPool, guest_id: i64, user_id: i64) {
        sqlx::query("DELETE FROM audit_logs WHERE user_id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("clear fixture audit logs");
        sqlx::query("DELETE FROM ekyc_verifications WHERE guest_id = $1 OR user_id = $2")
            .bind(guest_id)
            .bind(user_id)
            .execute(pool)
            .await
            .expect("clear fixture ekyc verifications");
        sqlx::query("DELETE FROM guest_portal_sessions WHERE guest_id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .expect("clear fixture guest portal sessions");
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("clear fixture user");
        sqlx::query("DELETE FROM guests WHERE id = $1")
            .bind(guest_id)
            .execute(pool)
            .await
            .expect("clear fixture guest");
    }

    /// Seed a guest + a bridging `users` row (`user_type = 'guest'`,
    /// `guest_id` set). `active` mirrors what `/auth/register` produces for
    /// a self-registered portal account: only an `is_active = true` row
    /// resolves through `find_guest_user_id`
    /// (`repositories/guest_portal_session.rs:259`) -- a deactivated account
    /// (soft-deleted, or an admin-provisioned login-disabled anchor from
    /// `EkycRepository::provision_guest_user`, which is born
    /// `is_active = false`) cannot self-submit.
    async fn seed_guest_and_user(pool: &PgPool, guest_id: i64, user_id: i64, active: bool) {
        sqlx::query(
            "INSERT INTO guests (id, full_name, email) \
             OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3) \
             ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name",
        )
        .bind(guest_id)
        .bind(format!("Ekyc Guest {guest_id}"))
        .bind(format!("ekyc-guest-{guest_id}@hotel.test"))
        .execute(pool)
        .await
        .expect("seed guest");

        sqlx::query(
            "INSERT INTO users (
                id, username, email, full_name, user_type, guest_id, is_active, is_verified
             )
             OVERRIDING SYSTEM VALUE
             VALUES ($1, $2, $3, $4, 'guest', $5, $6, true)
             ON CONFLICT (id) DO UPDATE SET
                username = EXCLUDED.username,
                email = EXCLUDED.email,
                full_name = EXCLUDED.full_name,
                guest_id = EXCLUDED.guest_id,
                is_active = EXCLUDED.is_active,
                deleted_at = NULL",
        )
        .bind(user_id)
        .bind(format!("ekycguest{user_id}"))
        .bind(format!("ekycguest{user_id}@hotel.test"))
        .bind(format!("Ekyc Guest {guest_id}"))
        .bind(guest_id)
        .bind(active)
        .execute(pool)
        .await
        .expect("seed bridging user");
    }

    /// Minimal bytes that pass `validation::validate_image_bytes`: the
    /// function only checks the 3-byte JPEG magic prefix (`FF D8 FF`) plus a
    /// non-zero, sub-10MB length -- it never decodes the image, so the
    /// filler bytes are irrelevant.
    fn jpeg_bytes() -> Vec<u8> {
        let mut bytes = vec![0xFFu8, 0xD8, 0xFF, 0xE0];
        bytes.extend(std::iter::repeat_n(0u8, 64));
        bytes
    }

    /// Write a real file into `EKYC_UPLOAD_DIR` the way the upload endpoint
    /// (`service::store_document_upload`) would, using the same
    /// `build_ekyc_filename` helper, so `validate_existing_ekyc_path` (which
    /// checks the file actually exists on disk) accepts the reference.
    fn write_uploaded_image(user_id: i64, image_type: &str) -> String {
        let dir = PathBuf::from(validation::EKYC_UPLOAD_DIR);
        fs::create_dir_all(&dir).expect("create ekyc upload dir");
        let filename = validation::build_ekyc_filename(user_id, image_type, "jpg")
            .expect("build ekyc filename");
        fs::write(dir.join(&filename), jpeg_bytes()).expect("write fixture image");
        format!("{}/{}", validation::EKYC_UPLOAD_DIR, filename)
    }

    /// Removes every file this fixture user could have written into
    /// `EKYC_UPLOAD_DIR` -- filenames embed `user_id` as the first
    /// underscore-delimited segment (`build_ekyc_filename`), so this is
    /// exact, not a prefix guess across users. Called both before (self-heal
    /// from a crashed prior run) and after each test.
    fn cleanup_uploaded_images(user_id: i64) {
        let dir = PathBuf::from(validation::EKYC_UPLOAD_DIR);
        let Ok(entries) = fs::read_dir(&dir) else {
            return;
        };
        let prefix = format!("{user_id}_");
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }

    /// A submission request valid enough to reach whichever check a
    /// scenario is targeting: dates parse and the expiry is comfortably in
    /// the future, so `validation::validate_dates` never rejects it first.
    fn submission_request(
        id_front_image: String,
        selfie_image: String,
        full_name: &str,
        id_number: &str,
    ) -> EkycSubmissionRequest {
        EkycSubmissionRequest {
            selfie_image,
            id_front_image,
            id_back_image: None,
            id_type: "passport".to_string(),
            id_number: id_number.to_string(),
            full_name: full_name.to_string(),
            date_of_birth: "1990-05-15".to_string(),
            nationality: Some("Malaysian".to_string()),
            address: None,
            id_expiry_date: "2031-01-01".to_string(),
            id_issue_date: None,
            id_issuing_country: Some("Malaysia".to_string()),
            proof_of_address: None,
            phone: Some("+60123456789".to_string()),
            email: Some("guest-ekyc-test@example.com".to_string()),
            current_address: None,
        }
    }

    async fn verification_count(pool: &PgPool, guest_id: i64) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM ekyc_verifications WHERE guest_id = $1")
            .bind(guest_id)
            .fetch_one(pool)
            .await
            .expect("count verifications")
    }

    // ---------- Scenario 1: the guest -> user bridge ----------

    #[tokio::test]
    async fn bridge_resolves_active_guest_and_rejects_deactivated_guest() {
        let Some(pool) = pool().await else {
            return;
        };
        let active = fixture(1);
        let inactive = inactive_fixture(1);

        cleanup(&pool, active.guest_id, active.user_id).await;
        cleanup(&pool, inactive.guest_id, inactive.user_id).await;

        seed_guest_and_user(&pool, active.guest_id, active.user_id, true).await;
        seed_guest_and_user(&pool, inactive.guest_id, inactive.user_id, false).await;

        let resolved = GuestPortalSessionRepository::find_guest_user_id(&pool, active.guest_id)
            .await
            .expect("resolve active guest");
        assert_eq!(
            resolved,
            Some(active.user_id),
            "an active guest-typed users row must resolve to its own id"
        );

        let resolved_inactive =
            GuestPortalSessionRepository::find_guest_user_id(&pool, inactive.guest_id)
                .await
                .expect("resolve inactive guest");
        assert_eq!(
            resolved_inactive, None,
            "a deactivated account must not resolve -- it cannot self-submit"
        );

        cleanup(&pool, active.guest_id, active.user_id).await;
        cleanup(&pool, inactive.guest_id, inactive.user_id).await;
    }

    // ---------- Scenario 2: happy path ----------

    #[tokio::test]
    async fn happy_path_submission_creates_one_verification_with_bridge_ids() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(2);
        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
        seed_guest_and_user(&pool, f.guest_id, f.user_id, true).await;

        let id_front = write_uploaded_image(f.user_id, "id_front");
        let selfie = write_uploaded_image(f.user_id, "selfie");
        let req = submission_request(id_front, selfie, "Happy Path Guest", "P1234567");

        let status = service::submit_ekyc(
            &pool,
            f.user_id,
            req,
            SubmissionChannel::GuestPortal,
            Some("203.0.113.10".to_string()),
            Some("test-agent".to_string()),
        )
        .await
        .expect("happy-path submission must succeed");
        assert_eq!(status.status, "submitted");

        let rows = sqlx::query("SELECT user_id, guest_id FROM ekyc_verifications WHERE guest_id = $1")
            .bind(f.guest_id)
            .fetch_all(&pool)
            .await
            .expect("read back verifications");
        assert_eq!(rows.len(), 1, "exactly one verification row must exist");
        assert_eq!(rows[0].get::<i64, _>("user_id"), f.user_id);
        assert_eq!(rows[0].get::<i64, _>("guest_id"), f.guest_id);

        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
    }

    /// Identity fields are stored as DATA, verbatim apart from control-character
    /// stripping and trimming.
    ///
    /// This pins a deliberate choice. The obvious "sanitize guest input" move is
    /// `Sanitizer::sanitize_notes` (used for booking notes and support
    /// messages), but it runs input through ammonia, which re-serializes HTML
    /// entities — so the real name "Tom & Jerry" would be persisted as
    /// "Tom &amp; Jerry", corrupting the exact string a reviewer has to compare
    /// against the physical passport. Ammonia also preserves benign markup, so
    /// it would not deliver a "no markup in the database" guarantee anyway.
    /// Escaping belongs at the render layer, and every consumer does it.
    ///
    /// If a future change makes this test fail by "adding HTML sanitization",
    /// check the `&` assertion first: that is the compliance-relevant one.
    #[tokio::test]
    async fn identity_fields_are_stored_verbatim_minus_control_characters() {
        let Some(pool) = pool().await else {
            return;
        };
        // Slot 8: slots 1-5 and 7 are taken by the tests above. Test fns in one
        // binary run concurrently, so a reused slot means one test deletes
        // another's fixture user mid-run (FK violation on user_id).
        let f = fixture(8);
        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
        seed_guest_and_user(&pool, f.guest_id, f.user_id, true).await;

        let id_front = write_uploaded_image(f.user_id, "id_front");
        let selfie = write_uploaded_image(f.user_id, "selfie");
        // A legitimate name containing an ampersand, plus a control character
        // that must not survive.
        let req = submission_request(id_front, selfie, "  Tom & Jerry\u{0}  ", "P7654321");

        service::submit_ekyc(
            &pool,
            f.user_id,
            req,
            SubmissionChannel::GuestPortal,
            None,
            None,
        )
        .await
        .expect("submission must succeed");

        let stored: String =
            sqlx::query_scalar("SELECT full_name FROM ekyc_verifications WHERE guest_id = $1")
                .bind(f.guest_id)
                .fetch_one(&pool)
                .await
                .expect("read back full_name");

        assert_eq!(
            stored, "Tom & Jerry",
            "the ampersand must survive unescaped and the NUL must be stripped"
        );

        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
    }

    /// Resubmitting after `additional_information_required` must SUPERSEDE the
    /// old row, not sit alongside it.
    ///
    /// `dashboard_metrics` buckets by status, so a surviving
    /// `additional_information_required` row would keep inflating the
    /// "resubmission required" figure while the replacement counts under
    /// pending review — one guest occupying two slots in the reviewer queue,
    /// permanently. This is a state that could not exist before self-resubmit
    /// was allowed.
    #[tokio::test]
    async fn resubmission_supersedes_the_information_request_instead_of_duplicating_it() {
        let Some(pool) = pool().await else {
            return;
        };
        // Slot 9: slots 1-5, 7 and 8 are taken above. Test fns in one binary
        // run concurrently, so a reused slot corrupts another test's fixtures.
        let f = fixture(9);
        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
        seed_guest_and_user(&pool, f.guest_id, f.user_id, true).await;

        let id_front = write_uploaded_image(f.user_id, "id_front");
        let selfie = write_uploaded_image(f.user_id, "selfie");

        let first = service::submit_ekyc(
            &pool,
            f.user_id,
            submission_request(id_front.clone(), selfie.clone(), "First Attempt", "P1111111"),
            SubmissionChannel::GuestPortal,
            None,
            None,
        )
        .await
        .expect("first submission must succeed");

        // The reviewer asks for a better photo.
        sqlx::query("UPDATE ekyc_verifications SET status = 'additional_information_required' WHERE id = $1")
            .bind(first.id)
            .execute(&pool)
            .await
            .expect("mark additional_information_required");

        let second = service::submit_ekyc(
            &pool,
            f.user_id,
            submission_request(id_front, selfie, "Second Attempt", "P2222222"),
            SubmissionChannel::GuestPortal,
            None,
            None,
        )
        .await
        .expect("resubmission must be allowed");

        let superseded: String =
            sqlx::query_scalar("SELECT status FROM ekyc_verifications WHERE id = $1")
                .bind(first.id)
                .fetch_one(&pool)
                .await
                .expect("read back the superseded row");
        assert_eq!(
            superseded, "void",
            "the replaced row must be voided so it leaves the review queue"
        );

        let still_awaiting: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM ekyc_verifications \
             WHERE guest_id = $1 AND status = 'additional_information_required'",
        )
        .bind(f.guest_id)
        .fetch_one(&pool)
        .await
        .expect("count awaiting-info rows");
        assert_eq!(still_awaiting, 0, "dashboard must not keep counting the old request");

        assert_ne!(second.id, first.id, "a new verification row must be created");
        assert_eq!(second.status, "submitted");

        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
    }

    // ---------- Scenario 3: inline base64 rejected on the portal channel ----------

    #[tokio::test]
    async fn portal_channel_rejects_inline_base64_and_writes_no_file() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(3);
        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
        seed_guest_and_user(&pool, f.guest_id, f.user_id, true).await;

        // A data-URI, not an existing-upload path: `resolve_image` for
        // `SubmissionChannel::GuestPortal` calls `validate_existing_ekyc_path`
        // directly (never `save_base64_image`), so this is rejected before
        // any bytes are decoded or written to disk.
        let base64_image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wA=".to_string();
        let req = submission_request(
            base64_image,
            "private_uploads/ekyc/irrelevant.jpg".to_string(),
            "Base64 Guest",
            "P7654321",
        );

        let err = service::submit_ekyc(
            &pool,
            f.user_id,
            req,
            SubmissionChannel::GuestPortal,
            None,
            None,
        )
        .await
        .expect_err("inline base64 must be rejected on the guest-portal channel");
        assert!(
            matches!(err, ApiError::BadRequest(_)),
            "expected BadRequest, got {err:?}"
        );

        assert_eq!(
            verification_count(&pool, f.guest_id).await,
            0,
            "a rejected submission must not create a row"
        );

        let dir = PathBuf::from(validation::EKYC_UPLOAD_DIR);
        let prefix = format!("{}_", f.user_id);
        let wrote_any_file = match fs::read_dir(&dir) {
            Ok(entries) => entries
                .flatten()
                .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix)),
            Err(_) => false,
        };
        assert!(
            !wrote_any_file,
            "the base64 path must never reach disk for the guest-portal channel"
        );

        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
    }

    // ---------- Scenario 4: duplicate guard ----------

    #[tokio::test]
    async fn a_second_submission_while_one_is_open_is_rejected() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(4);
        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
        seed_guest_and_user(&pool, f.guest_id, f.user_id, true).await;

        let id_front = write_uploaded_image(f.user_id, "id_front");
        let selfie = write_uploaded_image(f.user_id, "selfie");

        service::submit_ekyc(
            &pool,
            f.user_id,
            submission_request(id_front.clone(), selfie.clone(), "Dup Guest", "P1111111"),
            SubmissionChannel::GuestPortal,
            None,
            None,
        )
        .await
        .expect("first submission must succeed");

        let err = service::submit_ekyc(
            &pool,
            f.user_id,
            submission_request(id_front, selfie, "Dup Guest", "P1111111"),
            SubmissionChannel::GuestPortal,
            None,
            None,
        )
        .await
        .expect_err("a second submission while the first is open must be rejected");
        assert!(
            matches!(err, ApiError::BadRequest(_)),
            "expected BadRequest, got {err:?}"
        );
        assert_eq!(
            verification_count(&pool, f.guest_id).await,
            1,
            "the rejected duplicate must not create a second row"
        );

        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
    }

    // ---------- Scenario 5: resubmission is allowed after "additional information required" ----------

    #[tokio::test]
    async fn additional_information_required_unblocks_resubmission_but_pending_review_does_not() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(5);
        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
        seed_guest_and_user(&pool, f.guest_id, f.user_id, true).await;

        let id_front = write_uploaded_image(f.user_id, "id_front");
        let selfie = write_uploaded_image(f.user_id, "selfie");
        service::submit_ekyc(
            &pool,
            f.user_id,
            submission_request(id_front, selfie, "Resubmit Guest", "P2222222"),
            SubmissionChannel::GuestPortal,
            None,
            None,
        )
        .await
        .expect("initial submission must succeed");

        sqlx::query("UPDATE ekyc_verifications SET status = 'additional_information_required' WHERE guest_id = $1")
            .bind(f.guest_id)
            .execute(&pool)
            .await
            .expect("move verification to additional_information_required");
        assert!(
            !EkycRepository::exists_open_for_guest(&pool, f.guest_id)
                .await
                .expect("check open status"),
            "additional_information_required must NOT block a new submission"
        );

        sqlx::query("UPDATE ekyc_verifications SET status = 'pending_manual_review' WHERE guest_id = $1")
            .bind(f.guest_id)
            .execute(&pool)
            .await
            .expect("move verification to pending_manual_review");
        assert!(
            EkycRepository::exists_open_for_guest(&pool, f.guest_id)
                .await
                .expect("check open status"),
            "pending_manual_review must still block a new submission"
        );

        cleanup(&pool, f.guest_id, f.user_id).await;
        cleanup_uploaded_images(f.user_id);
    }

    // ---------- Scenario 7: length bounds are a 400, not a database error ----------

    #[tokio::test]
    async fn oversized_id_number_is_rejected_before_reaching_the_database() {
        let Some(pool) = pool().await else {
            return;
        };
        let f = fixture(7);
        cleanup(&pool, f.guest_id, f.user_id).await;
        seed_guest_and_user(&pool, f.guest_id, f.user_id, true).await;

        // `validate_submission_field_lengths` runs before image resolution
        // (service.rs: exists_open_for_guest -> validate_dates ->
        // validate_submission_field_lengths -> image resolution -> insert),
        // so these paths are never touched and need not exist on disk.
        let oversized_id_number = "9".repeat(300);
        let req = submission_request(
            "private_uploads/ekyc/never_read.jpg".to_string(),
            "private_uploads/ekyc/never_read.jpg".to_string(),
            "Length Bounds Guest",
            &oversized_id_number,
        );

        let err = service::submit_ekyc(
            &pool,
            f.user_id,
            req,
            SubmissionChannel::GuestPortal,
            None,
            None,
        )
        .await
        .expect_err("a 300-character id_number must be rejected");
        assert!(
            matches!(err, ApiError::BadRequest(_)),
            "expected BadRequest (not a database error), got {err:?}"
        );
        assert_eq!(
            verification_count(&pool, f.guest_id).await,
            0,
            "a length-rejected submission must not reach the database"
        );

        cleanup(&pool, f.guest_id, f.user_id).await;
    }
}
