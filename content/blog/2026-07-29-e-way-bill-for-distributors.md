---
title: How to generate an e-way bill for a sales invoice (2026 guide for distributors)
description: When an e-way bill is required, what goes in Part A and Part B, how long it stays valid, and the mistakes that get goods detained. Written for FMCG, pharma and general distributors in India.
published: 2026-07-29
tags: e-way bill, GST, logistics
---

An e-way bill is required before goods worth **more than ₹50,000** move, whether you are selling them, returning them, or shifting your own stock between godowns. You generate it on the government portal at ewaybillgst.gov.in, it carries a 12-digit number, and the driver must be able to produce it. Without one, the goods and the vehicle can both be detained, and the penalty is ₹10,000 or the tax being evaded, whichever is higher.

That is the whole rule in one paragraph. The rest of this page is the parts that actually catch people out.

## When you need one, and when you do not

The ₹50,000 threshold is on **consignment value** — the invoice value including tax, but excluding any exempt goods travelling in the same vehicle.

You need an e-way bill for:

- Any supply above ₹50,000, inter-state or intra-state
- Stock transfers between your own branches, even though there is no sale
- Sales returns coming back from a retailer, which also need [a credit note](/blog/credit-notes-sales-returns-gst)
- Goods sent for job work, inter-state, at any value

You do **not** need one for:

- Goods moving under 50 km within the same state where only Part A is needed
- Exempt goods (the full list is in Annexure to Rule 138(14))
- Non-motorised transport — a handcart or a cycle rickshaw

Intra-state thresholds are set by each state, and a few use a higher figure than ₹50,000. Punjab, for example, has historically used ₹1 lakh for intra-state movement. **Check your own state's current notification before relying on a higher limit** — this is the single most common reason a distributor is caught out after moving to a new state.

## Part A and Part B

An e-way bill has two halves, and confusing them is what causes most of the trouble.

**Part A** is the paperwork: GSTIN of supplier and recipient, place of delivery, invoice number and date, value, HSN code, and reason for transport. You can fill this the moment you raise the invoice.

**Part B** is the vehicle number. The bill is not valid until Part B is filled in, and **validity is counted from the moment Part B is entered, not from Part A**.

This matters practically. If you raise invoices in the evening and the truck loads the next morning, fill Part A when you invoice and Part B when the vehicle is actually assigned. Filling Part B early burns a day of validity while the goods sit in your godown.

## How long it stays valid

| Distance | Validity |
|---|---|
| Up to 200 km | 1 day |
| Every additional 200 km or part thereof | 1 more day |

A "day" here means until midnight of the following day, not 24 hours. A bill generated at 11 pm for a 150 km trip expires at midnight the next day — so barely 25 hours, not two days.

Validity can be extended, but only within eight hours either side of expiry, and you have to give a reason. Plan for the vehicle breaking down; do not plan on extending routinely.

## The five mistakes that get goods detained

1. **Wrong vehicle number after a transhipment.** If the goods change vehicles mid-route, Part B must be updated. The transporter can do this, but somebody has to actually do it.
2. **Invoice value and e-way bill value not matching.** Any difference invites questions. If you revise an invoice, cancel and regenerate the bill.
3. **Cancelling too late.** An e-way bill can be cancelled within 24 hours of generation, and only if the goods have not moved. After that, it stands.
4. **Wrong "reason for transport".** A stock transfer marked as "Supply" creates a GST liability on paper that you then have to explain.
5. **PIN code and state mismatch.** The portal validates the distance from the PIN codes. A typo produces a validity window that does not match the actual journey.

## Doing it without retyping everything

The portal accepts a JSON upload, which matters if you raise more than a handful of invoices a day. The format is defined by NIC and the schema is fussy about types — a value sent as a string where a number is expected fails the whole file, usually with an unhelpful error.

Dhela produces that JSON directly from a sales invoice: open the invoice, press **E-way bill**, enter the vehicle number, and download a NIC-ready file to upload on the portal. The GSTIN, HSN codes, PIN codes and values come from the invoice you already raised, so there is nothing to retype and nothing to mismatch.

To be clear about the boundary: **Dhela does not connect to the e-way bill portal and does not generate the bill for you.** It prepares the file. You upload it and the portal issues the number. Anything that claims to file on your behalf needs API credentials registered against your GSTIN, and you should know exactly who has those.

## Keep a record of what you generated

The e-way bill number should live against the invoice, not in a separate register. When a query comes six months later — and it will, usually during a GSTR-1 reconciliation — you want the bill number, the invoice, and the vehicle in one place rather than three.

---

*Rules change. The thresholds and validity above are current as of July 2026 and reflect the position after the 200 km amendment. Before relying on any of it for a specific consignment, check the current notification or ask your accountant — and check your own state's intra-state threshold, which is not the same everywhere.*
