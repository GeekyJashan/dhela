---
name: linkedin-post
description: Draft, illustrate and publish a post to the Dhela LinkedIn company page. Use when asked to post on LinkedIn, write a LinkedIn post, make a launch/marketing post, or run the daily posting routine. Covers English, Hindi and Punjabi, generates the 1200x1200 brand card, and publishes through a signed-in Chrome profile.
---

# Posting to the Dhela LinkedIn company page

Everything a cold session needs. Read it all before running anything — several
of the facts below were learned the hard way and are not discoverable from the
page.

## Guardrails — read first

1. **Never publish copy the user has not read.** Draft it, show it in full, wait
   for approval. These posts are permanent, public, screenshot-able, and written
   in the founder's voice. "Post something about X" authorises a draft, not a
   publication.
2. **`post.mjs` will not publish without `--publish`.** Default is a dry run that
   composes the post and screenshots it. Keep it that way.
3. **The user is the native Hindi/Punjabi speaker, not you.** Always ask them to
   proofread Indic copy before it goes out. Phrasing that reads slightly off
   destroys the credibility the post is buying.
4. **LinkedIn's User Agreement prohibits automated access.** One approved,
   human-reviewed post at a time looks like a normal session. Bulk or unattended
   scheduled posting risks the company page being restricted. If asked for
   "daily" posting, that means *a post a day that a human approved* — never a
   loop that publishes unread text.
5. **Do not put the founder's phone number on the page.** It was deliberately
   cleared from the company profile. Contact goes through dhela.in → WhatsApp.

## The account

| Thing | Value |
|---|---|
| Company page | Dhela |
| Page ID | `142985997` |
| Public URL | `https://www.linkedin.com/company/dhelaa/` |
| Admin URLs | must use the **numeric ID** — vanity slugs 404 to `/company/unavailable/` |
| Site | https://dhela.in |
| Founder | Jashan Sehgal, NIT alumnus, Jalandhar, Punjab |

Two traps worth remembering:

- **`/company/dhela` is a different company** — a fashion label trading since
  2016. The extra "a" in `dhelaa` is deliberate, not a typo.
- **The numeric URL redirects logged-out visitors to a login wall.** Use the
  vanity URL in anything public-facing (schema, footer links, shares); use the
  numeric one for admin navigation.

## Why a separate browser profile

Playwright MCP's `--extension` mode attaches through Chrome's `chrome.debugger`
API, and Chrome blocks `DOM.setFileInputFiles` there — uploads fail with
`Not allowed`. It is a security boundary, not a bug, and no permission removes
it. A browser Playwright launches itself has no such restriction, so posting with
media goes through the persistent profile at `~/.dhela-browser`.

```bash
node scripts/browser-session.mjs check    # is the profile still signed in?
node scripts/browser-session.mjs login    # user runs this; opens a window to sign in
```

If `check` says SIGNED OUT, **stop and ask the user to run `login`** — they have
to type the password and 2FA themselves. Never ask them for credentials.

Run every script from the repo root so `@playwright/test` resolves.

## Voice

Match the register in `src/locales/hi.json` and `pa.json`: native script for
ordinary words, **English for technical terms** (`invoice`, `rate`, `margin`,
`GST`, `e-way bill`, `stock`). That is how this audience actually writes, and
formal literary Hindi reads as an outsider talking at them.

What works:

- A concrete scene before any claim. "Forty supplier bills on the table. One
  operator. Three hours of typing."
- Real numbers: 45 minutes → 2 minutes per bill. ₹0 / ₹3,999 / ₹7,999 a year.
- Naming the competitor's world honestly — most readers use Tally or CatPro and
  are not going to stop. "Keep using Tally alongside" is a feature, not a retreat.
- Ending with `dhela.in` on its own line.

What does not: "revolutionising", "seamless", "empowering", exclamation marks,
hashtag stacks, or claiming anything the product does not do. Unverified claims
to avoid: WhatsApp statements/reminders, and anything about GST *filing* — Dhela
produces working papers, it does not file.

## Making the card

1200×1200, brand tokens straight from `src/styles.css`:

| Token | Value |
|---|---|
| cream | `oklch(0.985 0.006 90)` |
| ink | `oklch(0.22 0.03 200)` |
| teal | `oklch(0.42 0.09 200)` |
| gold | `oklch(0.78 0.14 65)` |

```bash
node .claude/skills/linkedin-post/card.mjs \
  --lang en --style light \
  --eyebrow "Per supplier bill" \
  --headline "45 minutes|→ 2 minutes." \
  --body "AI reads every line, updates your stock…" \
  --out brand/post-en.png
```

`--lang` is `en|hi|pa` (picks the typeface), `--style` is `light|deep|ink`, and
`|` in `--headline` is a line break. Keep the three styles rotating so a feed
does not show three identical cards.

**The landing page's Indic fonts are a 57-character subset** built from
`src/routes/index.tsx` — they will tofu on new copy. `card.mjs` loads the full
Noto families from Google Fonts for exactly this reason. Do not "optimise" that.

The card needs the dev server for the self-hosted Latin faces:
`npm run dev` (port 8080) before rendering. `card.mjs` checks and tells you.

## Publishing

```bash
# 1. Dry run — composes, screenshots, does NOT publish
node .claude/skills/linkedin-post/post.mjs --text post.txt --image brand/post-en.png

# 2. Show the user /tmp/linkedin-preview.png and the copy. Get approval.

# 3. Publish
node .claude/skills/linkedin-post/post.mjs --text post.txt --image brand/post-en.png --publish
```

Put the post body in a UTF-8 text file, blank line between paragraphs.

Notes baked into `post.mjs`, so you do not have to rediscover them:

- The composer opens from the **"Start a post" link** on the admin dashboard.
- It must say **Dhela** in the dialog header. If it shows the founder's name it
  is composing as the person, not the page — `post.mjs` aborts if so.
- The editor is a `contenteditable`, not an input. `fill()` mangles it; the
  script types paragraph by paragraph with `keyboard.insertText` + `Enter`,
  which produces the `<p>`-per-line structure LinkedIn expects.
- Media must be attached **before** typing is verified — opening the media
  sub-modal and pressing Back leaves the text intact, but the reverse order has
  reset the editor in the past.

## Two things the composer does that surprise people

**Writing `dhela.in` in the body auto-generates a link preview card.** LinkedIn
scrapes the URL and renders a card from the site's `og:image` and title. That
means a text-only post is never bare — but attaching an image **replaces** the
card. Both are fine; just know you get one or the other, never both.

**The page's own avatar is an `licdn.com` `<img>`.** An attachment check that
matches `licdn.com` reports success for an upload that never happened. Only
`blob:` and `data:` sources are the uploaded file. `post.mjs` checks for those
and dumps every image src when it finds none.

Also: the composer scrolls to the caret after typing, which is past the image,
so the preview screenshot scrolls containers back to top first. Media sits
*below* the text in the composer, so it may still be out of frame — trust the
`attached … — N uploaded image(s)` line over the screenshot.

## Cadence

The page started at 0 followers. Initial reach comes almost entirely from the
founder resharing to his own network, which skews English and NIT-alumni.

- Space posts out. Three in one day cannibalise each other and read as spam.
- Rotate language: English → a few days → Hindi → a few days → Punjabi.
- One idea per post. A post that explains the whole product explains nothing.

Post ideas that have not been used yet: the weighted-average-cost trap (a wrong
rate two weeks ago silently poisons every margin since); why a distributor should
keep Tally; what GSTR-1 Table 12 changed in 2025; the catalogue-matching problem
(the same product written six different ways across six suppliers' bills).
