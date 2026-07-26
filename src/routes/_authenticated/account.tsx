import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { updateOrgProfile, clearOrgData, updateOrgInvoiceProfile } from "@/lib/org.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Building2, Landmark, TriangleAlert, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({ meta: [{ title: "Account — Dhela" }] }),
  component: AccountPage,
});

type Org = {
  id: string; name: string; gstin: string | null; address: string | null;
  state_code: string | null; phone: string | null; email: string | null;
  bank_name: string | null; bank_account_no: string | null; bank_ifsc: string | null;
  bank_branch: string | null; upi_id: string | null; signatory_name: string | null;
};

function AccountPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const saveProfile = useServerFn(updateOrgProfile);
  const saveInvoiceProfile = useServerFn(updateOrgInvoiceProfile);
  const clearData = useServerFn(clearOrgData);

  const { data: org } = useQuery({
    queryKey: ["org_profile"],
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations")
        .select("id, name, gstin, address, state_code, phone, email, "
          + "bank_name, bank_account_no, bank_ifsc, bank_branch, upi_id, signatory_name")
        .limit(1).single();
      if (error) throw error;
      return data as unknown as Org;
    },
  });

  const { data: me } = useQuery({
    queryKey: ["auth_user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });

  const [biz, setBiz] = useState<Partial<Org>>({});
  const [bank, setBank] = useState<Partial<Org>>({});
  useEffect(() => {
    if (!org) return;
    setBiz({ name: org.name, gstin: org.gstin, address: org.address,
      state_code: org.state_code, phone: org.phone, email: org.email });
    setBank({ bank_name: org.bank_name, bank_account_no: org.bank_account_no,
      bank_ifsc: org.bank_ifsc, bank_branch: org.bank_branch, upi_id: org.upi_id,
      signatory_name: org.signatory_name });
  }, [org?.id]);

  const [clearOpen, setClearOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const submitBiz = async () => {
    try {
      await saveProfile({ data: {
        name: biz.name ?? "", gstin: biz.gstin ?? null, address: biz.address ?? null,
        state_code: biz.state_code ?? null, phone: biz.phone ?? null, email: biz.email ?? null,
      }});
      toast.success(t("Business details saved"));
      qc.invalidateQueries({ queryKey: ["org_profile"] });
      qc.invalidateQueries({ queryKey: ["current_org"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const submitBank = async () => {
    try {
      await saveInvoiceProfile({ data: {
        bank_name: bank.bank_name ?? null, bank_account_no: bank.bank_account_no ?? null,
        bank_ifsc: bank.bank_ifsc ?? null, bank_branch: bank.bank_branch ?? null,
        upi_id: bank.upi_id ?? null, signatory_name: bank.signatory_name ?? null,
      }});
      toast.success(t("Bank details saved"));
      qc.invalidateQueries({ queryKey: ["org_profile"] });
    } catch (e) { toast.error((e as Error).message); }
  };

  const submitClear = async () => {
    try {
      const r = await clearData({ data: { confirmName } });
      toast.success(t("Workspace cleared — {{n}} tables emptied", { n: r.tables }));
      setClearOpen(false);
      setConfirmName("");
      qc.clear();
    } catch (e) { toast.error((e as Error).message); }
  };

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl">{t("Account")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("Your business details, what prints on your invoices, and your login.")}
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-primary" />{t("Business details")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("These print on every invoice and drive your GST returns.")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="org-name" label={t("Workspace name *")} value={biz.name ?? ""}
              onChange={v => setBiz({ ...biz, name: v })} />
            <Field id="org-gstin" label={t("GSTIN")} value={biz.gstin ?? ""} mono
              placeholder="03AABCA1234K1Z5"
              onChange={v => setBiz({ ...biz, gstin: v.toUpperCase() })}
              hint={t("The first two digits set your state code automatically.")} />
            <Field id="org-address" label={t("Address")} value={biz.address ?? ""}
              onChange={v => setBiz({ ...biz, address: v })}
              hint={t("Street, city and PIN — printed as-is on invoices.")} />
            <Field id="org-state" label={t("State code")} value={biz.state_code ?? ""} mono
              onChange={v => setBiz({ ...biz, state_code: v })}
              hint={t("Set from your GSTIN when one is entered.")} />
            <Field id="org-phone" label={t("Phone")} value={biz.phone ?? ""}
              onChange={v => setBiz({ ...biz, phone: v })} />
            <Field id="org-email" label={t("Business email")} value={biz.email ?? ""}
              onChange={v => setBiz({ ...biz, email: v })} />
          </div>
          <Button onClick={submitBiz}>{t("Save business details")}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-primary" />{t("Invoice footer")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("Bank and signatory details printed at the bottom of a sales invoice.")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bank-name" label={t("Bank name")} value={bank.bank_name ?? ""}
              onChange={v => setBank({ ...bank, bank_name: v })} />
            <Field id="bank-acc" label={t("Account number")} value={bank.bank_account_no ?? ""} mono
              onChange={v => setBank({ ...bank, bank_account_no: v })} />
            <Field id="bank-ifsc" label={t("IFSC")} value={bank.bank_ifsc ?? ""} mono
              onChange={v => setBank({ ...bank, bank_ifsc: v.toUpperCase() })} />
            <Field id="bank-branch" label={t("Branch")} value={bank.bank_branch ?? ""}
              onChange={v => setBank({ ...bank, bank_branch: v })} />
            <Field id="bank-upi" label={t("UPI ID")} value={bank.upi_id ?? ""} mono
              onChange={v => setBank({ ...bank, upi_id: v })} />
            <Field id="bank-sign" label={t("Authorised signatory")} value={bank.signatory_name ?? ""}
              onChange={v => setBank({ ...bank, signatory_name: v })} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("The signature image is uploaded from a sales invoice, where you can see it in place.")}
          </p>
          <Button onClick={submitBank}>{t("Save invoice footer")}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("Login")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p className="font-medium">{me?.email ?? "…"}</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              {t("Change your password by signing out and using \"Forgot password\" on the sign-in screen.")}
            </p>
          </div>
          <Button variant="outline" onClick={signOut}>
            <LogOut className="h-4 w-4 mr-2" />{t("Sign out")}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <TriangleAlert className="h-4 w-4" />{t("Clear all data")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("Deletes every purchase, sale, order, return, payment, product, retailer and supplier in this workspace. Your login, your team and the business details above are kept, so you can start again from empty.")}
          </p>
          <p className="text-sm font-medium text-destructive">
            {t("This cannot be undone. There is no backup to restore from.")}
          </p>
          <Button variant="outline" className="text-destructive hover:text-destructive"
            onClick={() => { setConfirmName(""); setClearOpen(true); }}>
            {t("Clear all data…")}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("Clear all data")}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("Every business record in this workspace will be permanently deleted.")}
          </p>
          <div className="space-y-2">
            <Label htmlFor="confirm-name">
              {t("Type the workspace name to confirm:")}{" "}
              <span className="font-medium text-foreground">{org?.name}</span>
            </Label>
            <Input id="confirm-name" value={confirmName} autoComplete="off"
              onChange={e => setConfirmName(e.target.value)} placeholder={org?.name ?? ""} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClearOpen(false)}>{t("Cancel")}</Button>
            <Button variant="outline" className="text-destructive hover:text-destructive"
              disabled={confirmName.trim() !== (org?.name ?? "").trim()}
              onClick={submitClear}>
              {t("Delete everything")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ id, label, value, onChange, hint, mono, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  hint?: string; mono?: boolean; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder}
        className={mono ? "font-mono" : undefined}
        onChange={e => onChange(e.target.value)} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
