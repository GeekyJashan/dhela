import { test, expect } from "@playwright/test";
import fs from "node:fs";

/**
 * What the app says when it breaks in front of somebody.
 *
 * Reported from production: "Something went wrong / Failed to fetch dynamically
 * imported module: .../products-CUaiTSkn.js", after turning wifi off and
 * opening a screen not visited that day. Two separate faults were behind it.
 *
 * The message was wrong: that text matches both a tab left open across a
 * deploy and a screen whose chunk was never cached, and the first version
 * checked the message before checking the connection. Somebody with their wifi
 * off would have been told the app had been updated, and then it would have
 * tried to reload, which offline cannot do.
 *
 * And the cause was real: the worker only held what had already passed through
 * it, so an unvisited screen had no chunk to serve. It precaches the whole app
 * now.
 */

test("the connection is checked before the message is read", async () => {
  const { classifyError } = await import("../src/lib/offline");
  const chunkFailure = new Error(
    "Failed to fetch dynamically imported module: https://dhela.in/assets/products-CUaiTSkn.js",
  );

  // Online, that text means a tab older than the deploy.
  expect(classifyError(chunkFailure)).toBe("stale");

  // Offline, the identical text means no signal, and saying "updated" would be
  // both wrong and unactionable. Order matters more than the pattern here.
  const nav = globalThis.navigator as { onLine: boolean } | undefined;
  const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { ...nav, onLine: false },
    configurable: true,
  });
  try {
    expect(classifyError(chunkFailure)).toBe("offline");
    expect(classifyError(new Error("anything at all"))).toBe("offline");
  } finally {
    if (had) Object.defineProperty(globalThis, "navigator", had);
  }

  // A genuine bug stays a genuine bug.
  expect(classifyError(new Error("Cannot read properties of undefined"))).toBe("unknown");
  expect(classifyError(new Error("NetworkError when attempting to fetch"))).toBe("offline");
});

test("each kind gets an answer the operator can act on", () => {
  const src = fs.readFileSync("src/routes/__root.tsx", "utf8");

  // Stale cannot be fixed by re-running the route: invalidate() and reset()
  // ask for the same missing file. Only fresh HTML has the new hashes.
  expect(src).toMatch(/if \(kind === "stale"\) window\.location\.reload\(\)/);
  // And it reloads itself, once, guarded so a second identical failure does not
  // become a loop that hides the real problem.
  expect(src).toMatch(/dhela\.reloaded-for-stale-chunk/);

  expect(src).toMatch(/No internet connection/);
  expect(src).toMatch(/Nothing you had already saved is lost/);
  // The exception text is what gets pasted into a WhatsApp message to us, so it
  // stays — just not as the headline.
  expect(src).toMatch(/Technical details/);
});

test("the worker precaches the whole app, not only what was visited", () => {
  // Emitted by the build now, not served statically, so the source of truth
  // is the template.
  const sw = fs.readFileSync("src/sw.template.js", "utf8");
  const vite = fs.readFileSync("vite.config.ts", "utf8");

  // The manifest has to be emitted during the build. Nitro bakes its
  // public-asset list, so a file written into .output/public afterwards is
  // served as a 404 and an edit to one already there is ignored. Both were
  // tried before this.
  expect(vite).toMatch(/asset-manifest\.json/);
  expect(vite).toMatch(/generateBundle/);
  expect(sw).toMatch(/asset-manifest\.json/);

  // addAll would drop the entire precache over one stale entry.
  expect(sw).not.toMatch(/cache\.addAll\(/);
  expect(sw).toMatch(/Promise\.allSettled/);
  // A static sw.js is byte-identical after every deploy, so the browser never
  // sees a new worker and serves the previous build's chunks forever. Verified
  // with two builds: waiting stayed false until the version was baked in.
  expect(sw).toMatch(/const VERSION = "__BUILD_VERSION__"/);
  expect(vite).toMatch(/fileName: "sw\.js"/);
  expect(vite).toMatch(/__BUILD_VERSION__/);

  // And it must not force itself over a running tab: activate clears the old
  // caches, which pulls out the chunks that tab is still using.
  expect(sw).not.toMatch(/^\s*self\.skipWaiting\(\);\s*$/m);
  expect(sw).toMatch(/if \(e\.data === "skip-waiting"\) self\.skipWaiting\(\)/);
  const root = fs.readFileSync("src/routes/__root.tsx", "utf8");
  expect(root).toMatch(/A new version of Dhela is ready/);
  expect(root).toMatch(/controllerchange/);
});
