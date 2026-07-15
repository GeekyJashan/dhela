/**
 * Fuzzy matching of extracted purchase-invoice lines to catalog products.
 * Token overlap on names (containment + Dice) with an HSN-prefix bonus.
 */

const STOPWORDS = new Set(["the", "of", "and", "with", "for", "pack", "pcs", "pc", "nos", "no"]);

export function nameTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(t => t.length >= 2 && !STOPWORDS.has(t)),
  );
}

export function nameScore(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  // Containment forgives extra pack-size noise in the longer name;
  // Dice keeps single-shared-token coincidences from scoring high.
  const containment = inter / Math.min(ta.size, tb.size);
  const dice = (2 * inter) / (ta.size + tb.size);
  return 0.6 * containment + 0.4 * dice;
}

export type MatchableProduct = { id: string; name: string; hsn: string | null };

export function matchLineToProduct(
  description: string,
  hsn: string | null | undefined,
  products: MatchableProduct[],
): { productId: string; score: number } | null {
  let bestId: string | null = null;
  let bestScore = 0;
  const lineHsn = (hsn ?? "").replace(/\D/g, "");
  for (const p of products) {
    let s = nameScore(description, p.name);
    if (lineHsn && p.hsn) {
      const pHsn = p.hsn.replace(/\D/g, "");
      if (pHsn && (lineHsn.startsWith(pHsn) || pHsn.startsWith(lineHsn))) s += 0.15;
    }
    if (s > bestScore) { bestScore = s; bestId = p.id; }
  }
  if (!bestId || bestScore < 0.5) return null;
  return { productId: bestId, score: Math.round(Math.min(bestScore, 1) * 100) };
}
