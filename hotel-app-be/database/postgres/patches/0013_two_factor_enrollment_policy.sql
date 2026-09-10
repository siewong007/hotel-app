-- Role-based two-factor enrolment policy (opt-in, off by default).
--
-- `services::auth::two_factor_policy` reads both keys while minting a session,
-- so the policy covers every sign-in door: password, Google and passkey.
--
-- `require_two_factor_roles` ships EMPTY, which disables the policy outright.
-- An administrator switches it on from Settings by listing role names, e.g.
-- 'admin,manager'. A member of a listed role — and any user flagged
-- `is_super_admin`, who bypasses RBAC and so is always in scope — must have
-- TOTP enabled or at least one passkey registered. A passkey counts on its own:
-- it is already treated as a second factor elsewhere in the codebase, and
-- demanding TOTP on top would push staff off a phishing-resistant credential.
--
-- `require_two_factor_grace_days` is how long an in-scope account may keep
-- signing in unenrolled. The window runs from the LATER of the account's
-- creation and this row's own `updated_at`, so existing staff get a full window
-- when the policy is switched on and a new hire gets one from their start date.
-- Sign-ins inside the window succeed and flag the client to route the user to
-- enrolment; after it, they are refused with `two_factor_enrollment_required`.
--
-- Both rows use ON CONFLICT DO NOTHING rather than the metadata-syncing form
-- patch 0009 uses: `updated_at` on `require_two_factor_roles` is load-bearing
-- here — it dates the grace window — so this patch must never write a row a
-- hotel already has.
DO $two_factor_enrollment_policy$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'system_settings'
    ) THEN
        RAISE EXCEPTION 'two_factor_enrollment_policy preflight failed: system_settings is missing';
    END IF;

    INSERT INTO public.system_settings (key, value, value_type, category, description, is_public)
    VALUES
        (
            'require_two_factor_roles',
            '',
            'string',
            'security',
            'Comma-separated role names whose members must have two-factor authentication enrolled, either an authenticator app or a passkey. Empty disables the requirement.',
            false
        ),
        (
            'require_two_factor_grace_days',
            '14',
            'number',
            'security',
            'Days a member of a role listed in require_two_factor_roles may sign in before two-factor enrolment is enforced. 0 enforces immediately.',
            false
        )
    ON CONFLICT (key) DO NOTHING;
END;
$two_factor_enrollment_policy$;
