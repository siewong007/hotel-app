# Ledger Payment Report Stay Dates

## Goal

Show the linked booking's check-in and check-out dates in both ledger report
surfaces:

- Reports → Company Ledger statement.
- Customer Ledger printable statement and payment receipt.

Standalone ledger entries without a linked booking show `-` for both dates.

## Design

### Data flow

Add optional `check_in_date` and `check_out_date` fields to the shared ledger
response model. Populate them from the booking referenced by
`customer_ledgers.booking_id` through a left join or equivalent scalar lookup.
The fields remain nullable so entries created without a booking continue to
work unchanged.

Extend the Company Ledger report transaction query with the same booking-date
lookup. Serialize those report dates using the report's existing date format.
Existing ledger amounts, payment totals, balances, filters, and status logic are
unchanged.

### Frontend presentation

The Company Ledger report adds Check-in and Check-out columns alongside the
transaction details.

The printable Customer Ledger statement adds the same columns for every ledger
entry. The printable payment receipt adds Check-in Date and Check-out Date to
the receipt details when the linked booking supplies them.

Frontend rendering uses the existing Customer Ledger date-formatting helpers and
renders `-` for missing values.

### Compatibility

The API change is additive and optional. No database schema or dependency
changes are required. Existing consumers that do not use the new fields remain
compatible, and standalone ledger entries remain valid.

## Testing

- Backend coverage verifies linked booking dates are returned on ledger data.
- Backend coverage verifies standalone ledger entries return null dates.
- Backend report coverage verifies Company Ledger transaction JSON includes the
  two dates.
- Frontend coverage verifies the Company Ledger report and printable outputs
  render the dates and the `-` fallback.

## Scope boundaries

This change does not alter payment recording, payment-date calculation,
booking dates, ledger totals, report filters, or database schema.
