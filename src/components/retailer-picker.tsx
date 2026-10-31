import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { upsertRetailer } from "@/lib/retailers.functions";
import { verifyGstin } from "@/lib/gstin.functions";
import { STATE_OPTIONS } from "@/lib/gst-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronsUpDown, Plus, Loader2, CheckCircle2, XCircle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { describeError } from "@/lib/offline";

export type PickableRetailer = {
  id: string; name: string; state_code: string | null; gstin: string | null;
};

type GstInfo = {
  valid: boolean; stateCode?: string | null; state?: string | null;
  legalName?: string | null; tradeName?: string | null;
  address?: string | null; city?: string | null; pincode?: string | null;
  status?: string | null;
};

/**
 * Choose the shop this bill is for, or name one that is not on the list yet.
 *
 * The old control was a plain dropdown, so the only billable customers were
 * the ones already keyed in on another screen. A distributor writing their
 * first bills hits that immediately: the shop in front of them is not in the
 * list, and the bill cannot start. They are coming from a paper bill book
 * where you write the shop's name at the top — having to register a customer
 * before billing them is software's idea, not theirs.
 *
 * So: type to search, and when nothing matches, create it right here without
 * losing the bill in progress.
 *
 * GSTIN is optional on purpose. A kirana shop under the threshold has none,
 * and selling to it is an ordinary taxed sale that lands in B2C on GSTR-1 —
 * the buyer being unregistered has nothing to do with whether GST applies.
 *
 * The state code is the field that actually matters, which is why it is the
 * required one. Two state codes decide IGST against CGST plus SGST, and
 * issuing a taxed bill without them is refused further down. Asking here is
 * what stops somebody keying a whole bill and being told at the end that it
 * cannot go out.
 */
export function RetailerPicker({ retailers, value, onChange, onCreated }: {
  retailers: PickableRetailer[] | undefined;
  value: string;
  onChange: (id: string) => void;
  /** Lets the parent refetch its retailer list. */
  onCreated?: (r: PickableRetailer) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const selected = retailers?.find(r => r.id === value) ?? null;
  const typed = query.trim();

  const exactMatch = useMemo(
    () => (retailers ?? []).some(r => r.name.trim().toLowerCase() === typed.toLowerCase()),
    [retailers, typed],
  );

  const startCreate = () => { setOpen(false); setFormOpen(true); };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open}
            aria-label={t("Retailer")}
            className="w-full justify-between font-normal">
            <span className={selected ? "truncate" : "truncate text-muted-foreground"}>
              {selected
                ? `${selected.name}${selected.state_code ? ` — ${selected.state_code}` : ""}${selected.gstin ? ` · ${selected.gstin}` : ""}`
                : t("Choose or type a retailer name")}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command
            // Filtered here rather than by Command's scorer so that typing a
            // name that does not exist still leaves the "add it" row standing.
            filter={(v, search) => v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0}
          >
            <CommandInput placeholder={t("Search, or type a new name…")} value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty className="p-2">
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  {typed ? t("No retailer by that name yet.") : t("No retailers yet.")}
                </p>
              </CommandEmpty>
              <CommandGroup>
                {(retailers ?? []).map(r => (
                  <CommandItem key={r.id} value={`${r.name} ${r.gstin ?? ""}`}
                    onSelect={() => { onChange(r.id); setOpen(false); }}>
                    <Check className={`mr-2 h-4 w-4 ${r.id === value ? "opacity-100" : "opacity-0"}`} />
                    <span className="truncate">
                      {r.name}
                      <span className="text-muted-foreground">
                        {r.state_code ? ` — ${r.state_code}` : ""}{r.gstin ? ` · ${r.gstin}` : ""}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            {/* Outside CommandList so it is always reachable, whether the
                search matched nothing or matched something close but wrong. */}
            {!exactMatch && (
              <div className="border-t p-1">
                <Button type="button" variant="ghost" className="w-full justify-start font-normal"
                  onClick={startCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  {typed ? t('Add "{{name}}"', { name: typed }) : t("Add a new retailer")}
                </Button>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>

      <NewRetailerDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialName={typed}
        onSaved={(r) => {
          setFormOpen(false);
          setQuery("");
          onCreated?.(r);
          onChange(r.id);
        }}
      />
    </>
  );
}

/**
 * The smallest set of fields that makes a retailer billable today. Everything
 * else about them — credit limit, category, address — is on the Retailers
 * screen, and nothing here stops them filling it in later.
 */
function NewRetailerDialog({ open, onOpenChange, initialName, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialName: string;
  onSaved: (r: PickableRetailer) => void;
}) {
  const { t } = useTranslation();
  const save = useServerFn(upsertRetailer);
  const checkGstin = useServerFn(verifyGstin);

  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [phone, setPhone] = useState("");
  const [gst, setGst] = useState<GstInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  // So a GSTIN lookup never overwrites a state the person picked themselves.
  const stateTouched = useRef(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setGstin(""); setStateCode(""); setPhone("");
    setGst(null); setChecking(false);
    stateTouched.current = false;
  }, [open, initialName]);

  useEffect(() => {
    const g = gstin.trim().toUpperCase();
    if (g.length !== 15) { setGst(null); return; }
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const info = await checkGstin({ data: { gstin: g } }) as GstInfo;
        setGst(info);
        // The first two digits ARE the state, so there is nothing to ask.
        if (info.stateCode && !stateTouched.current) setStateCode(info.stateCode);
        const apiName = info.tradeName || info.legalName;
        setName(n => (!n.trim() && apiName) ? apiName : n);
      } catch { setGst(null); }
      finally { setChecking(false); }
    }, 700);
    return () => clearTimeout(timer);
  }, [gstin, checkGstin]);

  const gstinOk = !gstin.trim() || !!gst?.valid;
  const canSave = !!name.trim() && !!stateCode && gstinOk && !checking && !saving;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const row = await save({
        data: {
          name: name.trim(),
          gstin: gstin.trim() ? gstin.trim().toUpperCase() : null,
          state_code: stateCode,
          phone: phone.trim() || null,
          category: "C" as const,
        },
      }) as PickableRetailer;
      toast.success(t("{{name}} added", { name: row.name }));
      onSaved(row);
    } catch (e) { toast.error(describeError(e)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Add retailer")}</DialogTitle>
          <DialogDescription>
            {t("Enough to bill them now. The rest can be filled in later on the Retailers screen.")}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-3" onSubmit={e => { e.preventDefault(); submit(); }}>
          <div>
            <Label htmlFor="rp-name">{t("Business name *")}</Label>
            <Input id="rp-name" value={name} placeholder={t("e.g. Sharma General Store")}
              onChange={e => setName(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="rp-gstin">{t("GSTIN")}</Label>
            <Input id="rp-gstin" value={gstin} placeholder={t("15-character GST number")}
              onChange={e => setGstin(e.target.value.toUpperCase())} />
            <div className="mt-1 flex min-h-[16px] items-center gap-1.5 text-xs">
              {checking ? (
                <><Loader2 className="h-3 w-3 animate-spin" /><span className="text-muted-foreground">{t("Checking GSTIN…")}</span></>
              ) : gst ? (
                gst.valid ? (
                  <><CheckCircle2 className="h-3 w-3 text-green-600" />
                    <span className="text-muted-foreground">
                      {gst.state ?? gst.stateCode}
                      {gst.tradeName || gst.legalName ? ` · ${gst.tradeName ?? gst.legalName}` : ""}
                    </span></>
                ) : (
                  <><XCircle className="h-3 w-3 text-destructive" />
                    <span className="text-destructive">{t("Invalid GSTIN (check digits)")}</span></>
                )
              ) : (
                <span className="text-muted-foreground">
                  {t("Leave blank for a shop that is not GST registered.")}
                </span>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="rp-state">{t("State *")}</Label>
            <Select value={stateCode} onValueChange={v => { stateTouched.current = true; setStateCode(v); }}>
              <SelectTrigger id="rp-state" aria-label={t("State")}>
                <SelectValue placeholder={t("Where you are supplying to")} />
              </SelectTrigger>
              <SelectContent>
                {STATE_OPTIONS.map(([code, label]) => (
                  <SelectItem key={code} value={code}>{code} — {label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Required even without a GSTIN, and this says why rather than
                leaving a red asterisk to argue with. */}
            <p className="mt-1 text-xs text-muted-foreground">
              {gstin.trim() && stateCode
                ? t("Taken from the GSTIN.")
                : t("Decides IGST against CGST + SGST, so a taxed bill cannot be issued without it.")}
            </p>
          </div>

          <div>
            <Label htmlFor="rp-phone">{t("Phone")}</Label>
            <Input id="rp-phone" value={phone} placeholder={t("Mobile / landline")}
              onChange={e => setPhone(e.target.value)} />
          </div>

          <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              {gstin.trim()
                ? t("A registered buyer — this sale goes into B2B on your GSTR-1.")
                : t("No GSTIN is fine. You still charge GST as usual and the sale goes into B2C on your GSTR-1.")}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
            <Button type="submit" loading={saving} disabled={!canSave}>
              {saving ? t("Saving…") : t("Add and use")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
