-- ─────────────────────────────────────────────────────────────────────────────
-- Vendy Analytics — BigQuery Views Setup
-- Project: buildertrend-pipeline
-- Dataset: vendy_analytics
-- Run once in the BigQuery Console or via: bq query --use_legacy_sql=false < setup_views.sql
--
-- Prerequisites:
--   1. Install the Firestore → BigQuery export extension for these collections:
--      - apps/vendy/bids        → table prefix: bids
--      - apps/vendy/vendors     → table prefix: vendors
--      - apps/vendy/runs        → table prefix: runs
--      - apps/shared/projects   → table prefix: projects
--      - apps/shared/takeoffs   → table prefix: takeoffs
--      - apps/shared/cost_codes → table prefix: cost_codes
--      Dataset name: vendy_analytics (buildertrend-pipeline)
--
--   2. Deploy the bid_ledger_to_bigquery Cloud Function and let it run at least
--      once to create the bid_ledger table.
--
-- The extension creates for each collection:
--   {prefix}_raw_changelog  - every change event (append-only)
--   {prefix}_raw_latest     - materialized latest snapshot (one row per doc)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. bids_latest ────────────────────────────────────────────────────────────
-- Deduplicated bid documents — latest snapshot per bid_id.

CREATE OR REPLACE VIEW `buildertrend-pipeline.vendy_analytics.bids_latest` AS
SELECT
  document_id                                                    AS bid_id,
  JSON_VALUE(data, '$.project_id')                               AS project_id,
  JSON_VALUE(data, '$.project_name')                             AS project_name,
  JSON_VALUE(data, '$.vendor_id')                                AS vendor_id,
  JSON_VALUE(data, '$.vendor_name')                              AS vendor_name,
  JSON_VALUE(data, '$.cost_code')                                AS cost_code,
  JSON_VALUE(data, '$.cost_code_name')                           AS cost_code_name,
  JSON_VALUE(data, '$.status')                                   AS status,
  SAFE_CAST(JSON_VALUE(data, '$.subtotal') AS FLOAT64)           AS subtotal,
  JSON_VALUE(data, '$.generated_at')                             AS generated_at,
  JSON_VALUE(data, '$.approved_by')                              AS approved_by,
  timestamp                                                      AS last_updated
FROM `buildertrend-pipeline.vendy_analytics.bids_raw_latest`
WHERE operation != 'DELETE';


-- ── 2. vendors_latest ────────────────────────────────────────────────────────
-- Deduplicated vendor documents — latest snapshot per vendor slug.

CREATE OR REPLACE VIEW `buildertrend-pipeline.vendy_analytics.vendors_latest` AS
SELECT
  document_id                                                              AS vendor_id,
  JSON_VALUE(data, '$.name')                                               AS vendor_name,
  JSON_VALUE(data, '$.contact_email')                                      AS contact_email,
  SAFE_CAST(JSON_VALUE(data, '$.active') AS BOOL)                          AS active,
  SAFE_CAST(
    JSON_VALUE(data, '$.price_book.bids_processed') AS INT64
  )                                                                        AS bids_processed,
  JSON_VALUE(data, '$.price_book.last_updated')                            AS price_book_last_updated,
  timestamp                                                                AS last_updated
FROM `buildertrend-pipeline.vendy_analytics.vendors_raw_latest`
WHERE operation != 'DELETE';


-- ── 3. projects_latest ───────────────────────────────────────────────────────
-- Deduplicated project documents — latest snapshot.

CREATE OR REPLACE VIEW `buildertrend-pipeline.vendy_analytics.projects_latest` AS
SELECT
  document_id                                                              AS project_id,
  JSON_VALUE(data, '$.job_name')                                           AS project_name,
  JSON_VALUE(data, '$.address')                                            AS address,
  JSON_VALUE(data, '$.status')                                             AS status,
  SAFE_CAST(JSON_VALUE(data, '$.total_budget') AS FLOAT64)                 AS budget,
  timestamp                                                                AS last_updated
FROM `buildertrend-pipeline.vendy_analytics.projects_raw_latest`
WHERE operation != 'DELETE';


-- ── 4. bid_ledger_flat ───────────────────────────────────────────────────────
-- bid_ledger rows with line_items unnested — one row per line item.
-- Source: vendy_analytics.bid_ledger (written by bid_ledger_to_bigquery Cloud Function)

CREATE OR REPLACE VIEW `buildertrend-pipeline.vendy_analytics.bid_ledger_flat` AS
SELECT
  bl.vendor_id,
  bl.bid_id,
  bl.project_id,
  bl.project_name,
  bl.cost_code,
  bl.cost_code_name,
  bl.outcome,
  bl.bid_date,
  bl.subtotal,
  bl.created_at,
  JSON_VALUE(li, '$.description')                                AS description,
  SAFE_CAST(JSON_VALUE(li, '$.quantity')   AS FLOAT64)           AS quantity,
  JSON_VALUE(li, '$.unit')                                       AS unit,
  SAFE_CAST(JSON_VALUE(li, '$.unit_price') AS FLOAT64)           AS unit_price,
  SAFE_CAST(JSON_VALUE(li, '$.total')      AS FLOAT64)           AS extension,
  JSON_VALUE(li, '$.source')                                     AS source
FROM `buildertrend-pipeline.vendy_analytics.bid_ledger` AS bl,
UNNEST(JSON_QUERY_ARRAY(bl.line_items_json)) AS li;


-- ── Validation queries ────────────────────────────────────────────────────────
-- Run these after setup to confirm row counts match Firestore:
--
-- SELECT COUNT(*) FROM `buildertrend-pipeline.vendy_analytics.bids_latest`;
-- SELECT COUNT(*) FROM `buildertrend-pipeline.vendy_analytics.vendors_latest`;
-- SELECT COUNT(*) FROM `buildertrend-pipeline.vendy_analytics.bid_ledger`;
-- SELECT COUNT(*) FROM `buildertrend-pipeline.vendy_analytics.bid_ledger_flat`;
-- SELECT status, COUNT(*) as cnt FROM `buildertrend-pipeline.vendy_analytics.bids_latest`
--   GROUP BY status ORDER BY cnt DESC;
