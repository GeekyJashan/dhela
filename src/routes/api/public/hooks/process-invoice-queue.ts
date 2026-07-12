import { createFileRoute } from "@tanstack/react-router";
import { processQueue } from "@/lib/invoices.functions";
import { createLogger } from "@/lib/logger";

const log = createLogger("api.process-invoice-queue");

/**
 * Called by pg_cron every minute (see cron setup in README) and also fired
 * by the client right after enqueue for immediate feedback. No secret
 * required — the underlying worker only reads `queued` rows and processes
 * them via the extraction service.
 */
export const Route = createFileRoute("/api/public/hooks/process-invoice-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let limit = 5;
        try {
          const body = await request.json().catch(() => ({}));
          if (typeof body?.limit === "number") limit = Math.min(20, Math.max(1, body.limit));
        } catch { /* no body */ }
        log.info("cron:tick", { limit });
        try {
          const result = await processQueue({ data: { limit } });
          return Response.json(result);
        } catch (e) {
          log.error("cron:failed", { err: e });
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST to process queued invoices" }),
    },
  },
});
