-- Whether a record carries anything in `extra`, without reading `extra`.
--
-- The list screens deliberately do not select the jsonb, so they have no way
-- to know which rows have something worth opening. A stored generated boolean
-- costs one byte, is computed by Postgres on write, and can never drift from
-- the column it describes — unlike a flag the application maintains.
--
-- Without this the choice was to fetch every blob on every list load, or to
-- put a "see extra info" control on every row and have it turn out empty most
-- of the time. Imported data that nobody can find is the same as data that was
-- dropped, except the operator believes they still have it.

alter table products
  add column if not exists has_extra boolean
  generated always as (extra <> '{}'::jsonb) stored;

alter table suppliers
  add column if not exists has_extra boolean
  generated always as (extra <> '{}'::jsonb) stored;

alter table retailers
  add column if not exists has_extra boolean
  generated always as (extra <> '{}'::jsonb) stored;
