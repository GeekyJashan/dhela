-- Remove duplicate retailers/suppliers and enforce uniqueness going forward.
-- Dedup key mirrors the app rule: match on GSTIN when present, else on
-- lower(name). Duplicates are MERGED onto the earliest ("survivor") row —
-- every child record is repointed first, so no transactions are orphaned.

-- ---- Retailers ----
CREATE TEMP TABLE _r_map AS
WITH keyed AS (
  SELECT id, created_at,
         CASE WHEN coalesce(gstin,'') <> '' THEN 'g:' || org_id::text || ':' || gstin
              ELSE 'n:' || org_id::text || ':' || lower(name) END AS k
    FROM public.retailers
), ranked AS (
  SELECT id, k,
         row_number()  OVER (PARTITION BY k ORDER BY created_at NULLS LAST, id) AS rn,
         first_value(id) OVER (PARTITION BY k ORDER BY created_at NULLS LAST, id) AS survivor
    FROM keyed
)
SELECT id AS loser, survivor FROM ranked WHERE rn > 1;

UPDATE public.credit_notes  c SET retailer_id = m.survivor FROM _r_map m WHERE c.retailer_id = m.loser;
UPDATE public.orders        o SET retailer_id = m.survivor FROM _r_map m WHERE o.retailer_id = m.loser;
UPDATE public.payments      p SET retailer_id = m.survivor FROM _r_map m WHERE p.retailer_id = m.loser;
DELETE FROM public.product_price_overrides WHERE retailer_id IN (SELECT loser FROM _r_map);
UPDATE public.sales_invoices s SET retailer_id = m.survivor FROM _r_map m WHERE s.retailer_id = m.loser;
DELETE FROM public.retailers WHERE id IN (SELECT loser FROM _r_map);

-- ---- Suppliers ----
CREATE TEMP TABLE _s_map AS
WITH keyed AS (
  SELECT id, created_at,
         CASE WHEN coalesce(gstin,'') <> '' THEN 'g:' || org_id::text || ':' || gstin
              ELSE 'n:' || org_id::text || ':' || lower(name) END AS k
    FROM public.suppliers
), ranked AS (
  SELECT id, k,
         row_number()  OVER (PARTITION BY k ORDER BY created_at NULLS LAST, id) AS rn,
         first_value(id) OVER (PARTITION BY k ORDER BY created_at NULLS LAST, id) AS survivor
    FROM keyed
)
SELECT id AS loser, survivor FROM ranked WHERE rn > 1;

UPDATE public.invoices i SET supplier_id = m.survivor FROM _s_map m WHERE i.supplier_id = m.loser;
UPDATE public.payments p SET supplier_id = m.survivor FROM _s_map m WHERE p.supplier_id = m.loser;
DELETE FROM public.suppliers WHERE id IN (SELECT loser FROM _s_map);

DROP TABLE IF EXISTS _r_map;
DROP TABLE IF EXISTS _s_map;

-- ---- Uniqueness constraints (partial: GSTIN when present, else name) ----
CREATE UNIQUE INDEX IF NOT EXISTS retailers_org_gstin_uniq
  ON public.retailers (org_id, gstin) WHERE coalesce(gstin, '') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS retailers_org_name_uniq
  ON public.retailers (org_id, lower(name)) WHERE coalesce(gstin, '') = '';
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_gstin_uniq
  ON public.suppliers (org_id, gstin) WHERE coalesce(gstin, '') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_name_uniq
  ON public.suppliers (org_id, lower(name)) WHERE coalesce(gstin, '') = '';
