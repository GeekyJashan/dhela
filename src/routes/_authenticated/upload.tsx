import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FileUp, Loader2, Sparkles, ScanText, X, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { getCurrentOrg } from "@/lib/org.functions";
import { enqueueInvoices } from "@/lib/invoices.functions";
import { createLogger } from "@/lib/logger";

const log = createLogger("upload");

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({ meta: [{ title: "Upload invoices — Ledgerly" }] }),
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
}

const MAX_FILES = 100;
const MAX_MB = 20;

function Upload() {
  const navigate = useNavigate();
  const getOrg = useServerFn(getCurrentOrg);
  const enqueue = useServerFn(enqueueInvoices);
  const [rows, setRows] = useState<Row[]>([]);
  const [engine, setEngine] = useState<Engine>("ai");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next: Row[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_MB * 1024 * 1024) {
        toast.error(`${f.name} exceeds ${MAX_MB}MB`);
        continue;
      }
      next.push({ key: `${f.name}-${f.size}-${crypto.randomUUID()}`, file: f, status: "pending" });
    }
    setRows((prev) => {
      const total = prev.length + next.length;
      if (total > MAX_FILES) {
        toast.error(`Max ${MAX_FILES} files per batch`);
        return [...prev, ...next].slice(0, MAX_FILES);
      }
      return [...prev, ...next];
    });
  };

  const removeRow = (key: string) =>
    setRows((prev) => prev.filter((r) => r.key !== key || r.status === "processing"));

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
    setBusy(true);
    try {
      const { orgId } = await getOrg();
      log.info("batch:start", { count: pending.length, engine });

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
        toast.error("All uploads failed");
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

      // Kick the worker immediately (fire-and-forget)
      fetch("/api/public/hooks/process-invoice-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: Math.min(10, uploaded.length) }),
      }).catch(() => { /* pg_cron will pick it up */ });

      toast.success(`${uploaded.length} invoice(s) queued`);
    } catch (e) {
      log.error("batch:failed", { err: e });
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Poll status for queued/processing rows
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

  const pendingCount = rows.filter((r) => r.status === "pending").length;
  const doneCount = rows.filter((r) => r.status === "review" || r.status === "approved").length;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="font-display text-4xl mb-2">Upload invoices</h1>
      <p className="text-muted-foreground mb-8">
        Drop one or many. We&apos;ll process up to {MAX_FILES} at a time in the background.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Extraction engine</CardTitle>
          <CardDescription>
            Choose per batch. AI is more accurate on messy scans; OCR is much cheaper and only pulls header fields.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={engine} onValueChange={(v) => setEngine(v as Engine)} className="grid md:grid-cols-2 gap-3">
            <label className={`border rounded-lg p-4 cursor-pointer flex gap-3 ${engine === "ai" ? "border-primary bg-primary/5" : ""}`}>
              <RadioGroupItem value="ai" id="ai" className="mt-1" />
              <div>
                <div className="flex items-center gap-2 font-medium"><Sparkles className="h-4 w-4 text-accent" /> AI (Gemini 2.5 Flash)</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Full extraction — supplier, header, line items, HSN, batch, expiry. Higher cost per invoice.
                </p>
              </div>
            </label>
            <label className={`border rounded-lg p-4 cursor-pointer flex gap-3 ${engine === "ocr" ? "border-primary bg-primary/5" : ""}`}>
              <RadioGroupItem value="ocr" id="ocr" className="mt-1" />
              <div>
                <div className="flex items-center gap-2 font-medium"><ScanText className="h-4 w-4" /> OCR (cheap)</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Header only — supplier, GSTIN, invoice #, date, totals. Enter line items manually. Near-zero cost.
                </p>
              </div>
            </label>
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>PDF, JPG, PNG. Up to {MAX_MB}MB each, {MAX_FILES} per batch.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="block border-2 border-dashed rounded-xl p-10 text-center cursor-pointer hover:bg-muted/40 transition"
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            <FileUp className="h-9 w-9 mx-auto text-muted-foreground" />
            <p className="mt-3 font-medium">Drop files here or click to select</p>
            <p className="text-xs text-muted-foreground mt-1">Multiple files supported</p>
            <Input type="file" accept="application/pdf,image/*" multiple className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>

          {rows.length > 0 && (
            <div className="border rounded-lg divide-y">
              {rows.map((r) => (
                <div key={r.key} className="px-4 py-3 flex items-center gap-3 text-sm">
                  <StatusIcon status={r.status} />
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
                      Review
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
              {rows.length > 0 && `${doneCount} / ${rows.length} done · ${pendingCount} to start`}
            </div>
            <div className="flex gap-2">
              {doneCount > 0 && (
                <Button variant="outline" onClick={() => navigate({ to: "/invoices" })}>
                  Go to invoices
                </Button>
              )}
              <Button size="lg" onClick={startBatch} disabled={!pendingCount || busy}>
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {busy ? "Uploading…" : `Upload & extract${pendingCount ? ` (${pendingCount})` : ""}`}
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
  switch (row.status) {
    case "pending": return <span>Ready</span>;
    case "uploading": return <span>Uploading…</span>;
    case "queued": return <span>Queued</span>;
    case "processing": return <span>Extracting…</span>;
    case "review":
    case "approved":
      return (
        <span>
          {row.supplier ?? "Extracted"}
          {row.total ? ` · ₹ ${Number(row.total).toLocaleString("en-IN")}` : ""}
        </span>
      );
    case "failed": return <span className="text-destructive">{row.error ?? "Failed"}</span>;
  }
}
