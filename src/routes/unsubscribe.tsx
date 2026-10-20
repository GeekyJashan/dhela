/**
 * Where the unsubscribe link in a mass email lands.
 *
 * Public, and deliberately outside the authenticated layout: somebody who
 * wants out of our mail must not be asked to sign in first. Asking them to
 * log in to stop emails is how a complaint becomes a spam report.
 *
 * It acts on load rather than showing a confirm button, because Gmail and
 * Outlook fetch one-click unsubscribe links themselves and never render a
 * page. A link that needs a click would silently do nothing for them.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Logo } from "@/components/logo";

const unsubscribe = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ email: z.string(), sig: z.string() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { verifyUnsubscribe } = await import("@/lib/email.server");
    // An unsigned or tampered link is refused, so nobody can unsubscribe
    // somebody else by editing the address in the query string.
    if (!verifyUnsubscribe(data.email, data.sig)) return { ok: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.trim().toLowerCase();
    // upsert, not insert: clicking the link twice is normal and must not error.
    await supabaseAdmin.from("email_optouts")
      .upsert({ email, reason: "unsubscribe link" }, { onConflict: "email" });
    return { ok: true, email };
  });

export const Route = createFileRoute("/unsubscribe")({
  head: () => ({
    meta: [
      { title: "Unsubscribe — Dhela" },
      // Nothing here should ever be indexed.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => ({
    e: typeof s.e === "string" ? s.e : "",
    s: typeof s.s === "string" ? s.s : "",
  }),
  loaderDeps: ({ search }) => ({ e: search.e, s: search.s }),
  loader: async ({ deps }) => {
    if (!deps.e || !deps.s) return { ok: false as const };
    return await unsubscribe({ data: { email: deps.e, sig: deps.s } });
  },
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const result = Route.useLoaderData() as { ok: boolean; email?: string };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="flex justify-center mb-6"><Logo size={32} /></div>
        {result.ok ? (
          <>
            <h1 className="font-display text-2xl">You are unsubscribed</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {result.email} will not receive any more marketing email from Dhela.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              This does not touch your account. Sign-in links, and anything else
              you need in order to use Dhela, still reach you as before.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl">That link did not work</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It may have been cut short by your email app. Reply to the email
              you received and we will take you off the list by hand.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
