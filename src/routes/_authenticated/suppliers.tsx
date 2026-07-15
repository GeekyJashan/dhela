import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Plus, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — Ledgerly" }] }),
  component: Suppliers,
});

function Suppliers() {
  const qc = useQueryClient();
  const getOrg = useServerFn(getCurrentOrg);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", gstin: "", contact: "", address: "" });

  const { data } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Live payables from the ledger view (purchases − payments + opening).
  const { data: balanceRows } = useQuery({
    queryKey: ["party_balances", "supplier"],
    queryFn: async () => {
      const { data } = await supabase.from("party_balances")
        .select("party_id, balance").eq("party_type", "supplier");
      return data ?? [];
    },
  });
  const balances = new Map(balanceRows?.map(b => [b.party_id, Number(b.balance ?? 0)]));

  const submit = async () => {
    try {
      const { orgId } = await getOrg();
      const { error } = await supabase.from("suppliers").insert({ org_id: orgId, ...form });
      if (error) throw error;
      toast.success("Supplier added");
      setOpen(false);
      setForm({ name: "", gstin: "", contact: "", address: "" });
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl">Suppliers</h1>
          <p className="text-muted-foreground mt-1">Manufacturers and distributors you buy from.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> New supplier</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add supplier</DialogTitle></DialogHeader>
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (form.name) submit(); }}>
              <Input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <Input placeholder="GSTIN" value={form.gstin} onChange={e => setForm({ ...form, gstin: e.target.value })} />
              <Input placeholder="Contact" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} />
              <Input placeholder="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
              <DialogFooter><Button type="submit" disabled={!form.name}>Save</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardHeader><CardTitle>Suppliers ({data?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>GSTIN</TableHead><TableHead>Contact</TableHead><TableHead>Address</TableHead>
              <TableHead className="text-right">Payable</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data?.map(s => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.gstin}</TableCell>
                  <TableCell>{s.contact}</TableCell>
                  <TableCell className="text-muted-foreground">{s.address}</TableCell>
                  <TableCell className="text-right tabular-nums">₹ {(balances.get(s.id) ?? 0).toLocaleString("en-IN")}</TableCell>
                  <TableCell className="text-right">
                    <Link to="/statement" search={{ party: "supplier", id: s.id }}>
                      <Button size="sm" variant="ghost" title="Account statement"><FileText className="h-3.5 w-3.5" /></Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {!data?.length && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No suppliers yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
