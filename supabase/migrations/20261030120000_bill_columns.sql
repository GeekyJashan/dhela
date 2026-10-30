-- Let a distributor decide what their sales bill actually shows.
--
-- The printed table was eleven fixed columns. Meanwhile sales_invoice_lines
-- has carried `unit`, `mrp`, `free_quantity` and `expiry_date` on every line
-- since the beginning, auto-filled from the product and printed nowhere — a
-- pharma distributor could not put expiry on a bill even though Dhela was
-- already storing it. Most of this feature is un-hiding what is there.
--
-- Three columns, because the layout has to live in three different places:
--
--   organizations.bill_columns   the workspace default, set once
--   sales_invoices.bill_columns  what THIS bill printed, frozen
--   *.extra                      the values for columns Dhela has no field for
--
-- The per-invoice copy is the important one. A bill is the document a retailer
-- is holding; if the layout were only an org setting, changing it would
-- silently re-render every invoice ever issued, and a reprint pulled six
-- months later for a dispute would not match the copy across the table. So the
-- bill keeps its own layout and a reprint is always what went out.
--
-- NULL on an invoice means "issued before this existed" and renders the
-- original eleven columns. That is why the default is NULL rather than a
-- populated layout: no bill that already exists may change appearance because
-- of this migration.

alter table public.organizations
  add column if not exists bill_columns jsonb;

alter table public.sales_invoices
  add column if not exists bill_columns jsonb;

comment on column public.organizations.bill_columns is
  'Default printed-bill layout for new bills. NULL = the built-in layout.';
comment on column public.sales_invoices.bill_columns is
  'The layout this bill printed with, frozen at save. NULL = issued before customisable columns; renders the original built-in layout.';

-- Values for custom columns. Same bargain as products/suppliers/retailers
-- (see 20260830090000_extra_fields.sql): a jsonb column rather than a side
-- table, so it inherits the row's RLS policy instead of needing its own, and
-- Postgres keeps the oversized value out-of-line until somebody selects it.
--
-- And the same rule, which matters more here than it did there: this is for
-- information a person reads. Nothing computes with it. Quantity, rate, tax,
-- batch and expiry are real typed columns and stay real typed columns — a
-- custom field holding an expiry date is a bug, not a feature, because
-- nothing will ever warn on it, sort by it, or stop it shipping.
alter table public.sales_invoices
  add column if not exists extra jsonb not null default '{}'::jsonb;

alter table public.sales_invoice_lines
  add column if not exists extra jsonb not null default '{}'::jsonb;

alter table public.sales_invoices
  drop constraint if exists sales_invoices_extra_is_object;
alter table public.sales_invoice_lines
  drop constraint if exists sales_invoice_lines_extra_is_object;

-- Always an object, so every reader can call Object.entries on it without
-- first checking whether someone stored an array or a bare string.
alter table public.sales_invoices
  add constraint sales_invoices_extra_is_object check (jsonb_typeof(extra) = 'object');
alter table public.sales_invoice_lines
  add constraint sales_invoice_lines_extra_is_object check (jsonb_typeof(extra) = 'object');

comment on column public.sales_invoices.extra is
  'Bill-level custom fields (transport, LR number, vehicle). Reference only — never used in pricing, stock or tax.';
comment on column public.sales_invoice_lines.extra is
  'Line-level custom column values, keyed by the custom column id in the bill layout. Reference only — never used in pricing, stock or tax.';
