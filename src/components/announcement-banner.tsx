/**
 * The line across the top of the app, when there is one to show.
 *
 * Dismissal is per device, in localStorage, keyed by the banner's id. Keeping
 * it client-side is the right trade here: the cost of a banner reappearing on
 * a second device is a shrug, and the alternative is a write to the database
 * every time anybody closes anything.
 *
 * Polled rather than pushed, like the plan notice, so a banner published now
 * reaches an open tab within the minute instead of at the next reload.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { getActiveAnnouncement, type Announcement } from "@/lib/broadcast.functions";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

const KEY = "dhela.dismissed-announcement";

const TONES = {
  info: "bg-primary/10 text-foreground border-primary/20",
  success: "bg-green-50 text-green-900 border-green-200",
  warning: "bg-amber-50 text-amber-900 border-amber-200",
} as const;

export function AnnouncementBanner() {
  const fetchActive = useServerFn(getActiveAnnouncement);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Read once on mount rather than during render: localStorage throws in some
  // embedded webviews and in private mode, and a banner is never worth taking
  // the whole app down for.
  useEffect(() => {
    try { setDismissed(localStorage.getItem(KEY)); } catch { /* no storage, show it */ }
  }, []);

  const { data: banner } = useQuery({
    queryKey: ["site_announcement"],
    queryFn: async () => (await fetchActive({})) as Announcement | null,
    refetchInterval: 60_000,
    retry: 1,
  });

  if (!banner || dismissed === banner.id) return null;

  const close = () => {
    setDismissed(banner.id);
    try { localStorage.setItem(KEY, banner.id); } catch { /* fine, it comes back */ }
  };

  const isInternal = banner.link_url?.startsWith("/");

  return (
    <div className={cn(
      "flex items-center gap-3 border-b px-4 py-2 text-sm print:hidden",
      TONES[banner.tone] ?? TONES.info,
    )}>
      <p className="flex-1">
        {banner.message}
        {banner.link_url && banner.link_label && (
          isInternal ? (
            <Link to={banner.link_url} className="ml-2 font-medium underline underline-offset-2">
              {banner.link_label}
            </Link>
          ) : (
            <a href={banner.link_url} target="_blank" rel="noreferrer noopener"
              className="ml-2 font-medium underline underline-offset-2">
              {banner.link_label}
            </a>
          )
        )}
      </p>
      {banner.dismissible && (
        <button onClick={close} aria-label="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
