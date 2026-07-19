-- Moving weighted-average cost per product: the single cost basis used for
-- both COGS/profit and inventory valuation, so the profit shown on invoices
-- and the dashboard reconciles with an inventory-based account statement.
-- Free scheme units are folded in when this is maintained on purchase approval,
-- so effective cost drops correctly for "10+1"-style deals.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(14,4);

-- Backfill from the best cost we currently know for existing catalog rows.
UPDATE public.products
   SET avg_cost = COALESCE(last_purchase_rate, purchase_rate, 0)
 WHERE avg_cost IS NULL;
