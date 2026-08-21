# Deposit Refund Guard Implementation Plan

1. Enable the existing PostgreSQL characterization test that rejects refunds
   with no held deposit and refunds above the held amount; run it and confirm it
   fails against current production code.
2. In `PaymentRepository::refund_deposit`, lock the booking row, resolve the
   refundable amount from the approved legacy/payment fallback sources, and
   reject missing or excessive refunds before inserting the refund row.
3. Add coverage proving a deposit recorded on the booking fields is refundable.
4. Run the focused refund tests, Rust checks, and the full backend suite; report
   unrelated live-database failures separately.
