---
title: When do you issue a debit note under GST, and when you do not
description: A debit note is raised by the seller when an invoice charged too little: wrong rate, short billing, a charge left off. It is not what a buyer raises for a purchase return. The four real cases, the deadline rule that differs from credit notes, and the input tax credit change most people missed.
published: 2026-10-03
tags: GST, debit notes, credit notes
---

You issue a debit note when you have already raised an invoice and it charged the buyer **too little**. The debit note makes up the difference, and it carries GST on that difference.

That is the whole rule. Everything below is the cases where it applies, the cases where people raise one by mistake, and two timing rules that work differently from credit notes.

## What a debit note is under GST

Section 34(3) of the CGST Act says a debit note is raised by the **supplier**, when the taxable value or the tax charged in an invoice is **less** than what was actually payable.

Two things follow from that wording, and both get missed:

1. **Only the seller raises it.** A debit note is a seller's document in GST, always.
2. **A supplementary invoice is a debit note.** The Act says so explicitly. If your software calls it a supplementary invoice, it is the same document with a different label, and it reports in the same place.

## When do you issue a debit note

Four situations, and they cover almost everything a distributor sees.

**The rate on the invoice was too low.** You billed at ₹180 when the agreed rate was ₹195. The debit note covers ₹15 a unit plus GST on it.

**You delivered more than you billed.** Fifty cartons went out, forty were invoiced. The debit note covers the ten.

**You applied the wrong GST rate.** You charged 12% on goods that attract 18%. The debit note carries the 6% shortfall. This one matters, because the liability is yours whether or not the buyer pays it.

**A charge was left off the invoice.** Freight, insurance or packing that belonged in the transaction value under Section 15 but never made it onto the bill.

In every one of those, the invoice was right at the time and is wrong now, in the buyer's favour. The debit note corrects it in yours.

## When you should not issue a debit note

**Not for a purchase return.** This is the most common mistake, and it is worth being blunt about.

When you return goods to your supplier, you do not raise a debit note that has any effect under GST. Your supplier raises a **credit note**. Their document is the one that adjusts the tax.

Plenty of businesses raise a debit note in their own books anyway, as a record of the claim they have made. That is fine as bookkeeping. What it must not do is appear in your GST return as a document that adjusts tax, because the same transaction would then be adjusted twice, once by their credit note and once by your debit note. Your GSTR-2B will show their credit note. That is the number to work with.

**Not to cancel an invoice.** An invoice raised in error and never acted on is cancelled, not debited. A debit note adds to it.

**Not for a discount you want to claw back.** If you gave a discount you should not have, you are increasing the value of a supply already made, which is a debit note in form. But if what you are actually doing is reversing a scheme, read the conditions in [commercial credit notes under GST](/blog/commercial-credit-note-under-gst) first, because post-sale adjustments have their own rules.

## Debit note or credit note

From the seller's side, in one table:

| What happened | Document | Effect on your tax |
|---|---|---|
| Charged too little | **Debit note** | Output tax goes up |
| Charged too much | **Credit note** | Output tax goes down |
| Goods came back | **Credit note** | Output tax goes down |
| Billed less than delivered | **Debit note** | Output tax goes up |
| Billed more than delivered | **Credit note** | Output tax goes down |

The direction is always from the seller's point of view. A debit note debits the buyer, meaning it increases what they owe you.

Which document a sales return needs is covered in full in [credit notes, debit notes and sales returns](/blog/credit-notes-sales-returns-gst).

## Debit notes have no deadline, credit notes do

This is the asymmetry that catches people, and it runs in your favour.

A **credit note** can only carry a tax adjustment if it is declared by **30 November following the end of the financial year** of the original supply, or the date you file that year's annual return, whichever comes first. Miss it and you refund the goods and keep paying the tax.

A **debit note** has no such cut-off. You can raise one against a three year old invoice. The logic is not generosity: a debit note increases tax owed to the government, so there is no revenue reason to shut the window.

What this means in practice is that an undercharge you discover during an audit is still correctable. An overcharge discovered at the same time may not be.

## The input tax credit rule that changed

For your buyer, there is a rule worth knowing, because it decides whether they will accept your debit note without an argument.

Until 2020, a buyer's window to claim input tax credit on a debit note ran from the date of the **original invoice**. A debit note raised two years later was useless to them. They would refuse it, and they were right to.

The Finance Act 2020 changed this, effective 1 January 2021. Input tax credit on a debit note is now tied to the financial year of the **debit note itself**, not the invoice it corrects.

So a debit note you raise in October 2026 against an invoice from 2023 sits in FY 2026-27 for credit purposes. Your buyer can claim it up to 30 November 2027.

If a buyer tells you a debit note is too old to claim, this is the change they have not caught up with. It is five years old now and still catches people.

## What a debit note has to carry

It is a tax document and needs the same discipline as an invoice:

- Its own serial number, from a series kept for debit notes
- Date of issue
- Your name, address and GSTIN, and the buyer's
- **The original invoice number and date**, which is what makes it a correction rather than a fresh supply
- The amount being added, the rate, and the tax on it

The original invoice reference is the field that matters most. Without it the document matches nothing when your buyer reconciles, and a debit note the buyer cannot match is a debit note the buyer does not pay.

## How it reaches your return

A debit note is declared in the return for the month you issue it, and the extra tax is payable with that month's liability. It is not backdated into the original month.

Debit notes to registered buyers go in the **CDNR** table of GSTR-1 alongside credit notes, keyed to the original invoice. Which table each document lands in, including the awkward cases for unregistered buyers, is in [GSTR-1: B2B, B2CL and B2CS](/blog/gstr-1-b2b-b2cl-b2cs-explained).

## Where Dhela fits

Dhela raises credit notes against the original sales invoice and carries them into the GSTR-1 working papers in the right table, with the original invoice referenced so it matches when your buyer reconciles.

To be straight about the current state: Dhela handles **sales returns and credit notes** today. Debit notes for undercharges are not a separate document in the app yet. If you have undercharged, the correction is raised outside Dhela for now and the working paper will not carry it.

We would rather tell you that than let you discover it at filing time. Everything else about a return, the stock going back, the cost it returns at, the credit note matching the original invoice, is handled.

Free plan, no card. [dhela.in](https://dhela.in)

*General information, not tax advice. GST rules and deadlines change. Confirm the current position with your accountant before relying on anything here.*
