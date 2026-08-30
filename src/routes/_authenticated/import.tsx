import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Upload, Loader2, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parseDelimited, sniffDelimiter, toRecords } from "@/lib/csv";
import {
  proposeImportMapping, commitImport, IMPORT_FIELDS, KEEP_AS_EXTRA, type ImportKind,
} from "@/lib/import.functions";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({ meta: [{ title: "Bring your data in — Dhela" }] }),
  component: ImportPage,
});

type Preview = {
  willCreate: number; willUpdate: number;
  problems: string[]; problemCount: number;
  sample: Record<string, string | number | Record<string, string>>[];
  extraFields: number;
};

/** The extra column holds an object; everything else prints as itself. */
function cellText(v: string | number | Record<string, string>): string {
  if (v && typeof v === "object") {
    return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(" · ");
  }
  return String(v);
}

const KINDS: { id: ImportKind; label: string; hint: string }[] = [
  { id: "products", label: "Products", hint: "Item list with stock and rates" },
  { id: "suppliers", label: "Suppliers", hint: "Who you buy from, and what you owe" },
  { id: "retailers", label: "Retailers", hint: "Who you sell to, and what they owe" },
];

function ImportPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const propose = useServerFn(proposeImportMapping);
  const commit = useServerFn(commitImport);

  const [kind, setKind] = useState<ImportKind>("products");
  const [raw, setRaw] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [notes, setNotes] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const fields = IMPORT_FIELDS[kind];
  const reset = () => { setHeaders([]); setRecords([]); setMapping({}); setPreview(null); setNotes(null); };

  const read = async (text: string) => {
    setRaw(text);
    reset();
    if (!text.trim()) return;
    const rows = parseDelimited(text, sniffDelimiter(text));
    const { headers: h, records: r } = toRecords(rows);
    if (!r.length) { toast.error(t("That looks like a header row with nothing under it.")); return; }
    setHeaders(h); setRecords(r);
    setMapping({});          // nothing decided yet, and the card must say so
    setBusy(true);
    try {
      // Only the header and three rows are sent, never the whole file.
      const res = await propose({
        data: { kind, headers: h, sampleRows: r.slice(0, 3).map(x => h.map(c => x[c])) },
      });
      setMapping(res.mapping);
      setNotes(res.notes);
    } catch (e) {
      toast.error((e as Error).message);
      setMapping(Object.fromEntries(h.map(c => [c, null])));
    } finally { setBusy(false); }
  };

  const check = async () => {
    setBusy(true);
    try { setPreview(await commit({ data: { kind, mapping, rows: records, dryRun: true } }) as Preview); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const res = await commit({ data: { kind, mapping, rows: records, dryRun: false } });
      toast.success(t("{{c}} created, {{u}} updated", { c: res.willCreate, u: res.willUpdate }));
      qc.invalidateQueries();
      setRaw(""); reset();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  // Counted apart from the mapped fields: a column kept as extra info is not
  // "matched" to anything, and rolling it into that number would overstate how
  // much of the file actually landed somewhere meaningful.
  const mappedCount = Object.values(mapping).filter(f => f && f !== KEEP_AS_EXTRA).length;
  const extraCount = Object.values(mapping).filter(f => f === KEEP_AS_EXTRA).length;
  // The columns are known before the mapping is. Until it lands, the selects
  // would all read "do not import", which looks like a verdict rather than a
  // pause.
  const mappingPending = busy && Object.keys(mapping).length === 0;
  const hasName = Object.values(mapping).includes("name");

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-4xl">{t("Bring your data in")}</h1>
        <p className="text-muted-foreground mt-1 max-w-2xl">
          {t("Export from whatever you use now — Tally, Marg, Busy, Vyapar or a spreadsheet — and paste it here. The columns are worked out for you and shown before anything is saved.")}
        </p>
      </div>

      {/* Said plainly rather than discovered later: this brings masters and
          opening balances, not years of transactions. Importing history would
          restate stock that has already moved and double-count tax already
          filed, and the books it came from remain the record of it. */}
      <Card className="border-muted">
        <CardContent className="flex gap-3 pt-6 text-sm text-muted-foreground">
          <ArrowRight className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            {t("This brings across your item list, your parties and what they owe today. It does not bring past invoices — those stay where they are, and importing them would restate stock that has already moved.")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("What are you bringing in?")}</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup value={kind} onValueChange={v => { setKind(v as ImportKind); reset(); }}
            className="grid gap-3 sm:grid-cols-3">
            {KINDS.map(k => (
              <label key={k.id} htmlFor={`k-${k.id}`}
                className={`rounded-lg border p-3 cursor-pointer ${kind === k.id ? "border-primary bg-primary/5" : ""}`}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value={k.id} id={`k-${k.id}`} />
                  <span className="font-medium">{t(k.label)}</span>
                </div>
                <p className="ml-6 mt-0.5 text-xs text-muted-foreground">{t(k.hint)}</p>
              </label>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("Paste the export")}</CardTitle>
          <CardDescription>
            {t("A CSV, or copied straight out of Excel. Keep the header row — it is what the columns are matched on.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            onBlur={e => e.target.value !== "" && headers.length === 0 && read(e.target.value)}
            placeholder={"Party Name,GST No,City,Op. Bal\nAnand Enterprises,03AACFA5566L1ZQ,Ludhiana,1,23,456.78"}
            className="h-40 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" disabled={busy || !raw.trim()} onClick={() => read(raw)}>
              {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {t("Read the columns")}
            </Button>
            <label className="text-sm text-primary underline underline-offset-2 cursor-pointer">
              {t("or choose a .csv file")}
              <input type="file" accept=".csv,.txt,text/csv" className="hidden"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) await read(await f.text());
                }} />
            </label>
            {records.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {t("{{n}} rows read", { n: records.length })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t("Which column is which")}
              <span className="ml-2 font-normal text-muted-foreground">
                {mappingPending
                  ? t("working them out…")
                  : t("{{m}} of {{n}} matched", { m: mappedCount, n: headers.length })
                    + (extraCount ? t(", {{e}} kept as extra info", { e: extraCount }) : "")}
              </span>
            </CardTitle>
            {notes && <CardDescription>{notes}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-2">
            {mappingPending && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {t("Reading your column names and a few values to work out what is what…")}
              </div>
            )}
            {!mappingPending && headers.map(h => (
              // Named after their column so a test — and anyone reading the
              // DOM — can find the row for a given heading.
              <div key={h} data-column={h} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{h}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {records.slice(0, 2).map(r => r[h]).filter(Boolean).join("  ·  ") || t("(empty)")}
                  </div>
                </div>
                <Select value={mapping[h] ?? "__skip__"}
                  onValueChange={v => setMapping(m => ({ ...m, [h]: v === "__skip__" ? null : v }))}>
                  <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__skip__">{t("— Do not import —")}</SelectItem>
                    {/* For a column that is real information with no field of
                        its own — a rack code, an old ledger group. Kept
                        against the record and shown when you open it. */}
                    <SelectItem value={KEEP_AS_EXTRA}>{t("— Keep as extra info —")}</SelectItem>
                    {Object.entries(fields).map(([f, desc]) => (
                      <SelectItem key={f} value={f}>{f} — {desc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex items-center gap-3 pt-2">
              <Button size="sm" disabled={busy || !hasName} onClick={check}>
                {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                {t("Check what will happen")}
              </Button>
              {!hasName && (
                <span className="text-xs text-amber-600">
                  {t("One column has to be the name, or there is nothing to call these rows.")}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card className={preview.problemCount ? "border-amber-400/60" : "border-primary/40"}>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-start gap-3">
              {preview.problemCount
                ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />}
              <div>
                <p className="font-medium">
                  {t("{{c}} new, {{u}} updated", { c: preview.willCreate, u: preview.willUpdate })}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {t("An existing party is matched on its GSTIN, or on its name when there is no GSTIN, and updated rather than duplicated.")}
                </p>
                {preview.extraFields > 0 && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("{{n}} column(s) kept as extra info — visible when you open the record, and not used in any calculation.", { n: preview.extraFields })}
                  </p>
                )}
              </div>
            </div>

            {preview.problemCount > 0 && (
              <div className="rounded-lg border border-amber-400/50 bg-warning/10 p-3">
                <p className="text-sm font-medium">
                  {t("{{n}} row(s) need a look", { n: preview.problemCount })}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {preview.problems.map((p, i) => <li key={i}>· {p}</li>)}
                </ul>
              </div>
            )}

            {preview.sample.length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-1 text-xs text-muted-foreground">{t("First few, as they will be saved")}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(preview.sample[0]).filter(k => k !== "org_id")
                        .map(k => <TableHead key={k} className="text-xs">{k}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.sample.map((r, i) => (
                      <TableRow key={i}>
                        {Object.entries(r).filter(([k]) => k !== "org_id")
                          .map(([k, v]) => <TableCell key={k} className="text-xs">{cellText(v)}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <Button onClick={doImport} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {t("Import {{n}} rows", { n: preview.willCreate + preview.willUpdate })}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
