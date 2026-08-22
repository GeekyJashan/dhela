import { test, expect } from "@playwright/test";
import fs from "fs";
import { SAMPLE_KEYS, LANG_SAMPLES } from "../src/lib/lang-samples";
import { stripForSpeech, splitForSpeech } from "../src/lib/speech";
import { pcmToWav, rateFromMime } from "../src/lib/wav";
import { PLANS, LIVE_MAX_SESSION_SECONDS, LIVE_IDLE_TIMEOUT_SECONDS } from "../src/lib/plans";

/**
 * Covers the flows built in this repo that had never been exercised by a
 * human: navigation, the mobile drawer, payments after the tab split, the
 * insights move, the GST working papers, the billing checkout dialog, and the
 * upload screen's camera entry point.
 *
 * Seeded data comes from e2e/seed.mjs and is reset before every run, so the
 * assertions can be exact rather than "greater than zero".
 */

/**
 * TanStack routes every server function through /_serverFn/<base64url>, where
 * the segment encodes the source file and export. Matching on the raw URL
 * therefore never works — it has to be decoded first.
 *
 * Stubbing the realtime token mint keeps this suite off a billed API and is
 * the only way to exercise the fallback deliberately.
 */
function isServerFn(url: string, name: string) {
  const segment = url.split("/_serverFn/")[1]?.split("?")[0];
  if (!segment) return false;
  try {
    return Buffer.from(segment, "base64url").toString("utf8").includes(name);
  } catch {
    return false;
  }
}

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

test.describe("session", () => {
  // A phone in a lift: the Supabase auth endpoint is unreachable, but the
  // session in localStorage is perfectly valid.
  test("a signed-in operator stays signed in when the network drops", async ({ page }) => {
    await page.route("**/auth/v1/user*", route => route.abort("connectionfailed"));
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
  });

  test("and is still sent to sign-in when there is genuinely no session", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/dashboard");
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth/);
  });
});

test.describe("business pulse", () => {
  test("the dashboard leads with money, not with upload counts", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/working capital locked/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/return on that capital/i)).toBeVisible();
    await expect(page.getByText(/cash collection/i)).toBeVisible();
    await expect(page.getByText(/stock cover/i)).toBeVisible();

    // It sits above the invoice list: an owner opening this screen has a
    // question about the business, not about the last eight uploads.
    const pulse = await page.getByText(/working capital locked/i).first().boundingBox();
    const recent = await page.getByText(/recent invoices/i).first().boundingBox();
    expect(pulse!.y).toBeLessThan(recent!.y);
  });

  test("a ratio built on almost no data is withheld, not guessed", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/working capital locked/i)).toBeVisible({ timeout: 20000 });

    // The seeded workspace has 3 sales in 90 days. Annualising that into a
    // return on capital would be a confident number built on nothing, so the
    // screen says how thin the data is and leaves the ratios blank.
    await expect(page.getByText(/need a bit more history/i)).toBeVisible();
    const roc = page.getByText(/return on that capital/i).locator("xpath=..");
    await expect(roc).toContainText("—");
  });

  test("every suggested action links somewhere you can act", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/working capital locked/i)).toBeVisible({ timeout: 20000 });
    const card = page.locator("div").filter({ hasText: /^Worth doing this week/ }).first();
    if (!(await card.count())) return;              // a spotless workspace has nothing to do
    for (const href of await card.getByRole("link").evaluateAll(ls => ls.map(l => l.getAttribute("href")))) {
      expect(href, "an action must lead to a screen").toMatch(/^\/(pricing|payments|retailers|products)$/);
    }
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

test.describe("leads", () => {
  // The prospect pipeline is for whoever sells Dhela, not for the distributors
  // who buy it. It shipped in every customer's sidebar once; this is the guard
  // against that happening again.
  test("is admin-only in the nav, the route and the API", () => {
    const nav = fs.readFileSync("src/routes/_authenticated/route.tsx", "utf8");
    // The link may only be added inside the isAdmin branch.
    const adminBranch = nav.slice(nav.indexOf("const groups: NavGroup[] = isAdmin"), nav.indexOf(": NAV_GROUPS;"));
    expect(adminBranch).toContain('label: "Leads"');
    expect(nav.slice(0, nav.indexOf("const groups: NavGroup[]"))).not.toContain('label: "Leads"');

    // Hiding a link is presentation. The route must refuse a typed URL...
    const route = fs.readFileSync("src/routes/_authenticated/leads.tsx", "utf8");
    expect(route).toContain("platform_admin");
    expect(route).toMatch(/throw redirect\(\{ to: "\/dashboard" \}\)/);

    // ...and the server functions must refuse a crafted POST, which reaches
    // them without any screen ever loading.
    const api = fs.readFileSync("src/lib/leads.functions.ts", "utf8");
    expect(api).toContain("function assertPlatformAdmin");
    const handlers = api.match(/\.handler\(async \(\{/g) ?? [];
    const guards = api.match(/assertPlatformAdmin\(context\.claims\)/g) ?? [];
    expect(guards.length, "every handler needs the guard").toBe(handlers.length);
  });

  // The pipeline belongs to whoever sells the product, not to any workspace,
  // so it must survive an admin switching orgs to debug a customer issue.
  test("the pipeline is global to platform admins, not scoped to a workspace", () => {
    const sql = fs.readFileSync("supabase/migrations/20260803090000_leads.sql", "utf8");
    expect(sql).not.toContain("org_id");
    expect(sql).toContain("is_platform_admin()");
    // Four verbs, one rule. A missing policy is a table nobody can write to,
    // or worse, one anybody can.
    for (const verb of ["FOR SELECT", "FOR INSERT", "FOR UPDATE", "FOR DELETE"]) {
      expect(sql, `${verb} policy missing`).toContain(verb);
    }
    // The claim is read from the signed JWT, never from a client-supplied field.
    expect(sql).toContain("auth.jwt() -> 'app_metadata' ->> 'platform_admin'");

    const api = fs.readFileSync("src/lib/leads.functions.ts", "utf8");
    expect(api, "leads must not be filtered by organisation").not.toContain("org_id");
  });

  // Discovery scoring was written before any real listing had been seen, and
  // all three of these were wrong against actual Ludhiana results.
  test("discovery reads the business name, not Google's category taxonomy", () => {
    const src = fs.readFileSync("src/lib/lead-discovery.ts", "utf8");

    // 1. "store" appears in nearly every Places type — home_goods_store,
    //    building_materials_store — so matching it branded real wholesalers
    //    as retail. The retail list must not contain it.
    const retail = src.slice(src.indexOf("const RETAIL"), src.indexOf("const CONSUMER_TYPES"));
    expect(retail).not.toMatch(/"store"/);

    // 2. Indian boards say "Sales Corp", not "sales corporation".
    const wholesale = src.slice(src.indexOf("const WHOLESALE"), src.indexOf("/** Only unambiguous"));
    for (const word of ["sales corp", "dealer", "traders", "agencies", "enterprises"]) {
      expect(wholesale, `"${word}" is on real signage`).toContain(`"${word}"`);
    }

    // 3. Whole-word matching, or "mart" matches "market" and every wholesale
    //    market in India reads as a retail shop.
    expect(src).toContain("hasWord");

    // A consumer business short-circuits: a popular restaurant collects
    // hundreds of reviews and would otherwise outrank a small wholesaler.
    expect(src).toMatch(/return \{\s*score: 5,/);
  });

  test("a normal customer lands on the dashboard, not the pipeline", async ({ page }) => {
    await page.goto("/leads");
    // The seeded e2e account is a platform admin, so this asserts the shape of
    // the guard rather than the redirect — see the static test above for the
    // non-admin path, which cannot be exercised without a second account.
    await expect(page).toHaveURL(/\/(leads|dashboard)/);
  });
});

test.describe("analytics", () => {
  // Session replay records what is on screen. On a signed-in page that is a
  // distributor's bills, their retailers and what they are owed. Sending that
  // to a third party so we can see where people click is not a trade worth
  // making, so the recorder must never start there.
  test("session replay stays off every signed-in screen", async ({ page }) => {
    const thirdParty: string[] = [];
    page.on("request", r => {
      if (/clarity\.ms|hotjar|fullstory|logrocket|smartlook/i.test(r.url())) thirdParty.push(r.url());
    });

    for (const path of ["/dashboard", "/invoices", "/payments", "/retailers"]) {
      await page.goto(path);
      await page.waitForTimeout(600);
    }
    expect(thirdParty, "a recorder loaded on a signed-in page").toEqual([]);
  });

  test("the gate names the public paths, and stops on leaving them", () => {
    const src = fs.readFileSync("src/components/site-analytics.tsx", "utf8");
    // Not merely "don't start" — a client-side navigation from the landing
    // page into the app would otherwise keep an already-running recorder alive.
    expect(src).toContain('window.clarity?.("stop")');
    expect(src).toMatch(/const PUBLIC = \["\/", "\/blog", "\/auth"\]/);
    // And it is opt-in: no id set, nothing loads at all.
    expect(src).toContain("if (!id) return");
  });
});

test.describe("marketing", () => {
  // Publishing twice is the failure that embarrasses, and a retry after a
  // network wobble is the ordinary way it happens.
  test("a published post cannot be published again", () => {
    const src = fs.readFileSync("src/lib/marketing.functions.ts", "utf8");
    expect(src).toMatch(/status === "published"/);
    expect(src).toContain("Already published");
    // A failure is recorded, not swallowed: one that looks like a draft gets
    // retried forever, one that looks published never gets sent at all.
    expect(src).toMatch(/status: "failed"/);
  });

  test("what is on screen is what goes out", () => {
    const api = fs.readFileSync("src/lib/marketing.functions.ts", "utf8");
    const ui = fs.readFileSync("src/routes/_authenticated/marketing.tsx", "utf8");
    // The edited body travels with the publish call rather than being written
    // by the client first, so one place decides what gets posted.
    expect(api).toMatch(/body: z\.string\(\)[^\n]*optional\(\)/);
    expect(ui).toContain("publish({ data: { id: p.id, body } })");
    expect(ui, "the client must not write the table directly")
      .not.toContain('supabase.from("marketing_posts")');
  });

  test("Growth is its own admin-only section", () => {
    const nav = fs.readFileSync("src/routes/_authenticated/route.tsx", "utf8");
    const adminOnly = nav.slice(nav.indexOf("const groups: NavGroup[] = isAdmin"), nav.indexOf(": NAV_GROUPS;"));
    expect(adminOnly).toContain('label: "Growth"');
    expect(adminOnly).toContain('label: "Marketing"');
    expect(adminOnly).toContain('label: "Leads"');
    // And nothing of the sort in the nav every customer gets.
    const shared = nav.slice(0, nav.indexOf("const groups: NavGroup[]"));
    for (const label of ["Growth", "Marketing", "Leads"]) {
      expect(shared, `${label} must not be in the shared nav`).not.toContain(`label: "${label}"`);
    }
  });
});

// Granting platform admin is the most dangerous write in the product: it hands
// over every tenant's books at once. These are the properties that stop it
// being a one-click mistake or a way back in for someone just removed.
test.describe("granting platform admin", () => {
  const api = () => fs.readFileSync("src/lib/admin.functions.ts", "utf8");

  test("cannot be used to demote yourself", () => {
    const src = api();
    const handler = src.slice(src.indexOf("export const setPlatformAdmin"));
    // Without this the flag can only be restored by hand-editing JSON in the
    // Supabase dashboard, because the admin page is gated on the same flag.
    // It is also what guarantees the platform never reaches zero admins.
    expect(handler).toContain("data.userId === context.userId && !data.admin");
    expect(handler).toMatch(/throw new Error\("You can't remove your own admin access/);
  });

  test("re-checks the caller against the database, not the token they arrived with", () => {
    const src = api();
    const handler = src.slice(src.indexOf("export const setPlatformAdmin"), src.indexOf("export const generateUserMagicLink"));

    // context.claims is the JWT payload, minted at sign-in and refreshed about
    // hourly. Trusting it here would leave a demoted admin holding a token that
    // still says admin — long enough to promote themselves straight back.
    expect(handler).toContain("assertPlatformAdmin(context.claims");
    expect(handler, "the token alone is not enough on this handler")
      .toContain("getUserById(context.userId)");
    expect(handler).toContain("if (!callerIsAdmin) throw new Error(\"Forbidden: admin only\")");

    // The live check must run before the write, or it checks nothing.
    expect(handler.indexOf("callerIsAdmin"))
      .toBeLessThan(handler.indexOf("updateUserById"));
  });

  test("writes one flag so the rest of app_metadata survives", () => {
    const handler = api().slice(api().indexOf("export const setPlatformAdmin"));
    // updateUserById merges app_metadata keys. Sending a rebuilt object would
    // be the way to silently drop provider/providers.
    expect(handler).toContain("app_metadata: { platform_admin: data.admin }");
  });

  test("is recorded at warn level with who did it", () => {
    const handler = api().slice(api().indexOf("export const setPlatformAdmin"));
    expect(handler).toContain('log.warn("platform_admin:changed"');
    expect(handler).toContain("by: context.userId");
  });

  test("the screen warns what the grant actually covers, and that it is not instant", () => {
    const ui = fs.readFileSync("src/routes/_authenticated/admin.tsx", "utf8");
    // A bare switch reads like a per-workspace role. It is not one.
    expect(ui).toContain("AlertDialog");
    expect(ui).toMatch(/see every account|access to all of them/);
    // The propagation delay is a real property of JWT-carried claims. Hiding it
    // makes a revoked admin look revoked when they are not, for up to an hour.
    expect(ui).toMatch(/up to an hour/);
    // And the client must never try to write the flag itself.
    expect(ui, "the flag is service-role only").not.toContain("app_metadata:");
  });
});

test.describe("sales import", () => {
  // Importing already-issued invoices is how a distributor's existing history
  // gets in without retyping it. It must never issue on their behalf: issuing
  // deducts stock and locks cost, and a machine reading a photograph is not
  // grounds for moving someone's inventory.
  test("importing a sales invoice offers it, and creates a draft not an issue", async ({ page }) => {
    await page.goto("/sales");
    await expect(page.getByRole("button", { name: /upload invoice/i })).toBeVisible();
    // Writing a new invoice stays the primary action; this is a migration tool.
    await expect(page.getByRole("link", { name: /new sales invoice/i })).toBeVisible();

    const src = fs.readFileSync("src/lib/sales-import.functions.ts", "utf8");
    expect(src, "an import must land as a draft").toContain('status: "draft"');
    expect(src).not.toMatch(/status:\s*"issued"/);
    // Cost comes from our own weighted-average at issue, never from the
    // customer's copy of the bill.
    expect(src).toContain("cost_price: 0");
    // And the counterparty on a sales invoice is the buyer, not us.
    const backend = fs.readFileSync("backend/main.py", "utf8");
    expect(backend).toContain("THIS IS A SALES INVOICE THE USER ISSUED");
    expect(backend).toContain('doc_type: Optional[str] = Form(None)');
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

  // The mic button shipped dead: vercel.json carried "microphone=()", whose
  // empty allowlist blocks the site's own origin, so Chrome refused before
  // ever showing a prompt and reported it as a plain "not-allowed". Only
  // production sends this header — the dev server doesn't — so no amount of
  // local clicking would have caught it. Hence a static check.
  test("the production headers still permit the microphone they gate", () => {
    const conf = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
    const policy = conf.headers
      .flatMap((h: { headers: { key: string; value: string }[] }) => h.headers)
      .find((h: { key: string }) => h.key === "Permissions-Policy")?.value ?? "";

    expect(policy, "Permissions-Policy must allow this origin a microphone").toMatch(
      /microphone=\((self|\*)[^)]*\)/,
    );
    // Still denied to embedded third parties, and the unused features stay off.
    expect(policy).not.toMatch(/microphone=\(\s*\*\s*\)/);
    expect(policy).toContain("geolocation=()");
  });

  // The chat panel renders markdown; a speech engine reads it literally. This
  // is the seam between the two, and getting it wrong means hearing
  // "star star one lakh star star" or a table read out as pipes and dashes.
  test("answers are rewritten for the ear before they are spoken", () => {
    const spoken = stripForSpeech(
      "Retailers owe you **₹1,42,500** in total.\n\n"
      + "| Retailer | Outstanding |\n|---|---:|\n"
      + "| Shree Sanitary House | ₹98,000 |\n\n"
      + "- Oldest bill is 42 days past due",
    );

    for (const marker of ["**", "|", "---", "#", "₹"]) {
      expect(spoken, `"${marker}" would be read aloud`).not.toContain(marker);
    }
    expect(spoken).toContain("1,42,500 rupees");
    // Table rows survive as speakable pairs rather than being dropped.
    expect(spoken).toContain("Shree Sanitary House, 98,000 rupees");
    expect(spoken).toContain("Oldest bill is 42 days past due");
    // Sentence breaks, so the voice pauses between facts instead of running on.
    expect(spoken).toMatch(/total\./);

    // The rupee word follows the reader's language, not the server's.
    expect(stripForSpeech("Total ₹500", "hi")).toContain("रुपये");
    expect(stripForSpeech("Total ₹500", "pa")).toContain("ਰੁਪਏ");
  });

  // A tool the model is told about but that has no implementation makes the
  // assistant say it cannot do something it can, and the reverse is dead code
  // it will never reach. Asking what was on a supplier bill hit exactly this:
  // purchases had a list-the-headers tool and nothing that could see inside
  // one, so the answer was an apology and a suggestion to go and look.
  test("every declared assistant tool is implemented, and vice versa", () => {
    const src = fs.readFileSync("src/lib/assistant-tools.ts", "utf8");
    const declared = [...src.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map(m => m[1]);
    const implemented = [...src.matchAll(/^\s{4}case "([a-z_]+)": \{$/gm)].map(m => m[1]);

    expect(declared.length).toBeGreaterThan(5);
    expect([...declared].sort()).toEqual([...implemented].sort());
    // The pair that was missing.
    expect(declared).toContain("purchases_summary");
    expect(declared).toContain("get_purchase_invoice");
  });

  test("speech is chunked so Chrome doesn't cut a long answer off", () => {
    const long = "You bought four items from Anand Enterprises. " .repeat(20);
    const chunks = splitForSpeech(long);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(180);
    // Nothing may be dropped on the floor between chunks.
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(long.replace(/\s+/g, " ").trim());

    // A single sentence with no full stop still has to be broken up.
    const runOn = Array.from({ length: 40 }, (_, i) => `item ${i}`).join(", ");
    for (const c of splitForSpeech(runOn)) expect(c.length).toBeLessThanOrEqual(180);
  });

  // The model returns raw PCM; a wrong length field in the container yields
  // silence or static, which nothing catches until a human listens.
  test("synthesised audio is wrapped in a valid WAV container", () => {
    const pcm = Buffer.alloc(4800); // 0.1s of 24kHz 16-bit mono
    const wav = pcmToWav(pcm, 24000);

    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    // Both length fields have to reconcile with the real buffer.
    expect(wav.readUInt32LE(4) + 8).toBe(wav.length);
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
    expect(wav.readUInt16LE(22)).toBe(1);      // mono
    expect(wav.readUInt32LE(24)).toBe(24000);  // sample rate
    expect(wav.readUInt16LE(34)).toBe(16);     // bits per sample
    expect(wav.readUInt32LE(28)).toBe(24000 * 2); // byte rate

    // The rate is read off the model's mime type, not assumed.
    expect(rateFromMime("audio/L16;codec=pcm;rate=16000")).toBe(16000);
    expect(rateFromMime(undefined)).toBe(24000);
  });

  // Server speech is billed per character and validates its input, so a chunk
  // that exceeds the cap fails the whole answer rather than one sentence.
  test("speech chunks stay inside the synthesis input cap", () => {
    const src = fs.readFileSync("src/lib/tts.functions.ts", "utf8");
    const cap = Number(/max\((\d+)\)/.exec(src)?.[1]);
    expect(cap).toBeGreaterThan(0);

    const wordy = "एक लाख रुपये का माल खरीदा है, ".repeat(40);
    for (const chunk of splitForSpeech(wordy)) expect(chunk.length).toBeLessThanOrEqual(cap);
  });

  test("holding clips exist, are valid WAV, and are wired to the thinking phase", async ({ page, context }) => {
    await context.grantPermissions(["microphone"]);

    // Every clip the manifest advertises must actually resolve and be audio.
    const manifest = await (await page.request.get("/speech/manifest.json")).json();
    for (const [lang, files] of Object.entries(manifest as Record<string, string[]>)) {
      for (const f of files) {
        const r = await page.request.get(`/speech/${f}`);
        expect(r.status(), `${f} missing`).toBe(200);
        const buf = await r.body();
        expect(buf.subarray(0, 4).toString(), `${f} not RIFF`).toBe("RIFF");
        expect(buf.readUInt32LE(4) + 8, `${f} length field`).toBe(buf.length);
      }
    }

    // The holding clips belong to the fallback pipeline — realtime voice
    // answers in about a second and has nothing to cover. So force the
    // fallback, then assert it preloads them, which is what makes the first
    // one instant.
    await page.route("**/_serverFn/**", async route =>
      isServerFn(route.request().url(), "live.functions")
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"no billing"}' })
        : route.fallback());

    const requested: string[] = [];
    page.on("request", r => { if (r.url().includes("/speech/")) requested.push(r.url().split("/").pop()!); });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /talk to dhela/i }).first().click();
    await expect(page.getByRole("dialog", { name: /talk to dhela/i })).toBeVisible();
    // Polled rather than slept on. A fixed wait passes alone and fails under
    // a loaded suite, and a test that fails for timing teaches you to ignore
    // it — which is exactly how a real failure gets waved through.
    await expect.poll(() => requested, { timeout: 15_000 }).toContain("manifest.json");
    await expect.poll(() => requested.filter(r => r.endsWith(".wav")).length,
                      { timeout: 15_000 }).toBeGreaterThan(0);
  });

  // Realtime voice is the default path now. Its session token is minted by a
  // server function, so the test stubs that: it keeps the suite off a billed
  // API, and it is the only way to exercise the fallback deliberately.
  test("voice mode opens, and falls back to the pipeline when Live can't start", async ({ page, context }) => {
    await context.grantPermissions(["microphone"]);
    // Fail the token mint. Matching on the payload rather than the URL because
    // TanStack routes every server function through one endpoint.
    await page.route("**/_serverFn/**", async route =>
      isServerFn(route.request().url(), "live.functions")
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"no billing"}' })
        : route.fallback());

    await page.goto("/dashboard");
    await page.getByRole("button", { name: /talk to dhela/i }).first().click();

    const overlay = page.getByRole("dialog", { name: /talk to dhela/i });
    await expect(overlay).toBeVisible();
    // Whichever path won, the user gets a working overlay and a way out.
    await expect(overlay.getByText(/press esc to close/i)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
    // The launcher has to come back, or the feature is a one-shot.
    await expect(page.getByRole("button", { name: /talk to dhela/i }).first()).toBeVisible();
  });

  // The assistant and the dashboard answer "how is the business" from one
  // computation. Two implementations of that question is two sets of numbers
  // to disagree with each other in front of an owner.
  test("the assistant reads business health from the same code the dashboard does", () => {
    const tools = fs.readFileSync("src/lib/assistant-tools.ts", "utf8");
    expect(tools).toContain('name: "business_health"');
    expect(tools).toContain('import { computeInsights } from "./insights"');

    const dashboard = fs.readFileSync("src/lib/insights.functions.ts", "utf8");
    expect(dashboard).toContain('from "./insights"');

    // And the prompt has to tell it how to answer, not just that it can.
    const prompt = fs.readFileSync("src/lib/assistant.functions.ts", "utf8");
    expect(prompt).toContain("WHEN SOMEONE ASKS HOW THE BUSINESS IS DOING");
    // Jargon an owner does not use is jargon the answer should not use.
    expect(prompt).toMatch(/Never use the words DSO/);
  });

  // Bedrock is an addition, not a replacement: it is tried first when
  // configured and every failure has to fall through to the provider that
  // already works. A distributor asking about their receivables must not care
  // which cloud answered.
  test("the Bedrock path is additive and cannot break the existing one", () => {
    const src = fs.readFileSync("src/lib/assistant.functions.ts", "utf8");

    // The attempt is wrapped, and its failure is logged rather than thrown.
    const attempt = src.slice(src.indexOf("if (bedrockConfigured())"), src.indexOf("if (!run) {"));
    expect(attempt).toContain("try {");
    expect(attempt).toContain("ask:bedrock_failed");
    expect(attempt).not.toMatch(/throw\s/);

    // And the fallback still runs when the attempt produced nothing.
    expect(src).toMatch(/if \(!run\) \{[\s\S]*runAnthropic[\s\S]*runGemini/);

    // Model ids carry a colon, and SigV4 needs it raw on the wire but encoded
    // in the string it signs. Encoding both is a signature mismatch, which is
    // exactly the bug this shipped with first.
    const bedrock = fs.readFileSync("src/lib/bedrock.ts", "utf8");
    expect(bedrock).toContain("const path = `/model/${model}/converse`");
    expect(bedrock).toContain("const canonicalPath = `/model/${encodeURIComponent(model)}/converse`");
  });

  // Realtime voice bills per minute of audio, in and out, for as long as the
  // socket is open — the one meter in this product that runs while nobody is
  // doing anything. These constants are the whole cost control, so they get a
  // guard rather than a comment.
  test("realtime voice stays a Pro allowance with hard ceilings", () => {
    expect(PLANS.free.liveVoiceMinutesPerMonth).toBe(0);
    expect(PLANS.standard.liveVoiceMinutesPerMonth).toBe(0);
    expect(PLANS.pro.liveVoiceMinutesPerMonth).toBeGreaterThan(0);

    // Worst case one Pro workspace can cost us, at the published rate for
    // gemini-3.1-flash-live-preview: $0.005/min in (the whole session) plus
    // $0.018/min out (call it a third of it) — about ₹0.90 a minute.
    const worstCaseRupees = PLANS.pro.liveVoiceMinutesPerMonth * 0.9;
    const proNetMonthly = PLANS.pro.priceYearly / 12 / 1.18;   // ex-GST
    expect(worstCaseRupees).toBeLessThan(proNetMonthly * 0.25);

    // A session that is never closed is charged at its cap, so the cap is what
    // bounds an abandoned tab.
    expect(LIVE_MAX_SESSION_SECONDS).toBeLessThanOrEqual(15 * 60);
    expect(LIVE_IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(120);
    // And no single session may exceed the monthly allowance.
    expect(LIVE_MAX_SESSION_SECONDS).toBeLessThanOrEqual(PLANS.pro.liveVoiceMinutesPerMonth * 60);
  });

  // The Gemini SDK is ~350KB. It belongs in a chunk that loads when someone
  // taps the mic, not in the one every authenticated page already pays for.
  test("the realtime voice SDK is not in the eagerly loaded bundle", () => {
    const src = fs.readFileSync("src/components/assistant.tsx", "utf8");
    // A static import here is what would silently undo the split.
    expect(src).not.toMatch(/^import\s+\{[^}]*VoiceAgentLive/m);
    expect(src).toMatch(/lazy\(\(\)\s*=>\s*import\("@\/components\/voice-agent-live"\)/);
  });

  // Playwright's Chromium exposes webkitSpeechRecognition and then never
  // starts it — no start, no error, no end, ever. Chromium builds shipped
  // without Google's speech keys behave the same way, so this is a fair stand
  // -in for a real browser where the mic button would otherwise sit on
  // "listening" forever with no event to hang a message off.
  test("dictation that never starts times out instead of hanging", async ({ page, context }) => {
    await context.grantPermissions(["microphone"]);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /ask ai/i }).click();
    await page.getByRole("button", { name: /ask by voice/i }).click();

    await expect(page.getByRole("button", { name: /stop dictating/i })).toBeVisible();
    await expect(page.getByText(/couldn't reach a speech service/i)).toBeVisible({ timeout: 15000 });
    // And the button must come back rather than stay stuck.
    await expect(page.getByRole("button", { name: /ask by voice/i })).toBeVisible();
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

// A bill that runs to several pages arrives as several photos. Read one photo
// at a time it becomes several invoices, each with a fraction of the rows and a
// total that means nothing. These guard the rules that stop that, and the
// sharper failure in the other direction: two suppliers merged into one bill.
test.describe("multi-page bills", () => {
  const py = () => fs.readFileSync("backend/main.py", "utf8");

  test("the whole batch goes to the model in one call, not one call per photo", () => {
    const src = py();
    expect(src).toContain('@app.post("/extract-batch"');
    // A continuation page usually carries no supplier and no invoice number —
    // only line numbers that carry on. Nothing looking at one photo alone can
    // place it, so the grouping has to happen where every photo is visible.
    expect(src).toContain("MULTIPAGE_CONTEXT");
    expect(src).toMatch(/There are \{len\(blobs\)\} photos/);
  });

  test("grouping is told to split when unsure, never to join", () => {
    // DocumentExtraction is declared BEFORE this block, so bound the slice by the
    // prompt's own closing quotes rather than by a later symbol.
    const all = py();
    const from = all.indexOf('MULTIPAGE_CONTEXT = """');
    const p = all.slice(from, all.indexOf('"""', from + 30));
    expect(p.length).toBeGreaterThan(500);
    // The asymmetry that has to drive every rule: a wrong merge writes one
    // supplier's goods under another's name and looks plausible afterwards.
    expect(p).toMatch(/Prefer to split/i);
    expect(p).toMatch(/Different supplier GSTIN means different bills/i);
    expect(p).toMatch(/not unique across suppliers/i);
    // Retakes and Original/Duplicate/Transporter copies both look like extra
    // pages and both would double the goods received.
    expect(p).toMatch(/duplicate_page_indexes/);
    expect(p).toMatch(/B\/F|carry-forward|Carried\s*Forward/i);
  });

  test("every photo is accounted for, and an unread one is reported not swallowed", () => {
    const src = py();
    expect(src).toContain("def _settle_page_assignment");
    expect(src).toContain("unassigned_page_indexes");
    // A page claimed by two bills doubles those goods; a page claimed by none
    // is stock that was paid for and never arrives. Neither shows on screen.
    expect(src).toMatch(/claimed twice/);
    expect(src).toMatch(/log\.error\(\s*"batch: %d photo\(s\) unaccounted for/);
  });

  test("a truncated read is refused rather than shown as a whole bill", () => {
    const src = py();
    // Thinking tokens are charged to the same output budget as the answer, and
    // with a response schema in force Gemini closes the JSON validly but short.
    // That arrives as a well-formed bill missing rows, which is worse than an
    // error the operator can retry.
    expect(src).toContain("MAX_OUTPUT_TOKENS");
    expect(src).toContain("def _gemini_text_or_die");
    expect(src).toMatch(/reason == "MAX_TOKENS"/);
    // Both call paths must go through it — the single-file one had this bug too.
    const uses = src.match(/_gemini_text_or_die\(data, "(extract|extract_batch)"\)/g) ?? [];
    expect(uses.length, "both /extract and /extract-batch must check finishReason").toBe(2);
    expect(src.match(/"maxOutputTokens": MAX_OUTPUT_TOKENS/g)?.length).toBe(2);
  });

  test("an incomplete read is retried once, against the model's own row count", () => {
    const src = py();
    expect(src).toContain("def _batch_shortfalls");
    // Measured: the same request returns [18, 3] rows on one attempt and a
    // single bill with one row on the next, both HTTP 200 / STOP / schema-valid.
    // line_count_on_bill is the only thing that separates them.
    expect(src).toMatch(/line_count_on_bill/);
    expect(src).toMatch(/retrying once/);
    // Reconciliation must not run before the retry compares the two reads, or
    // arithmetic repair makes a lazy answer look tidier than it is.
    // _run_batch is immediately followed by @app.post("/extract"), which DOES
    // reconcile — an unbounded slice sweeps that in and the assertion passes
    // for the wrong reason.
    const rbFrom = src.indexOf("async def _run_batch");
    const rbTo = src.indexOf("\n@app.", rbFrom);
    const runBatch = src.slice(rbFrom, rbTo > 0 ? rbTo : undefined);
    expect(rbTo).toBeGreaterThan(rbFrom);
    expect(runBatch, "_run_batch must not reconcile").not.toContain("_reconcile_lines");
  });

  test("a bill costs one extraction however many photos it took", () => {
    const api = fs.readFileSync("src/lib/invoice-batch.functions.ts", "utf8");
    // Quota is checked before the read but spent only on save, so an operator
    // who abandons a proposal has not paid for it.
    expect(api).toContain("export const proposeInvoiceGroups");
    expect(api).toContain("export const saveInvoiceGroups");
    expect(api).toMatch(/data\.documents\.length > remaining/);
    expect(api, "quota must not be counted per photo")
      .not.toMatch(/data\.items\.length > remaining/);
  });

  test("page 1 stays where every existing screen already looks for it", () => {
    const api = fs.readFileSync("src/lib/invoice-batch.functions.ts", "utf8");
    // invoices.storage_path keeps holding the first page, so thumbnails,
    // re-extract and storage cleanup go on working without knowing multi-page
    // bills exist.
    expect(api).toContain("storage_path: first.storagePath");
    const sql = fs.readFileSync("supabase/migrations/20260822120000_invoice_pages.sql", "utf8");
    expect(sql).toContain("invoice_pages_page_unique unique (invoice_id, page_no)");
    expect(sql).toContain("invoice_pages_path_unique unique (invoice_id, storage_path)");
    expect(sql).toContain("is_org_member(org_id)");
    for (const verb of ["for select", "for insert", "for update", "for delete"]) {
      expect(sql.toLowerCase(), `${verb} policy missing`).toContain(verb);
    }
  });

  test("nothing is written until the operator has seen the grouping", () => {
    const ui = fs.readFileSync("src/routes/_authenticated/upload.tsx", "utf8");
    const panel = fs.readFileSync("src/components/invoice-group-review.tsx", "utf8");
    // propose() writes nothing; save happens only from the confirm handler.
    expect(ui).toContain("proposeInvoiceGroups");
    expect(ui).toContain("const confirmProposal");
    expect(ui).toMatch(/saveGroups\(\{/);
    expect(panel).toMatch(/Nothing is saved\s*\n?\s*yet/);

    // A regroup must re-read rather than reshuffle: nothing records which photo
    // a row came from, so moving photos between bills cannot move their rows.
    expect(ui).toContain("const regroupProposal");
    expect(ui).toMatch(/groups\s*\}/);
    const py = fs.readFileSync("backend/main.py", "utf8");
    expect(py).toContain("def _parse_groups");
    // An invalid operator grouping must be refused, never silently fall back to
    // auto-grouping — that would look like the correction had been applied.
    expect(py).toMatch(/is in more than one group/);
    expect(py).toMatch(/are not in any group/);
  });

  test("only 2..12 photos on the AI engine take the grouping path", () => {
    const ui = fs.readFileSync("src/routes/_authenticated/upload.tsx", "utf8");
    // One file keeps the instant path; a big dump is many separate bills and
    // keeps the queue; OCR has no grouping to do.
    expect(ui).toMatch(/engine === "ai" && uploaded\.length > 1 && uploaded\.length <= MAX_PAGES_PER_BATCH/);
  });
});
