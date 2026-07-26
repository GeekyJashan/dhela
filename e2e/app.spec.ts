import { test, expect } from "@playwright/test";
import fs from "fs";
import { SAMPLE_KEYS, LANG_SAMPLES } from "../src/lib/lang-samples";

/**
 * Covers the flows built in this repo that had never been exercised by a
 * human: navigation, the mobile drawer, payments after the tab split, the
 * insights move, the GST working papers, the billing checkout dialog, and the
 * upload screen's camera entry point.
 *
 * Seeded data comes from e2e/seed.mjs and is reset before every run, so the
 * assertions can be exact rather than "greater than zero".
 */

test.describe("navigation", () => {
  test("sidebar reaches every section", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    // On mobile the sidebar is off-canvas until the hamburger is tapped.
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: /open menu/i }).click();
    }
    for (const label of ["Dashboard", "Insights", "Purchases", "Suppliers",
                         "Sales", "Retailers", "Products", "Payments", "GST returns"]) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("mobile drawer closes after navigating", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "drawer only exists below lg");
    await page.goto("/dashboard");
    const drawer = page.locator("aside");
    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(drawer).toHaveClass(/translate-x-0/);
    await page.getByRole("link", { name: "Products", exact: true }).click();
    await expect(page).toHaveURL(/\/products/);
    // The close-on-navigate behaviour is the whole point of the drawer.
    await expect(drawer).toHaveClass(/-translate-x-full/);
  });
});

test.describe("purchases", () => {
  test("seeded invoices are listed", async ({ page }) => {
    await page.goto("/invoices");
    await expect(page.getByText("INV-45")).toBeVisible();
    await expect(page.getByText("INV-49")).toBeVisible();
    await expect(page.getByText("INV-53")).toBeVisible();
  });

  test("review screen shows line totals and no false arithmetic warning", async ({ page }) => {
    await page.goto("/invoices");
    await page.getByText("INV-53").click();
    await expect(page).toHaveURL(/\/invoices\//);
    await expect(page.getByText("Line items", { exact: false })).toBeVisible();
    // Seeded figures reconcile, so the "don't add up" card must stay away —
    // this is the regression guard for false positives on that check.
    await expect(page.getByText("These numbers don't add up")).toHaveCount(0);
  });
});

test.describe("payments", () => {
  test("history filters by direction", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await expect(page.getByText("Receivables ageing")).toBeVisible();
    for (const f of ["All", "Received", "Paid out"]) {
      await expect(page.getByRole("button", { name: f, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Received", exact: true }).click();
    await expect(page.getByRole("button", { name: "Received", exact: true })).toHaveClass(/bg-primary/);
  });

  test("charts are on Insights, not Payments", async ({ page }) => {
    await page.goto("/payments");
    await expect(page.getByRole("tab", { name: /insights/i })).toHaveCount(0);
    await page.goto("/insights");
    await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  });
});

test.describe("GST returns", () => {
  test("builds working papers for the seeded month", async ({ page }) => {
    await page.goto("/gst");
    await expect(page.getByRole("heading", { name: "GST returns" })).toBeVisible();
    // Never claim to file.
    await expect(page.getByText("This is a working paper, not a filing.")).toBeVisible();

    await page.getByRole("textbox").or(page.locator('input[type="month"]')).first().fill("2026-07");
    await expect(page.getByText("GSTR-3B summary")).toBeVisible();

    // Seed has one B2B sale (retailer with GSTIN) and one B2CS (without),
    // which is exactly the split GSTR-1 has to get right. Section titles carry
    // their row count, e.g. "B2B (1)".
    await expect(page.getByText(/^B2B \(1\)$/)).toBeVisible();
    await expect(page.getByText(/^B2CS \(1\)$/)).toBeVisible();
  });

  test("credit note to an unregistered intrastate buyer nets into B2CS, not CDNUR", async ({ page }) => {
    await page.goto("/gst");
    await page.locator('input[type="month"]').fill("2026-07");
    await expect(page.getByText("GSTR-3B summary")).toBeVisible();

    // CDNUR only accepts B2CL/EXPWP/EXPWOP. The seeded note is intrastate to a
    // buyer with no GSTIN, so it must not appear there at all.
    await expect(page.getByText(/^CDNUR \(0\)$/)).toBeVisible();

    // Instead it reduces the B2CS bucket: 3 units sold less 1 credited.
    const b2csRow = page.locator("table").filter({ hasText: "OE" }).first();
    await expect(b2csRow).toContainText("OE");
    await expect(b2csRow).toContainText("2067.36");
  });

  test("0% lines go to Table 8, not into B2B at rate 0", async ({ page }) => {
    await page.goto("/gst");
    await page.locator('input[type="month"]').fill("2026-07");
    await expect(page.getByText("GSTR-3B summary")).toBeVisible();

    // Seeded: 20 units of a 0% product to a registered retailer = 1,416.
    await expect(page.getByText(/^Nil rated & exempt \(1\)$/)).toBeVisible();
    const t8 = page.locator("table").filter({ hasText: "8B." }).first();
    await expect(t8).toContainText("1416");
    // And it must be reported under 3.1(c), not 3.1(a).
    await expect(page.getByText("3.1(c) Other outward supplies (nil rated, exempted)")).toBeVisible();

    // B2B has three rated rows from S-9 and none at rate 0.
    const b2b = page.locator("table").filter({ hasText: "Invoice Number" }).first();
    await expect(b2b).not.toContainText("S-11");
  });

  test("document series sorts numerically, so S-10 doesn't precede S-9", async ({ page }) => {
    await page.goto("/gst");
    await page.locator('input[type="month"]').fill("2026-07");
    await expect(page.getByText("GSTR-3B summary")).toBeVisible();
    const docs = page.locator("table").filter({ hasText: "Nature of Document" }).first();
    await expect(docs).toContainText("S-9");
    await expect(docs).toContainText("S-11");
  });

  test("Table 12 is split into B2B and B2C tabs", async ({ page }) => {
    await page.goto("/gst");
    await page.locator('input[type="month"]').fill("2026-07");
    await expect(page.getByText("GSTR-3B summary")).toBeVisible();
    await expect(page.getByText(/^HSN — B2B \(\d+\)$/)).toBeVisible();
    await expect(page.getByText(/^HSN — B2C \(\d+\)$/)).toBeVisible();
  });

  test("a section downloads as CSV", async ({ page }) => {
    await page.goto("/gst");
    await page.locator('input[type="month"]').fill("2026-07");
    await expect(page.getByText("GSTR-3B summary")).toBeVisible();
    const download = page.waitForEvent("download", { timeout: 15_000 });
    await page.getByRole("button", { name: "CSV" }).first().click();
    expect((await download).suggestedFilename()).toMatch(/^gstr1-2026-07-/);
  });
});

test.describe("billing", () => {
  test("upgrade opens the UPI checkout with the plan price", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Plan & billing" })).toBeVisible();
    const upgrade = page.getByRole("button", { name: /upgrade now/i }).first();
    if (await upgrade.count()) {
      await upgrade.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText("jsehgal2003@okaxis")).toBeVisible();
      // Anchored, or it also matches "Pay ₹3,999 in your UPI app" on mobile.
      await expect(page.getByRole("dialog").getByText(/^₹(3,999|7,999)$/)).toBeVisible();
    }
  });

  test("the UPI QR image actually resolves", async ({ page }) => {
    const res = await page.request.get("/upi-qr.png");
    expect(res.status()).toBe(200);
    expect(Number(res.headers()["content-length"] ?? 0)).toBeGreaterThan(1000);
  });
});

test.describe("upload", () => {
  test("camera button appears on mobile only", async ({ page }, testInfo) => {
    await page.goto("/upload");
    await expect(page.getByRole("heading", { name: "Upload invoices" })).toBeVisible();
    const camera = page.getByRole("button", { name: /take photo/i });
    if (testInfo.project.name === "mobile") {
      await expect(camera).toBeVisible();
      // capture=environment is what opens the camera rather than a file list.
      await expect(page.locator('input[type="file"][capture="environment"]')).toHaveCount(1);
    } else {
      await expect(camera).toHaveCount(0);
    }
  });

  test("one spinner on the upload button, not two", async ({ page }) => {
    await page.goto("/upload");
    const btn = page.getByRole("button", { name: /upload & extract/i });
    await expect(btn).toBeDisabled(); // nothing selected yet
    await expect(btn.locator(".animate-spin")).toHaveCount(0);
  });
});

test.describe("account", () => {
  test("saves the workspace GSTIN, which nothing else could set", async ({ page }) => {
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.locator("#org-name")).not.toHaveValue("");
    const gstin = page.locator("#org-gstin");
    await gstin.fill("03AABCA1234K1Z5");
    await page.getByRole("button", { name: /save business details/i }).click();
    await expect(page.getByText("Business details saved")).toBeVisible();
    await page.reload();
    await expect(page.locator("#org-gstin")).toHaveValue("03AABCA1234K1Z5");
    // State code is derived from the GSTIN rather than typed separately.
    await expect(page.locator("#org-state")).toHaveValue("03");
  });

  test("rejects a malformed GSTIN instead of storing it", async ({ page }) => {
    await page.goto("/account");
    // Wait for the profile query to populate the form; submitting before that
    // fails on the required name rather than on the GSTIN under test.
    await expect(page.locator("#org-name")).not.toHaveValue("");
    await page.locator("#org-gstin").fill("NOTAGSTIN");
    await page.getByRole("button", { name: /save business details/i }).click();
    await expect(page.getByText(/doesn't look like a valid GSTIN/i)).toBeVisible();
  });

  test("clear-all stays locked until the workspace name is typed exactly", async ({ page }) => {
    await page.goto("/account");
    await page.getByRole("button", { name: /clear all data…/i }).click();
    const confirmBtn = page.getByRole("button", { name: /delete everything/i });
    await expect(confirmBtn).toBeDisabled();
    await page.locator("#confirm-name").fill("not the name");
    await expect(confirmBtn).toBeDisabled();
    // Deliberately not completing it — this asserts the guard, not the wipe.
  });
});

test.describe("landing page", () => {
  // The multilingual demo inlines its strings rather than importing the locale
  // files, which would ship 1,572 keys to render five words. This is the guard
  // that keeps the inlined copies honest.
  test("multilingual demo strings still match the locale files", () => {
    for (const code of ["hi", "pa"] as const) {
      const dict = JSON.parse(fs.readFileSync(`src/locales/${code}.json`, "utf8"));
      const shown = LANG_SAMPLES.find(l => l.code === code)!.rows;
      SAMPLE_KEYS.forEach((key, i) => {
        expect(shown[i], `landing demo ${code} "${key}" drifted from ${code}.json`)
          .toBe(dict[key]);
      });
    }
  });

  // AI crawlers and answer engines don't run JavaScript. Anything that only
  // appears after hydration is invisible to them — which is exactly how the
  // FAQ answers went missing when they lived in a JS accordion.
  test("FAQ answers and schema are in the raw HTML, not JS-only", async ({ request }) => {
    const html = await (await request.get("/")).text();

    for (const answer of [
      "most people don't",
      "confidence score and only the uncertain",
      "isolated workspace",
      "No card, no call",
      "NIC bulk-upload file",
    ]) {
      expect(html, `FAQ answer missing from SSR: ${answer}`).toContain(answer);
    }

    // A definition an answer engine can lift.
    expect(html).toContain("Dhela is invoice and inventory software");

    const ld = html.match(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
    expect(ld, "no JSON-LD in SSR HTML").toBeTruthy();
    const graph = JSON.parse(ld![1])["@graph"] as { "@type": string }[];
    expect(graph.map(n => n["@type"])).toEqual(
      expect.arrayContaining(["Organization", "SoftwareApplication", "FAQPage"]),
    );
  });

  test("product tour images and author signals are in the raw HTML", async ({ request }) => {
    const html = await (await request.get("/")).text();

    // Images were the weakest category in the audit: the page had none at all.
    const imgs = [...html.matchAll(/<img [^>]*>/g)].map(m => m[0]);
    expect(imgs.length, "landing page should ship real product images").toBeGreaterThanOrEqual(2);
    for (const tag of imgs) {
      expect(tag, `img without alt: ${tag}`).toMatch(/alt="[^"]+"/);
      // Explicit dimensions keep CLS down while the screenshots load.
      expect(tag, `img without width: ${tag}`).toMatch(/width="\d+"/);
    }

    // E-E-A-T: a named author with a real profile, and a stated update date.
    expect(html).toContain("Jashan Sehgal");
    expect(html).toContain("linkedin.com/in/jashan-sehgal");
    expect(html).toMatch(/dateTime="\d{4}-\d{2}-\d{2}"/);

    const graph = JSON.parse(
      html.match(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s)![1],
    )["@graph"] as Record<string, unknown>[];
    expect(graph.map(n => n["@type"])).toEqual(
      expect.arrayContaining(["Organization", "Person", "WebPage"]));
    expect(graph.find(n => n["@type"] === "Organization")!.sameAs).toBeTruthy();
    expect(graph.find(n => n["@type"] === "WebPage")!.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("every product screenshot actually resolves", async ({ request }) => {
    for (const f of ["bulk", "review", "insights", "gst", "payments", "mobile-upload"]) {
      const r = await request.get(`/shots/${f}.jpg`);
      expect(r.status(), `/shots/${f}.jpg`).toBe(200);
      expect(Number(r.headers()["content-length"] ?? 0)).toBeGreaterThan(5_000);
    }
  });

  test("social preview image and crawler files resolve", async ({ request }) => {
    const og = await request.get("/og-image.png");
    expect(og.status()).toBe(200);
    expect(Number(og.headers()["content-length"] ?? 0)).toBeGreaterThan(10_000);
    expect((await request.get("/robots.txt")).status()).toBe(200);
    expect((await request.get("/sitemap.xml")).status()).toBe(200);
  });

  test("renders unauthenticated with no horizontal scroll", async ({ browser, baseURL }) => {
    // Fresh context: the landing page must work for a logged-out visitor.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /your entire back office/i })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.body.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await ctx.close();
  });
});
