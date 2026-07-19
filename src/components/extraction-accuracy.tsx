import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Level = "high" | "medium" | "low";

function levelOf(pct: number): Level {
  if (pct >= 90) return "high";
  if (pct >= 70) return "medium";
  return "low";
}

const TONE: Record<Level, string> = {
  high: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  low: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
};

/**
 * Shows how much you can trust the AI's reading of an invoice, as a coloured
 * "83% · Medium" pill. Hovering explains what the number means and how much
 * review the invoice needs — lower = read it more carefully before approving.
 */
export function ExtractionAccuracy({ value }: { value: number | null | undefined }) {
  const { t } = useTranslation();
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const pct = Number(value);
  const lvl = levelOf(pct);
  const short = { high: t("High"), medium: t("Medium"), low: t("Low") }[lvl];
  const advice = {
    high: t("High — the AI is confident it read this invoice correctly. A quick check is enough."),
    medium: t("Medium — mostly right, but review the key fields (amounts, HSN, GST %) before approving."),
    low: t("Low — the AI struggled to read this invoice. Review every line carefully before approving."),
  }[lvl];
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium cursor-help", TONE[lvl])}>
            {pct.toFixed(0)}% <span className="opacity-90">· {short}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs leading-relaxed">{advice}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Column/field label for extraction accuracy, with an info tooltip explaining it. */
export function ExtractionAccuracyLabel() {
  const { t } = useTranslation();
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-help">
            {t("Extraction accuracy")}
            <Info className="h-3 w-3 opacity-60" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs leading-relaxed">
          {t("How confident the AI is that it read this invoice correctly. The lower it is, the more carefully you should review the details before approving.")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
