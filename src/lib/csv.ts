/**
 * A CSV reader for files other software produced.
 *
 * Splitting on commas is wrong the first time a product is called
 * "PIPE, PVC, 110MM" or an address contains a comma, which on a distributor's
 * catalogue is immediately. So this is a real scanner: quoted fields, doubled
 * quotes inside them, newlines inside them, and CRLF from anything that has
 * been through Windows.
 *
 * Written rather than installed. The alternative is a parsing dependency in a
 * repo that holds a service-role key, for forty lines of well-specified work.
 */

/** Split one delimited file into rows of raw cells. */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // A byte-order mark survives Excel's "Save as CSV" and would otherwise become
  // part of the first column name, so the header never matches anything.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }  // "" is one quote
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delimiter) { row.push(field); field = ""; continue; }
    if (c === "\r") continue;                            // CRLF, and lone CR
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  // Trailing blank lines are not rows.
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

/**
 * Guess the delimiter. Indian exports are usually comma, but Tally and some
 * Excel locales produce semicolons or tabs, and a file that parses as one
 * column is a file nobody can map.
 */
export function sniffDelimiter(text: string): string {
  const head = text.split("\n").slice(0, 5).join("\n");
  const counts = [",", ";", "\t", "|"].map(d => ({
    d,
    // Count outside quotes only, or a single quoted address decides it.
    n: (head.match(new RegExp(`\\${d}(?=(?:[^"]*"[^"]*")*[^"]*$)`, "g")) ?? []).length,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

/** Rows of cells to rows of objects, keyed by the header line. */
export function toRecords(rows: string[][]): { headers: string[]; records: Record<string, string>[] } {
  if (!rows.length) return { headers: [], records: [] };
  // Blank header cells get a position name so two of them cannot collide.
  const headers = rows[0].map((h, i) => h.trim() || `column_${i + 1}`);
  const records = rows.slice(1).map(r => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
    return o;
  });
  return { headers, records };
}

/**
 * A number as accounting software writes it: "1,23,456.78", "(500)" for
 * negative, "₹1,200", "1 200,50" from a European locale, or empty.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()₹$€£\s]/g, "").replace(/^-/, "");
  // If a comma is the decimal mark there will be no dot; otherwise commas are
  // thousands separators, Indian-grouped or not.
  if (s.includes(",") && !s.includes(".")) {
    const parts = s.split(",");
    s = parts[parts.length - 1].length === 2 && parts.length === 2
      ? parts.join(".")            // 1200,50
      : parts.join("");            // 1,23,456
  } else {
    s = s.replace(/,/g, "");
  }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : null;
}
