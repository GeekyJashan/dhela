---
name: dhela-media
description: Create Dhela-branded marketing media — a single 1200x1200 image card, a multi-slide LinkedIn carousel (PDF), or a screen-recorded demo video of the real app. Use when asked for a post image, a carousel, a deck, a demo video, or any visual to go with a social post. Pairs with the linkedin-post skill, which publishes what this produces.
---

# Making Dhela marketing media

Produces the file; `linkedin-post` publishes it. Keep them separate — media is
worth reviewing on its own before anything is written around it.

Everything runs from the **repo root** with the dev server up (`npm run dev`),
because the Latin brand faces are self-hosted at `/fonts` and only the dev
server serves them. Each script checks and says so.

| Want | Script | Output |
|---|---|---|
| Single post image | `card.mjs` | 1200×1200 PNG |
| Carousel / deck | `carousel.mjs` | multi-page PDF |
| Product demo | `demo-video.mjs` | MP4 (needs ffmpeg) |

All three share `render.mjs`, so a standalone card and a carousel slide are
visibly the same object. Change brand tokens there, not in three places.

## Design language

Tokens are copied from `src/styles.css`:

| Token | Value | Use |
|---|---|---|
| cream | `oklch(0.985 0.006 90)` | light background |
| ink | `oklch(0.22 0.03 200)` | dark background, body text on cream |
| teal | `oklch(0.42 0.09 200)` | accent on light |
| gold | `oklch(0.78 0.14 65)` | accent on dark, the coin |

Three styles: `light` (cream + faint ledger grid), `deep` (teal gradient),
`ink` (flat dark). In a carousel, alternate them — a deck in one treatment
reads as a PDF someone forgot to design.

Type is Instrument Serif for display, Inter for body, Noto Sans Devanagari /
Gurmukhi for `hi` and `pa`. Every slide carries the coin mark and either
`DHELA.IN` or a page counter.

**Headline syntax:** `|` breaks the line, `*stars*` take the accent colour.

```bash
--headline "45 minutes|→ *2 minutes.*"
```

## Single card

```bash
node .claude/skills/dhela-media/card.mjs \
  --lang en --style light \
  --eyebrow "Per supplier bill" \
  --headline "45 minutes|→ *2 minutes.*" \
  --body "AI reads every line, updates your stock, and recalculates the true weighted-average cost." \
  --out brand/post-en.png
```

`--lang en|hi|pa` picks the typeface. Indic headlines are stepped down and given
more leading automatically — Latin display type carries a much larger optical
size at the same px, and without that the Devanagari overflows.

## Carousel

**A LinkedIn carousel is a PDF.** LinkedIn "document posts" take a PDF and
render it swipeable. Uploading several PNGs gets you a plain multi-image post,
which is a different and worse thing. Do not offer "a carousel" as a folder of
images.

```bash
node .claude/skills/dhela-media/carousel.mjs --spec deck.json --out brand/deck.pdf
```

```json
{
  "lang": "en",
  "slides": [
    { "style": "deep",  "eyebrow": "Seven o'clock", "headline": "Forty bills.|One operator.",
      "body": "Item, quantity, rate, tax — line by line, every evening." },
    { "style": "light", "eyebrow": "The part nobody sees",
      "headline": "One wrong rate|poisons *every margin.*", "body": "…" },
    { "style": "light", "headline": "Free plan.|*No card.*",
      "body": "Keep using Tally alongside it.|dhela.in", "pager": false }
  ]
}
```

Per-slide `lang` and `style` override the deck default; styles alternate if you
omit them. A `1 / 7` counter is added unless `"pager": false`, and slide 1 gets
a `swipe →` hint. Six to ten slides is the useful range — past that people stop
swiping, and the script warns above 20.

The script warns if a slide's content overflows. **Take that seriously**:
overflow is invisible in a PDF, the slide just silently loses its last line.

## Demo video

Records the **real app** against the seeded e2e workspace. That is the whole
point — a real screen is the most credible thing you can show a distributor, and
it cannot drift from what the product actually does.

```bash
node .claude/skills/dhela-media/demo-video.mjs --out brand/demo.mp4
node .claude/skills/dhela-media/demo-video.mjs --out brand/demo.mp4 --steps dashboard,insights,gst
```

Steps: `dashboard, upload, invoices, insights, gst, payments`. Default runs all
six, about 35 seconds. Each scrolls slowly and holds; `--size` defaults to
`1280x800`.

Needs `e2e/.auth/user.json`. If it is missing or stale, refresh it with
`npx playwright test --project=desktop -g "landing page"`.

It writes a still per step to `<outdir>/demo-stills/`. **Look at them before
posting** — a demo showing a spinner or an empty table is worse than no demo.

## Things that will bite you

**ffmpeg is required for MP4.** Playwright records `.webm`, which LinkedIn does
not accept. Without ffmpeg the script keeps the webm and tells you to
`brew install ffmpeg`. The conversion forces `yuv420p` and even dimensions —
without both, the file plays fine on a desktop and shows a black rectangle on
most phones.

**A stale session records a login page.** `demo-video.mjs` aborts if a route
redirects to `/auth`, because a thirty-second film of a sign-in form is the kind
of thing that gets posted before anyone notices.

**Indic fonts come from Google, deliberately.** `public/fonts` holds a
57-character subset built from the landing page copy; point the renderer at it
and any new Hindi or Punjabi sentence renders as tofu. `render.mjs` loads the
full Noto families.

**Font family names are single-quoted in `render.mjs`.** They get interpolated
into a double-quoted `style="…"` attribute, and a double quote there terminates
the attribute — silently dropping `font-size` and everything after it. The first
carousel came out with headlines smaller than the body text for exactly this
reason. Do not "tidy" those quotes.

**The accent colour is a per-slide custom property**, not a global rule. A
global `.accent` rule makes the last slide's accent win for every slide.

## Handing off to the post

Produce the media, show it, then use the `linkedin-post` skill. That skill will
not publish without a human approving the copy, and the same applies here: show
the card or the deck before it goes anywhere.

For the pairing — a carousel is a document post, so `post.mjs --image` (which
attaches an image) is not the right path for a PDF. Attach the PDF by hand for
now, or extend `post.mjs`; the composer's media button accepts documents.
