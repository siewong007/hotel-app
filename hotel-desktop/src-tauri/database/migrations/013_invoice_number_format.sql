-- Migration: switch invoice number format to INV-YYYYMM-XXXX
--
-- The application now generates invoice numbers in Rust (see
-- services::invoice_numbers::next_invoice_number) and writes them on INSERT,
-- so the legacy trigger only fires on rows that arrive without an explicit
-- invoice_number. Keep the trigger consistent with the application format.

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
    v_prefix TEXT;
    v_next_seq INTEGER;
BEGIN
    IF NEW.invoice_number IS NULL THEN
        v_prefix := 'INV-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-';

        SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 12) AS INTEGER)), 0)
          INTO v_next_seq
          FROM (
              SELECT invoice_number FROM invoices
               WHERE invoice_number LIKE v_prefix || '%'
              UNION ALL
              SELECT invoice_number FROM customer_ledgers
               WHERE invoice_number LIKE v_prefix || '%'
          ) combined;

        NEW.invoice_number := v_prefix || LPAD((v_next_seq + 1)::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
