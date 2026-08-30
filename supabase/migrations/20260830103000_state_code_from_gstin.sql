-- Give a party the state code its own GSTIN already states.
--
-- The first two digits of a GSTIN are the state. It is a fact carried in the
-- number, not an inference. Where state_code is blank, GSTR-1 falls back to
-- the distributor's own state for place of supply, so an out-of-state party
-- books as CGST/SGST where IGST belongs — a filing error nobody sees until
-- the return is compared with the portal.
--
-- Narrow on purpose: only rows that have a GSTIN and no state code are
-- touched. A row whose state_code disagrees with its GSTIN is left exactly as
-- it is — that is a contradiction worth a human looking at, not something to
-- paper over in a migration.

update suppliers
   set state_code = left(gstin, 2)
 where gstin is not null
   and gstin ~ '^[0-9]{2}'
   and coalesce(state_code, '') = '';

update retailers
   set state_code = left(gstin, 2)
 where gstin is not null
   and gstin ~ '^[0-9]{2}'
   and coalesce(state_code, '') = '';
