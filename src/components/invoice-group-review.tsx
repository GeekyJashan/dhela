import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Copy, FileText, Layers, Loader2 } from "lucide-react";
import type { ProposedDocument } from "@/lib/invoice-batch.functions";

/**
 * What the reader made of a pile of photos, before any of it is saved.
 *
 * This screen exists because of one asymmetry. A bill wrongly split into two is
 * obvious here and costs a regroup. Two bills wrongly merged writes one
 * supplier's goods under another's name, moves the weighted-average cost, and
 * looks perfectly ordinary on every screen afterwards. So the grouping is shown
 * as a claim to be checked, with the reasoning next to it, rather than as a
 * result to be accepted.
 *
 * Regrouping deliberately triggers a fresh read rather than shuffling what is
 * already on screen: nothing records which photo a given row came from, so
 * moving a photo between bills cannot move its line items with it. Patching the
 * grouping while leaving the rows where they were would produce a bill that
 * looks corrected and is not.
 */

export type PhotoThumb = { index: number; name: string; preview?: string };

const money = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function InvoiceGroupReview({
  documents,
  photos,
  unassigned,
  busy,
  onConfirm,
  onRegroup,
  onCancel,
}: {
  documents: ProposedDocument[];
  photos: PhotoThumb[];
  unassigned: number[];
  busy: boolean;
  onConfirm: () => void;
  onRegroup: (groups: number[][]) => void;
  onCancel: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // Photo index -> bill number the operator has put it in (1-based).
  const [assignment, setAssignment] = useState<Record<number, number>>(() => {
    const a: Record<number, number> = {};
    documents.forEach((d, i) => {
      [...d.page_indexes, ...d.duplicate_page_indexes].forEach((p) => {
        a[p] = i + 1;
      });
    });
    // A photo the reader never placed still has to go somewhere, or the operator
    // cannot act on it at all. It starts in its own bill.
    unassigned.forEach((p, n) => {
      a[p] = documents.length + n + 1;
    });
    return a;
  });

  const billCount = Math.max(documents.length, ...Object.values(assignment), 1);
  const groups = useMemo(() => {
    const out: number[][] = [];
    for (let b = 1; b <= billCount + 1; b++) {
      const g = photos.map((p) => p.index).filter((i) => assignment[i] === b);
      if (g.length) out.push(g);
    }
    return out;
  }, [assignment, billCount, photos]);

  const changed = useMemo(() => {
    const original: number[][] = documents.map((d) =>
      [...d.page_indexes, ...d.duplicate_page_indexes].sort((a, b) => a - b),
    );
    unassigned.forEach((p) => original.push([p]));
    const now = groups.map((g) => [...g].sort((a, b) => a - b));
    return (
      JSON.stringify(original.map((g) => g.join(","))) !==
      JSON.stringify(now.map((g) => g.join(",")))
    );
  }, [documents, unassigned, groups]);

  const thumbOf = (i: number) => photos.find((p) => p.index === i);

  return (
    <Card className="border-primary/30">
      <CardContent className="p-5 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-2xl flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              {documents.length === 1
                ? "This looks like one bill"
                : `This looks like ${documents.length} bills`}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              {photos.length} photo{photos.length === 1 ? "" : "s"} read together. Nothing is saved
              yet — check the grouping before importing.
            </p>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={busy}>
              Regroup
            </Button>
          )}
        </div>

        {unassigned.length > 0 && (
          <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <span>
              <strong>
                {unassigned.length} photo{unassigned.length === 1 ? " was" : "s were"} not read.
              </strong>{" "}
              {unassigned
                .map((i) => thumbOf(i)?.name)
                .filter(Boolean)
                .join(", ")}{" "}
              — put {unassigned.length === 1 ? "it" : "them"} in a bill below, or remove and
              re-photograph.
            </span>
          </div>
        )}

        <div className="space-y-4">
          {documents.map((doc, i) => {
            const short =
              doc.line_count_on_bill != null && doc.lines.length < doc.line_count_on_bill;
            return (
              <div key={i} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-medium">
                    {doc.supplier_name || (
                      <span className="text-muted-foreground">Supplier not read</span>
                    )}
                    {doc.invoice_number && (
                      <span className="ml-2 text-sm text-muted-foreground">
                        {doc.invoice_number}
                      </span>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className={short ? "text-destructive font-medium" : ""}>
                      {doc.lines.length}
                      {doc.line_count_on_bill != null && ` of ${doc.line_count_on_bill}`} rows
                    </span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span className="font-medium">{money(doc.grand_total)}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {doc.page_indexes.map((p, n) => (
                    <Thumb
                      key={p}
                      photo={thumbOf(p)}
                      caption={doc.page_labels[n] || `Page ${n + 1}`}
                    />
                  ))}
                  {doc.duplicate_page_indexes.map((p) => (
                    <Thumb key={p} photo={thumbOf(p)} caption="duplicate" muted />
                  ))}
                </div>

                {doc.grouping_reason && (
                  <p className="mt-3 text-xs text-muted-foreground italic">{doc.grouping_reason}</p>
                )}
                {doc.duplicate_page_indexes.length > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Copy className="h-3 w-3" />
                    {doc.duplicate_page_indexes.length} photo
                    {doc.duplicate_page_indexes.length === 1 ? " was" : "s were"} the same page
                    again — read once, so the goods are not counted twice.
                  </p>
                )}
                {doc.missing_page_numbers.length > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    The bill refers to page{doc.missing_page_numbers.length === 1 ? "" : "s"}{" "}
                    {doc.missing_page_numbers.join(", ")}, which{" "}
                    {doc.missing_page_numbers.length === 1 ? "was" : "were"} not photographed. Rows
                    on {doc.missing_page_numbers.length === 1 ? "it" : "them"} are missing.
                  </p>
                )}
                {short && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    It counted {doc.line_count_on_bill} rows on the paper but read{" "}
                    {doc.lines.length}. Check against the bill before approving.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {editing && (
          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <p className="text-sm font-medium">Which bill is each photo?</p>
            <p className="text-xs text-muted-foreground">
              Changing this reads the bills again from the start. Line items cannot simply be moved
              between bills — nothing records which photo a row came from, so a shuffled grouping
              would look corrected without being correct.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {photos.map((p) => (
                <div
                  key={p.index}
                  className="flex items-center gap-3 rounded border bg-background p-2"
                >
                  <Thumb photo={p} small />
                  <span className="flex-1 truncate text-xs" title={p.name}>
                    {p.name}
                  </span>
                  <Select
                    value={String(assignment[p.index] ?? 1)}
                    onValueChange={(v) => setAssignment((a) => ({ ...a, [p.index]: Number(v) }))}
                  >
                    <SelectTrigger className="h-8 w-28 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: billCount + 1 }, (_, n) => n + 1).map((b) => (
                        <SelectItem key={b} value={String(b)}>
                          {b > billCount ? "New bill" : `Bill ${b}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !changed} onClick={() => onRegroup(groups)}>
                {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Read again with {groups.length} bill{groups.length === 1 ? "" : "s"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={onConfirm} disabled={busy || editing}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Import {documents.length} bill{documents.length === 1 ? "" : "s"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Discard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Thumb({
  photo,
  caption,
  muted,
  small,
}: {
  photo?: PhotoThumb;
  caption?: string;
  muted?: boolean;
  small?: boolean;
}) {
  const size = small ? "h-9 w-9" : "h-24 w-20";
  return (
    <div className={`shrink-0 ${muted ? "opacity-50" : ""}`}>
      <div className={`${size} overflow-hidden rounded border bg-muted grid place-items-center`}>
        {photo?.preview ? (
          <img src={photo.preview} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileText className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      {caption && (
        <div className="mt-1 w-20 truncate text-center text-[10px] text-muted-foreground">
          {caption}
        </div>
      )}
    </div>
  );
}
