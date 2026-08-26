---
title: What your stock actually cost: weighted average, FIFO, and the mistake that inflates every margin
description: Why costing off the printed rate instead of the amount you paid quietly doubles your inventory value, how weighted average cost works with an example, and when FIFO is worth the extra work.
published: 2026-08-02
tags: costing, inventory, margin
---

Here is a question most distributors cannot answer in under a minute: **what did the stock on your shelf cost you?**

Not what it is listed at. Not what you sell it for. What it cost.

Get that number wrong and every figure downstream is wrong with it — margin per product, profit for the month, which lines are worth stocking, what you can afford to discount. And the usual way of getting it wrong looks completely reasonable.

## The mistake: costing off the rate column

Open any hardware or FMCG purchase bill. There is a Rate column and, next to it, a Discount column. On a lot of Indian bills that discount is **50 to 70 per cent**, and the Amount column already has it taken off.

| Description | Qty | Rate | Disc% | Amount |
|---|---|---|---|---|
| PVC PIPE 110MM 6KG | 40 | 486.50 | 55 | 8,757.00 |

Cost that line at quantity times rate and you get **₹19,460**. You paid **₹8,757**.

The stock is now on your books at 2.2 times what it cost. Every sale of that pipe looks like a loss. Your gross margin looks terrible, your inventory looks valuable, and neither is true.

This is not a hypothetical. It is the single most common costing error we have seen in real data, and it survives for months because nothing contradicts it. The books balance. The numbers look plausible. They are just built on the wrong column.

**The unit cost is the amount, divided by the billed quantity.** ₹8,757 ÷ 40 = **₹218.93**. Not ₹486.50.

## Free goods change the answer again

Indian trade runs on schemes. Ten plus one. Buy a hundred, get twelve free.

If you buy 100 units at ₹50 and receive 12 free, you have spent ₹5,000 and taken in 112 units. Your cost per unit is not ₹50, it is:

> ₹5,000 ÷ 112 = **₹44.64**

Free units carry no money but they do carry stock. Ignore them and you overstate cost by about eleven per cent on that purchase, and you will price too high and wonder why the scheme did not help.

The rule: **spend is divided by everything that came in, billed and free.**

## Weighted average cost, with an example

You do not buy at one price forever. So you need a rule for what happens when the second lot arrives cheaper or dearer than the first.

Weighted average cost — a moving average — recalculates one number every time stock comes in:

> new average = (existing units × existing average + money just spent) ÷ (existing units + units just received)

Start with nothing. Buy 40 units for ₹8,757.

> 0 + 8,757 ÷ 0 + 40 = **₹218.93 a unit**

Sell 15. Stock is 25 units, still at ₹218.93. Selling does not change the average.

Buy 60 more, this time for ₹15,000.

> (25 × 218.93 + 15,000) ÷ (25 + 60) = (5,473 + 15,000) ÷ 85 = **₹240.86 a unit**

Every unit on the shelf is now valued at ₹240.86, whichever lot it physically came from. That is the trade: you lose the ability to say which lot a particular unit came from, and you gain a number that is always current and needs no lot tracking.

## When FIFO is worth it instead

FIFO — first in, first out — keeps each lot separate and consumes the oldest first. It is more accurate and more work.

You want FIFO, or batch-level costing, when:

- **You sell by batch anyway.** Pharma distributors already track batch and expiry because they have to. The cost can ride along with it.
- **Prices move sharply and often.** Metals, some commodities. A moving average smooths a swing that you actually need to see.
- **You need per-batch margin.** If a customer negotiates on a specific lot, an average tells you nothing useful.

For most FMCG, hardware, grocery and general distribution, weighted average is the right answer. It gets you within a few per cent of FIFO for a fraction of the effort, and it is what Tally and most Indian accounting software use by default, so your CA will not blink at it.

## The check that catches errors

Whatever method you use, one test catches most mistakes on a purchase line:

> quantity × rate × (1 − discount%) should equal the amount printed on the row.

If it does not, a number came from the wrong column. On a photographed or scanned bill, that is usually the quantity and the rate being read out of adjacent columns — the arithmetic fails even though every individual figure looks sensible.

Run that check on every line before you accept a bill into stock. It is the cheapest fraud-and-typo detector you will ever build.

## Why this is hard in practice

None of the above is difficult arithmetic. It is difficult because it has to happen on **every line of every purchase bill**, and a distributor gets a lot of bills.

Do it by hand and you will do it right for a week. Do it in a spreadsheet and you will do it right until someone copies a formula down a column wrong. The only version that survives contact with a real godown is one where the cost is computed at the moment the bill is recorded, from the amount actually charged, without anyone deciding anything.

## Where Dhela fits

Dhela reads a supplier bill from a photo, checks every line against its own arithmetic, and costs stock at what you actually paid — the printed amount, with the discount already in it, spread across billed and free units together. It keeps a moving weighted average per product, locks the cost into each sale at the moment you issue it, and shows you margin per product built on that.

It also shows its working. If a line does not reconcile, it says so on the bill rather than quietly accepting it.

Free plan, no card. [dhela.in](https://dhela.in)
