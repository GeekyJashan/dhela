import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ChevronUp, ChevronDown, Plus, Trash2, Lock, AlertTriangle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  BUILT_IN, MAX_CUSTOM_COLUMNS, MAX_BILL_FIELDS, MAX_LABEL_LEN,
  CROWDED_AT, MAX_COLUMNS, isCustom, customId, normaliseLayout,
  type BillLayout,
} from "@/lib/bill-columns";

/**
 * Pick what the printed bill shows.
 *
 * Used twice: on Account as the workspace default, and on a single bill as a
 * one-off override. Same editor both times, so what someone learns in one
 * place holds in the other.
 *
 * The locked columns are shown rather than hidden. A distributor who cannot
 * find HSN in the list will assume Dhela dropped it; a greyed row with a
 * padlock and a reason says the opposite — it is there, and it is not
 * optional, and here is why.
 */
export function BillColumnsDialog({
  open, onOpenChange, layout, onSave, scope, saving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  layout: BillLayout;
  onSave: (next: BillLayout) => void;
  /** "org" = the workspace default, "bill" = just this bill. */
  scope: "org" | "bill";
  saving?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<BillLayout>(layout);

  // Re-seed whenever the dialog opens, so cancelling actually discards.
  useEffect(() => { if (open) setDraft(normaliseLayout(layout)); }, [open, layout]);

  const on = new Set(draft.columns);
  const count = draft.columns.length;

  const toggle = (key: string, checked: boolean) =>
    setDraft(d => ({
      ...d,
      columns: checked
        ? [...d.columns, key]
        : d.columns.filter(k => k !== key),
    }));

  const move = (key: string, dir: -1 | 1) =>
    setDraft(d => {
      const i = d.columns.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.columns.length) return d;
      const next = [...d.columns];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, columns: next };
    });

  const addCustom = () => setDraft(d => {
    if (d.custom.length >= MAX_CUSTOM_COLUMNS) return d;
    const id = crypto.randomUUID().slice(0, 8);
    return { ...d, custom: [...d.custom, { id, label: "" }], columns: [...d.columns, `custom:${id}`] };
  });

  const renameCustom = (id: string, label: string) =>
    setDraft(d => ({ ...d, custom: d.custom.map(c => c.id === id ? { ...c, label } : c) }));

  const removeCustom = (id: string) =>
    setDraft(d => ({
      ...d,
      custom: d.custom.filter(c => c.id !== id),
      columns: d.columns.filter(k => k !== `custom:${id}`),
    }));

  const setField = (i: number, label: string) =>
    setDraft(d => ({ ...d, fields: d.fields.map((f, n) => n === i ? label : f) }));
  const addField = () =>
    setDraft(d => d.fields.length >= MAX_BILL_FIELDS ? d : { ...d, fields: [...d.fields, ""] });
  const removeField = (i: number) =>
    setDraft(d => ({ ...d, fields: d.fields.filter((_, n) => n !== i) }));

  const unlabelled = draft.custom.some(c => !c.label.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Bill columns")}</DialogTitle>
          <DialogDescription>
            {scope === "org"
              ? t("The layout every new bill starts with. Bills you have already issued keep the layout they were issued with.")
              : t("Just this bill. Your workspace default is left alone.")}
          </DialogDescription>
        </DialogHeader>

        {count > CROWDED_AT && (
          <div className="flex gap-2 rounded-lg border border-amber-400/60 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>{t("{{n}} columns is more than an A4 page holds comfortably — the table will start to squeeze. Printing landscape, or dropping a column, reads better.", { n: count })}</p>
          </div>
        )}

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("Columns")}</p>
          {/* Ordered list first so the arrows mean something, then whatever is
              switched off, so turning one on appends it where you can see it. */}
          {[...draft.columns, ...BUILT_IN.filter(c => !on.has(c.key)).map(c => c.key)].map((key) => {
            const def = isCustom(key) ? null : BUILT_IN.find(c => c.key === key);
            const enabled = on.has(key);
            const cust = isCustom(key) ? draft.custom.find(c => c.id === customId(key)) : null;
            if (isCustom(key) && !cust) return null;
            return (
              <div key={key} className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${enabled ? "" : "opacity-55"}`}>
                {/* Named for a screen reader, and for anything else driving
                    this by the heading a person can see. */}
                <Checkbox
                  aria-label={cust ? cust.label || t("Unnamed column") : t(def!.label)}
                  checked={enabled}
                  disabled={def?.locked}
                  onCheckedChange={v => toggle(key, !!v)}
                />
                <div className="min-w-0 flex-1">
                  {cust ? (
                    <Input
                      value={cust.label}
                      maxLength={MAX_LABEL_LEN}
                      placeholder={t("Column heading, e.g. Warranty")}
                      onChange={e => renameCustom(cust.id, e.target.value)}
                      className="h-7"
                    />
                  ) : (
                    <>
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {t(def!.label)}
                        {def!.locked && <Lock className="h-3 w-3 text-muted-foreground" />}
                      </p>
                      {(def!.advised || def!.hint) && (
                        <p className="text-xs text-muted-foreground">{t(def!.advised ?? def!.hint!)}</p>
                      )}
                    </>
                  )}
                </div>
                {enabled && (
                  <>
                    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={() => move(key, -1)}><ChevronUp className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={() => move(key, 1)}><ChevronDown className="h-3.5 w-3.5" /></Button>
                  </>
                )}
                {cust && (
                  <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive"
                    onClick={() => removeCustom(cust.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                )}
              </div>
            );
          })}

          <Button type="button" variant="outline" size="sm" className="mt-2"
            disabled={draft.custom.length >= MAX_CUSTOM_COLUMNS || count >= MAX_COLUMNS}
            onClick={addCustom}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {t("Add your own column")}
          </Button>
          {draft.custom.length >= MAX_CUSTOM_COLUMNS && (
            <p className="text-xs text-muted-foreground">{t("Four is the most that fits across a bill.")}</p>
          )}
        </div>

        <div className="space-y-1 border-t pt-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{t("Fields for the whole bill")}</p>
          <p className="text-xs text-muted-foreground">
            {t("One value per bill rather than per line — transport, LR number, vehicle. Printed above the totals.")}
          </p>
          {draft.fields.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={f} maxLength={MAX_LABEL_LEN} placeholder={t("Field name, e.g. Transport")}
                onChange={e => setField(i, e.target.value)} className="h-8" />
              <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive"
                onClick={() => removeField(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="mt-1"
            disabled={draft.fields.length >= MAX_BILL_FIELDS} onClick={addField}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />{t("Add a field")}
          </Button>
        </div>

        {/* Said plainly, because a custom column looks exactly like a real one
            once it is printed, and someone will otherwise key an expiry date
            into one and expect to be warned about it. */}
        <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{t("Your own columns are printed as you type them and nothing is calculated from them. Expiry, batch, quantity and tax are real fields — switch those on above rather than making your own, so stock, GST and expiry warnings keep working.")}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button type="button" loading={saving} disabled={unlabelled}
            title={unlabelled ? t("Give every column you added a heading") : undefined}
            onClick={() => onSave(normaliseLayout(draft))}>
            {saving ? t("Saving…") : scope === "org" ? t("Save as default") : t("Use on this bill")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
