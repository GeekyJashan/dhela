-- Keep the reader's working notes off the customer's bill.
--
-- When a sales bill is read from a photo, the extractor writes down what it
-- could not be sure of: "handwriting is very faint/cursive making several
-- batch numbers illegible", "please verify quantities and HSN codes against
-- the original paper bill". That is exactly the right thing to record, and it
-- was being written into `notes` — the field that prints on the invoice. So a
-- distributor printing a bill for a retailer handed them a paragraph of our
-- extractor doubting itself. One such bill has already been issued.
--
-- `notes` stays what it always was: terms, transport, remarks, the things the
-- distributor types and wants printed. This column is for the machine talking
-- to the operator, and nothing renders it on the bill.

alter table public.sales_invoices
  add column if not exists import_notes text;

comment on column public.sales_invoices.import_notes is
  'What the extractor could not be certain of when reading this bill from a photo. Shown to the operator while reviewing; never printed on the invoice.';
