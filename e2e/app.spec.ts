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
                         "Sales", "Retailers", "Products", "Payments", "GST returns",
                         "Billing", "Account"]) {
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

test.describe("sign up", () => {
  // /auth sends a signed-in visitor to /dashboard, so these have to run
  // logged out — the default storageState is an authenticated user.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the eye button reveals the password instead of submitting the form", async ({ page }) => {
    await page.goto("/auth");
    const field = page.locator("#signin-password");
    await field.fill("hunter2");
    await expect(field).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: /show password/i }).click();
    await expect(field).toHaveAttribute("type", "text");
    // A bare <button> in a <form> defaults to submit; peeking must not navigate.
    await expect(page).toHaveURL(/\/auth/);
    await expect(field).toHaveValue("hunter2");

    await page.getByRole("button", { name: /hide password/i }).click();
    await expect(field).toHaveAttribute("type", "password");
  });

  test("create workspace stays disabled until both passwords match", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: /create account/i }).click();

    const submit = page.getByRole("button", { name: /create workspace/i });
    await page.locator("#signup-email").fill("newdistributor@example.com");
    await page.locator("#signup-password").fill("secret123");
    await expect(submit).toBeDisabled();

    await page.locator("#signup-confirm").fill("secret124");
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
    await expect(submit).toBeDisabled();

    await page.locator("#signup-confirm").fill("secret123");
    await expect(page.getByText(/passwords do not match/i)).toBeHidden();
    await expect(submit).toBeEnabled();
  });

  // Supabase only returns a session from signUp when "Confirm email" is off.
  // With it on, the old code navigated to /dashboard anyway and the route
  // guard threw them back here with cleared fields and no explanation.
  // Stubbed rather than really registering, so the suite never writes to the
  // production auth table.
  test("a signup that needs email confirmation says so instead of bouncing", async ({ page }) => {
    await page.route("**/auth/v1/signup*", route =>
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ id: "stub", email: "newdistributor@example.com", session: null }),
      }));
    await page.route("**/auth/v1/token*", route =>
      route.fulfill({
        status: 400, contentType: "application/json",
        body: JSON.stringify({ error_code: "email_not_confirmed", msg: "Email not confirmed" }),
      }));

    await page.goto("/auth");
    await page.getByRole("tab", { name: /create account/i }).click();
    await page.locator("#signup-email").fill("newdistributor@example.com");
    await page.locator("#signup-password").fill("secret123");
    await page.locator("#signup-confirm").fill("secret123");
    await page.getByRole("button", { name: /create workspace/i }).click();

    await expect(page.getByText(/confirm your email/i)).toBeVisible();
    await expect(page.getByText("newdistributor@example.com")).toBeVisible();
    await expect(page).toHaveURL(/\/auth/);
  });

  test("a password under the Supabase minimum is caught before the round trip", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("tab", { name: /create account/i }).click();
    await page.locator("#signup-password").fill("abc");
    await page.locator("#signup-confirm").fill("abc");
    await expect(page.getByText(/at least 6 characters/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /create workspace/i })).toBeDisabled();
  });
});

test.describe("assistant", () => {
  // The stored answer is markdown because that is what the models emit. It
  // used to be printed raw, so users read "**₹1,42,500**".
  test("renders markdown instead of printing ** and pipes", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /ask ai/i }).click();

    const panel = page.getByRole("region", { name: "Dhela Assistant" });
    await expect(panel.locator("strong").filter({ hasText: "₹1,42,500" })).toBeVisible();
    await expect(panel.getByRole("cell", { name: "Shree Sanitary House" })).toBeVisible();
    await expect(panel.getByRole("listitem").filter({ hasText: /42 days past due/ })).toBeVisible();

    // The literal markers must be gone, not merely styled.
    await expect(panel.getByText("**", { exact: false })).toHaveCount(0);
    await expect(panel.getByText("|---|", { exact: false })).toHaveCount(0);
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
    const org = graph.find(n => n["@type"] === "Organization")!;
    // Name the company page specifically: a truthy check still passed when
    // sameAs held only the founder profile, which is the gap two audits flagged.
    // The vanity slug matters — /company/142985997 redirects a crawler to a
    // login wall, and /company/dhela is an unrelated company.
    expect(org.sameAs).toEqual(
      expect.arrayContaining(["https://www.linkedin.com/company/dhelaa/"]));
    expect(html).toContain("linkedin.com/company/dhelaa");
    expect((org.address as Record<string, string>).addressLocality).toBe("Jalandhar");
    expect(graph.find(n => n["@type"] === "WebPage")!.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("tour switches screens and keeps the golden connector on the live tab", async ({ page }) => {
    await page.goto("/");
    await page.locator("#tour").scrollIntoViewIfNeeded();
    const img = page.locator(".tour-img");
    const before = await img.getAttribute("src");

    const gstTab = page.locator("[data-tour-tab]", { hasText: "File your GST" });
    // This page is server-rendered, so the tab is in the DOM well before React
    // attaches its handler. Clicking that early lands on inert markup: nothing
    // moves, and because the auto-advance timer has not been created either,
    // nothing moves for the rest of the test. The connector's width comes from
    // a measurement effect, so a non-zero width means the component is live.
    await expect
      .poll(async () => (await page.locator(".tab-wire").boundingBox())?.width ?? 0,
        { timeout: 10_000, message: "tour should hydrate before the test drives it" })
      .toBeGreaterThan(0);
    await gstTab.click();
    await expect(img).not.toHaveAttribute("src", before!);
    await expect(img).toHaveAttribute("src", "/shots/gst.webp");

    // The connector is absolutely positioned and has to track the active tab in
    // both axes — the row wraps to three lines on a phone, where tracking only
    // x left it underneath the wrong tab.
    // Poll rather than sleep a fixed 800ms: the connector animates into place,
    // and on a loaded machine a fixed wait sampled it mid-transition. Clicking a
    // tab restarts the 6.5s auto-advance, so this window cannot span a slide
    // change.
    await expect
      .poll(async () => {
        const tab = (await gstTab.boundingBox())!;
        const wire = (await page.locator(".tab-wire").boundingBox())!;
        return Math.round(Math.max(
          Math.abs((tab.x + tab.width / 2) - (wire.x + wire.width / 2)),
          Math.abs((tab.y + tab.height) - wire.y),
        ));
      }, { timeout: 3_000, message: "golden connector should settle under the active tab" })
      .toBeLessThan(12);
  });

  test("every product screenshot actually resolves", async ({ request }) => {
    for (const f of ["bulk", "review", "insights", "gst", "payments", "mobile-upload"]) {
      const r = await request.get(`/shots/${f}.webp`);
      expect(r.status(), `/shots/${f}.webp`).toBe(200);
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
    await expect(page.getByRole("heading", { name: /invoices, stock and GST/i })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.body.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
    await ctx.close();
  });
});

test.describe("blog", () => {
  test("articles are in the raw HTML, not JS-only", async ({ request }) => {
    // Same reason the landing page's FAQ had to move out of an Accordion: AI
    // crawlers do not execute JavaScript, so an article rendered only after
    // hydration does not exist as far as they are concerned.
    const r = await request.get("/blog/gstr-1-b2b-b2cl-b2cs-explained");
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toContain("Notification 12/2024");   // a fact from mid-article
    expect(html).toContain("<table");                  // the tables carry the answers
    expect(html).toMatch(/<h2 id="/);                  // headings are anchorable
    expect(html).toContain('rel="canonical"');
  });

  test("article schema names an author and both dates", async ({ request }) => {
    const html = await (await request.get("/blog/e-way-bill-for-distributors")).text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)]
      .map(m => JSON.parse(m[1]));
    const article = blocks.find(b => b["@type"] === "BlogPosting");
    expect(article, "BlogPosting schema missing").toBeTruthy();
    expect(article.author.name).toBe("Jashan Sehgal");
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(article.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("an unknown slug 404s instead of returning an empty 200", async ({ request }) => {
    // A 200 with no content is worse than a 404: crawlers index the emptiness.
    expect((await request.get("/blog/no-such-post")).status()).toBe(404);
  });

  test("the blog is reachable from the landing page, not just the sitemap", async ({ request }) => {
    // An orphaned blog gets no internal links and no human visitors.
    expect(await (await request.get("/")).text()).toContain('href="/blog"');

    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("https://dhela.in/blog</loc>");
    expect(sitemap).toContain("/blog/gstr-1-b2b-b2cl-b2cs-explained");
  });

  test("index lists every post and each link resolves", async ({ page, request }) => {
    await page.goto("/blog");
    const links = page.locator('a[href^="/blog/"]');
    const n = await links.count();
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) {
      const href = await links.nth(i).getAttribute("href");
      expect((await request.get(href!)).status(), href!).toBe(200);
    }
  });

  test("renders with no horizontal scroll on a phone", async ({ browser, baseURL }) => {
    // The tables are wide by nature; they must scroll inside their own box.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL,
      viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto("/blog/gstr-1-b2b-b2cl-b2cs-explained");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(
      () => document.body.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await ctx.close();
  });
});
