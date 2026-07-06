import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentOrg } from "@/lib/org.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Products — Ledgerly" }] }),
  component: Products,
});

function Products() {
  const qc = useQueryClient();
  const getOrg = useServerFn(getCurrentOrg);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", sku: "", hsn: "", gst_rate: "", mrp: "", unit: "" });

  const { data } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const submit = async () => {
    try {
      const { orgId } = await getOrg();
      const { error } = await supabase.from("products").insert({
        org_id: orgId,
        name: form.name,
        sku: form.sku || null,
        hsn: form.hsn || null,
        gst_rate: form.gst_rate ? Number(form.gst_rate) : null,
        mrp: form.mrp ? Number(form.mrp) : null,
        unit: form.unit || null,
      });
      if (error) throw error;
      toast.success("Product added");
      setOpen(false);
      setForm({ name: "", sku: "", hsn: "", gst_rate: "", mrp: "", unit: "" });
      qc.invalidateQueries({ queryKey: ["products"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Products</h1>
          <p className="text-muted-foreground mt-1">Your ERP catalog used for AI matching.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> New product</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add product</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <Input placeholder="SKU" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} />
              <Input placeholder="HSN" value={form.hsn} onChange={e => setForm({ ...form, hsn: e.target.value })} />
              <Input placeholder="GST %" value={form.gst_rate} onChange={e => setForm({ ...form, gst_rate: e.target.value })} />
              <Input placeholder="MRP" value={form.mrp} onChange={e => setForm({ ...form, mrp: e.target.value })} />
              <Input placeholder="Unit (PCS/KG)" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
            </div>
            <DialogFooter><Button onClick={submit} disabled={!form.name}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader><CardTitle>Catalog ({data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>SKU</TableHead><TableHead>HSN</TableHead>
              <TableHead>GST%</TableHead><TableHead>MRP</TableHead><TableHead>Unit</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data?.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.sku}</TableCell>
                  <TableCell>{p.hsn}</TableCell>
                  <TableCell>{p.gst_rate}</TableCell>
                  <TableCell>{p.mrp}</TableCell>
                  <TableCell>{p.unit}</TableCell>
                </TableRow>
              ))}
              {!data?.length && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No products yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
