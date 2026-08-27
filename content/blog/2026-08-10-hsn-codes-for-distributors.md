---
title: HSN codes for distributors: how many digits you need, and what happens when they are wrong
description: The digit requirement by turnover, why the code belongs on the product and not on the invoice line, what a wrong HSN actually costs, and how to fix a catalogue full of blanks.
published: 2026-08-10
tags: GST, HSN, catalogue
---

HSN codes are the most boring compliance detail in distribution and one of the easiest to get quietly wrong for years.

Nothing happens immediately. Returns file, invoices go out, nobody objects. The bill arrives later, as a rate mismatch, a notice, or a customer whose input credit does not reconcile because your code and theirs disagree.

## How many digits

The requirement scales with turnover. As it currently stands:

- **Aggregate turnover up to ₹5 crore** — 4 digits on B2B invoices. B2C is optional.
- **Above ₹5 crore** — 6 digits on all invoices.

There are exceptions upward: certain chemicals and specified goods require 8 digits regardless of turnover.

Two practical notes. Turnover here is **aggregate turnover on the PAN across all your GSTINs**, not the turnover of one registration. And it is based on the **previous financial year** — cross ₹5 crore this year and the six-digit requirement starts next year, which is exactly the sort of thing that gets missed in a growing business.

More digits are always allowed. If you are near the threshold, use six now and stop thinking about it.

## The code belongs to the product

The most common structural mistake is treating HSN as something you fill in on an invoice line.

It is a property of the **product**, decided once, then used everywhere. Put it on the invoice and you get:

- The same item with three different codes depending on who typed it
- Codes that do not match between your purchase records and your sales
- A rate that varies by invoice, because the rate follows the code

Put it on the product master and every invoice inherits it. If the classification changes, you change it once.

The corollary: **a product without an HSN is an incomplete product**, and it should be visible as one rather than silently defaulting to blank.

## What a wrong code actually costs

**A rate mismatch.** The GST rate follows the classification. Charge 12 per cent where 18 applies and you owe the difference plus interest, whether or not you collected it from the customer. Charge 18 where 12 applies and your customer is out of pocket and will notice.

**Your customer's credit.** A code that does not match theirs is one of the causes of an [input tax credit mismatch](/blog/input-tax-credit-gstr-2b-mismatch). Their reconciliation matches on your data. A code that disagrees with what they expect is a query at best.

**Your own return.** [GSTR-1](/blog/gstr-1-b2b-b2cl-b2cs-explained) has an HSN summary table, and it has to reconcile with the invoice lines.

**Compounding.** A wrong code applied to a fast-moving line for a year is not one error, it is every invoice of that line for a year.

## Classifying something you are not sure about

The chapter structure is logical once you see it. Broadly: 25 to 27 minerals, 28 to 38 chemicals, 39 to 40 plastics and rubber, 72 to 83 base metals, 84 to 85 machinery and electrical, 90 optical and medical.

The classification rules that resolve the awkward cases:

- **Specific beats general.** If a heading names your item, use it, even if a broader one also fits.
- **Essential character decides mixtures.** A composite article is classified by what gives it its character.
- **Function over material, usually.** A plastic pipe fitting is classified as a pipe fitting rather than as plastic.

Where it genuinely matters — a high-volume line, an unusual product, a rate that could go either way — the correct move is not a search engine. It is your CA, or an advance ruling if the amount justifies it.

## Fixing a catalogue that is already a mess

If you have hundreds of products and many are blank or inconsistent:

1. **Sort by value, not alphabetically.** The top 20 products by annual value are most of your exposure. Fix those first, properly.
2. **Group by similarity.** Once one PVC fitting is classified, the rest of the family usually follows.
3. **Compare against your suppliers' bills.** Your supplier already classified the item when they sold it to you. Their code is not automatically right, but it is a strong starting point and a disagreement is worth investigating.
4. **Check the rate matches the code.** A code with a rate that does not match what you have been charging is the highest-priority item on the list.
5. **Make blank visible.** A product with no HSN should be flagged in your system, not silently accepted.

Step 3 is the highest-leverage one, and it is free. The information is sitting on bills you already have.

## Where Dhela fits

Dhela reads the HSN off every supplier bill along with the rest of the line, so your purchase records carry the code your supplier used. Products link to those lines, so a catalogue can be built from what you actually buy rather than typed from scratch.

For products with nothing to inherit, it will suggest a classification and the rate that goes with it — as a suggestion to confirm, not an answer to accept, because classification is a judgement and the liability is yours.

Free plan, no card. [dhela.in](https://dhela.in)

*General information, not tax advice. Classification is fact-specific and thresholds change — confirm the current position for your goods.*
