# SEO Audit — dhela.in

**Audited:** 2026-07-27 · **Business type: SaaS** (pricing page, sign-up, free plan,
`/features`-equivalent sections) · single public page

## SEO Health Score: 71 → 79 → 88/100 (round 3)

| Category | Weight | Score | Note |
|---|---|---|---|
| Technical SEO | 22% | 90 | HSTS, clean redirects, full security header set |
| Content quality | 23% | 88 | Named author, credentials, LinkedIn, stated update date |
| On-page SEO | 20% | 85 | One H1, clean hierarchy, no generic anchors |
| Schema | 10% | 95 | Organization, SoftwareApplication, FAQPage, Person, WebPage |
| Performance (CWV) | 10% | 80 | Excellent LCP/CLS; JS still heavy for a marketing page |
| AI search readiness | 10% | 72 | See `GEO-ANALYSIS.md` |
| Images | 5% | 90 | Five real product screenshots, all with alt text and dimensions |

> **Re-audit.** The previous round is deployed and verified live: JSON-LD,
> og:image, FAQ answers in HTML, robots.txt and sitemap.xml all returning 200.
> Live Core Web Vitals measured over the real network are in the "good" band on
> both desktop and mobile. New findings from this pass are marked **[R2]**.

## [R4] Third-party crawler findings, fixed

A run through seositecheckup.com surfaced six items. Five are fixed; one needs a
DNS change only the domain owner can make.

| Finding | Severity | Status |
|---|---|---|
| Render-blocking resources | HIGH | Fixed — fonts self-hosted, no third-party stylesheet |
| Title/meta/heading keywords don't overlap | HIGH | Fixed — H1 rewritten |
| Images not in a modern format | HIGH | Fixed — WebP |
| More than 20 HTTP requests | LOW | Fixed — 40 → 19 |
| No SPF record | LOW | **Open — needs a TXT record at the registrar** |
| Favicon not referenced properly | LOW | Fixed — added `rel="shortcut icon"` |

### The rupee sign was costing 104 KB

The single biggest finding of this round, and it was invisible until the font
files were listed by subset. U+20B9 (₹) sits in Google's `latin-ext` unicode
range, so rendering one rupee glyph pulled the **entire** latin-ext subset of
three families: Inter (83 KB), Instrument Serif (7.6 KB) and Noto Devanagari
(13.5 KB). None of the rest of latin-ext — Central and Eastern European
accented characters — is used anywhere on the page.

Fonts are now self-hosted and built by `scripts/build-fonts.mjs` (`npm run
fonts`), which fetches a rupee-only subset and inlines it as a data URI with
`unicode-range: U+20B9`.

Instrument Serif turns out to have no ₹ glyph at all — gstatic answers that
subset request with a 400 — so ₹ in display type has always fallen through the
stack. Unchanged behaviour, now documented rather than accidental.

### Indic fonts moved off the marketing page

Noto Devanagari + Gurmukhi were 151 KB, loaded by every visitor, for one hero
tagline and two FAQ entries. The landing page now ships a 25 KB subset built
from the characters that page actually contains. The full families load only
when someone switches the app to Hindi or Punjabi, because a distributor can
type any Devanagari they like into a product name and a subset would not have
it. The font stack lists the subsets ahead of the full families and the system
Indic font, so an uncovered glyph degrades to a font mismatch, never to tofu.

*Verified:* switching the app to Hindi fetches the 118 KB full family and
`document.fonts.check('16px "Noto Sans Devanagari"', 'हिसाब')` returns true.

### Measured, production build over localhost

| | Before | After |
|---|---|---|
| Requests | 40 | **19** |
| Fonts | 317.7 KB / 7 reqs | **87.3 KB / 4 reqs** |
| Images | 204.3 KB JPEG | **75.0 KB WebP** |
| Scripts | 28 reqs | **11 reqs** |

Screenshots re-encoded at WebP q90 rather than q85: q85 saved another 58 KB but
these are text-heavy UI captures already through one lossy generation, and q90
holds SSIM at 0.9968. 948 KB of JPEG became 504 KB of WebP on disk.

### Still open after this round

The entry chunk is 424 KB raw / 119 KB gzipped, and the largest thing in it is
the Supabase auth client — which a logged-out visitor reading the marketing page
has no use for. Deferring it is the next real performance win, and it is a
bigger change than anything above because it touches the auth flow.

Also worth stating plainly: the "more than 20 HTTP requests" rule is an
HTTP/1.1-era heuristic, and Vercel serves this site over HTTP/2. Getting from 21
to 19 was worth doing because those were sub-1 KB chunks costing a full round
trip each on a slow Indian mobile connection — not because 20 is a meaningful
number.

## [R2] Correction to earlier advice: FAQPage schema

I recommended FAQPage markup last round and implied a search benefit. That was
wrong. **Google retired FAQ rich results for all sites on 7 May 2026** — the
dropdown SERP feature no longer exists, Search Console's FAQ reporting is being
removed through mid-2026, and the markup produces no rich result.

What survives: Google still reads FAQ structured data to understand a page, and
the markup does no harm. **Keep it — don't remove it.** But the real win was
never the schema; it was getting the answers into server-rendered HTML, which
helps users and AI answer engines regardless of what Google does with the JSON-LD.

Do not add FAQPage to future pages expecting a SERP feature.

## [R2] Live Core Web Vitals

Measured against the deployed site over a real network, not localhost:

| | TTFB | FCP | LCP | CLS | Load | Requests |
|---|---|---|---|---|---|---|
| Desktop | 136 ms | 644 ms | 644 ms | 0.016 | 877 ms | 38 |
| Mobile | 149 ms | 756 ms | 756 ms | 0.015 | 911 ms | 38 |

All comfortably inside Google's "good" thresholds. INP still unmeasured — it
needs real interaction data from real users.

## [R2] Fonts were the second-largest payload — fixed

318 KB of webfont on a page with no images. Four weights each of Noto Sans
Devanagari and Noto Sans Gurmukhi were being loaded; Indic glyph sets are large,
and the landing page's Devanagari amounts to one tagline. Trimmed to two weights
each (400, 600). Latin keeps its full range because the UI genuinely uses
400/500/600/700.

## [R2] FAQ answers were too short to cite — improved

Answers measured 25–40 words against an optimal citation block of 134–167. Short
enough to be skipped as a citation target. The three answers carrying the most
commercial weight — the Tally coexistence question, the accuracy question and the
privacy question — are now 105–125 words, each still fully checkable against what
the product does. The simple ones stay short, which is correct.

## [R2] Security headers — fixed

`vercel.json` now sets `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options` and `Permissions-Policy`, plus a one-day cache on static brand
assets. HSTS was already present.

## [R2] Schema validated

All three blocks structurally valid, required fields present, and the three plan
prices in `SoftwareApplication` read from `PLANS` so they cannot drift from what
you charge. `Organization.sameAs` is absent because no social profiles exist yet
— that is the gap to close, not a markup error.

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

### 4. No images on the page at all — **fixed [R3]**
Five real screenshots of the running app, captured through Playwright against a
logged-in session with seeded demo data, now ship in a "Look inside" product
tour: the purchase review screen, the insights dashboard, GST working papers,
receivables ageing, and the camera upload flow in a phone frame. Every image
carries descriptive alt text and explicit dimensions, and the section is a real
tour — tabs, auto-advance, pause on hover.

One capture detail worth recording: the first mobile shot was taken by resizing
the viewport, which does **not** change the user agent, so `isMobileDevice()`
returned false and the camera button never rendered. The caption claimed
something the picture didn't show. Re-shot with a real Pixel 7 device profile.

*Original finding, kept for context:*
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

### 6. No E-E-A-T signals — **fixed [R3]**
Founder card on the closing CTA: Jashan Sehgal, Founder · NIT alumnus, with a
LinkedIn link and a first-person line about why the product exists. Footer
carries a byline and a machine-readable `<time>` last-updated date. Schema gains
`Person` (with `alumniOf` and `sameAs`) and `WebPage` (with `author`,
`datePublished`, `dateModified`), and `Organization.sameAs` now points at the
founder's LinkedIn — it was the one empty required-ish field last round.

*Original finding, kept for context:*
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
