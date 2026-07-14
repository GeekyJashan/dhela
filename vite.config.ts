import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

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
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      // src/server.ts wraps SSR errors; nitro builds a plain Node server
      // locally. Set NITRO_PRESET=vercel (or netlify, …) on the host to
      // target its serverless output instead.
      tanstackStart({ server: { entry: "server" } }),
      ...(command === "build" ? [nitro({ preset: process.env.NITRO_PRESET ?? "node-server" })] : []),
      viteReact(),
    ],
  };
});
