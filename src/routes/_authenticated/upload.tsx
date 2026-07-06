import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { getCurrentOrg } from "@/lib/org.functions";
import { extractInvoice } from "@/lib/invoices.functions";

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({ meta: [{ title: "Upload invoice — Ledgerly" }] }),
  component: Upload,
});

function Upload() {
  const navigate = useNavigate();
  const getOrg = useServerFn(getCurrentOrg);
  const extract = useServerFn(extractInvoice);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string>("");

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      setStep("Reading your workspace…");
      const { orgId } = await getOrg();

      setStep("Uploading invoice…");
      const path = `${orgId}/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage.from("invoices").upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (upErr) throw upErr;

      const { data: { user } } = await supabase.auth.getUser();
      const { data: inv, error: insErr } = await supabase.from("invoices").insert({
        org_id: orgId,
        storage_path: path,
        mime_type: file.type,
        status: "uploaded",
        uploaded_by: user!.id,
      }).select("id").single();
      if (insErr) throw insErr;

      setStep("AI is reading the invoice…");
      await extract({ data: { invoiceId: inv.id } });

      toast.success("Invoice processed. Review it now.");
      navigate({ to: "/invoices/$id", params: { id: inv.id } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false); setStep("");
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="font-display text-4xl mb-2">Upload invoice</h1>
      <p className="text-muted-foreground mb-8">PDF, image, or scan. From any supplier, in any format.</p>

      <Card>
        <CardHeader>
          <CardTitle>Choose file</CardTitle>
          <CardDescription>We support PDF, JPEG, PNG, and multi-page scans up to 20MB.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <label className="block border-2 border-dashed rounded-xl p-12 text-center cursor-pointer hover:bg-muted/40 transition">
            <FileUp className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="mt-3 font-medium">{file ? file.name : "Click to select a file"}</p>
            <p className="text-xs text-muted-foreground mt-1">{file ? `${(file.size / 1024).toFixed(0)} KB` : "PDF, JPG, PNG"}</p>
            <Input type="file" accept="application/pdf,image/*" className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>

          {busy && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {step}
            </div>
          )}

          <Button size="lg" className="w-full" onClick={upload} disabled={!file || busy}>
            {busy ? "Processing…" : "Upload & extract"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
