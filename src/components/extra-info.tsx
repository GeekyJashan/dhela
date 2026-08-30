import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "react-i18next";
import { Archive } from "lucide-react";

/**
 * What a record carried over from the software the distributor used before.
 *
 * A Tally or Marg export has columns Dhela has no field for — a rack code, an
 * old ledger group, a salesman code. They are kept in the record's `extra`
 * jsonb rather than dropped, because a bin code is not derivable from anything
 * else and re-walking a godown to rebuild one is exactly the switching cost
 * that stops people moving.
 *
 * Fetched here, one record at a time, and deliberately not by the list queries
 * — they name their columns precisely so this blob does not ride along on a
 * catalogue of several thousand rows to be shown on none of them. This is the
 * "join only when you need it" half of that bargain.
 */

export type ExtraTable = "products" | "suppliers" | "retailers";

export function ExtraInfo({ table, id }: { table: ExtraTable; id: string | null | undefined }) {
  const { t } = useTranslation();

  const { data } = useQuery({
    queryKey: [table, id, "extra"],
    enabled: !!id,
    queryFn: async () => {
      // The table is chosen at runtime, which the generated per-table types
      // cannot express — the same escape hatch the importer uses.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from(table)
        .select("extra")
        .eq("id", id)
        .single();
      if (error) throw error;
      return (data?.extra ?? {}) as Record<string, string>;
    },
  });

  const entries = Object.entries(data ?? {});
  if (!entries.length) return null;

  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Archive className="h-3.5 w-3.5" />
        {t("From your old system")}
      </p>
      <dl className="mt-2 space-y-1 text-sm">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-x-2">
            {/* Their column heading, kept verbatim — it is the word they will
                go looking for. */}
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {/* Said plainly, because the difference between this and a real field is
          invisible otherwise, and someone will otherwise assume a cost kept
          here is costing their stock. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {t("Kept for reference only — not used in any pricing, stock or tax calculation.")}
      </p>
    </div>
  );
}
