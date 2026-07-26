# GEO / AI Search Analysis — dhela.in

**Audited:** 2026-07-27 · live production HTML · **GEO Readiness: 46/100**

> **Update, same day:** items 1, 2, 8, 9 and most of 10 are fixed and verified
> in the served HTML (FAQ answers, og:image, JSON-LD, robots.txt, sitemap.xml,
> canonical, product definition, unsourced 98% claim removed). Re-scored
> **72/100**. The remaining gap is §4 — brand mentions — which no markup fixes.

Google's position is that optimising for AI search *is* SEO — GEO/AEO are labels
for the same work. Findings below are SEO fundamentals applied to AI-answer
surfaces, not a separate discipline.

| Criterion | Weight | Score | Notes |
|---|---|---|---|
| Citability | 25% | 55 | Strong copy, but the most citable block is invisible to crawlers |
| Structural readability | 20% | 75 | Genuinely good hierarchy and question-based headings |
| Multi-modal | 15% | 30 | No og:image, no video, no diagrams |
| Authority & brand signals | 20% | 10 | Zero presence anywhere; domain days old |
| Technical accessibility | 20% | 55 | SSR excellent; everything else missing |

---

## 1. The finding that matters most

**All seven FAQ answers are missing from the server-rendered HTML.**

Verified against live HTML:

| Probe | In SSR HTML |
|---|---|
| `Do I have to stop using Tally?` (question) | yes |
| `most people don't` (its answer) | **no** |
| `confidence score and only the uncertain` | **no** |
| `isolated workspace` | **no** |
| `NIC bulk-upload file` | **no** |

Radix `AccordionContent` renders nothing while collapsed. The triggers ship, the
answers don't. **AI crawlers do not execute JavaScript**, so every answer engine
sees seven questions with no answers.

This is the highest-leverage fix on the page, because Q&A pairs are the exact
shape AI answer engines extract. The content is already written and already good
— it simply isn't being delivered.

**Fix:** render FAQ content in the DOM and hide it with CSS rather than
unmounting it. In `src/routes/index.tsx`, either give `Accordion` a
`defaultValue` covering all items, or replace it with `<details>/<summary>`,
which is natively SSR-friendly, keyboard-accessible and needs no JS at all.

---

## 2. AI crawler access

`https://dhela.in/robots.txt` → **404**.

No robots.txt means nothing is blocked, so GPTBot, OAI-SearchBot, ClaudeBot and
PerplexityBot can all crawl today. That's the permissive default, not a problem —
but there's also no sitemap reference and no explicit signal.

Recommended `public/robots.txt`:

```
User-agent: *
Allow: /

# App screens are behind auth and render nothing server-side.
Disallow: /auth
Disallow: /dashboard
Disallow: /invoices
Disallow: /sales
Disallow: /gst
Disallow: /account

User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /

Sitemap: https://dhela.in/sitemap.xml
```

Verified: `/auth` server-renders **0 visible words** (the route is `ssr:false`),
so authenticated routes leak nothing. Disallowing them is tidiness, not urgency.

---

## 3. llms.txt

**Absent (404).** Leaving it that way is defensible.

Google's AI optimization guide states you do not need `llms.txt` for Google
Search including its AI features, and that it "won't harm (nor help)" rankings.
Mueller called the discovery use case "a dead end." It carries **no citation
weight here**. Optional for non-Google crawlers; not a priority.

---

## 4. Brand mention analysis — the real ceiling

Brand mentions correlate with AI citation roughly **3× more strongly than
backlinks** (Ahrefs, 75k brands: YouTube ~0.737, Domain Rating ~0.266).

| Platform | Presence |
|---|---|
| Wikipedia / Wikidata | none |
| Reddit | none |
| YouTube | none |
| LinkedIn | none |
| Web mentions | none — searched, nothing indexed |

**No technical fix moves this.** The domain is days old and the brand is
genuinely unknown, so ChatGPT (Wikipedia 47.9%, Reddit 11.3%) and Perplexity
(Reddit 46.7%) have nothing to cite. This is the ceiling on AI visibility for
the next several months, and it's earned through distribution, not markup.

Given the actual go-to-market — Jalandhar distributors, WhatsApp word of mouth —
the honest read is that **AI search is not where the first ten customers come
from.** Fix the technical items because they're cheap and permanent; don't expect
AI citations before the brand exists.

---

## 5. Passage-level citability

Optimal citable block is **134–167 words**, and ~44% of AI citations come from
the first 30% of a page.

Working well:
- Specific, quotable figures — `₹333/month`, `45 min → 2 min`, `₹50,000` e-way
  threshold, `₹1,00,000` B2CL threshold, plan prices
- Self-contained pain→fix cards that extract cleanly without surrounding context
- A comparison table, which is ideal extractable structure

Weak:
- **No "What is Dhela?" definition anywhere.** There is no sentence matching
  `X is …` that an answer engine can lift to explain the product. The H1 is a
  claim ("Your entire back office, run by AI"), not a definition.
- **`98%+ match accuracy` is unsourced.** Unverifiable statistics are a
  liability in AI answers, and this one has no data behind it. Remove or
  substantiate before it gets quoted back at you.
- Meta description still describes only invoice extraction, while the page now
  sells the whole back office. It's stale relative to the content.

**Add near the top, ~40–60 words:**

> Dhela is invoice and inventory software for Indian distributors. It reads
> supplier bills with AI, updates stock and true weighted-average cost, raises
> GST invoices, prepares e-way bills and GSTR-1 working papers, and answers
> questions about your business in English, Hindi or Punjabi. Free plan
> available; paid plans from ₹3,999 a year.

---

## 6. Structure

Genuinely strong, and unusual for a landing page:

- Clean `H1 → 9×H2 → 14×H3`, single H1
- **Seven question-based H3s** in the FAQ — exactly the pattern that matches
  query phrasing
- Comparison table, ordered steps, feature lists, short paragraphs
- `<html lang="en">` correct

The structure is already doing its job. The FAQ delivery bug is what's wasting it.

---

## 7. Server-side rendering

**The one thing done well.** Verified in live HTML: hero, pain cards, feature
grid, pricing, comparison table and FAQ *questions* are all server-rendered.
100KB of real HTML, no JS required.

Exception: FAQ answers (§1).

---

## 8. Structured data

**None.** No JSON-LD anywhere. Three schemas apply directly:

- **Organization** — name, url, logo, contactPoint, `sameAs` once social profiles exist
- **SoftwareApplication** — `applicationCategory: BusinessApplication`, `offers`
  with the three real plan prices, `inLanguage: [en, hi, pa]`
- **FAQPage** — seven Q&A pairs already written; **only valid once the answers
  are actually in the DOM** (§1), since schema must match visible content

---

## 9. Missing head elements

| Element | Status | Impact |
|---|---|---|
| `og:image` | **absent** | No preview card on WhatsApp — the channel you actually sell through |
| `canonical` | absent | Duplicate-URL ambiguity |
| `sitemap.xml` | 404 | Slower discovery |
| Publication / updated date | absent | Content under 3 months is ~3× more likely to be cited |
| Author / org credentials | absent | No E-E-A-T signal |

`og:image` is worth doing first for a non-AI reason: every WhatsApp share of
`dhela.in` currently renders as a bare link with no picture, and WhatsApp is
your primary distribution channel.

---

## 10. Top 5 highest-impact changes

1. **Ship the FAQ answers in HTML** (§1) — the content exists; it just isn't
   delivered. Biggest single citability win, ~15 minutes.
2. **Add an og:image** — 1200×630 with the coin logo, wordmark and
   "हर ढेला, हिसाब में". Fixes every WhatsApp share, not just AI previews.
3. **Add a 40–60 word "What is Dhela?" definition** high on the page (§5).
4. **Add JSON-LD** — Organization + SoftwareApplication now, FAQPage after #1.
5. **Add robots.txt and sitemap.xml** (§2).

Then, and only then: **fix or remove the unsourced 98% claim**, and start
building the brand mentions that are the actual constraint (§4).

---

## Caveats

- Scores are heuristic, from a single-page audit of the production HTML.
- Third-party statistics quoted here (Ahrefs, SE Ranking, SparkToro) come from
  the skill's reference material and were not independently verified.
- Only `/` was audited in depth; `/auth` was checked for SSR leakage only. Every
  other route is behind authentication and correctly renders nothing.
