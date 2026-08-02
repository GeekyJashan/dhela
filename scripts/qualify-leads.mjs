/**
 * Qualify and rank distributor prospects from public GST registration data.
 *
 *   npm run leads -- prospects.csv
 *
 * Input: a CSV with a `gstin` column, and optionally `name`, `phone`, `source`.
 * Output: leads-qualified.csv, ranked, with the reasoning for each score and a
 * first line to open with.
 *
 * WHAT THIS DOES NOT DO, ON PURPOSE
 *
 * It does not find businesses for you. It takes a list you have sourced —
 * a trade association directory, a market association roster, a wholesale
 * market walk, exhibitor lists, your own referrals — and tells you which
 * names on it are worth your morning. Harvesting names and phone numbers off
 * B2B marketplaces at scale breaches their terms and puts personal data in
 * your hands that India's DPDP Act makes your problem, not the scraper's.
 * A ranked list of forty real prospects beats six thousand scraped rows that
 * nobody will ever call.
 *
 * WHAT IT SCORES ON
 *
 * The registry asks every taxpayer to declare what they actually do, and that
 * field carries more weight here than anything else: "Wholesale Business" with
 * "Warehouse / Depot" is this product's customer, while a retail counter is
 * not, however healthy the business. After that it is who can say yes — a
 * proprietor decides over one call, a public limited runs a procurement for
 * ₹7,999 a year — then whether they file monthly returns at all, how long they
 * have traded, and whether you can drive there. The first ten customers are
 * won in person.
 *
 * Scores are a sort order, not a verdict. The `why` column is the useful part:
 * "wholesale with a warehouse, proprietor, trading 9 years" is something to
 * open a call with. "Score 82" is not.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const CACHE = path.join(root, ".leads-cache.json");

// Same free lookup the app itself uses for supplier and retailer onboarding,
// so nothing new is introduced and no key is required to run this.
const LOOKUP = "https://tallysolutions.com/wp-content/themes/tally/api/gstin-serach-api.php";

/** One request every 1.5s. Someone else is paying for this endpoint. */
const DELAY_MS = 1500;
const wait = ms => new Promise(r => setTimeout(r, ms));

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};

async function lookup(gstin) {
  if (cache[gstin]) return cache[gstin];
  try {
    const resp = await fetch(LOOKUP, {
      method: "POST",
      // Same headers the app sends. This is someone else's public tool; look
      // like the browser it was built for rather than something to block.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0",
        Referer: "https://tallysolutions.com/business-tools-templates/gstin-verification-search/",
      },
      body: `gstin=${encodeURIComponent(gstin)}`,
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (Number(json.status) !== 1) return null;
    cache[gstin] = json;
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    return json;
  } catch {
    return null;
  }
}

const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = k.split(".").reduce((a, p) => (a == null ? a : a[p]), o);
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
};

/**
 * Score a prospect out of 100, and say why. The reasons matter more than the
 * number — "files late, wholesale, Punjab" is something you can open a call
 * with; "score 72" is not.
 */
function score(tp) {
  const reasons = [];
  let s = 0;

  if ((tp.status ?? "").toLowerCase() !== "active") {
    return { score: 0, reasons: [`GST registration is ${tp.status || "not active"}`], skip: true };
  }

  // The strongest signal the registry gives, and the one worth most: the
  // taxpayer declared what they actually do. A wholesaler with a warehouse is
  // this product's customer; a retail shop with a counter is not, however
  // healthy the business.
  const act = (tp.activity ?? "").toLowerCase();
  const wholesale = act.includes("wholesale");
  const depot = act.includes("warehouse") || act.includes("depot");
  if (wholesale && depot) { s += 40; reasons.push("wholesale with a warehouse — squarely a distributor"); }
  else if (wholesale) { s += 30; reasons.push("wholesale business"); }
  else if (depot) { s += 20; reasons.push("keeps a warehouse or depot"); }
  else if (act.includes("retail")) { s += 5; reasons.push("retail only — probably too small"); }
  else if (act.includes("factory") || act.includes("manufact")) { s += 12; reasons.push("manufacturer — sells through distributors"); }

  // Regular taxpayers file GSTR-1 and 3B monthly, which is the work the GST
  // papers remove. Composition dealers file quarterly and lack the pain.
  const type = (tp.taxpayerType ?? "").toLowerCase();
  if (type.includes("regular")) { s += 15; reasons.push("regular taxpayer — monthly GSTR-1 and 3B"); }
  else if (type.includes("composition")) { s -= 15; reasons.push("composition dealer — far less GST work"); }

  // Owner-run businesses buy software in one conversation. A public limited
  // needs three meetings and a procurement process for ₹7,999 a year.
  const con = (tp.constitution ?? "").toLowerCase();
  if (con.includes("proprietor")) { s += 20; reasons.push("proprietor — one person decides"); }
  else if (con.includes("partnership") || con.includes("llp")) { s += 15; reasons.push("partnership — short decision chain"); }
  else if (con.includes("private")) { s += 8; reasons.push("private limited"); }
  else if (con.includes("public")) { s -= 15; reasons.push("public limited — long procurement"); }

  // Years in trade stands in for volume, and volume is what makes typing bills
  // unbearable enough to pay to stop.
  const parts = (tp.registrationDate ?? "").split("/");
  const reg = parts.length === 3 ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}`) : null;
  const years = reg && !isNaN(reg) ? (Date.now() - reg) / (365 * 86400000) : null;
  if (years != null) {
    if (years >= 5) { s += 15; reasons.push(`trading ${Math.floor(years)} years`); }
    else if (years >= 2) { s += 10; reasons.push(`trading ${Math.floor(years)} years`); }
    else { s += 3; reasons.push("registered recently — may still be small"); }
  }

  // Nearby is not a better business, it is a cheaper one to win: the first ten
  // customers are won in person, and you can drive to these.
  if (tp.stateCode === "03") { s += 10; reasons.push("Punjab — you can visit"); }
  else if (["06", "07", "02", "05"].includes(tp.stateCode)) { s += 5; reasons.push(`${tp.state} — a short drive`); }

  return { score: Math.max(0, Math.min(100, s)), reasons, skip: false };
}

function opener(tp, res) {
  const name = tp.tradeName || tp.legalName || "there";
  if (res.reasons.some(r => r.includes("warehouse"))) {
    return `Hi, is this ${name}? I build software for distributors — purchase bills read straight off a photo, so stock and true cost update themselves and GSTR-1 is ready before the 11th. Worth ten minutes?`;
  }
  return `Hi, is this ${name}? I build billing and stock software for distributors — bills read from a photo, stock and true cost updated automatically, GST working papers out the other side. Worth ten minutes?`;
}

// ---- run ------------------------------------------------------------------
const file = process.argv[2];
if (!file) {
  console.error("usage: npm run leads -- prospects.csv   (needs a `gstin` column)");
  process.exit(1);
}

const rows = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
const header = rows[0].split(",").map(h => h.trim().toLowerCase());
const gi = header.indexOf("gstin");
if (gi < 0) { console.error("No `gstin` column found in " + file); process.exit(1); }

const out = [];
for (const [n, line] of rows.slice(1).entries()) {
  const cells = line.split(",").map(c => c.trim());
  const gstin = (cells[gi] ?? "").toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(gstin)) {
    console.log(`  ${(n + 1).toString().padStart(3)}. ${gstin || "(blank)"} — not a valid GSTIN, skipped`);
    continue;
  }

  const json = await lookup(gstin);
  await wait(DELAY_MS);
  if (!json) { console.log(`  ${(n + 1).toString().padStart(3)}. ${gstin} — lookup failed`); continue; }

  const tp = {
    legalName: pick(json, "legal_name", "lgnm"),
    tradeName: pick(json, "trade_name", "tradeNam"),
    status: pick(json, "gstin_status", "sts"),
    constitution: pick(json, "business_constitution", "ctb"),
    taxpayerType: pick(json, "registration_type", "dty"),
    registrationDate: pick(json, "registration_date", "rgdt"),
    activity: pick(json, "business_activity"),
    city: pick(json, "city"),
    state: pick(json, "state"),
    stateCode: gstin.slice(0, 2),
  };

  const res = score(tp);
  const label = `${tp.tradeName || tp.legalName || gstin}`;
  console.log(`  ${(n + 1).toString().padStart(3)}. ${String(res.score).padStart(3)}  ${label.slice(0, 40).padEnd(42)} ${res.reasons[0] ?? ""}`);
  if (!res.skip) {
    out.push({
      score: res.score, gstin,
      name: tp.tradeName || tp.legalName || "",
      city: [tp.city, tp.state].filter(Boolean).join(", "), constitution: tp.constitution || "",
      taxpayer_type: tp.taxpayerType || "", activity: tp.activity || "",
      why: res.reasons.join("; "),
      opener: opener(tp, res),
    });
  }
}

out.sort((a, b) => b.score - a.score);
const cols = ["score", "name", "gstin", "city", "constitution", "taxpayer_type", "activity", "why", "opener"];
const csv = [cols.join(",")]
  .concat(out.map(r => cols.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(",")))
  .join("\n");
fs.writeFileSync("leads-qualified.csv", csv + "\n");

console.log(`\n${out.length} qualified of ${rows.length - 1} → leads-qualified.csv`);
if (out.length) {
  console.log(`\nStart here:`);
  for (const r of out.slice(0, 3)) console.log(`  ${r.score}  ${r.name} (${r.city}) — ${r.why.split(";")[0]}`);
}
