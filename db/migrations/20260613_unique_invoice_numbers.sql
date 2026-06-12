UPDATE invoices
SET invoice_number = CONCAT('INV-LEGACY-', UPPER(LEFT(REPLACE(id::text, '-', ''), 8)))
WHERE invoice_number IS NULL OR BTRIM(invoice_number) = '';

WITH ranked AS (
  SELECT
    id,
    invoice_number,
    ROW_NUMBER() OVER (PARTITION BY invoice_number ORDER BY created_at NULLS FIRST, id) AS row_num
  FROM invoices
  WHERE invoice_number IS NOT NULL AND BTRIM(invoice_number) <> ''
)
UPDATE invoices AS inv
SET invoice_number = CONCAT(ranked.invoice_number, '-', ranked.row_num)
FROM ranked
WHERE inv.id = ranked.id
  AND ranked.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_unique_idx
ON invoices (invoice_number)
WHERE invoice_number IS NOT NULL;
