-- Stock groups keyed by the 4-digit HSN heading (first 4 digits of the
-- product HSN) instead of the full code. Group names come strictly from
-- the hsn_codes reference table.

CREATE OR REPLACE FUNCTION public.tg_assign_stock_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grp_hsn TEXT;
  grp_id UUID;
  grp_name TEXT;
BEGIN
  IF NEW.hsn IS NULL OR btrim(NEW.hsn) = '' THEN
    NEW.stock_group_id := NULL;
    RETURN NEW;
  END IF;

  -- 4-digit HSN heading: digits only, first four.
  grp_hsn := left(regexp_replace(btrim(NEW.hsn), '\D', '', 'g'), 4);
  IF grp_hsn = '' THEN
    NEW.stock_group_id := NULL;
    RETURN NEW;
  END IF;

  SELECT id INTO grp_id FROM public.stock_groups
   WHERE org_id = NEW.org_id AND hsn_code = grp_hsn;

  IF grp_id IS NULL THEN
    -- Name from the reference table: exact heading, else nearest prefix
    -- (chapter), else the most specific code under this heading.
    SELECT description INTO grp_name FROM public.hsn_codes WHERE code = grp_hsn;
    IF grp_name IS NULL THEN
      SELECT description INTO grp_name FROM public.hsn_codes
       WHERE grp_hsn LIKE code || '%' ORDER BY length(code) DESC LIMIT 1;
    END IF;
    IF grp_name IS NULL THEN
      SELECT description INTO grp_name FROM public.hsn_codes
       WHERE code LIKE grp_hsn || '%' ORDER BY length(code) ASC LIMIT 1;
    END IF;
    INSERT INTO public.stock_groups(org_id, name, hsn_code)
    VALUES (NEW.org_id, COALESCE(grp_name, 'HSN ' || grp_hsn), grp_hsn)
    ON CONFLICT (org_id, hsn_code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO grp_id;
  END IF;

  NEW.stock_group_id := grp_id;
  RETURN NEW;
END $$;

-- Rebuild groups from scratch on the 4-digit basis.
UPDATE public.products SET stock_group_id = NULL WHERE stock_group_id IS NOT NULL;
DELETE FROM public.stock_groups;
UPDATE public.products SET hsn = hsn WHERE hsn IS NOT NULL AND btrim(hsn) <> '';
