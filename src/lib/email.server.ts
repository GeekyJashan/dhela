/**
 * Sending mail, and the unsubscribe link that has to go in it.
 *
 * Server only. Never import this from a route or a *.functions.ts file that
 * ships to the browser: it reads the Resend key off the environment, and the
 * unsubscribe secret with it.
 *
 * Resend is reached over its REST API rather than through the SDK. One fetch
 * against a documented endpoint is not worth a dependency, and it keeps the
 * serverless bundle smaller.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SITE = "https://dhela.in";
/** Resend's batch endpoint takes at most 100 messages per call. */
const BATCH_SIZE = 100;

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** Who the mail comes from. Must be on a domain verified with Resend. */
export function emailFrom(): string {
  return process.env.EMAIL_FROM ?? "Dhela <hello@dhela.in>";
}

/**
 * The key that signs unsubscribe links.
 *
 * Falls back to the service-role key so this works without a second secret to
 * manage. That is safe here because the signature never leaves our own links
 * and is only ever checked against itself, but it does mean rotating the
 * service key invalidates outstanding unsubscribe links. Set
 * UNSUBSCRIBE_SECRET if you would rather they outlived a key rotation.
 */
function unsubscribeSecret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("No secret available to sign unsubscribe links");
  return s;
}

function sign(email: string): string {
  return createHmac("sha256", unsubscribeSecret())
    .update(email.toLowerCase().trim())
    .digest("base64url");
}

/**
 * A one-click unsubscribe URL for one address.
 *
 * Signed, because the alternative is a link that takes a bare email address
 * and removes it. That would let anyone unsubscribe anyone by editing the
 * query string, which is both a nuisance and a way to quietly cut a customer
 * off from mail they wanted.
 */
export function unsubscribeUrl(email: string): string {
  const e = encodeURIComponent(email.toLowerCase().trim());
  return `${SITE}/unsubscribe?e=${e}&s=${sign(email)}`;
}

/** Whether a signature matches, compared in constant time. */
export function verifyUnsubscribe(email: string, sig: string): boolean {
  try {
    const expected = Buffer.from(sign(email));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}

export type Mail = {
  to: string;
  subject: string;
  /** Plain text as typed by the sender. Turned into HTML and a text part. */
  body: string;
  unsubscribe: string;
};

/** Minimal escaping. Runs before any markup is added, never after. */
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Brand colours as hex.
 *
 * The app is written in oklch, which no email client understands. These are
 * the same colours converted once, here, rather than guessed at per template.
 */
const C = {
  ink: "#1c2b2f",
  muted: "#7a7268",
  cream: "#faf8f5",
  card: "#ffffff",
  teal: "#0f5d64",
  gold: "#dfa14b",
  goldSoft: "#fdf4e6",
  border: "#e8e2d9",
};

/**
 * What the compose box understands.
 *
 *   # Heading            a section heading
 *   ## Smaller heading
 *   - item               a bullet with a gold dot
 *   **bold**             bold
 *   [label](url)         a link, or a button when alone on its line
 *   > was | now | note   the price block
 *   ---                  a divider
 *
 * Deliberately a small, familiar subset rather than a markdown library. The
 * person writing these is composing one email a month in a textarea, not
 * authoring documents, and every extra rule is something to get wrong at the
 * moment of sending to the entire customer list.
 */
function inline(raw: string): string {
  let t = escapeHtml(raw);
  t = t.replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${C.ink}">$1</strong>`);
  t = t.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    `<a href="$2" style="color:${C.teal};text-decoration:underline">$1</a>`,
  );
  return t;
}

/** Bulletproof button: a table cell with a real background, not a styled <a>. */
function button(label: string, href: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${C.teal}" style="border-radius:8px">
<a href="${href}" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>
</td></tr></table>
</td></tr></table>`;
}

/**
 * The price block: old struck through, new large and gold.
 *
 * Text, not an image, and that is the point. Most clients block images until
 * the reader allows them, and the one thing this email exists to say must not
 * be the thing that fails to load.
 */
function priceBlock(parts: string[]): string {
  const [was, now, note] = parts;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
<tr><td align="center" bgcolor="${C.goldSoft}" style="padding:24px 16px;border-radius:12px;border:1px solid ${C.gold}33">
${note ? `<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};margin-bottom:10px">${escapeHtml(note)}</div>` : ""}
<span style="font-size:19px;color:${C.muted};text-decoration:line-through;white-space:nowrap">${escapeHtml(was ?? "")}</span>
<span style="font-size:19px;color:${C.muted};padding:0 9px">&rarr;</span>
<span style="font-size:30px;font-weight:700;color:${C.ink};white-space:nowrap">${escapeHtml(now ?? "")}</span>
</td></tr></table>`;
}

/** Turn one block of source into one block of HTML. */
function renderBlock(block: string): string {
  const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return "";

  if (lines.every(l => l === "---")) {
    return `<hr style="border:none;border-top:1px solid ${C.border};margin:28px 0">`;
  }

  // A price line: "> ₹3,999 | ₹899 a year | Standard plan"
  if (lines[0].startsWith(">")) {
    return priceBlock(lines[0].slice(1).split("|").map(x => x.trim()));
  }

  // A lone link becomes the call to action.
  const lone = lines.length === 1 && lines[0].match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (lone) return button(lone[1], lone[2]);

  if (lines[0].startsWith("## ")) {
    return `<h2 style="margin:28px 0 10px;font-size:19px;font-weight:600;color:${C.ink}">${inline(lines[0].slice(3))}</h2>`
      + renderBlock(lines.slice(1).join("\n"));
  }
  if (lines[0].startsWith("# ")) {
    return `<h1 style="margin:0 0 14px;font-size:27px;line-height:1.25;font-weight:700;color:${C.ink}">${inline(lines[0].slice(2))}</h1>`
      + renderBlock(lines.slice(1).join("\n"));
  }

  if (lines.every(l => l.startsWith("- "))) {
    // A table rather than <ul>: Outlook's list indentation is its own weather
    // system, and a two-cell row behaves everywhere.
    const rows = lines.map(l =>
      `<tr>
<td width="22" valign="top" style="padding:5px 0;color:${C.gold};font-size:17px;line-height:1.5">&bull;</td>
<td valign="top" style="padding:5px 0;font-size:16px;line-height:1.55;color:${C.ink}">${inline(l.slice(2))}</td>
</tr>`).join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px">${rows}</table>`;
  }

  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${C.ink}">${lines.map(inline).join("<br>")}</p>`;
}

/**
 * The HTML part.
 *
 * One column, 600px, tables throughout, every colour inline. No webfonts and
 * no background images: both fail quietly in enough clients that designing
 * around them is cheaper than discovering which ones.
 */
function html(body: string, unsubscribe: string): string {
  const content = body.split(/\n{2,}/).map(renderBlock).join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
</head>
<body style="margin:0;padding:0;background:${C.cream};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Dhela</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}" style="background:${C.cream}">
<tr><td align="center" style="padding:28px 12px 40px">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">

  <tr><td align="center" style="padding:0 0 22px">
    <a href="${SITE}" style="text-decoration:none">
      <img src="${SITE}/icon.png" width="40" height="40" alt="Dhela" style="display:inline-block;vertical-align:middle;border:0;border-radius:50%">
      <span style="display:inline-block;vertical-align:middle;padding-left:10px;font-size:23px;font-weight:700;letter-spacing:-0.2px;color:${C.ink}">Dhela</span>
    </a>
  </td></tr>

  <tr><td bgcolor="${C.gold}" style="background:${C.gold};height:4px;line-height:4px;font-size:0;border-radius:14px 14px 0 0">&nbsp;</td></tr>

  <tr><td bgcolor="${C.card}" style="background:${C.card};padding:32px;border-radius:0 0 14px 14px;border:1px solid ${C.border};border-top:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
${content}
  </td></tr>

  <tr><td align="center" style="padding:22px 16px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${C.muted}">
    Dhela &middot; invoice and inventory software for Indian distributors<br>
    <a href="${SITE}" style="color:${C.muted}">dhela.in</a>
    &nbsp;&middot;&nbsp;
    <a href="${unsubscribe}" style="color:${C.muted}">Unsubscribe</a>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

/** The text part, with the markup taken back out. */
function text(body: string, unsubscribe: string): string {
  const plain = body
    .split("\n")
    .map(l => {
      const t = l.trim();
      if (t.startsWith(">")) return t.slice(1).split("|").map(x => x.trim()).filter(Boolean).join("  ");
      if (t === "---") return "------------------------------";
      return l
        .replace(/^#{1,2}\s+/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2");
    })
    .join("\n");
  return `${plain}\n\n---\nDhela  ${SITE}\nUnsubscribe: ${unsubscribe}\n`;
}

export type SendResult = { email: string; ok: boolean; error?: string };

/**
 * Send a batch of messages.
 *
 * Returns a result per address rather than throwing on the first failure. A
 * campaign that stops dead on one bad address, having already delivered two
 * hundred, is worse than one that reports which address was bad.
 *
 * List-Unsubscribe is set as a header as well as a link. Gmail and Outlook
 * surface it as their own unsubscribe control, and its absence on bulk mail is
 * itself a spam signal.
 */
export async function sendBatch(mails: Mail[]): Promise<SendResult[]> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return mails.map(m => ({ email: m.to, ok: false, error: "RESEND_API_KEY is not set" }));

  const results: SendResult[] = [];

  for (let i = 0; i < mails.length; i += BATCH_SIZE) {
    const slice = mails.slice(i, i + BATCH_SIZE);
    const payload = slice.map(m => ({
      from: emailFrom(),
      to: [m.to],
      subject: m.subject,
      html: html(m.body, m.unsubscribe),
      text: text(m.body, m.unsubscribe),
      headers: {
        "List-Unsubscribe": `<${m.unsubscribe}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }));

    try {
      const resp = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const detail = (await resp.text()).slice(0, 300);
        for (const m of slice) results.push({ email: m.to, ok: false, error: `${resp.status}: ${detail}` });
        continue;
      }

      // Resend answers with one entry per message, in the order sent.
      const json = (await resp.json()) as { data?: { id?: string; error?: unknown }[] };
      slice.forEach((m, idx) => {
        const entry = json.data?.[idx];
        const err = entry && "error" in entry && entry.error ? String(entry.error) : undefined;
        results.push({ email: m.to, ok: !err, error: err });
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const m of slice) results.push({ email: m.to, ok: false, error: msg });
    }
  }

  return results;
}
