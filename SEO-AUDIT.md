# SEO Audit — dhela.in

**Audited:** 2026-07-27 · **Business type: SaaS** (pricing page, sign-up, free plan,
`/features`-equivalent sections) · single public page

## SEO Health Score: 71/100

| Category | Weight | Score | Note |
|---|---|---|---|
| Technical SEO | 22% | 78 | HSTS + clean redirects; security headers thin |
| Content quality | 23% | 70 | Strong copy, no author/date/E-E-A-T signals |
| On-page SEO | 20% | 85 | One H1, clean hierarchy, no generic anchors |
| Schema | 10% | 90 | Organization + SoftwareApplication + FAQPage added |
| Performance (CWV) | 10% | 80 | Excellent LCP/CLS; JS still heavy for a marketing page |
| AI search readiness | 10% | 72 | See `GEO-ANALYSIS.md` |
| Images | 5% | 25 | Zero raster images on the page |

> **State warning.** Every fix below is committed locally and **not deployed**.
> The live site at dhela.in still serves the pre-fix HTML: no JSON-LD, no
> og:image, FAQ answers missing, `/robots.txt` and `/sitemap.xml` returning 404.
> These findings are only real once pushed.

---

## Critical

Nothing blocking indexing. The site is crawlable, returns 200, redirects
cleanly, and server-renders its content.

---

## High

### 1. Hero statistics server-rendered as zeroes — **fixed**
The `CountUp` component initialised at `useState(0)`, so the served HTML read:

```
0 → 0  min   Per purchase bill, start to stock
```

Crawlers and AI answer engines saw **wrong numbers**, not missing ones, in the
first 30% of the page. Seeded with the final value instead; now serves
`45 → 2 min`.

*How we'd know it regressed:* the SSR test asserts the real figures appear in
raw HTML fetched without a browser.

### 2. Both locale dictionaries in the shared chunk — **fixed**
`src/i18n.ts` statically imported `hi.json` and `pa.json`, and `__root.tsx`
imports i18n — so every visitor to the public marketing page, and every crawler,
downloaded **1,572 translation keys (~40 KB gzipped)** for an app they had not
signed into.

Now dynamically imported per language. Verified: `hi-*.js` and `pa-*.js` are
separate chunks and app-only Punjabi strings no longer appear in the index chunk.

| | Before | After |
|---|---|---|
| index chunk, gzipped | 213 KB | **173 KB** |
| index chunk, raw | 743 KB | 598 KB |

*Depends on:* nothing. *Unblocks:* any further CWV work on slow Indian mobile
networks, where 40 KB is real.

### 3. FAQ answers absent from HTML — **fixed** (see `GEO-ANALYSIS.md` §1)
Radix Accordion unmounted collapsed content. Replaced with `<details>`.

---

## Medium

### 4. No images on the page at all
`document.querySelectorAll("img").length === 0`. Every visual is inline SVG.
Consequences: nothing for Google Images, no `alt` text as a relevance signal,
and multi-modal content correlates with materially higher AI citation rates.

The product is inherently visual — a screenshot of a bill being read, the
extracted line items, the ageing report — and none of it is shown. This is a
content gap, not a markup one.

*Falsifiable:* if adding three annotated product screenshots doesn't change
time-on-page or image impressions in 60 days, the hypothesis was wrong.

### 5. Security headers thin
Present: `strict-transport-security: max-age=63072000`.
Absent: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` /
`frame-ancestors`, `Permissions-Policy`.

Not a ranking factor, but cheap and it's a trust surface for a product asking
distributors for their ledger. Add via `vercel.json` headers.

### 6. No E-E-A-T signals
No author, no organisation credentials, no publication or updated date, no
`sameAs` links (nothing exists to link to yet). Content under three months old
is roughly 3× more likely to be cited by AI answers, and there is currently no
date on the page for anything to judge freshness by.

Cheapest meaningful step: a real founder byline with a photo and a LinkedIn
link. You already lead with "you'll get the person who wrote the software" —
the page just never says who that is in a machine-readable way.

### 7. Single-page site
One URL means one shot at every query. No blog, no comparison pages, no
glossary. For a category where distributors search things like *"e-way bill
kaise banaye"*, *"GSTR-1 B2CS meaning"*, *"Tally alternative for distributors"*,
there is nothing to rank.

This is the highest-ceiling item on the list and the slowest. It is also the
only one that compounds.

---

## Low

- `changefreq`/`priority` in sitemap.xml are ignored by Google; harmless.
- `og:locale` is `en_IN` while the page contains Hindi and Punjabi. Correct as
  primary, but `og:locale:alternate` could be added if translated pages appear.
- No `theme-color` meta.

---

## Measured performance

Production build, served locally (so network latency is excluded — treat as an
upper bound on quality, not a field measurement):

| Metric | Value | Threshold |
|---|---|---|
| LCP | 264 ms | good (< 2.5 s) |
| CLS | 0.016 | good (< 0.1) |
| TTFB | 37 ms | good |
| FCP | 332 ms | good |
| JS transferred | 855 KB uncompressed / 28 chunks | heavy for a marketing page |
| CSS | 129 KB uncompressed | fine |

INP was not measured — it needs real interaction data, and field data via CrUX
requires the site to have traffic, which it does not yet.

**JS weight is the one soft spot.** A 598 KB raw index chunk on a page that is
essentially text and SVG is the TanStack router plus React plus the app shell.
Not urgent at current traffic; would matter on a 3G connection in a Jalandhar
shop, which is exactly the audience.

---

## On-page checks (all passing)

- Exactly one `<h1>`; clean `H1 → H2 → H3` hierarchy
- 18 links, **zero** generic anchors ("click here", "read more")
- Zero buttons without an accessible name
- `<html lang="en">` set
- `http://` → `https://` and `www.` → apex both resolve correctly
- No horizontal overflow at 390 px (asserted in the e2e suite)

---

## Action plan

**This week**
1. **Push the commits.** Everything above is inert until deployed. *(unblocks all)*
2. Add security headers via `vercel.json`. *(15 min)*
3. Add a founder byline with photo + LinkedIn. *(E-E-A-T floor)*

**This month**
4. Three real product screenshots with descriptive `alt`. *(fixes Images 25/100)*
5. Create the LinkedIn company page and one Reddit/YouTube presence — brand
   mentions correlate ~3× more strongly with AI citation than backlinks, and
   there are currently zero. *(see `GEO-ANALYSIS.md` §4)*

**This quarter**
6. Build out content: e-way bill guide, GSTR-1 explainer, "Tally alternative"
   comparison, HSN lookup tool. Each is a page that can rank; the current site
   has exactly one.

**Leading indicator to watch without re-auditing:** Search Console impressions
for non-branded queries. Today that number is zero because there is one page and
no brand. If it is still zero in 60 days after steps 4–6, the content thesis is
wrong and the answer is distribution, not SEO.

---

## Caveats

- Single-page audit; there is only one public URL.
- Performance measured on a local production server, not from a real network.
  Field CWV via CrUX needs traffic the site does not have.
- No Search Console, GA4 or backlink API credentials were configured, so
  indexation, traffic and referring-domain data are unavailable.
- Scores are heuristic.
