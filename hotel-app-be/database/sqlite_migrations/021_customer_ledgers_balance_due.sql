-- customer_ledgers.balance_due is a STORED generated column in PostgreSQL
-- (schema.sql: GENERATED ALWAYS AS (amount - paid_amount) STORED), but
-- 005_customer_ledgers_schema_sync.sql left it as an unresolved TODO ("we
-- can omit balance_due... it is not used in SQLite queries strictly") when
-- it recreated this table. That assumption is no longer true:
-- repositories/ledger.rs reads balance_due in every SELECT field list and
-- in the invoice_state/balance_state/ui_status filter predicates that
-- derive a ledger's displayed status (outstanding/paid/overdue/partial/
-- invoiced/ready_to_invoice/draft). No INSERT/UPDATE statement in
-- repositories/ledger.rs writes to balance_due directly (it is correctly
-- omitted from every VALUES list already), matching generated-column
-- semantics on both DB flavors.
--
-- SQLite 3.31+ supports STORED generated columns via ALTER TABLE ADD COLUMN.

ALTER TABLE customer_ledgers
    ADD COLUMN balance_due DECIMAL(10, 2) GENERATED ALWAYS AS (amount - paid_amount) STORED;
