//! Guest-portal sessions (token hashes only — raw tokens are never stored).
//! Ported from staging.sql §80. Session 808704 stores the real sha256 digest
//! of `stg-portal-token-a`, so Bearer `stg-portal-token-a` authenticates
//! against the portal API for guest 801002.

use crate::engine::Tx;

pub async fn seed(tx: &mut Tx<'_>) -> Result<(), sqlx::Error> {
    sqlx::raw_sql(SQL).execute(&mut **tx).await?;
    Ok(())
}

const SQL: &str = r#"
INSERT INTO public.guest_portal_sessions (id, guest_id, token_hash, expires_at, last_used_at)
OVERRIDING SYSTEM VALUE VALUES
    (808701, 801020, 'sha256:STAGINGDONOTUSE0000000000000000000000000000000000000010', (SELECT today+7 FROM staging_ref)::timestamptz, (SELECT today-1 FROM staging_ref)::timestamptz + interval '9 hours'),
    (808702, 801014, 'sha256:STAGINGDONOTUSE0000000000000000000000000000000000000011', (SELECT today+7 FROM staging_ref)::timestamptz, NULL),
    (808703, 801001, 'sha256:STAGINGDONOTUSE0000000000000000000000000000000000000012', (SELECT today-3 FROM staging_ref)::timestamptz, (SELECT today-4 FROM staging_ref)::timestamptz),
    -- Known-token session for direct portal API checks: Bearer
    -- `stg-portal-token-a` (the hash below is its real sha256 digest).
    (808704, 801002, encode(sha256('stg-portal-token-a'::bytea), 'hex'), (SELECT today+1 FROM staging_ref)::timestamptz, NULL);
"#;
