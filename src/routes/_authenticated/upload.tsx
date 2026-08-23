import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Sparkles, ScanText, X, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { CaptureInput, previewUrl } from "@/components/capture-input";
import { getCurrentOrg } from "@/lib/org.functions";
import { enqueueInvoices, extractInvoice, cancelQueuedInvoices } from "@/lib/invoices.functions";
import { proposeInvoiceGroups, saveInvoiceGroups, MAX_PAGES_PER_BATCH, type ProposedDocument } from "@/lib/invoice-batch.functions";
import { InvoiceGroupReview, type PhotoThumb } from "@/components/invoice-group-review";
import { ExtractionProgress, type ProgressPhase } from "@/components/extraction-progress";
import { getBillingInfo, type BillingInfo } from "@/lib/billing.functions";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { createLogger } from "@/lib/logger";
import { useTranslation } from "react-i18next";

const log = createLogger("upload");

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({ meta: [{ title: "Upload invoices — Dhela" }] }),
  component: Upload,
});

type Engine = "ai" | "ocr";

type RowStatus =
  | "pending"
  | "uploading"
  | "queued"
  | "processing"
  | "review"
  | "approved"
  | "failed";

interface Row {
  key: string;
  file: File;
  status: RowStatus;
  invoiceId?: string;
  error?: string;
  supplier?: string | null;
  total?: number | null;
  /** Object URL for image files, so a blurry photo is caught before upload. */
  preview?: string;
}

const MAX_FILES = 100;
const MAX_MB = 20;

function Upload() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const getOrg = useServerFn(getCurrentOrg);
  const enqueue = useServerFn(enqueueInvoices);
  const runExtract = useServerFn(extractInvoice);
  const propose = useServerFn(proposeInvoiceGroups);
  const cancelQueued = useServerFn(cancelQueuedInvoices);
  const saveGroups = useServerFn(saveInvoiceGroups);
  const [rows, setRows] = useState<Row[]>([]);
  const [engine, setEngine] = useState<Engine>("ai");
  const fetchBilling = useServerFn(getBillingInfo);
  const { data: billing } = useQuery({
    queryKey: ["billing_info"],
    queryFn: async () => (await fetchBilling()) as BillingInfo,
  });
  const aiRemaining = billing ? Math.max(0, billing.aiLimitPerMonth - billing.aiUsedThisMonth) : null;
  const [busy, setBusy] = useState(false);
  const photoCount = rows.filter(r => r.file.type.startsWith("image/")).length;
  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const overQuota = aiRemaining != null && pendingCount > aiRemaining;
  const pollRef = useRef<number | null>(null);

  /**
   * A read waiting to be confirmed. Held on the client on purpose: nothing is
   * written until the operator has looked at the grouping, because a wrong
   * merge is invisible once it is in the ledger.
   */
  const [proposal, setProposal] = useState<{
    documents: ProposedDocument[];
    unassigned: number[];
    items: { storagePath: string; mimeType?: string | null }[];
    photos: PhotoThumb[];
  } | null>(null);
  /**
   * What the app is doing right now, so the wait can say so. A lone spinner
   * for ninety seconds reads as a hang, and a reload mid-read is how the same
   * bill ends up uploaded twice.
   */
  const [work, setWork] = useState<{ phase: ProgressPhase; photos: number } | null>(null);
  const [stopping, setStopping] = useState(false);
  /**
   * Aborts the in-flight read. It stops the waiting, not the server: a read
   * already running finishes and is discarded. That is honest for this path
   * because nothing is written until the grouping is confirmed, so an
   * abandoned read costs a request and leaves no trace.
   */
  const abortRef = useRef<AbortController | null>(null);
  /**
   * "separate" — every photo is its own bill. The fast path: each is read on
   * its own, in parallel, which is what most uploads are.
   * "onebill" — the operator says these photos are pages of ONE bill. Nothing
   * has to be guessed, so the reader is told rather than asked.
   */
  const [mode, setMode] = useState<"separate" | "onebill">("separate");

  const addFiles = (files: File[] | FileList | null) => {
    if (!files) return;
    const next: Row[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_MB * 1024 * 1024) {
        toast.error(t("{{name}} exceeds {{mb}}MB", { name: f.name, mb: MAX_MB }));
        continue;
      }
      next.push({
        key: `${f.name}-${f.size}-${crypto.randomUUID()}`,
        file: f,
        status: "pending",
        preview: previewUrl(f),
      });
    }
    setRows((prev) => {
      const total = prev.length + next.length;
      if (total > MAX_FILES) {
        toast.error(t("Max {{n}} files per batch", { n: MAX_FILES }));
        // Revoke the previews of anything we're dropping on the floor.
        [...prev, ...next].slice(MAX_FILES).forEach(r => r.preview && URL.revokeObjectURL(r.preview));
        return [...prev, ...next].slice(0, MAX_FILES);
      }
      return [...prev, ...next];
    });
  };

  const removeRow = (key: string) =>
    setRows((prev) => prev.filter((r) => {
      const keep = r.key !== key || r.status === "processing";
      if (!keep && r.preview) URL.revokeObjectURL(r.preview);
      return keep;
    }));

  // Release every object URL when leaving the page.
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;
  useEffect(() => () => {
    rowsRef.current.forEach(r => r.preview && URL.revokeObjectURL(r.preview));
  }, []);

  const patch = useCallback((key: string, p: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }, []);

  /** Upload one file to storage, return its path. Runs with concurrency=3. */
  const uploadOne = async (orgId: string, row: Row): Promise<{ key: string; path: string; mime: string } | null> => {
    patch(row.key, { status: "uploading" });
    const path = `${orgId}/${crypto.randomUUID()}-${row.file.name}`;
    const { error } = await supabase.storage.from("invoices")
      .upload(path, row.file, { contentType: row.file.type, upsert: false });
    if (error) {
      log.error("upload:storage_failed", { name: row.file.name, err: error });
      patch(row.key, { status: "failed", error: error.message });
      return null;
    }
    return { key: row.key, path, mime: row.file.type || "application/octet-stream" };
  };

  const startBatch = async () => {
    const pending = rows.filter((r) => r.status === "pending");
    if (!pending.length) return;
    if (mode === "onebill" && pending.length > MAX_PAGES_PER_BATCH) {
      toast.error(t("One bill can be up to {{n}} pages here. Split it, or upload as separate bills.",
        { n: MAX_PAGES_PER_BATCH }));
      return;
    }
    setBusy(true);
    try {
      const { orgId } = await getOrg();
      log.info("batch:start", { count: pending.length, engine, mode });
      abortRef.current = new AbortController();
      setWork({ phase: "uploading", photos: pending.length });

      // Concurrency=3 uploads
      const uploaded: Array<{ key: string; path: string; mime: string }> = [];
      const queue = [...pending];
      const workers = Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const r = queue.shift();
          if (!r) return;
          const res = await uploadOne(orgId, r);
          if (res) uploaded.push(res);
        }
      });
      await Promise.all(workers);

      if (!uploaded.length) {
        toast.error(t("All uploads failed"));
        return;
      }

      // Only when the operator has said these are one bill. Grouping several
      // photos is slow, and making every ordinary batch pay for it was the
      // wrong trade: five separate bills read on their own, in parallel, beat
      // one call that has to reason about all five.
      if (engine === "ai" && mode === "onebill" && uploaded.length > 1) {
        const items = uploaded.map(u => ({ storagePath: u.path, mimeType: u.mime }));
        uploaded.forEach(u => patch(u.key, { status: "processing" }));
        setWork({ phase: "reading", photos: uploaded.length });
        try {
          // The grouping is stated, not inferred: one bill, these pages, in
          // this order. That is the whole point of the operator saying so.
          const res = await propose({
            data: { items, docType: "purchase", groups: [items.map((_, i) => i)] },
            signal: abortRef.current?.signal,
          });
          setProposal({
            documents: res.documents as ProposedDocument[],
            unassigned: res.unassignedPageIndexes,
            items,
            photos: uploaded.map((u, i) => ({
              index: i,
              name: rows.find(r => r.key === u.key)?.file.name ?? `Photo ${i + 1}`,
              preview: rows.find(r => r.key === u.key)?.preview,
            })),
          });
        } catch (e) {
          uploaded.forEach(u => patch(u.key, { status: "failed", error: (e as Error).message }));
          toast.error((e as Error).message);
        }
        return;
      }

      // Enqueue in one call
      const { ids } = await enqueue({
        data: {
          engine,
          items: uploaded.map((u) => ({ storagePath: u.path, mimeType: u.mime })),
        },
      });
      uploaded.forEach((u, i) => patch(u.key, { status: "queued", invoiceId: ids[i] }));

      // Fast path for a single file: extract inline and go straight to review,
      // skipping the background queue + 3s polling latency. Batches (>1) still
      // use the queue so many files process in parallel.
      if (uploaded.length === 1) {
        patch(uploaded[0].key, { status: "processing" });
        setWork({ phase: "reading", photos: 1 });
        try {
          await runExtract({ data: { invoiceId: ids[0], engine }, signal: abortRef.current?.signal });
          navigate({ to: "/invoices/$id", params: { id: ids[0] } });
        } catch (e) {
          patch(uploaded[0].key, { status: "failed", error: (e as Error).message });
          toast.error((e as Error).message);
        }
        return;
      }

      // Kick the worker immediately (fire-and-forget)
      fetch("/api/public/hooks/process-invoice-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: Math.min(10, uploaded.length) }),
      }).catch(() => { /* pg_cron will pick it up */ });

      setWork({ phase: "batch", photos: uploaded.length });
    } catch (e) {
      log.error("batch:failed", { err: e });
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      // Cleared here and nowhere else. finally runs on every early return too,
      // which is what the inner blocks were getting wrong: a failed upload
      // returned with the wait still on screen. The one exception is a queued
      // batch, whose work outlives this function and is ended by the poller.
      setWork(w => (w?.phase === "batch" ? w : null));
    }
  };

  /**
   * Stop. What that means depends on what is running.
   *
   * A queued batch can genuinely be stopped, by deleting the rows that have
   * not been picked up yet. Anything already being read is mid-flight in the
   * worker and deleting it would fail the run rather than end it, so those are
   * left to finish and the count is reported rather than glossed over.
   *
   * A synchronous read cannot be stopped on the server at all. Aborting ends
   * the waiting and discards the answer, which is a clean stop here only
   * because nothing is written until the grouping is confirmed.
   */
  const stopWork = async () => {
    const phase = work?.phase;
    setStopping(true);
    try {
      if (phase === "batch") {
        const ids = rows.filter(r => r.invoiceId && (r.status === "queued" || r.status === "processing"))
          .map(r => r.invoiceId!);
        if (ids.length) {
          const { cancelled, stillRunning } = await cancelQueued({ data: { ids } });
          setRows(prev => prev.filter(r => !(r.invoiceId && ids.includes(r.invoiceId) && r.status === "queued")));
          toast.success(
            stillRunning > 0
              ? t("Stopped. {{n}} already being read will still finish.", { n: stillRunning })
              : t("Stopped. {{n}} bill(s) cancelled.", { n: cancelled }),
          );
        }
      } else {
        abortRef.current?.abort();
        // The photos are already in storage, so they go back to pending rather
        // than being lost — pressing upload again reuses nothing but retries.
        setRows(prev => prev.map(r => (r.status === "processing" || r.status === "uploading"
          ? { ...r, status: "pending" } : r)));
        toast.message(t("Stopped."), {
          description: t("The read was abandoned. Nothing was saved."),
        });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStopping(false);
      setWork(null);
    }
  };

  const confirmProposal = async () => {
    if (!proposal) return;
    setBusy(true);
    setWork({ phase: "saving", photos: proposal.items.length });
    try {
      const { invoices } = await saveGroups({
        data: { items: proposal.items, documents: proposal.documents },
      });
      setProposal(null);
      setRows(prev => {
        prev.forEach(r => r.preview && URL.revokeObjectURL(r.preview));
        return [];
      });
      if (invoices.length === 1) {
        navigate({ to: "/invoices/$id", params: { id: invoices[0].id } });
      } else {
        toast.success(t("{{n}} bill(s) imported", { n: invoices.length }));
        navigate({ to: "/invoices" });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setWork(null);
    }
  };

  /**
   * The operator has corrected the grouping. That is now a fact, so the bills
   * are read again from scratch under it rather than reshuffled on screen —
   * nothing records which photo a row was read from, so moving photos between
   * bills cannot move their line items with them.
   */
  const regroupProposal = async (groups: number[][]) => {
    if (!proposal) return;
    setBusy(true);
    setWork({ phase: "reading", photos: proposal.items.length });
    try {
      const res = await propose({
        data: { items: proposal.items, docType: "purchase", groups },
      });
      setProposal({
        ...proposal,
        documents: res.documents as ProposedDocument[],
        unassigned: res.unassignedPageIndexes,
      });
      toast.success(t("Read again as {{n}} bill(s)", { n: res.documents.length }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setWork(null);
    }
  };

  const discardProposal = () => {
    setProposal(null);
    setRows(prev => prev.map(r => (r.status === "processing" ? { ...r, status: "pending" } : r)));
  };

  // Poll status for queued/processing rows
  // A queued batch ends when nothing is outstanding, which only the poller
  // knows. startBatch has long since returned by then.
  useEffect(() => {
    if (work?.phase !== "batch") return;
    const outstanding = rows.filter(r => r.invoiceId && (r.status === "queued" || r.status === "processing")).length;
    if (outstanding === 0) {
      setWork(null);
      const read = rows.filter(r => r.status === "review" || r.status === "approved").length;
      if (read) toast.success(t("{{n}} bill(s) read and waiting for review", { n: read }));
    }
  }, [rows, work?.phase, t]);

  useEffect(() => {
    const active = rows.filter((r) => r.invoiceId && (r.status === "queued" || r.status === "processing"));
    if (!active.length) {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = window.setInterval(async () => {
      const ids = rows.filter((r) => r.invoiceId && (r.status === "queued" || r.status === "processing"))
        .map((r) => r.invoiceId!) as string[];
      if (!ids.length) return;
      const { data } = await supabase.from("invoices")
        .select("id, status, supplier_name, grand_total, error_message")
        .in("id", ids);
      if (!data) return;
      setRows((prev) => prev.map((r) => {
        if (!r.invoiceId) return r;
        const found = data.find((d) => d.id === r.invoiceId);
        if (!found) return r;
        return {
          ...r,
          status: found.status as RowStatus,
          supplier: found.supplier_name,
          total: found.grand_total,
          error: found.error_message ?? undefined,
        };
      }));
      // Nudge the worker if some are still queued (in case pg_cron isn't set up yet)
      const stillQueued = data.some((d) => d.status === "queued");
      if (stillQueued) {
        fetch("/api/public/hooks/process-invoice-queue", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 5 }),
        }).catch(() => {});
      }
    }, 3000);
    return () => {
      if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [rows]);

  const doneCount = rows.filter((r) => r.status === "review" || r.status === "approved").length;

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <h1 className="font-display text-4xl mb-2">{t("Upload invoices")}</h1>
      <p className="text-muted-foreground mb-8">
        {t("Drop one or many — up to {{n}}. If a bill runs to several pages, say so below and photograph every page.", { n: MAX_FILES })}
      </p>

      {/* Shown instead of the picker while a read is waiting to be confirmed:
          the grouping is the decision on this screen, and nothing else on the
          page matters until it is made. */}
      {/* The wait, named. Hidden once the proposal is up, because by then the
          decision on screen is the grouping and nothing else — except while
          saving, which happens with the proposal still rendered. */}
      {work && (!proposal || work.phase === "saving") && (
        <div className="mb-6">
          <ExtractionProgress
            phase={work.phase}
            photos={work.photos}
            onStop={work.phase === "saving" ? undefined : stopWork}
            stopping={stopping}
            progress={work.phase === "batch"
              ? {
                  done: rows.filter(r => r.invoiceId
                    && r.status !== "queued" && r.status !== "processing").length,
                  total: rows.filter(r => r.invoiceId).length,
                }
              : undefined}
          />
        </div>
      )}

      {proposal && (
        <div className="mb-6">
          <InvoiceGroupReview
            documents={proposal.documents}
            photos={proposal.photos}
            unassigned={proposal.unassigned}
            busy={busy}
            onConfirm={confirmProposal}
            onRegroup={regroupProposal}
            onCancel={discardProposal}
          />
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("What are you uploading?")}</CardTitle>
          <CardDescription>
            {t("Saying which it is up front is faster than having it worked out for you.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={mode} onValueChange={v => setMode(v as "separate" | "onebill")}
            className="grid gap-3 sm:grid-cols-2">
            <label htmlFor="m-sep"
              className={`rounded-lg border p-4 cursor-pointer ${mode === "separate" ? "border-primary bg-primary/5" : ""}`}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="separate" id="m-sep" />
                <span className="font-medium">{t("Separate bills")}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1 ml-6">
                {t("One photo, one bill. Each is read on its own — the quickest way in.")}
              </p>
            </label>
            <label htmlFor="m-one"
              className={`rounded-lg border p-4 cursor-pointer ${mode === "onebill" ? "border-primary bg-primary/5" : ""}`}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="onebill" id="m-one" />
                <span className="font-medium">{t("One bill, several pages")}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1 ml-6">
                {t("A long bill photographed page by page. Read together as a single bill, up to {{n}} pages.", { n: MAX_PAGES_PER_BATCH })}
              </p>
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t("Extraction engine")}</CardTitle>
          <CardDescription>
            {t("Choose per batch. AI is more accurate on messy scans; OCR is free but heuristic.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={engine} onValueChange={(v) => setEngine(v as Engine)} className="grid md:grid-cols-2 gap-3">
            <label className={`border rounded-lg p-4 cursor-pointer flex gap-3 ${engine === "ai" ? "border-primary bg-primary/5" : ""}`}>
              <RadioGroupItem value="ai" id="ai" className="mt-1" />
              <div>
                <div className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-accent" /> AI</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("Full extraction — supplier, header, line items, HSN, batch, expiry. Higher cost per invoice.")}
                </p>
                {aiRemaining != null && (
                  <p className={`text-xs mt-1.5 font-medium ${aiRemaining === 0 ? "text-destructive" : "text-primary"}`}>
                    {t("{{n}} AI extractions left this month", { n: aiRemaining })}
                    {aiRemaining === 0 && (
                      <RouterLink to="/billing" className="ml-1 underline">{t("Upgrade")}</RouterLink>
                    )}
                  </p>
                )}
              </div>
            </label>
            <label className={`border rounded-lg p-4 cursor-pointer flex gap-3 ${engine === "ocr" ? "border-primary bg-primary/5" : ""}`}>
              <RadioGroupItem value="ocr" id="ocr" className="mt-1" />
              <div>
                <div className="flex items-center gap-2 font-medium"><ScanText className="h-4 w-4" /> {t("OCR (free)")}</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {t("Header + line items parsed heuristically. Works best on clean, digital invoices — always review before approving. Zero cost.")}
                </p>
              </div>
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Files")}</CardTitle>
          <CardDescription>{t("PDF, JPG, PNG. Up to {{mb}}MB each, {{n}} per batch.", { mb: MAX_MB, n: MAX_FILES })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <CaptureInput onFiles={addFiles} photoCount={photoCount} disabled={busy} />

          {/* The engine picker is two cards up — off-screen on a phone by the
              time you're shooting bills — so the quota has to be repeated here,
              where the decision actually gets made. */}
          {engine === "ai" && aiRemaining != null && overQuota && (
            <div className="rounded-lg border border-amber-400/60 bg-warning/10 p-3 space-y-2">
              <p className="text-sm">
                {aiRemaining === 0
                  ? t("You've used all your AI reads this month.")
                  : t("{{pending}} files ready but only {{left}} AI read(s) left this month.", {
                      pending: pendingCount, left: aiRemaining,
                    })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEngine("ocr")}>
                  <ScanText className="h-3.5 w-3.5 mr-1.5" /> {t("Use free OCR instead")}
                </Button>
                <RouterLink to="/billing">
                  <Button size="sm" variant="outline">{t("Upgrade")}</Button>
                </RouterLink>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("OCR is unlimited and free, but reads clean printed bills far better than photos.")}
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <div className="border rounded-lg divide-y">
              {rows.map((r) => (
                <div key={r.key} className="px-4 py-3 flex items-center gap-3 text-sm">
                  <StatusIcon status={r.status} />
                  {r.preview && (
                    <img src={r.preview} alt=""
                      className="h-10 w-10 shrink-0 rounded border object-cover" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{r.file.name}</div>
                    <div className="text-xs text-muted-foreground flex gap-2">
                      <span>{(r.file.size / 1024).toFixed(0)} KB</span>
                      <span>·</span>
                      <StatusText row={r} />
                    </div>
                  </div>
                  {r.invoiceId && (r.status === "review" || r.status === "approved") && (
                    <Link to="/invoices/$id" params={{ id: r.invoiceId }} className="text-xs text-primary hover:underline">
                      {t("Review")}
                    </Link>
                  )}
                  {r.status !== "processing" && r.status !== "uploading" && (
                    <Button variant="ghost" size="icon" onClick={() => removeRow(r.key)}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {rows.length > 0 && t("{{done}} / {{total}} done · {{pending}} to start", { done: doneCount, total: rows.length, pending: pendingCount })}
            </div>
            <div className="flex gap-2">
              {doneCount > 0 && (
                <Button variant="outline" onClick={() => navigate({ to: "/invoices" })}>
                  {t("Go to invoices")}
                </Button>
              )}
              {/* Button spins by itself when onClick returns a promise — an
                  extra Loader2 here renders a second one beside it. */}
              <Button size="lg" onClick={startBatch} disabled={!pendingCount}>
                {busy ? t("Uploading…") : `${t("Upload & extract")}${pendingCount ? ` (${pendingCount})` : ""}`}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusIcon({ status }: { status: RowStatus }) {
  switch (status) {
    case "pending": return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
    case "uploading":
    case "queued":
    case "processing": return <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />;
    case "review":
    case "approved": return <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />;
    case "failed": return <AlertCircle className="h-4 w-4 text-destructive shrink-0" />;
  }
}

function StatusText({ row }: { row: Row }) {
  const { t } = useTranslation();
  switch (row.status) {
    case "pending": return <span>{t("Ready")}</span>;
    case "uploading": return <span>{t("Uploading…")}</span>;
    case "queued": return <span>{t("Queued")}</span>;
    case "processing": return <span>{t("Extracting…")}</span>;
    case "review":
    case "approved":
      return (
        <span>
          {row.supplier ?? t("Extracted")}
          {row.total ? ` · ₹ ${Number(row.total).toLocaleString("en-IN")}` : ""}
        </span>
      );
    case "failed": return <span className="text-destructive">{row.error ?? t("Failed")}</span>;
  }
}
