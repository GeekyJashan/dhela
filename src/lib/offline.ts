/**
 * Working without a signal.
 *
 * A distributor stands in a godown photographing forty supplier bills. The
 * signal drops halfway. Before this, every remaining upload failed, the rows
 * went red, and reloading the page lost the photos entirely — the one feature
 * that makes Dhela worth using, failing at the exact moment it should shine.
 *
 * So photos are held on the device until they can be sent. IndexedDB rather
 * than localStorage because these are image blobs, and localStorage is capped
 * around 5MB, holds strings only, and blocks the main thread while it reads.
 *
 * Deliberately narrow: this queues photographs, which are inert until the
 * server reads them. It does not queue invoices. Issuing a bill offline needs
 * a device-aware numbering scheme, because two operators offline would both be
 * handed the same invoice number by `next_sales_invoice_number`, and a
 * duplicate serial on a GST document is not a merge conflict you can fix later.
 */

const DB_NAME = "dhela-offline";
const DB_VERSION = 1;
const UPLOADS = "uploads";

export type QueuedUpload = {
  id: string;
  /** Resolved at flush time: offline we cannot ask the server who we are. */
  orgId: string | null;
  /** Everything the batch needs to resume exactly as the operator set it up. */
  engine: "ai" | "ocr";
  mode: "separate" | "onebill";
  docType: "purchase" | "sales";
  name: string;
  mime: string;
  blob: Blob;
  queuedAt: number;
  attempts: number;
  lastError: string | null;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(UPLOADS)) {
        db.createObjectStore(UPLOADS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(UPLOADS, mode);
    const req = fn(t.objectStore(UPLOADS));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export async function queueUpload(
  u: Omit<QueuedUpload, "id" | "queuedAt" | "attempts" | "lastError">,
) {
  const row: QueuedUpload = {
    ...u,
    id: crypto.randomUUID(),
    queuedAt: Date.now(),
    attempts: 0,
    lastError: null,
  };
  await tx("readwrite", (s) => s.add(row));
  notify();
  return row.id;
}

export async function listQueued(): Promise<QueuedUpload[]> {
  const all = await tx<QueuedUpload[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedUpload[]>);
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function dequeue(id: string) {
  await tx("readwrite", (s) => s.delete(id));
  notify();
}

/** Records a failed try and returns how many there have now been. */
export async function markAttempt(id: string, error: string): Promise<number> {
  const row = await tx<QueuedUpload | undefined>(
    "readonly",
    (s) => s.get(id) as IDBRequest<QueuedUpload | undefined>,
  );
  if (!row) return 0;
  row.attempts += 1;
  row.lastError = error;
  await tx("readwrite", (s) => s.put(row));
  notify();
  return row.attempts;
}

/** A photo the server keeps rejecting is given up on, but not silently. */
export const MAX_ATTEMPTS = 5;

export async function queuedCount(): Promise<number> {
  try {
    return await tx<number>("readonly", (s) => s.count());
  } catch {
    return 0;
  }
}

/* --------------------------- connectivity --------------------------- */

/**
 * `navigator.onLine` only reports that a network interface exists. Hotel wifi
 * with no route out still reports true, so it is treated as a hint: false is
 * trustworthy, true is not, and anything that matters confirms with a request.
 */
export const isOnline = () =>
  // Only an explicit `false` means offline. `onLine` is undefined outside a
  // browser and in some webviews, and treating unknown as offline would pause
  // saving for somebody who is perfectly connected.
  typeof navigator === "undefined" ? true : navigator.onLine !== false;

/** Does a request actually reach our own origin right now? */
export async function reachable(timeoutMs = 4000): Promise<boolean> {
  if (!isOnline()) return false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // Same-origin and tiny. HEAD so nothing is downloaded, cache: no-store so
    // the service worker cannot answer it from a cache and report a false yes.
    await fetch("/favicon.ico", { method: "HEAD", cache: "no-store", signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

/** Thrown when a write is attempted with no connection. */
export class OfflineError extends Error {
  constructor(what = "This change") {
    super(`${what} needs a connection. It has not been saved. Try again when you are back online.`);
    this.name = "OfflineError";
  }
}

/** Guard a write so it fails with something an operator can act on. */
export async function requireNetwork(what?: string) {
  if (!(await reachable())) throw new OfflineError(what);
}

/**
 * What to actually show someone when a write fails.
 *
 * "Failed to fetch" is the browser talking to itself. It tells an operator
 * nothing, and worse, it looks like the data might have saved. This says
 * plainly that nothing was written and why.
 */
export function describeError(e: unknown): string {
  if (isNetworkError(e)) {
    return "No connection, so nothing was saved. Try again when you are back online.";
  }
  return e instanceof Error ? e.message : String(e);
}

/**
 * What actually went wrong, in words a distributor can act on.
 *
 * Three failures reach this boundary and they need three different answers,
 * where before they all got the raw exception text under "Something went
 * wrong":
 *
 *   stale chunk   The tab was opened before a deploy and is asking for a file
 *                 hash that no longer exists. The old button could not fix
 *                 this: router.invalidate() and reset() re-run the route, they
 *                 cannot re-fetch a module the server no longer has. Only a
 *                 real reload does, which is why this one reloads itself.
 *   offline       No signal. Nothing is broken and nothing is lost.
 *   everything    A genuine bug. The message is still shown, because it is
 *   else          what gets pasted into a WhatsApp message to us.
 */
export function classifyError(error: Error): "stale" | "offline" | "unknown" {
  const m = error.message ?? "";
  // Offline is checked first, and that order is the whole point. A screen not
  // opened before has never had its chunk cached, so with no signal it fails
  // with the same "dynamically imported module" text as a stale tab. Reading
  // the message first told somebody with their wifi off that the app had been
  // updated, and then tried to reload, which offline cannot work.
  // `=== false` and not `!onLine`: outside a browser, and in some embedded
  // webviews, `onLine` is undefined, and treating unknown as offline told a
  // perfectly connected user they had no internet.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  if (
    /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading (CSS )?chunk/i.test(
      m,
    )
  ) {
    return "stale";
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return "offline";
  return "unknown";
}

/* ------------------------------- flush ------------------------------- */

let flushing = false;

/**
 * Send what is waiting.
 *
 * Only "separate bills" resume by themselves. "One bill, several pages" needs
 * the operator to confirm which photos are which page before anything is
 * written, so those stay queued and the upload screen finishes them. Guessing
 * the grouping on their behalf is the thing we deliberately stopped doing.
 *
 * Safe to call from anywhere and often: it no-ops while already running, and
 * stops at the first network failure rather than burning through the queue
 * marking everything failed.
 */
export async function flushQueue(): Promise<{ sent: number; left: number }> {
  if (flushing) return { sent: 0, left: await queuedCount() };
  flushing = true;
  let sent = 0;
  try {
    if (!(await reachable())) return { sent: 0, left: await queuedCount() };
    const { supabase } = await import("@/integrations/supabase/client");
    const { enqueueInvoices } = await import("./invoices.functions");
    const { getCurrentOrg } = await import("./org.functions");
    // Queued offline, so the workspace was never resolved. It is resolved once
    // here, now that there is a network to ask.
    let orgId: string | null = null;

    for (const row of await listQueued()) {
      if (row.mode === "onebill") continue; // needs the review screen
      try {
        if (!orgId) orgId = (await getCurrentOrg()).orgId;
        const path = `${row.orgId ?? orgId}/${crypto.randomUUID()}-${row.name}`;
        const { error } = await supabase.storage
          .from("invoices")
          .upload(path, row.blob, { contentType: row.mime, upsert: false });
        if (error) throw new Error(error.message);
        await enqueueInvoices({
          data: { engine: row.engine, items: [{ storagePath: path, mimeType: row.mime }] },
        });
        await dequeue(row.id);
        sent++;
      } catch (e) {
        // A dropped connection means try again later. A rejection from the
        // server is an answer, and retrying it forever helps nobody.
        if (isNetworkError(e)) break;
        const attempts = await markAttempt(row.id, (e as Error).message);
        // Parenthesised deliberately: `attempts ?? 0 >= MAX` parses as
        // `attempts ?? (0 >= MAX)`, which drops the photo on the first server
        // error. It typechecked and was wrong.
        if (attempts >= MAX_ATTEMPTS) await dequeue(row.id);
      }
    }
    if (sent) {
      // Nudge the worker so the queued bills are read rather than waiting for
      // the next cron tick.
      fetch("/api/public/hooks/process-invoice-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: Math.min(10, sent) }),
      }).catch(() => {});
    }
    return { sent, left: await queuedCount() };
  } finally {
    flushing = false;
    notify();
  }
}

/* ----------------------------- listeners ----------------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  for (const l of listeners) l();
}

/** Fires on connectivity change and whenever the queue changes. */
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  if (typeof window !== "undefined") {
    window.addEventListener("online", l);
    window.addEventListener("offline", l);
  }
  return () => {
    listeners.delete(l);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", l);
      window.removeEventListener("offline", l);
    }
  };
}

/**
 * Whether an error is the network giving up rather than the server saying no.
 * A failed fetch is a TypeError with no status; a 400 from PostgREST is a real
 * answer and must not be retried forever.
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof OfflineError) return true;
  if (!isOnline()) return true;
  const m = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("network request failed")
  );
}
