/**
 * Mass email and the site banner. Platform admins only.
 *
 * The shape of this screen is deliberate: you choose the groups, you see the
 * resolved list of real addresses, and only then does the send button mean
 * anything. Every count on the page is the answer to "who is actually going to
 * receive this", not an estimate, because the one thing you cannot do with a
 * mass email is take it back.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  previewAudience, sendCampaign, listCampaigns,
  saveAnnouncement, clearAnnouncement, listAnnouncements,
  type AudienceSource, type Recipient,
} from "@/lib/broadcast.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { describeError } from "@/lib/offline";
import { cn } from "@/lib/utils";
import { Check, X, Send, Megaphone, TriangleAlert, Users, Target, Store, Undo2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/broadcast")({
  head: () => ({ meta: [{ title: "Broadcast — Dhela" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    const meta = data.user?.app_metadata as { platform_admin?: boolean } | undefined;
    if (meta?.platform_admin !== true) throw redirect({ to: "/dashboard" });
  },
  component: BroadcastPage,
});

/**
 * The three groups, and what each one actually is.
 *
 * `caution` marks a group whose addresses were not given to us. Retailers were
 * typed into Dhela by a distributor so they could raise bills, which is why
 * that one starts off and says so rather than sitting quietly ticked.
 */
const GROUPS: {
  id: AudienceSource; label: string; icon: typeof Users; blurb: string; caution?: string;
}[] = [
  { id: "users", label: "App users", icon: Users,
    blurb: "People with a Dhela login. Confirmed addresses only." },
  { id: "leads", label: "Leads", icon: Target,
    blurb: "Prospects from Growth → Leads. Yours to contact about Dhela." },
  { id: "retailers", label: "Retailers", icon: Store,
    blurb: "Retailer contacts entered by your customers.",
    caution: "These belong to your customers, not to you. They were entered to raise bills, and have not asked to hear from Dhela." },
];

function BroadcastPage() {
  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl">Broadcast</h1>
        <p className="text-muted-foreground mt-1">
          Email everyone at once, or put a line across the top of the app.
        </p>
      </div>
      <Tabs defaultValue="email">
        <TabsList>
          <TabsTrigger value="email">Mass email</TabsTrigger>
          <TabsTrigger value="banner">Site banner</TabsTrigger>
        </TabsList>
        <TabsContent value="email" className="mt-4"><MassEmail /></TabsContent>
        <TabsContent value="banner" className="mt-4"><SiteBanner /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------ mass email ----------------------------- */

function MassEmail() {
  const qc = useQueryClient();
  const preview = useServerFn(previewAudience);
  const send = useServerFn(sendCampaign);
  const campaigns = useServerFn(listCampaigns);

  const [sources, setSources] = useState<AudienceSource[]>(["users"]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [includeRaw, setIncludeRaw] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const include = useMemo(
    () => includeRaw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean),
    [includeRaw],
  );

  const { data: audience, isFetching } = useQuery({
    queryKey: ["broadcast_audience", sources, exclude, include],
    queryFn: async () => await preview({ data: { sources, exclude, include } }),
  });

  const { data: history } = useQuery({
    queryKey: ["broadcast_campaigns"],
    queryFn: async () => await campaigns({}),
  });

  const toggleSource = (id: AudienceSource) =>
    setSources(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const toggleAddress = (email: string) =>
    setExclude(x => (x.includes(email) ? x.filter(e => e !== email) : [...x, email]));

  const willSend = audience?.willSend ?? 0;
  const configured = audience?.configured ?? false;
  const ready = !!subject.trim() && !!body.trim() && willSend > 0 && configured;

  const doSend = async () => {
    setSending(true);
    try {
      const r = await send({ data: { sources, exclude, include, subject, body, confirm: true } });
      toast.success(`Sent to ${r.sent} recipient${r.sent === 1 ? "" : "s"}`, {
        description: r.failed ? `${r.failed} failed. See the history below.` : undefined,
      });
      setConfirming(false);
      setSubject(""); setBody("");
      qc.invalidateQueries({ queryKey: ["broadcast_campaigns"] });
    } catch (e) { toast.error(describeError(e)); }
    finally { setSending(false); }
  };

  const bySource = (s: AudienceSource) =>
    (audience?.recipients ?? []).filter(r => r.source === s).length;

  return (
    <div className="space-y-6">
      {!configured && (
        <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">No sending key configured</p>
            <p>RESEND_API_KEY is not set on this environment. You can compose and
              preview the audience, but sending is disabled.</p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Who gets it</CardTitle>
          <p className="text-sm text-muted-foreground">
            Tick a group to include it. Counts are live, duplicates across groups
            are folded, and anyone who has unsubscribed is dropped whatever you tick.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {GROUPS.map(g => {
              const on = sources.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleSource(g.id)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors",
                    on ? "border-primary bg-primary/5" : "bg-background hover:bg-muted/50",
                    g.caution && on && "border-amber-400 bg-amber-50",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium">
                      <g.icon className="h-4 w-4" /> {g.label}
                    </span>
                    <span className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full",
                      on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                    )}>
                      {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{g.blurb}</p>
                  {on && (
                    <p className="mt-1 text-xs font-medium tabular-nums">
                      {bySource(g.id)} address{bySource(g.id) === 1 ? "" : "es"}
                    </p>
                  )}
                  {g.caution && on && (
                    <p className="mt-2 flex gap-1.5 text-[11px] text-amber-900">
                      <TriangleAlert className="h-3 w-3 shrink-0 mt-0.5" />
                      {g.caution}
                    </p>
                  )}
                </button>
              );
            })}
          </div>

          <div>
            <Label htmlFor="extra">Also send to (typed by hand)</Label>
            <Input id="extra" placeholder="someone@example.com, another@example.com"
              value={includeRaw} onChange={e => setIncludeRaw(e.target.value)} className="mt-1" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            The list{" "}
            <span className="font-normal text-muted-foreground">
              {isFetching ? "· working it out…" : `· ${willSend} will receive, ${audience?.excluded ?? 0} will not`}
            </span>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Click any address to strike it out. Unsubscribed addresses cannot be put back.
          </p>
        </CardHeader>
        <CardContent>
          <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
            {(audience?.recipients ?? []).map(r => (
              <AddressRow key={r.email} r={r} onToggle={() => toggleAddress(r.email)} />
            ))}
            {!audience?.recipients.length && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {isFetching ? "Loading…" : "No addresses in the ticked groups."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">The message</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="subj">Subject</Label>
            <Input id="subj" value={subject} onChange={e => setSubject(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="body">Message</Label>
            <Textarea id="body" rows={10} value={body} onChange={e => setBody(e.target.value)}
              className="mt-1" placeholder="Plain text. A blank line starts a new paragraph." />
            <p className="mt-1 text-xs text-muted-foreground">
              Sent as plain text with a matching HTML part. An unsubscribe link is
              added to every message automatically.
            </p>
          </div>
          <Button disabled={!ready} onClick={() => setConfirming(true)}>
            <Send className="h-4 w-4 mr-2" />
            Send to {willSend} recipient{willSend === 1 ? "" : "s"}
          </Button>
        </CardContent>
      </Card>

      {!!history?.length && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Sent before</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {history.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-4 text-sm border-b pb-1.5 last:border-0">
                <span className="truncate">{c.subject}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {c.sent_count} sent{c.failed_count ? `, ${c.failed_count} failed` : ""}
                  {" · "}{String(c.created_at).slice(0, 10)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirming} onOpenChange={o => !o && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send to {willSend} recipients?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p className="font-medium text-foreground">{subject}</p>
                <p>Going to {sources.map(s => GROUPS.find(g => g.id === s)?.label).join(", ")}.</p>
                {sources.includes("retailers") && (
                  <p className="text-amber-700">
                    This includes retailer contacts entered by your customers for
                    billing. They have not asked to hear from Dhela.
                  </p>
                )}
                <p className="text-xs">Mail cannot be recalled once it is sent.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); doSend(); }} disabled={sending}>
              {sending ? "Sending…" : "Send now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddressRow({ r, onToggle }: { r: Recipient; onToggle: () => void }) {
  const unsubscribed = r.note === "unsubscribed";
  return (
    <button
      type="button"
      onClick={unsubscribed ? undefined : onToggle}
      disabled={unsubscribed}
      className={cn(
        "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm",
        unsubscribed ? "cursor-not-allowed opacity-60" : "hover:bg-muted/60",
      )}
    >
      <span className={cn("truncate font-mono text-xs", r.excluded && "line-through text-muted-foreground")}>
        {r.email}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {r.name && <span className="hidden sm:inline truncate max-w-[12rem] text-xs text-muted-foreground">{r.name}</span>}
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {r.source}
        </span>
        {r.excluded
          ? <span className="text-[11px] text-muted-foreground">{r.note}</span>
          : <Check className="h-3.5 w-3.5 text-primary" />}
      </span>
    </button>
  );
}

/* ------------------------------ site banner ---------------------------- */

function SiteBanner() {
  const qc = useQueryClient();
  const save = useServerFn(saveAnnouncement);
  const clear = useServerFn(clearAnnouncement);
  const list = useServerFn(listAnnouncements);

  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"info" | "warning" | "success">("info");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [dismissible, setDismissible] = useState(true);
  const [saving, setSaving] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ["broadcast_announcements"],
    queryFn: async () => await list({}),
  });
  const live = (rows ?? []).find(r => r.active);

  const publish = async () => {
    setSaving(true);
    try {
      await save({ data: {
        message, tone,
        link_url: linkUrl || null, link_label: linkLabel || null,
        dismissible, ends_at: null,
      }});
      toast.success("Banner is live", { description: "Everyone signed in will see it within a minute." });
      setMessage(""); setLinkUrl(""); setLinkLabel("");
      qc.invalidateQueries({ queryKey: ["broadcast_announcements"] });
    } catch (e) { toast.error(describeError(e)); }
    finally { setSaving(false); }
  };

  const takeDown = async () => {
    try {
      await clear({});
      toast.success("Banner taken down");
      qc.invalidateQueries({ queryKey: ["broadcast_announcements"] });
    } catch (e) { toast.error(describeError(e)); }
  };

  return (
    <div className="space-y-6">
      {live && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" /> Showing right now
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <BannerPreview message={live.message} tone={live.tone as "info"}
              linkLabel={live.link_label} />
            <Button variant="outline" size="sm" onClick={takeDown}>
              <Undo2 className="h-3.5 w-3.5 mr-1.5" /> Take it down
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{live ? "Replace it" : "Put up a banner"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            One line across the top of every screen, for everyone signed in.
            Publishing takes down whatever is up now.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="msg">Message</Label>
            <Input id="msg" value={message} maxLength={300} className="mt-1"
              onChange={e => setMessage(e.target.value)}
              placeholder="Dhela is now ₹150 a month, and your first two months are free." />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Tone</Label>
              <Select value={tone} onValueChange={v => setTone(v as typeof tone)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="success">Good news</SelectItem>
                  <SelectItem value="warning">Needs attention</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="lurl">Link (optional)</Label>
              <Input id="lurl" value={linkUrl} className="mt-1" placeholder="/billing"
                onChange={e => setLinkUrl(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="llab">Link text</Label>
              <Input id="llab" value={linkLabel} className="mt-1" placeholder="See plans"
                onChange={e => setLinkLabel(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="dism" className="cursor-pointer">Let people close it</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Off means it stays on screen until you take it down. Use rarely.
              </p>
            </div>
            <Switch id="dism" checked={dismissible} onCheckedChange={setDismissible} />
          </div>

          {message && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Preview</p>
              <BannerPreview message={message} tone={tone} linkLabel={linkLabel || null} />
            </div>
          )}

          <Button disabled={!message.trim() || saving} onClick={publish}>
            <Megaphone className="h-4 w-4 mr-2" />
            {saving ? "Publishing…" : "Publish banner"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function bannerClasses(tone: "info" | "warning" | "success") {
  return {
    info: "bg-primary/10 text-foreground border-primary/20",
    success: "bg-green-50 text-green-900 border-green-200",
    warning: "bg-amber-50 text-amber-900 border-amber-200",
  }[tone];
}

function BannerPreview({ message, tone, linkLabel }: {
  message: string; tone: "info" | "warning" | "success"; linkLabel: string | null;
}) {
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", bannerClasses(tone))}>
      {message}
      {linkLabel && <span className="ml-2 underline underline-offset-2">{linkLabel}</span>}
    </div>
  );
}
