import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Sparkles, ArrowDown } from "lucide-react";

/** Briefly flash a value when it is auto-filled, so the user sees it happen. */
export function useFlash(): [boolean, () => void] {
  const [flash, setFlash] = useState(false);
  const trigger = () => { setFlash(false); requestAnimationFrame(() => setFlash(true)); };
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 1100);
    return () => clearTimeout(id);
  }, [flash]);
  return [flash, trigger];
}

/** Animated nudge telling the user to enter the GSTIN first to auto-fill. */
export function GstHint({ show, className }: { show: boolean; className?: string }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <div className={cn(
      "hint-glow flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary animate-in fade-in slide-in-from-top-1",
      className,
    )}>
      <Sparkles className="h-4 w-4 shrink-0 animate-pulse" />
      <span className="flex-1">{t("Tip: enter the GSTIN first — business name, address, city, state & GST status fill in automatically.")}</span>
      <ArrowDown className="h-4 w-4 shrink-0 animate-bounce" />
    </div>
  );
}

/**
 * Read-only "GST filer status" field: shows the taxpayer type (Regular /
 * Composition …) or "Defaulter" when the GSTIN isn't an active, compliant filer.
 * Auto-populated from the GSTIN lookup.
 */
export function GstFilerField({ status, rating, taxpayerType, flash, className }: {
  status?: string | null; rating?: string | null; taxpayerType?: string | null; flash?: boolean; className?: string;
}) {
  const { t } = useTranslation();
  const active = !status || status.toLowerCase() === "active";
  const isDefaulter = rating === "Defaulter" || !active;
  const label = isDefaulter ? t("Defaulter") : (taxpayerType || rating || null);
  const cls = isDefaulter
    ? "bg-red-100 text-red-800"
    : "bg-green-100 text-green-800";
  return (
    <div className={className}>
      <label className="text-xs text-muted-foreground">{t("GST filer status")}</label>
      <div className={cn("mt-1 h-9 flex items-center gap-2 px-3 rounded-md border bg-muted/30 text-sm", flash && "field-flash")}>
        {label ? (
          <>
            <Badge variant="secondary" className={cls}>{label}</Badge>
            {!isDefaulter && rating && rating !== "Unrated" && rating !== taxpayerType && (
              <span className="text-xs text-muted-foreground">· {t("Filer")}: {t(rating)}</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground/70">{t("Enter GSTIN to fetch")}</span>
        )}
      </div>
    </div>
  );
}
