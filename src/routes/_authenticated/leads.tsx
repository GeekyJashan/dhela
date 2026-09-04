import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { describeError } from "@/lib/offline";
import { toast } from "sonner";
import { Plus, Phone, MessageCircle, Loader2, Trash2, Search, Radar } from "lucide-react";
import { addLeads, listLeads, updateLead, deleteLead, discoverLeads } from "@/lib/leads.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { whatsappLink, telLink, normalisePhone } from "@/lib/support";

export const Route = createFileRoute("/_authenticated/leads")({
  // Hidden from the sidebar is presentation. This is what stops a customer who
  // types the URL from landing on the founder's prospect list.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    const meta = data.user?.app_metadata as { platform_admin?: boolean } | undefined;
    if (meta?.platform_admin !== true) throw redirect({ to: "/dashboard" });
  },
  head: () => ({ meta: [{ title: "Leads — Dhela" }] }),
  component: Leads,
});

const STAGES = ["new", "contacted", "interested", "won", "lost"] as const;

/** Fit, not certainty. Green means call first, not "will buy". */
function ScorePill({ value }: { value: number }) {
  const tone = value >= 70 ? "bg-success/15 text-success"
    : value >= 45 ? "bg-warning/15 text-warning"
    : "bg-muted text-muted-foreground";
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${tone}`}>{value}</span>;
}

function Leads() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const load = useServerFn(listLeads);
  const add = useServerFn(addLeads);
  const patch = useServerFn(updateLead);
  const remove = useServerFn(deleteLead);
  const discover = useServerFn(discoverLeads);

  const [paste, setPaste] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [trade, setTrade] = useState("");
  const [city, setCity] = useState("");
  const [finding, setFinding] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [stage, setStage] = useState<string>("open");

  const { data } = useQuery({ queryKey: ["leads"], queryFn: () => load({ data: undefined }) });
  const leads = useMemo(() => {
    const all = data?.leads ?? [];
    const q = filter.trim().toLowerCase();
    return all.filter(l => {
      if (stage === "open" && (l.status === "won" || l.status === "lost")) return false;
      if (stage !== "open" && stage !== "all" && l.status !== stage) return false;
      if (!q) return true;
      return [l.name, l.city, l.gstin, l.contact_person, l.phone]
        .some(v => (v ?? "").toString().toLowerCase().includes(q));
    });
  }, [data, filter, stage]);

  const save = async (id: string, patchData: Record<string, unknown>) => {
    await patch({ data: { id, ...patchData } as never });
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const submit = async () => {
    if (!paste.trim()) return;
    setBusy(true);
    try {
      const res = await add({ data: { text: paste, source: source || undefined } });
      toast.success(t("{{a}} added, {{u}} updated", { a: res.added, u: res.updated }));
      if (res.failed || res.skipped) {
        // Named, not swallowed: a silently dropped row is a prospect nobody
        // ever calls and nobody ever knows was dropped.
        toast.warning(
          t("{{f}} lookup(s) failed, {{s}} line(s) had no GSTIN", { f: res.failed, s: res.skipped }) +
          (res.problems.length ? ` — ${res.problems[0]}` : ""),
        );
      }
      setPaste(""); setOpen(false);
      qc.invalidateQueries({ queryKey: ["leads"] });
    } catch (e) {
      toast.error(describeError(e));
    } finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const all = data?.leads ?? [];
    return {
      open: all.filter(l => l.status !== "won" && l.status !== "lost").length,
      won: all.filter(l => l.status === "won").length,
      worth: all.filter(l => l.status !== "won" && l.status !== "lost" && l.score >= 70).length,
    };
  }, [data]);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl">{t("Leads")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("{{open}} open · {{worth}} worth calling first · {{won}} won", counts)}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <Dialog open={findOpen} onOpenChange={setFindOpen}>
          <DialogTrigger asChild>
            <Button size="lg" variant="outline"><Radar className="h-4 w-4 mr-2" /> {t("Find prospects")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("Find prospects")}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("Searches business listings for wholesalers and distributors in a trade and city, and adds the ones worth a look with their phone numbers.")}
            </p>
            <Input placeholder={t("Trade — e.g. sanitary ware, pharma, FMCG")} value={trade}
              onChange={e => setTrade(e.target.value)} />
            <Input placeholder={t("City — e.g. Ludhiana")} value={city}
              onChange={e => setCity(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {t("These are scored on the listing alone, so they cap lower than a lead with a GSTIN. Add the GSTIN later and it is rescored against the tax registry.")}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFindOpen(false)}>{t("Cancel")}</Button>
              <Button disabled={finding || trade.length < 2 || city.length < 2} onClick={async () => {
                setFinding(true);
                try {
                  const r = await discover({ data: { trade, city, limit: 20 } });
                  toast.success(t("Found {{f}}, added {{a}}, {{d}} already known", { f: r.found, a: r.added, d: r.already }));
                  setFindOpen(false);
                  qc.invalidateQueries({ queryKey: ["leads"] });
                } catch (e) { toast.error(describeError(e)); }
                finally { setFinding(false); }
              }}>
                {finding ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("Searching…")}</> : t("Search")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="lg"><Plus className="h-4 w-4 mr-2" /> {t("Add prospects")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{t("Add prospects")}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("One per line. A GSTIN on its own is enough — the name, city, trade and fit score are looked up. Add a phone or a person on the same line and they are kept: the GST registry never returns a contact number.")}
            </p>
            <Textarea rows={8} value={paste} onChange={e => setPaste(e.target.value)}
              placeholder={"03AABCS1429B1ZX, 9876543210, Rakesh\n09AAFPB4502R1ZL\n27AAPFU0939F1ZV, ops@shop.in"}
              className="font-mono text-xs" />
            <Input placeholder={t("Where this list came from (optional)")} value={source}
              onChange={e => setSource(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
              <Button onClick={submit} disabled={busy || !paste.trim()}>
                {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t("Looking up…")}</> : t("Add and score")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder={t("Search name, city, GSTIN or phone")}
            value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">{t("Open")}</SelectItem>
            <SelectItem value="all">{t("All")}</SelectItem>
            {STAGES.map(s => <SelectItem key={s} value={s}>{t(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">{t("Fit")}</TableHead>
                <TableHead>{t("Business")}</TableHead>
                <TableHead className="min-w-[230px]">{t("Contact")}</TableHead>
                <TableHead className="min-w-[260px]">{t("Why this one")}</TableHead>
                <TableHead className="w-[150px]">{t("Stage")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map(l => (
                <TableRow key={l.id} className={l.status === "won" ? "bg-success/5" : l.status === "lost" ? "opacity-50" : ""}>
                  <TableCell><ScorePill value={l.score ?? 0} /></TableCell>
                  <TableCell>
                    <p className="font-medium text-sm">{l.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[l.city, l.state].filter(Boolean).join(", ")}
                      {l.gstin && <span className="ml-1.5 opacity-60">{l.gstin}</span>}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Input className="h-7 text-xs" defaultValue={l.contact_person ?? ""}
                      placeholder={t("Person")}
                      onBlur={e => e.target.value !== (l.contact_person ?? "") && save(l.id, { contact_person: e.target.value || null })} />
                    <div className="mt-1 flex items-center gap-1">
                      {/* key on the stored value so a refetch replaces what is
                          shown; an uncontrolled input keeps its first value
                          forever and would quietly show a stale number. */}
                      <Input key={l.phone ?? ""} className="h-7 min-w-0 flex-1 text-xs"
                        defaultValue={l.phone ?? ""} placeholder={t("Phone")} inputMode="tel"
                        onBlur={e => e.target.value !== (l.phone ?? "") && save(l.id, { phone: e.target.value || null })} />
                      {/* Two actions, because they are two different things.
                          Call dials. WhatsApp opens the chat — there is no URL
                          that starts a WhatsApp voice call to someone else's
                          number, so offering one would be a button that lies.
                          From the chat the call button is one tap away. */}
                      {telLink(l.phone) && (
                        <a href={telLink(l.phone)!}
                          className="shrink-0 rounded p-1 text-primary hover:bg-muted" title={t("Call")}>
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {normalisePhone(l.phone) && (
                        <a href={whatsappLink(`Hi, is this ${l.name}?`, l.phone)} target="_blank" rel="noreferrer"
                          className="shrink-0 rounded p-1 text-success hover:bg-muted" title={t("WhatsApp")}>
                          <MessageCircle className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {l.phone && !normalisePhone(l.phone) && (
                        <span className="shrink-0 text-[10px] text-amber-600" title={t("Not a dialable number")}>?</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground align-top">{l.why}</TableCell>
                  <TableCell>
                    <Select value={l.status} onValueChange={v => save(l.id, { status: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STAGES.map(s => <SelectItem key={s} value={s}>{t(s)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" title={t("Delete")}
                      onClick={async () => { await remove({ data: { id: l.id } }); qc.invalidateQueries({ queryKey: ["leads"] }); }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!leads.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                    {t("No leads yet. Paste a few GSTINs and they'll be looked up and ranked.")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
