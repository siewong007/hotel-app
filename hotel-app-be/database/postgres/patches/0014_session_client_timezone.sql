-- Approximate sign-in location for the "signed-in devices" list.
--
-- The value is the IANA zone the browser reported when the session was minted
-- (e.g. 'Asia/Kuala_Lumpur'), NOT a geolocated position: no IP lookup happens
-- anywhere in this codebase, and `services::profile::list_sessions` masks the
-- IP before it reaches the client. Storing the zone keeps the feature working
-- in offline desktop mode and keeps guest IPs away from third parties.
DO $session_client_timezone_preflight$
DECLARE
    found_type text;
    found_nullable text;
BEGIN
    SELECT data_type, is_nullable
    INTO found_type, found_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'refresh_tokens'
      AND column_name = 'client_timezone';

    IF found_type IS NOT NULL AND (found_type <> 'text' OR found_nullable <> 'YES') THEN
        RAISE EXCEPTION 'refresh_tokens.client_timezone has incompatible shape: type %, nullable %',
            found_type, found_nullable;
    END IF;
END;
$session_client_timezone_preflight$;

ALTER TABLE public.refresh_tokens
    ADD COLUMN IF NOT EXISTS client_timezone text;

COMMENT ON COLUMN public.refresh_tokens.client_timezone IS 'IANA timezone reported by the client when the session was created; approximate location only.';
