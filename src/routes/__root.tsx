import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/react";
import { SiteAnalytics } from "@/components/site-analytics";
import { applySavedLanguage } from "@/i18n";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl text-foreground">404</h1>
        <p className="mt-4 text-muted-foreground">This page doesn't exist.</p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Back home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error("[root-error-boundary]", error);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Dhela - Invoice & Inventory Software for Indian Distributors" },
      {
        name: "description",
        content:
          "Dhela is invoice and inventory software for Indian distributors. AI reads every supplier bill, updates stock and true cost, raises GST invoices, prepares e-way bills and GSTR-1. English, Hindi, Punjabi. Free plan.",
      },
      {
        property: "og:title",
        content: "Dhela - Invoice & Inventory Software for Indian Distributors",
      },
      {
        property: "og:description",
        content:
          "AI reads every supplier bill, updates stock and true cost, raises GST invoices and prepares e-way bills. In English, हिंदी or ਪੰਜਾਬੀ. Free plan, no card.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://dhela.in/" },
      { property: "og:site_name", content: "Dhela" },
      { property: "og:locale", content: "en_IN" },
      { property: "og:image", content: "https://dhela.in/og-image.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Dhela - your entire back office, run by AI" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "twitter:title",
        content: "Dhela - Invoice & Inventory Software for Indian Distributors",
      },
      {
        name: "twitter:description",
        content:
          "AI reads every supplier bill, updates stock and true cost, raises GST invoices and prepares e-way bills. Free plan, no card.",
      },
      { name: "twitter:image", content: "https://dhela.in/og-image.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // No canonical here. A root-level one is emitted on every page and wins
      // over the child route's, so every blog post was declaring itself a
      // duplicate of the homepage — which tells Google to index the homepage
      // and drop the post. Each public route sets its own.
      { rel: "icon", href: "/dhela.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      // Redundant next to rel="icon", but several SEO crawlers still look for
      // the legacy rel before they will admit the site has a favicon.
      { rel: "shortcut icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "apple-touch-icon", href: "/icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      // The two faces the first screenful is set in. Fonts are fetched in CORS
      // anonymous mode even same-origin, so the preload has to say crossOrigin
      // or the browser fetches the file twice.
      {
        rel: "preload",
        href: "/fonts/inter-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      {
        rel: "preload",
        href: "/fonts/instrument-serif-latin.woff2",
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    applySavedLanguage();
  }, []);
  // Registered after paint so it never delays first render. Without it the app
  // shows a blank screen the moment signal drops, which reads as broken rather
  // than offline.
  useEffect(() => {
    if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.warn("[sw] registration failed", err));
    }, 1200);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      // Cached reads are one workspace's stock, parties and rates. On a shared
      // godown phone they must not outlive the session that fetched them.
      if (event === "SIGNED_OUT") {
        navigator.serviceWorker?.controller?.postMessage("clear-data-cache");
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors position="top-right" />
      {/* Page counts everywhere: a path and a referrer, no screen content, no
          cookie, so it is safe on the signed-in screens too. Heatmaps and
          replay are handled separately and stay off them. */}
      <Analytics />
      <SiteAnalytics />
    </QueryClientProvider>
  );
}
