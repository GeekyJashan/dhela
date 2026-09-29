/**
 * Tells a workspace its plan changed.
 *
 * Mounted in the authenticated layout, so wherever the customer happens to be
 * when they next open Dhela, this is what they meet. It fires once per person
 * per change, which is why the acknowledgement is a row on the server rather
 * than a flag in localStorage: the same upgrade must not greet them again on
 * their phone, and clearing site data must not bring it back.
 *
 * An upgrade gets a moment. A downgrade gets a sentence. Confetti over
 * somebody dropping to Free would read as gloating.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getPlanNotice, dismissPlanNotice, type PlanNotice } from "@/lib/billing.functions";
import { PLANS } from "@/lib/plans";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sparkles, ScanLine, Mic, CalendarCheck, ArrowRight } from "lucide-react";

/**
 * Brand gold and the deep teal, so the paper belongs to Dhela.
 *
 * Every one of these has to hold its own against a cream card. A pale tint
 * that looks pretty in a palette disappears completely here, which thins the
 * burst without anybody being able to say why.
 */
const CONFETTI_COLORS = [
  "oklch(0.78 0.14 65)",
  "oklch(0.68 0.16 55)",
  "oklch(0.42 0.09 200)",
  "oklch(0.62 0.12 195)",
  "oklch(0.86 0.13 85)",
];

/** Deterministic spread, worked out once, so a re-render does not reshuffle it. */
function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => ({
        left: `${(i * 97) % 100}%`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        drift: `${(((i * 53) % 80) - 40) / 1}px`,
        spin: `${360 + ((i * 131) % 720)}deg`,
        fall: `${2.2 + ((i * 7) % 16) / 10}s`,
        delay: `${((i * 41) % 90) / 100}s`,
        width: i % 4 === 0 ? "6px" : "8px",
        height: i % 3 === 0 ? "10px" : "14px",
      })),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {bits.map((b, i) => (
        <span
          key={i}
          className="confetti-bit"
          style={{
            left: b.left,
            background: b.color,
            width: b.width,
            height: b.height,
            animationDelay: b.delay,
            ["--drift" as string]: b.drift,
            ["--spin" as string]: b.spin,
            ["--fall" as string]: b.fall,
          }}
        />
      ))}
    </div>
  );
}

function Perk({ icon: Icon, children }: { icon: typeof ScanLine; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span>{children}</span>
    </li>
  );
}

export function PlanNoticeDialog() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fetchNotice = useServerFn(getPlanNotice);
  const dismiss = useServerFn(dismissPlanNotice);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const { data: notice } = useQuery({
    queryKey: ["plan_notice"],
    queryFn: async () => (await fetchNotice()) as PlanNotice | null,
    // A minute is soon enough for something that happens a few times a month,
    // and React Query also refetches on window focus, which is the case that
    // actually matters: the customer who sent the payment screenshot and keeps
    // coming back to the tab to see whether it landed.
    refetchInterval: 60_000,
    // Never a reason to interrupt somebody the moment their connection returns
    // with a stale question; the poll will come round again.
    retry: 1,
  });

  useEffect(() => { if (notice) setOpen(true); }, [notice]);

  const close = async () => {
    setOpen(false);
    setClosing(true);
    try {
      await dismiss({});
      // The plan gates AI limits and voice, and billing_info is already cached
      // from before the change. Drop both so the app reflects what they now have
      // without a reload.
      await qc.invalidateQueries({ queryKey: ["plan_notice"] });
      await qc.invalidateQueries({ queryKey: ["billing_info"] });
    } catch {
      // If the acknowledgement does not land, the dialog returns on the next
      // poll. Annoying, and better than silently losing the news.
    } finally {
      setClosing(false);
    }
  };

  if (!notice) return null;

  const planName = PLANS[notice.plan].name;
  const upgrade = notice.direction === "upgrade";

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) close(); }}>
      <DialogContent className="max-w-md overflow-hidden text-center">
        {upgrade && <Confetti />}

        <div className="relative pt-2">
          {/* Gold and a sparkle are for good news only. The same pill on a
              downgrade congratulates somebody on losing something. */}
          <div className={cn(
            "plan-badge-in relative mx-auto inline-flex items-center gap-2 overflow-hidden rounded-full px-4 py-1.5 border",
            upgrade ? "border-accent/40 bg-accent/10" : "border-border bg-muted",
          )}>
            {upgrade && <Sparkles className="h-4 w-4 text-accent" />}
            <span className="font-display text-lg">{planName}</span>
            {upgrade && <span aria-hidden className="plan-badge-sheen absolute inset-0" />}
          </div>

          <h2 className="font-display mt-4 text-2xl">
            {upgrade
              ? t("You are on {{plan}} now", { plan: planName })
              : t("Your plan is now {{plan}}", { plan: planName })}
          </h2>

          <p className="text-muted-foreground mx-auto mt-1.5 max-w-xs text-sm">
            {upgrade
              ? t("Your workspace moved up from {{from}}. Thank you for backing Dhela.", {
                  from: PLANS[notice.previousPlan].name,
                })
              : t("Everything you have recorded stays exactly as it is. Only the monthly allowance changes.")}
          </p>

          <ul className="mt-5 space-y-2.5 text-left mx-auto inline-block">
            <Perk icon={ScanLine}>
              {t("{{n}} AI bill reads a month", { n: notice.aiPerMonth })}
            </Perk>
            {notice.voiceMinutesPerMonth > 0 && (
              <Perk icon={Mic}>
                {t("{{n}} minutes of voice a month", { n: notice.voiceMinutesPerMonth })}
              </Perk>
            )}
            {notice.planValidTill && (
              <Perk icon={CalendarCheck}>
                {t("Valid till {{date}}", { date: notice.planValidTill })}
              </Perk>
            )}
          </ul>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
            <Button variant="outline" onClick={close} disabled={closing}>
              {t("Got it")}
            </Button>
            {/* Closing before navigating, so the acknowledgement is recorded
                even though the dialog is on its way off screen. */}
            <Link to="/billing" onClick={close}>
              <Button className="w-full sm:w-auto" disabled={closing}>
                {t("See what is included")}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
