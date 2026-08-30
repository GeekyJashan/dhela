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

**Write as "we", never "I".** These go out from the Dhela company page, not
from Jashan's personal profile — the composer literally says *Dhela* in its
header, and `post.mjs` aborts if it does not. A post that says "I hear this
from distributors" or "I wrote up the comparison" reads as a person, and the
reader can see it came from a company, so it lands as either a slip or a
company pretending to be a friend. Neither is what you want.

- "The complaint **we** hear most about Marg…" not "the complaint I hear most"
- "**We** wrote up the full comparison" not "I wrote up"
- "**Our** price" is right; "my price" is not
- Hindi/Punjabi: **हम / ਅਸੀਂ**, never मैं / ਮੈਂ

Anything genuinely personal to the founder, a story from his own shop or an
opinion he wants attributed, belongs on his profile and reshared rather than on
the page in the first person. If a draft needs "I" to work, it is the wrong
surface for it.

**No long dashes.** Not the em dash and not the en dash. A stack of them is the
single clearest tell that copy was machine-written, and on a page selling
software to distributors that impression costs more than the punctuation buys.
Use what the sentence actually wants:

| Instead of | Write |
|---|---|
| `the renewal — that is the problem` | `the renewal. That is the problem.` |
| `it runs at 25% to 35% — every year` | `it runs at 25% to 35%, every year` |
| `three things — price, support, stock` | `three things: price, support, stock` |
| `Marg (a good product — offline) wins` | `Marg (a good product, offline) wins` |
| `₹7,200 — ₹10,300` | `₹7,200 to ₹10,300` |

A hyphen in a compound word (`one-time`, `five-year`) is fine and is not what
this is about.

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

## Making the image

**Use the `dhela-media` skill** — it owns every visual: the single 1200×1200
card, multi-slide carousels, and screen-recorded demo videos of the real app.

```bash
node .claude/skills/dhela-media/card.mjs \
  --lang en --style light \
  --eyebrow "Per supplier bill" \
  --headline "45 minutes|→ *2 minutes.*" \
  --body "AI reads every line, updates your stock…" \
  --out brand/post-en.png
```

Keep the three styles (`light|deep|ink`) rotating so a feed does not show three
identical cards. Read that skill before generating anything — it carries the
brand tokens and several traps worth not rediscovering.

Note a carousel is a **PDF document post**, not an image: `post.mjs --image`
attaches an image, so a PDF still has to go on by hand.

## Where posts live

Every post is a file in `content/linkedin/`, named `YYYY-MM-DD-<lang>-<slug>.md`:

```markdown
---
lang: en                    # en | hi | pa
image: brand/post-en.png    # optional; --image overrides
status: draft               # becomes `posted` automatically after publishing
needs_proofread: true       # optional; blocks --publish until removed
---
First paragraph.

Second paragraph. Blank line between each.
```

That directory is the record of what exists and what has gone out. **Write new
posts there**, not to a scratch file in /tmp — the whole point is that a session
six weeks from now can see the history.

## Publishing

```bash
node .claude/skills/linkedin-post/post.mjs --list     # what exists, and its status
node .claude/skills/linkedin-post/post.mjs --next     # dry-run the oldest unposted one
node .claude/skills/linkedin-post/post.mjs --post content/linkedin/<file>.md
node .claude/skills/linkedin-post/post.mjs --post content/linkedin/<file>.md --publish
```

`--next` picks the oldest file whose status is not `posted`. Dry run is the
default: it composes, verifies, screenshots to `/tmp/linkedin-preview.png` and
stops. **Show the user the copy and the preview, get a yes, then add
`--publish`.** On success the file is rewritten with `status: posted` and a
`posted_at` stamp.

`--text <file> --image <img>` still works for a one-off not worth a file.

## Queuing several at once

There is no "publish all". Publishing four posts together puts them in front of
the same small audience at the same moment — the later ones get nothing — and a
burst of automated publishes is the pattern that gets a company page restricted.

Use LinkedIn's own scheduler instead. One command now, posts land days apart,
nothing has to keep running:

```bash
node .claude/skills/linkedin-post/post.mjs --schedule-all --from 2026-08-04 --every 3 --at 10:00
node .claude/skills/linkedin-post/post.mjs --schedule-all --from 2026-08-04 --every 3 --at 10:00 --publish
```

It prints the plan first (dry run), skips anything flagged `needs_proofread`,
and runs one child process per post so a failure part-way leaves the rest
untouched and re-runnable. A single post can be queued with
`--post <file> --schedule 2026-08-04T10:00 --publish`.

**Scheduling is the one path that cannot be verified.** A company page exposes
no scheduled-posts list — `/admin/page-posts/scheduled/` redirects to the
dashboard, and LinkedIn's own "View all scheduled posts" button lands back on
the Published tab. The script confirms the post did *not* go out immediately
(if it is live, the schedule silently failed) and marks the file
`status: scheduled`, which is what stops it being queued twice. Confirm the
queue by hand in the composer's schedule dialog.

The Time field reports `role=combobox` but is an `<input>` typeahead, not a
`<select>` — `selectOption()` throws on it. Type the value and pick the matching
option from the listbox.

## Not posting the same thing twice

Three independent guards, because no single one is trustworthy:

| Guard | Catches | Blind spot |
|---|---|---|
| `status: posted` in the file | anything this repo has published | a post deleted on LinkedIn by hand still reads `posted` |
| `needs_proofread: true` | Indic copy no native speaker has read | only what you remember to flag |
| **live check of the published tab** | anything actually on the page, however it got there | needs the profile signed in |

The live check runs **before** the composer opens, so a duplicate costs nothing.
It has already earned its keep: a second copy of the English post was created by
hand, and a later `--next` run refused to make a third.

`--force` overrides all three and says so loudly. Reach for it only when a
second copy is genuinely wanted.

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

**The composer can stay open on a post that published perfectly well.** Do not
treat a lingering dialog as failure — that reading is what leads to a retry and
a duplicate post. `post.mjs` now confirms by loading the published tab and
looking for the opening line, and it refuses to claim success without it. If it
ever reports that it clicked Post but cannot find the post, **check the page by
hand before running anything again.**

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
