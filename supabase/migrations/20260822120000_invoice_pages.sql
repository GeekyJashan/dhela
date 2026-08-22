-- A bill can run to more than one photo.
--
-- Until now an invoice was one file: `invoices.storage_path`. That column stays
-- exactly as it is and keeps holding page 1, so every existing invoice, every
-- thumbnail and every re-extract goes on working untouched. This table adds the
-- rest of the pages beside it.
--
-- Two things are enforced here rather than left to the application, because both
-- of them corrupt stock silently if they slip:
--   * a page number is unique within an invoice, so the same page cannot be
--     recorded twice and have its rows counted twice;
--   * a storage path is unique within an invoice, so the same photo cannot be
--     attached under two page numbers.

create table if not exists public.invoice_pages (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices(id) on delete cascade,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  -- 1-based, in reading order. Page 1 is also invoices.storage_path.
  page_no       integer not null check (page_no >= 1),
  storage_path  text not null,
  mime_type     text,
  -- What the page said about itself, e.g. "2 of 3". Null when nothing is printed.
  page_label    text,
  -- A photo of a page already captured — a re-shoot, or an Original/Duplicate
  -- copy. Kept so the operator can see it was looked at and deliberately not
  -- read twice, rather than wondering where their photo went.
  is_duplicate  boolean not null default false,
  created_at    timestamptz not null default now(),

  constraint invoice_pages_page_unique unique (invoice_id, page_no),
  constraint invoice_pages_path_unique unique (invoice_id, storage_path)
);

create index if not exists invoice_pages_invoice_idx on public.invoice_pages (invoice_id, page_no);

alter table public.invoice_pages enable row level security;

-- Same rule as the invoice itself: a page is visible to the workspace that owns
-- the bill it belongs to, and to nobody else.
drop policy if exists "invoice_pages_select" on public.invoice_pages;
create policy "invoice_pages_select" on public.invoice_pages
  for select using (public.is_org_member(org_id));

drop policy if exists "invoice_pages_insert" on public.invoice_pages;
create policy "invoice_pages_insert" on public.invoice_pages
  for insert with check (public.is_org_member(org_id));

drop policy if exists "invoice_pages_update" on public.invoice_pages;
create policy "invoice_pages_update" on public.invoice_pages
  for update using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

drop policy if exists "invoice_pages_delete" on public.invoice_pages;
create policy "invoice_pages_delete" on public.invoice_pages
  for delete using (public.is_org_member(org_id));

comment on table public.invoice_pages is
  'Extra photos making up one multi-page bill. Page 1 remains invoices.storage_path.';
