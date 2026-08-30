-- Somewhere to keep the columns a distributor's old software had and Dhela
-- does not.
--
-- A Tally or Marg stock export carries things we have no field for — a rack or
-- bin code, an old ledger group, a salesman code. Dropping them at import is a
-- real loss: a bin code is not derivable from anything else, and re-walking a
-- godown to rebuild it is exactly the switching cost that stops people moving.
--
-- A jsonb column rather than a side table on purpose. Postgres already stores
-- an oversized value out-of-line in TOAST and only reads it back when the
-- column is selected, so it is the "keep it apart, join when needed" design
-- without a join to write. More to the point, a column inherits the row's RLS
-- policy; a separate table needs its own, and a wrong one there would leak one
-- distributor's data to another.
--
-- This is for information a person reads, never for anything the system
-- computes with. Cost, tax, stock and dates need real typed columns with
-- constraints — if pharma batch numbers and expiry dates ever land here, that
-- is a bug, not a feature.

alter table products  add column if not exists extra jsonb not null default '{}'::jsonb;
alter table suppliers add column if not exists extra jsonb not null default '{}'::jsonb;
alter table retailers add column if not exists extra jsonb not null default '{}'::jsonb;

-- Always an object, so every reader can call Object.entries on it without
-- first checking whether someone stored an array or a bare string.
alter table products  drop constraint if exists products_extra_is_object;
alter table suppliers drop constraint if exists suppliers_extra_is_object;
alter table retailers drop constraint if exists retailers_extra_is_object;

alter table products  add constraint products_extra_is_object  check (jsonb_typeof(extra) = 'object');
alter table suppliers add constraint suppliers_extra_is_object check (jsonb_typeof(extra) = 'object');
alter table retailers add constraint retailers_extra_is_object check (jsonb_typeof(extra) = 'object');

comment on column products.extra  is 'Reference-only fields carried over from the distributor''s previous software. Never used in calculations.';
comment on column suppliers.extra is 'Reference-only fields carried over from the distributor''s previous software. Never used in calculations.';
comment on column retailers.extra is 'Reference-only fields carried over from the distributor''s previous software. Never used in calculations.';
