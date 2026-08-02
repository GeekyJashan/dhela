import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLogger } from "./logger";
import { geminiModel } from "./ai-provider";

/**
 * Write a post and put it out, from one screen.
 *
 * The posting skill in this repo drives a real browser with a real logged-in
 * LinkedIn profile, which is why it works and also why a button in a deployed
 * app cannot call it: there is no browser on a serverless function and the
 * session lives on a laptop. So publishing here goes through the platforms'
 * own APIs, which need a token each and behave predictably once they exist.
 *
 * The skill stays useful and is not replaced — it handles images, carousels
 * and scheduling, which the APIs make far more work. This is for the plain
 * text post you want out before the day starts.
 */

const log = createLogger("marketing");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

/** Declared here; the generated Supabase types do not know this table yet. */
export type MarketingPost = {
  id: string;
  channel: "linkedin" | "twitter";
  language: "en" | "hi" | "pa";
  body: string;
  topic: string | null;
  status: "draft" | "published" | "failed";
  published_at: string | null;
  external_url: string | null;
  error: string | null;
  created_at: string;
};

function assertPlatformAdmin(claims: Record<string, unknown>) {
  const meta = claims.app_metadata as { platform_admin?: boolean } | undefined;
  if (meta?.platform_admin !== true) throw new Error("Forbidden: admin only");
}

const LIMITS = { linkedin: 2800, twitter: 275 } as const;

/**
 * What the product actually is, in the words a distributor would use. Kept
 * here rather than left to the model, which otherwise writes SaaS copy about
 * "streamlining workflows" for an audience that has never used the phrase.
 */
const BRIEF = `
Dhela is billing, stock and GST software for Indian distributors.
- A photo of a supplier's bill becomes line items, stock and true weighted-average cost, without typing.
- Sales invoices, e-way bills, retailer statements, receivables ageing.
- GSTR-1 and GSTR-3B working papers, ready before the 11th. It does not file; the taxpayer files.
- English, Hindi and Punjabi. Free plan; Pro is ₹7,999 a year.
Written by Jashan Sehgal, who builds it.`;

const VOICE = `
Write the way a person who has sat in a distributor's office writes.
- Open with something true and specific about their day — the pile of bills, the 11th of the month, the operator typing at 9pm. Never open with "In today's fast-paced world" or a question to the reader.
- Plain words. No "streamline", "leverage", "game-changer", "revolutionise", "unlock", "empower".
- No emoji walls, no hashtag spam. At most two hashtags, at the end, or none.
- Say one thing. A post that makes three points makes none.
- Never claim Dhela files GST returns. It prepares the papers; the taxpayer files.
- Never invent a customer, a number or a testimonial.`;

export const listPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertPlatformAdmin(context.claims);
    const db = context.supabase as unknown as Db;
    const { data, error } = await db.from("marketing_posts")
      .select("*").order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return { posts: (data ?? []) as MarketingPost[] };
  });

export const draftPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      channel: z.enum(["linkedin", "twitter"]),
      language: z.enum(["en", "hi", "pa"]).default("en"),
      topic: z.string().max(300).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims);
    const db = context.supabase as unknown as Db;
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY is not set on this deployment");

    // Everything already published, so the model can be told not to repeat
    // itself. Double-posting is the failure that actually embarrasses.
    const { data: prior } = await db.from("marketing_posts")
      .select("body").eq("channel", data.channel)
      .order("created_at", { ascending: false }).limit(15);
    const seen = (prior ?? []).map((p: { body: string }) => p.body.slice(0, 180)).join("\n---\n");

    const lang = { en: "English", hi: "Hindi (Devanagari)", pa: "Punjabi (Gurmukhi)" }[data.language];
    const limit = LIMITS[data.channel];
    const prompt = `${BRIEF}\n${VOICE}

Write ONE ${data.channel === "twitter" ? "post for X" : "LinkedIn post"} in ${lang}.
Hard limit ${limit} characters — count them, and come in under.
${data.topic ? `It should be about: ${data.topic}` : "Pick an angle that has not been used below."}
${seen ? `\nAlready posted, do not repeat the angle or the opening line:\n${seen}` : ""}

Return the post text only. No preamble, no quotes around it, no "here is".`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9 },
        }),
      },
    );
    if (!resp.ok) throw new Error(`Draft failed: ${resp.status} ${(await resp.text()).slice(0, 160)}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await resp.json();
    let body = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? "").join("").trim();
    // Models wrap a requested string in quotes surprisingly often.
    body = body.replace(/^["“']|["”']$/g, "").trim();
    if (!body) throw new Error("The model returned nothing to post");

    const { data: row, error } = await db.from("marketing_posts").insert({
      channel: data.channel, language: data.language, body,
      topic: data.topic ?? null, created_by: context.userId,
    }).select("*").single();
    if (error) throw new Error(error.message);

    log.info("draft", { channel: data.channel, language: data.language, chars: body.length });
    return { post: row, overLimit: body.length > limit };
  });

/** LinkedIn: needs LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN. */
async function publishLinkedIn(body: string) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const urn = process.env.LINKEDIN_PERSON_URN;
  if (!token || !urn) {
    throw new Error(
      "LinkedIn publishing needs LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN. " +
      "Until they are set, use Copy and paste it, or the local posting skill.",
    );
  }
  const resp = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: urn.startsWith("urn:") ? urn : `urn:li:person:${urn}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: body },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`LinkedIn ${resp.status}: ${text.slice(0, 200)}`);
  const id = resp.headers.get("x-restli-id") ?? JSON.parse(text || "{}").id ?? null;
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null };
}

/** X: needs TWITTER_ACCESS_TOKEN (OAuth 2.0 user token with tweet.write). */
async function publishTwitter(body: string) {
  const token = process.env.TWITTER_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "X publishing needs TWITTER_ACCESS_TOKEN — an OAuth 2.0 user token with tweet.write. " +
      "Until it is set, use Copy and paste it.",
    );
  }
  const resp = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: body }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`X ${resp.status}: ${text.slice(0, 200)}`);
  const id = JSON.parse(text || "{}")?.data?.id ?? null;
  return { id, url: id ? `https://x.com/i/status/${id}` : null };
}

export const publishPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      // What is on the screen is what goes out. Editing a draft and then
      // publishing the stored original would be a genuinely nasty surprise,
      // and having the client write the row first put two places in charge of
      // deciding what gets posted.
      body: z.string().min(1).max(3000).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims);
    const db = context.supabase as unknown as Db;

    const { data: post, error } = await db.from("marketing_posts")
      .select("*").eq("id", data.id).single();
    if (error || !post) throw new Error("Post not found");
    if (data.body && data.body !== post.body) {
      await db.from("marketing_posts").update({ body: data.body }).eq("id", post.id);
      post.body = data.body;
    }
    // The one guard that matters. A retry after a network wobble must not put
    // the same thing on the feed twice.
    if (post.status === "published") {
      throw new Error("Already published — nothing sent.");
    }

    try {
      const res = post.channel === "linkedin"
        ? await publishLinkedIn(post.body)
        : await publishTwitter(post.body);
      await db.from("marketing_posts").update({
        status: "published", published_at: new Date().toISOString(),
        external_id: res.id, external_url: res.url, error: null,
      }).eq("id", post.id);
      log.info("published", { channel: post.channel, id: res.id });
      return { ok: true, url: res.url };
    } catch (e) {
      const message = (e as Error).message;
      // Recorded, not swallowed: a failed post that looks like a draft gets
      // quietly retried forever, and one that looks published never gets sent.
      await db.from("marketing_posts").update({ status: "failed", error: message }).eq("id", post.id);
      throw new Error(message);
    }
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    assertPlatformAdmin(context.claims);
    const db = context.supabase as unknown as Db;
    const { error } = await db.from("marketing_posts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
