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

/** Minimal escaping, because the body is plain text going into an HTML part. */
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * The HTML part.
 *
 * Deliberately plain. A mail that looks like a newsletter gets filed like a
 * newsletter, and this is going to distributors who read mail on a phone. One
 * column, system fonts, no images, no tracking pixel.
 */
function html(body: string, unsubscribe: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#faf8f5">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c2b2f">
${paragraphs}
<hr style="border:none;border-top:1px solid #e5e0d8;margin:32px 0 16px">
<p style="margin:0;font-size:12px;color:#7a7268">
Dhela &middot; <a href="${SITE}" style="color:#7a7268">dhela.in</a><br>
<a href="${unsubscribe}" style="color:#7a7268">Unsubscribe from these emails</a>
</p>
</div></body></html>`;
}

function text(body: string, unsubscribe: string): string {
  return `${body}\n\n---\nDhela  ${SITE}\nUnsubscribe: ${unsubscribe}\n`;
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
