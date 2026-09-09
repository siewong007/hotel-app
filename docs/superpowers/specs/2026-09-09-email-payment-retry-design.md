# Email and Anonymous Payment Retry Design

## Goal

Make guest emails concise, informative, and consistent with a professional hotel identity. Give anonymous guests a direct payment recovery path without guest-portal login.

## Approved approach

Use a dedicated short-lived capability tied to the booking and rejected payment. Store only its cryptographic hash, expiry and consumption state. Keep the existing booking-access token separate. Reuse existing payment business rules and controls.

## Workflow

After a definite payment failure or rejection, queue a concise outcome email with booking reference, relevant payment details, reason and one recovery action. Use a 60-minute retry capability, capped by the booking hold deadline when applicable. Distinguish unpaid, failed, processing and uncertain payment outcomes; never prompt repayment for an uncertain capture or already-paid booking.

The public retry page validates the capability and displays only the reservation reference, payable amount and available payment methods. Viewing the page does not consume the link, so email scanners cannot exhaust it. Creating a replacement payment consumes it atomically with payment creation. Duplicate submissions must not create another payment. The authorized replacement PayPal order must remain capturable after the initial capability is consumed, without authorizing another order. Bank-transfer recovery must allow evidence for the replacement claim without granting check-in or profile access.

Invalid, expired or unavailable links show a generic recovery message and hotel contact fallback. Existing booking-status and duplicate-payment guards remain authoritative. A paid, cancelled, released or otherwise ineligible booking cannot accept a new attempt.

## Presentation

Use the shared responsive table-based email layout with restrained ivory, charcoal and gold styling, serif headings, clear reservation details and one primary action. Maintain HTML escaping, readable plain text and localization support. Include a hotel seal displaying the configured hotel name and canonical website host. Explain that the visual seal is an identity cue that can be copied; sender-domain authentication and checking the official website are the actual authenticity controls. Do not claim verified delivery or invent certification.

## Persistence and integration

Add capability persistence through the existing repository/service architecture and register any schema addition in the baseline and complete live-patch catalog and deployment/test integration. Keep token generation and verification on the server, use existing cryptographic dependencies and rate limiters, and avoid token disclosure in logs or referrers. Keep authenticated guest-portal behavior intact.

## Verification

Test token expiry, scope, replay, cross-booking access, payment concurrency and capture continuation. Exercise real PostgreSQL persistence for new row mappings. Test HTML/text recovery links and localization, frontend recovery states and submissions. Run required backend check/clippy and appropriate tests; run frontend typecheck, lint and relevant tests. Inspect the rendered email on desktop and mobile. Report any environment-related checks that cannot run accurately.
