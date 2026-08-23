import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { useTranslation } from "react-i18next";

/**
 * The wait while a bill is read.
 *
 * Reading several photos in one pass takes about a minute and a half, and a
 * lone spinner for that long reads as a hang — people reload, and reloading
 * mid-read is how you end up with the same bill twice.
 *
 * Every stage below names work that is genuinely happening in that window:
 * the model reading the rows, the page assignment being checked, the row count
 * being compared against the count the model itself made, each line's
 * arithmetic being re-derived, the totals being worked out. None of it is
 * invented to fill time. There is no percentage either, because the server
 * sends no progress and a number that precise would be a guess dressed up as a
 * fact. What is shown instead is elapsed time, which is true.
 *
 * The last stage is deliberately sticky. If the read runs longer than expected
 * the label stops advancing rather than sitting on "almost done", and past
 * roughly twice the expected time it says plainly that this one is slow.
 */

export type ProgressPhase = "uploading" | "reading" | "saving" | "batch";

/** Roughly how long each stage holds, in ms. Reading dominates on purpose. */
const READ_STAGES: { key: string; hold: number }[] = [
  { key: "Reading every line off the bill", hold: 26000 },
  { key: "Checking no page was missed", hold: 12000 },
  { key: "Counting rows against the bill's own count", hold: 14000 },
  { key: "Re-checking each line's arithmetic", hold: 16000 },
  { key: "Working out the totals", hold: 14000 },
];

const SAVE_STAGES: { key: string; hold: number }[] = [
  { key: "Matching your product catalogue", hold: 2500 },
  { key: "Saving the bill", hold: 2500 },
];

export function ExtractionProgress({
  phase, photos = 1, expectedMs, progress, onStop, stopping,
}: {
  phase: ProgressPhase;
  photos?: number;
  /** What "normal" looks like, so the copy can admit when it is not. */
  expectedMs?: number;
  /**
   * Real counts, for the queued path where the number finished is actually
   * known. When this is present the bar is determinate and the stage list goes
   * away, because there is no need to narrate something measurable.
   */
  progress?: { done: number; total: number };
  onStop?: () => void;
  stopping?: boolean;
}) {
  const { t } = useTranslation();
  const stages = phase === "saving" ? SAVE_STAGES : READ_STAGES;
  // Measured against these bills: one photo lands in fifteen to twenty five
  // seconds, two in about fifty, six in ninety. A flat budget meant a short
  // read never got past the first stage, so it scales with the work.
  const budget = expectedMs ?? (photos <= 1 ? 25_000 : 28_000 + (photos - 1) * 14_000);

  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  // One timer for both the clock and the stage, so they can never disagree.
  useEffect(() => {
    startedAt.current = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 500);
    return () => window.clearInterval(id);
  }, [phase]);

  // Stage holds are written for a typical read; stretch or squeeze them to the
  // budget so a single photo does not sit on stage one for half its life.
  const scale = budget / stages.reduce((s, x) => s + x.hold, 0);
  let acc = 0;
  const bounds = stages.map(s => (acc += s.hold * scale));
  const active = Math.min(bounds.findIndex(b => elapsed < b), stages.length - 1);
  const current = active === -1 ? stages.length - 1 : active;
  const overrunning = elapsed > budget * 1.6;

  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : null;

  return (
    <Card className="border-primary/30">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          {/* The mark itself, turning. A dhela is a small coin, and this is the
              one screen where the waiting IS the experience. */}
          <div className="hidden shrink-0 flex-col items-center pt-1 sm:flex" aria-hidden>
            <div className="coin-read-bob" style={{ perspective: 260 }}>
              {/* Two faces, not one. Rotating a single face past ninety degrees
                  shows the mark mirrored, which reads as a rendering glitch
                  rather than a coin. The reverse is the same mark turned a
                  half turn, so it comes up the right way round. */}
              <div className="coin-read-spin relative" style={{ width: 44, height: 44 }}>
                <span className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
                  <Logo size={44} withWordmark={false} idle={false} ambient />
                </span>
                <span
                  className="absolute inset-0"
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                >
                  <Logo size={44} withWordmark={false} idle={false} />
                </span>
              </div>
            </div>
            <div className="coin-read-shadow mt-2 h-1 w-7 rounded-[50%] bg-foreground/40 blur-[3px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="font-medium">
                {phase === "uploading"
                  ? t("Uploading {{n}} photo(s)…", { n: photos })
                  : phase === "batch"
                    ? t("Reading {{done}} of {{total}} bills…", {
                        done: progress?.done ?? 0, total: progress?.total ?? photos })
                  : phase === "saving"
                    ? t("Saving…")
                    : photos > 1
                      ? t("Reading {{n}} photos as one bill…", { n: photos })
                      : t("Reading the bill…")}
              </p>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-xs text-muted-foreground">
                  {Math.floor(elapsed / 1000)}s
                </span>
                {onStop && (
                  <Button variant="ghost" size="sm" onClick={onStop} disabled={stopping}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive">
                    <X className="mr-1 h-3.5 w-3.5" />
                    {stopping ? t("Stopping…") : t("Stop")}
                  </Button>
                )}
              </span>
            </div>

            <p className="mt-0.5 text-sm text-muted-foreground">
              {phase === "batch"
                ? t("Each bill is read on its own in the background. You can leave this page.")
                : overrunning
                ? t("This one is taking longer than usual. It is still going — leave the page open.")
                : photos > 1
                  ? t("All the pages go in one pass so they come back as a single bill. Usually about a minute or two.")
                  : t("Usually about half a minute.")}
            </p>

            {pct === null && (
            <ul className="mt-3 space-y-1.5" aria-live="polite">
              {stages.map((s, i) => {
                const done = i < current;
                const isNow = i === current;
                return (
                  <li
                    key={s.key}
                    className={`flex items-center gap-2 text-sm transition-opacity duration-500 ${
                      done ? "text-muted-foreground" : isNow ? "text-foreground" : "text-muted-foreground/40"
                    }`}
                  >
                    <span className="grid h-4 w-4 shrink-0 place-items-center">
                      {done ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : isNow ? (
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />
                      )}
                    </span>
                    <span className={isNow ? "font-medium" : ""}>{t(s.key)}</span>
                  </li>
                );
              })}
            </ul>
            )}

            {/* Indeterminate on purpose. The server reports no progress, so a
                filling bar would be inventing one. This only says "working". */}
            <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-muted">
              {pct === null ? (
                <div className="h-full w-1/3 animate-[progress-sweep_1.8s_ease-in-out_infinite] rounded-full bg-primary/70" />
              ) : (
                /* Determinate, because here the number finished is genuinely
                   known rather than inferred from a clock. */
                <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.max(4, pct)}%` }} />
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
