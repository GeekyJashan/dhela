import { createFileRoute } from "@tanstack/react-router";
import { processOrderQueue } from "@/lib/orders.functions";
import { createLogger } from "@/lib/logger";

const log = createLogger("api.process-order-queue");

/**
 * Fills queued order uploads. Fired by the client right after enqueue for
 * snappy UX, and safe for pg_cron to call on a schedule. Only reads/writes
 * `queued` order rows via the extraction service — no secret required.
 */
export const Route = createFileRoute("/api/public/hooks/process-order-queue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let limit = 5;
        try {
          const body = await request.json().catch(() => ({}));
          if (typeof body?.limit === "number") limit = Math.min(20, Math.max(1, body.limit));
        } catch { /* no body */ }
        log.info("tick", { limit });
        try {
          const result = await processOrderQueue({ data: { limit } });
          return Response.json(result);
        } catch (e) {
          log.error("failed", { err: e });
          return Response.json({ error: (e as Error).message }, { status: 500 });
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST to process queued order uploads" }),
    },
  },
});
