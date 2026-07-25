import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { listAppUsers, generateUserMagicLink, setOrgPlan } from "@/lib/admin.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PLANS, type PlanId } from "@/lib/plans";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { KeyRound, Copy, ShieldCheck, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — Dhela" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    const meta = data.user?.app_metadata as { platform_admin?: boolean } | undefined;
    if (meta?.platform_admin !== true) throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

type AppUser = {
  id: string; email: string | null; created_at: string;
  last_sign_in_at: string | null; confirmed: boolean;
  org: string | null; org_id: string | null;
  plan: string | null; plan_valid_till: string | null;
  platform_admin: boolean;
};

function AdminPage() {
  const qc = useQueryClient();
  const fetchUsers = useServerFn(listAppUsers);
  const magicLink = useServerFn(generateUserMagicLink);
  const changePlan = useServerFn(setOrgPlan);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);

  const { data: users } = useQuery({
    queryKey: ["admin_users"],
    queryFn: async () => (await fetchUsers()) as AppUser[],
  });

  const generate = async (email: string) => {
    setGenerating(email);
    try {
      const res = await magicLink({ data: { email } });
      setLink({ email, url: res.action_link });
    } catch (e) { toast.error((e as Error).message); }
    finally { setGenerating(null); }
  };

  const setPlan = async (orgId: string, plan: PlanId) => {
    // Paid plans get one year of validity from today; free clears it.
    const validTill = plan === "free" ? null
      : new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    try {
      await changePlan({ data: { orgId, plan, validTill } });
      toast.success(`Plan set to ${PLANS[plan].name}${validTill ? ` till ${validTill}` : ""}`);
      qc.invalidateQueries({ queryKey: ["admin_users"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link.url);
    toast.success("Link copied");
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl">Admin</h1>
        <p className="text-muted-foreground mt-1">
          Every account on the platform. Generate a sign-in link to debug a tenant as that user.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Users ({users?.length ?? 0})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Signed up</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {users?.map(u => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.email}
                    {u.platform_admin && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs text-primary">
                        <ShieldCheck className="h-3 w-3" /> admin
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{u.org ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    {u.org_id ? (
                      <div>
                        <Select value={u.plan ?? "free"} onValueChange={v => setPlan(u.org_id!, v as PlanId)}>
                          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(PLANS) as PlanId[]).map(pid => (
                              <SelectItem key={pid} value={pid}>{PLANS[pid].name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {u.plan_valid_till && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">till {u.plan_valid_till}</div>
                        )}
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>{u.created_at.slice(0, 10)}</TableCell>
                  <TableCell>{u.last_sign_in_at ? u.last_sign_in_at.slice(0, 16).replace("T", " ") : "never"}</TableCell>
                  <TableCell>
                    <span className={`text-xs ${u.confirmed ? "text-green-700" : "text-amber-700"}`}>
                      {u.confirmed ? "confirmed" : "unconfirmed"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {u.email && (
                      <Button size="sm" variant="outline" disabled={generating === u.email}
                        onClick={() => generate(u.email!)}>
                        <KeyRound className="h-3.5 w-3.5 mr-1.5" />
                        {generating === u.email ? "Generating…" : "Magic link"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!users?.length && (
                <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                  Loading users…
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!link} onOpenChange={o => !o && setLink(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Sign-in link for {link?.email}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 p-3 text-xs font-mono break-all max-h-32 overflow-auto">
              {link?.url}
            </div>
            <p className="text-sm text-muted-foreground">
              Open it in an <span className="font-medium text-foreground">incognito window</span> —
              opening it here would replace your own session with theirs.
              The link works once and expires in about an hour.
            </p>
            <div className="flex gap-2">
              <Button onClick={copy}><Copy className="h-4 w-4 mr-2" /> Copy link</Button>
              <a href={link?.url} target="_blank" rel="noreferrer">
                <Button variant="outline"><ExternalLink className="h-4 w-4 mr-2" /> Open (new tab)</Button>
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
