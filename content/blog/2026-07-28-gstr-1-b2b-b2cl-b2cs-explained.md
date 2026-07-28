---
title: GSTR-1 for distributors: what B2B, B2CL and B2CS actually mean
description: Which table each sales invoice belongs in, the ₹1 lakh B2CL threshold that changed in 2024, why credit notes to unregistered buyers usually do not go in CDNUR, and the HSN summary rule that depends on your turnover.
published: 2026-07-28
tags: GST, GSTR-1, compliance
---

Every sales invoice you raise lands in exactly one table of GSTR-1, and which table depends on two things: whether the buyer has a GSTIN, and whether the supply crossed a state border. Get the split wrong and the return still files — it just does not match your books, and you find out months later when someone reconciles.

Here is the short version:

| Buyer | Supply | Table |
|---|---|---|
| Has a GSTIN | Any | **B2B** (Table 4) |
| No GSTIN | Inter-state, invoice above ₹1 lakh | **B2CL** (Table 5) |
| No GSTIN | Everything else | **B2CS** (Table 7), consolidated |

That is 95% of a distributor's return. The rest of this explains the parts that are genuinely easy to get wrong.

## B2B is about registration, not size

A B2B invoice is any supply to a buyer who has a GSTIN — a kirana with a registration is B2B, even for a ₹400 invoice. Each one is reported individually, with the buyer's GSTIN, invoice number, date, value, rate and tax.

This is the table your buyers care about, because it is what feeds their GSTR-2B and therefore their input tax credit. **An invoice you leave out of B2B is a customer who cannot claim credit**, and they will notice. It is worth reconciling B2B against your sales register every month before filing, not annually.

## The B2CL threshold changed, and a lot of software did not

B2CL is for **inter-state** supplies to unregistered buyers above a value threshold, reported invoice by invoice.

That threshold was ₹2.5 lakh for years. **Notification 12/2024 cut it to ₹1 lakh**, effective from the November 2024 return period. Invoices between ₹1 lakh and ₹2.5 lakh that used to be consolidated into B2CS now have to be reported individually in B2CL.

If your billing software was configured before late 2024 and nobody revisited it, it is very likely still using ₹2.5 lakh. The return will file without complaint. The mismatch only surfaces on scrutiny.

Intra-state supplies to unregistered buyers never go in B2CL, whatever the value. A ₹5 lakh cash sale inside your own state is B2CS.

## B2CS is consolidated, and the Type field is not what you think

B2CS is everything left over — small-value and intra-state sales to unregistered buyers. It is not invoice-by-invoice. You report one line per combination of **place of supply and tax rate**, with the total taxable value and tax.

The field that trips people up is **Type**. It is not "Inter-State" or "Intra-State". The valid values are:

- `OE` — Other than E-commerce
- `E` — through an e-commerce operator

Most distributors only ever use `OE`. Software that writes "Intra-State" into that column produces a file the offline utility rejects, or worse, silently mangles.

## Credit notes: CDNR and the CDNUR trap

Credit notes against B2B invoices go in **CDNR**, keyed to the original invoice and the buyer's GSTIN. Straightforward.

Credit notes against unregistered buyers go in **CDNUR** — but CDNUR only accepts three document types: **B2CL, EXPWP and EXPWOP** (export with and without payment of tax).

There is no CDNUR category for B2CS. So a credit note against a small intra-state cash sale does **not** get its own CDNUR row. It reduces the B2CS figure for that place of supply and rate. Software that dumps every non-GSTIN credit note into CDNUR produces a return the portal will reject.

## HSN summary depends on your turnover

Table 12 needs an HSN-wise summary of everything you sold. How many digits depends on your aggregate annual turnover in the previous year:

| AATO | HSN digits |
|---|---|
| Up to ₹5 crore | 4 |
| Above ₹5 crore | 6 |

Since the Phase 3 changes from the May 2025 period, Table 12 is also **split into separate B2B and B2C tabs**, and the HSN is selected from a dropdown rather than typed. Free text no longer passes.

If you are near the ₹5 crore line, this is worth checking every April — the requirement follows last year's turnover, so it changes at the start of a financial year, not when you cross the threshold mid-year.

## Table 11 (advances) probably does not apply to you

Table 11 reports tax on advances received against future supplies. It looks like it should apply to any business that takes deposits.

For a supplier of **goods**, it does not. **Notification 66/2017** removed the requirement to pay GST on advances received for goods — tax is due at invoice, not at advance. So a distributor taking money in advance from a retailer has nothing to report in Table 11.

It still applies to services. If you supply only goods, leaving Table 11 empty is correct, and filling it means declaring tax you do not owe.

## Nil-rated is not the same as zero tax

Table 8 covers nil-rated, exempt and non-GST supplies. A line taxed at 0% belongs there, not in B2B with a 0% rate. Many FMCG distributors carry both — unbranded flour or fresh produce alongside taxed packaged goods — and the split matters because Table 8 figures are excluded from the taxable-value totals that feed GSTR-3B.

## Working papers, not filing

Dhela builds these tables from the invoices you have already raised: B2B, B2CL, B2CS, CDNR, CDNUR, nil-rated, both HSN summaries and the document series, plus a GSTR-3B summary.

It stops there deliberately. **Dhela does not file returns.** You download the working papers, your accountant checks them against your books, and the return is filed on the portal. Figures come from what is in Dhela — if a purchase was never approved or an invoice is still a draft, it is not counted, and the working paper says so.

The point of a working paper is that somebody who knows your books can check it before it becomes a filed return. Anything that files straight from your billing software without that step is removing the only review the process has.

---

*This describes the position as of July 2026. GST rules change frequently and this is not tax advice — confirm anything material with your accountant before filing.*
