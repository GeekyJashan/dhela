import { useEffect, useState } from "react";
import { WifiOff, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isOnline, queuedCount, subscribe, flushQueue } from "@/lib/offline";

/**
 * Says what is happening instead of letting the app look broken.
 *
 * Silent failure is what makes someone stop trusting software. A blank screen
 * and a red row read as "this thing is broken"; "offline, 12 photos waiting"
 * reads as "it is holding my work", which is what is actually true.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (!alive) return;
      setOnline(isOnline());
      setPending(await queuedCount());
    };
    refresh();
    const unsub = subscribe(refresh);
    // The queue is also drained by other tabs and by the upload screen itself,
    // so the count is re-read on a slow tick rather than trusted to events.
    const tick = window.setInterval(refresh, 5000);
    return () => {
      alive = false;
      unsub();
      window.clearInterval(tick);
    };
  }, []);

  // Coming back online is the moment the queue should move, wherever the
  // operator happens to be in the app.
  useEffect(() => {
    if (online && pending > 0) void flushQueue();
  }, [online, pending]);

  if (online && pending === 0) return null;

  return (
    <div
      role="status"
      className={`flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium ${
        online
          ? "bg-primary/15 text-foreground"
          : "bg-amber-500/20 text-amber-900 dark:text-amber-200"
      }`}
    >
      {online ? <UploadCloud className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {!online && pending === 0 && (
        <span>{t("No connection. You can still look things up; saving is paused.")}</span>
      )}
      {!online && pending > 0 && (
        <span>
          {t(
            "No connection. {{n}} photo(s) are waiting and will send themselves when you are back.",
            { n: pending },
          )}
        </span>
      )}
      {online && pending > 0 && (
        <span>{t("Sending {{n}} photo(s) that were waiting…", { n: pending })}</span>
      )}
    </div>
  );
}
