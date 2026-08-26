---
title: How to photograph a supplier bill so software can actually read it
description: What makes a phone photo of an invoice readable, why carbon copies and thermal prints fail, how to shoot a multi-page bill, and the checks worth running before you accept the numbers.
published: 2026-08-04
tags: OCR, AI, workflow
---

Reading a bill from a photo works well now. It fails in specific, boring, fixable ways, and almost all of them happen before the photo is taken.

This is what actually matters, roughly in order of how much difference it makes.

## Light beats everything

The single biggest factor is not the camera. It is whether the numbers have contrast against the paper.

- **Shoot in daylight or under a plain white light.** Godown tube lights with a yellow cast wash out faint dot-matrix print.
- **Do not use flash straight on.** It produces a bright blowout in the middle of the page, usually right where the totals are.
- **Watch your own shadow.** Standing over a bill with a phone puts your shoulders between the light and the paper. Stand to the side.

A well-lit photo from a three-year-old phone beats a badly lit one from a new phone every time.

## Flat, square, whole

Three rules that between them fix most of the rest.

**Flatten the paper.** A curled bill bends the columns, and a bent column is how a quantity ends up read as a rate. Put it on a table. A book on the far edge is enough.

**Shoot straight down.** Photographing at an angle makes the far edge of the table narrower than the near edge, and every column drifts with it. Get the phone parallel to the paper.

**Include the whole page, with a margin.** Cropping tight to the table loses the header, and the header is where the supplier, GSTIN, invoice number and date live. A centimetre of table showing on all four sides is fine and helps.

## The paper types that fight back

**Carbon copies.** The second and third copies of a triplicate book are faint by design. Shoot the top copy if you have it. If you only have the carbon, get more light on it rather than more zoom.

**Thermal printer rolls.** These fade, especially in heat, and a bill that has been in a truck cabin for a week may already be unreadable to anyone. Photograph thermal bills the day they arrive.

**Dot matrix on continuous stationery.** Usually fine, but the sprocket-hole edges confuse cropping. Tear them off or include them fully.

**Bills with a stamp over the figures.** A round rubber stamp across the total is common and genuinely hard. Photograph it anyway, then check the total by hand.

## Multi-page bills

A long bill is the case most people get wrong, because each page looks like a complete bill on its own.

- **Photograph every page**, including the last one even if it is mostly blank. The totals are on it.
- **Keep them in order.**
- **Do not skip the page that is "just the continuation".** That is where half your line items are.
- **If you re-shoot a blurry page, keep both.** Good software will spot the repeat. Deleting the wrong one is worse.

The specific trap: many bills print a **carried forward** total on every page. It is a running subtotal, not an extra charge. Adding those together double counts the bill, and it is a mistake that produces a plausible-looking number rather than an obvious error.

The other trap: **Original, Duplicate and Transporter copies**. Three near-identical sheets of the same invoice. Photographed together they look like a three-page bill, and treated that way they would triple the goods you received.

Tell your software these are pages of one bill rather than leaving it to guess. Guessing is where the expensive mistakes live.

## Check the read, not the confidence

Any tool that reads bills will give you a confidence score. Confidence measures how sure the model was, not whether it was right, and a wrong number read clearly gets a high score.

Two checks are worth more than any confidence figure:

**Does each row add up?** quantity × rate × (1 − discount%) should equal the amount printed on that row. If it does not, a figure came from the wrong column. This catches the classic failure where a quantity and a rate are read out of adjacent columns — both look reasonable on their own.

**Does the row count match?** Count the product rows on the paper. If the software gives you nine and the bill has thirteen, four line items are missing and your stock will be short by exactly those four. Faint rows and rows near the bottom of the table are the ones that go.

Check those two before you check anything else.

## A workflow that holds up

1. Shoot bills the day they arrive, on the table, in daylight, one page at a time.
2. Do the whole day's pile in one sitting. Ten bills in five minutes beats one bill ten times a day.
3. Review before approving. Approving is what moves stock and cost, and it is much easier to fix a number now than to unpick it next month.
4. Fix the row that does not reconcile. It is usually one row, and it is usually the quantity.
5. Keep the paper for as long as the law says, whatever the software claims.

## What good looks like

On a clean, well-lit photo of a typical distributor's bill, expect every line item, the HSN codes, batch and expiry where printed, the discount, and the totals. Expect to correct something on maybe one bill in five, usually a supplier name or a batch code rather than a figure.

If you are correcting figures on most bills, the problem is upstream. Look at the light first.

## Where Dhela fits

Dhela reads bills from a phone photo — line items, HSN, batch, expiry, discounts and totals — and checks its own work. It re-derives every line's arithmetic and flags rows that do not reconcile, counts the rows on the bill and tells you if it read fewer, and handles a multi-page bill as one bill when you tell it the photos belong together, including spotting a page you photographed twice.

It reads English, and it works in Hindi and Punjabi, because the person holding the phone in the godown is often not the person who reads English.

Free plan, no card. [dhela.in](https://dhela.in)
