import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

/**
 * Emits the list of built client assets so the service worker can precache the
 * whole app rather than only what has been visited.
 *
 * It has to be emitted *during* the build, not written afterwards: Nitro bakes
 * its public-asset list at build time, so a file dropped into .output/public
 * later is served as a 404, and editing one that is already there is ignored.
 * Both were tried.
 *
 * Client bundle only. The server build has its own chunks and none of them are
 * ever fetched by a browser.
 */
function swAssetManifest() {
  return {
    name: "dhela-sw-asset-manifest",
    apply: "build" as const,
    generateBundle(
      this: { emitFile: (f: Record<string, unknown>) => void },
      _opts: unknown,
      bundle: Record<string, { fileName: string }>,
    ) {
      const assets = Object.values(bundle)
        .map((c) => c.fileName)
        .filter((f) => /\.(js|css|woff2)$/.test(f) && !f.startsWith("_"))
        .map((f) => `/${f}`);
      if (!assets.length) return;
      this.emitFile({
        type: "asset",
        fileName: "asset-manifest.json",
        source: JSON.stringify({ version: Date.now().toString(36), assets }),
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // Vite only exposes .env values on import.meta.env; server functions read
  // process.env (SUPABASE_SERVICE_ROLE_KEY, EXTRACTION_API_URL, …), so copy
  // them over. Real environment variables still win.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    server: { host: "::", port: 8080 },
    build: {
      rollupOptions: {
        output: {
          // The landing page was fetching 28 scripts, 20 of them a single SVG
          // each, because every lucide icon got its own chunk. Grouping the two
          // sets below took it to 8. Everything else keeps the bundler's own
          // route splitting — the point is to stop paying a round trip for
          // 700-byte files, not to build one big bundle.
          manualChunks(id: string) {
            if (id.includes("node_modules/lucide-react")) return "icons";
            // React and the tiny shims that always load with it.
            if (
              /node_modules\/(react|react-dom|scheduler|use-sync-external-store|tslib)\//.test(id)
            ) {
              return "react";
            }
            // The three components the public page shares with the app. Named
            // one by one on purpose: grouping all of src/components would drag
            // the authenticated screens' code onto the landing page, and
            // grouping all of components/ui would drag in every shadcn
            // primitive for the sake of one button.
            if (/\/src\/components\/(ui\/button|logo|reveal)\.tsx$/.test(id)) return "ui";
            // Every article's rendered HTML lives in blog-data. Two route chunks
            // share it, so the bundler hoisted it into the entry — putting all
            // three articles in front of every landing-page visitor. Its own
            // chunk means it loads only when a /blog route does.
            if (id.includes("/src/lib/blog-data")) return "blog-data";
          },
        },
      },
    },
    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      // src/server.ts wraps SSR errors; nitro builds a plain Node server
      // locally. Vercel builds are auto-detected (VERCEL=1); NITRO_PRESET
      // still overrides for any other host (netlify, cloudflare, …).
      tanstackStart({ server: { entry: "server" } }),
      ...(command === "build"
        ? [
            nitro({
              preset: process.env.NITRO_PRESET ?? (process.env.VERCEL ? "vercel" : "node-server"),
            }),
          ]
        : []),
      viteReact(),
      swAssetManifest(),
    ],
  };
});
