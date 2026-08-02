/**
 * Finding prospects, rather than qualifying ones you already have.
 *
 * WHY GOOGLE PLACES AND NOT A SCRAPER
 *
 * The obvious route is IndiaMART or JustDial. Both forbid scraping in their
 * terms, both ban the IPs that do it, and both would hand you individuals'
 * mobile numbers that India's DPDP Act then makes your responsibility. You are
 * selling compliance software to businesses that care about compliance; a cold
 * call they can trace to a scraped list is the worst possible introduction.
 *
 * Places is the licensed version of the same thing: a paid API, built for
 * exactly this, returning a business name, address, phone and website with
 * terms that permit it. It costs roughly ₹3 a search.
 *
 * OpenStreetMap was the free alternative and it does not work here. Measured
 * on Ludhiana: 400 shops mapped, 2 with a phone number, and the categories are
 * convenience stores and clothes shops. India's OSM coverage has retail, not
 * distributors.
 *
 * WHAT A DISCOVERED LEAD IS SCORED ON
 *
 * Not the same things as a GSTIN lead — Places knows nothing about GST
 * registration, constitution or how long a business has traded. It knows what
 * the business calls itself, whether anyone reviews it, and whether it has a
 * phone. So discovery scores lower and more coarsely on purpose, and a lead
 * only earns a real score once its GSTIN is added and the registry is asked.
 * A number derived from a shop's Google rating should not look as confident as
 * one derived from a tax registration.
 */

export type Discovered = {
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  types: string[];
  reviews: number;
  open: boolean;
};

/** Words an Indian distributor puts on the board, and words a retailer does. */
const WHOLESALE = ["wholesale", "wholesaler", "distributor", "distributors", "agencies",
                   "traders", "trading", "enterprises", "supply", "suppliers", "depot",
                   "stockist", "marketing", "sales corporation", "& sons", "and sons"];
const RETAIL = ["retail", "showroom", "boutique", "store", "mart", "bazaar", "restaurant",
                "cafe", "hotel", "salon", "clinic", "hospital", "school"];

export function scoreDiscovered(d: Discovered): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let s = 0;

  if (!d.open) return { score: 0, reasons: ["listed as permanently closed"] };

  const hay = `${d.name} ${d.types.join(" ")}`.toLowerCase();
  const wholesale = WHOLESALE.filter(w => hay.includes(w));
  const retail = RETAIL.filter(w => hay.includes(w));

  if (wholesale.length) {
    s += 35;
    reasons.push(`calls itself "${wholesale[0]}" — trade, not counter`);
  } else if (retail.length) {
    s += 5;
    reasons.push(`looks like ${retail[0]} — probably sells to the public`);
  } else {
    s += 15;
    reasons.push("trade unclear from the listing");
  }

  // A phone is the whole point. A lead you cannot ring is a row in a table.
  if (d.phone) { s += 25; reasons.push("has a phone number"); }
  else reasons.push("no phone listed — you would have to find one");

  // Review count stands in for how long and how publicly a business has
  // traded. A wholesaler with 40 reviews is real; one with none may be a
  // pin someone dropped.
  if (d.reviews >= 30) { s += 20; reasons.push(`${d.reviews} reviews — well established`); }
  else if (d.reviews >= 5) { s += 12; reasons.push(`${d.reviews} reviews`); }
  else { s += 2; reasons.push("barely reviewed — may be a stale listing"); }

  if (d.website) { s += 5; reasons.push("has a website"); }

  // Scaled, not clamped, into a band below the GSTIN-scored leads. Clamping
  // put a wholesaler with 48 reviews and a website level with one that had 9
  // and neither — both hit the ceiling and the ranking stopped ranking.
  // Scaling keeps the order and still guarantees a listing never outranks a
  // lead the tax registry vouched for.
  const MAX_RAW = 85;   // 35 trade + 25 phone + 20 reviews + 5 website
  const CEILING = 70;
  return { score: Math.round(Math.max(0, Math.min(MAX_RAW, s)) * CEILING / MAX_RAW), reasons };
}

/** Search phrasings that find distributors rather than shops. */
export function searchPhrases(trade: string, city: string): string[] {
  const t = trade.trim();
  const c = city.trim();
  return [
    `${t} wholesaler in ${c}`,
    `${t} distributor in ${c}`,
    `${t} traders in ${c}`,
    `${t} agencies in ${c}`,
  ];
}
