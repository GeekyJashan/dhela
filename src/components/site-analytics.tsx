import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Heatmaps and session replay, on the marketing pages only.
 *
 * The constraint that shapes this: session replay records what is on the
 * screen. Inside the app that is a distributor's purchase bills, their
 * retailers' names, what they owe and what they paid. Sending that to a third
 * party so we can see where people click would be handing over our customers'
 * commercial data without them ever being asked, and no heatmap is worth it.
 *
 * So Clarity is loaded only while the visitor is on a public page, and told to
 * stop the moment they enter the app. Belt and braces on purpose: the load
 * gate stops it starting, the stop call handles a client-side navigation from
 * the landing page into a signed-in screen, which the gate alone would miss.
 *
 * Page counts come from Vercel Analytics instead, which records a path and a
 * referrer and no screen content, so it is safe everywhere.
 */

/** Anything not under here is signed-in territory. */
const PUBLIC = ["/", "/blog", "/auth"];

const isPublic = (path: string) =>
  PUBLIC.some(p => path === p || (p !== "/" && path.startsWith(`${p}/`)));

declare global {
  interface Window {
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] };
  }
}

export function SiteAnalytics() {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const loaded = useRef(false);

  useEffect(() => {
    const id = import.meta.env.VITE_CLARITY_ID;
    if (!id) return;

    if (!isPublic(pathname)) {
      // Navigated into the app. Stop recording rather than merely not starting.
      window.clarity?.("stop");
      return;
    }
    if (loaded.current) {
      window.clarity?.("start");
      return;
    }
    loaded.current = true;

    // Clarity's own snippet, inlined rather than pasted into the HTML head so
    // it cannot run before this check has decided whether it should.
    window.clarity = window.clarity || function (...args: unknown[]) {
      (window.clarity!.q = window.clarity!.q || []).push(args);
    };
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${id}`;
    document.head.appendChild(script);
  }, [pathname]);

  return null;
}
