/**
 * How a prospect is scored, in one place.
 *
 * Shared by the pipeline screen and the CLI, so a weight changed in one cannot
 * quietly disagree with the other.
 *
 * The registry asks every taxpayer to declare what they actually do, and that
 * field carries more weight here than anything else: "Wholesale Business"
 * alongside "Warehouse / Depot" is this product's customer in a way a retail
 * counter is not, however healthy that business is. After that it is who can
 * say yes — a proprietor decides over one call, a public limited runs a
 * procurement for ₹7,999 a year — then whether they file monthly returns at
 * all, how long they have traded, and whether you can drive there.
 *
 * The score is a sort order. The reasons are the useful output: "wholesale
 * with a warehouse, proprietor, trading 9 years" is something to open a call
 * with, and "82" is not.
 *
 * These weights are reasoned, not measured. Once thirty of these have been
 * called, the ones that converted should set them instead.
 */

export type Registry = {
  legalName: string | null;
  tradeName: string | null;
  status: string | null;
  constitution: string | null;
  taxpayerType: string | null;
  registrationDate: string | null;
  activity: string | null;
  city: string | null;
  state: string | null;
  stateCode: string;
};

export function scoreProspect(tp: Registry): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let s = 0;

  if ((tp.status ?? "").toLowerCase() !== "active") {
    return { score: 0, reasons: [`GST registration is ${tp.status || "not active"} — not trading`] };
  }

  const act = (tp.activity ?? "").toLowerCase();
  const wholesale = act.includes("wholesale");
  const depot = act.includes("warehouse") || act.includes("depot");
  if (wholesale && depot) { s += 40; reasons.push("wholesale with a warehouse — squarely a distributor"); }
  else if (wholesale) { s += 30; reasons.push("wholesale business"); }
  else if (depot) { s += 20; reasons.push("keeps a warehouse or depot"); }
  else if (act.includes("factory") || act.includes("manufact")) { s += 12; reasons.push("manufacturer — sells through distributors"); }
  else if (act.includes("retail")) { s += 5; reasons.push("retail only — probably too small"); }

  const type = (tp.taxpayerType ?? "").toLowerCase();
  if (type.includes("regular")) { s += 15; reasons.push("regular taxpayer — monthly GSTR-1 and 3B"); }
  else if (type.includes("composition")) { s -= 15; reasons.push("composition dealer — far less GST work"); }

  const con = (tp.constitution ?? "").toLowerCase();
  if (con.includes("proprietor")) { s += 20; reasons.push("proprietor — one person decides"); }
  else if (con.includes("partnership") || con.includes("llp")) { s += 15; reasons.push("partnership — short decision chain"); }
  else if (con.includes("private")) { s += 8; reasons.push("private limited"); }
  else if (con.includes("public")) { s -= 15; reasons.push("public limited — long procurement"); }

  const parts = (tp.registrationDate ?? "").split("/");
  const reg = parts.length === 3 ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}`) : null;
  const years = reg && !Number.isNaN(reg.getTime()) ? (Date.now() - reg.getTime()) / (365 * 86_400_000) : null;
  if (years != null) {
    if (years >= 5) { s += 15; reasons.push(`trading ${Math.floor(years)} years`); }
    else if (years >= 2) { s += 10; reasons.push(`trading ${Math.floor(years)} years`); }
    else { s += 3; reasons.push("registered recently — may still be small"); }
  }

  // Nearby is not a better business, it is a cheaper one to win. The first ten
  // customers are won in person.
  if (tp.stateCode === "03") { s += 10; reasons.push("Punjab — you can visit"); }
  else if (["06", "07", "02", "05"].includes(tp.stateCode)) { s += 5; reasons.push(`${tp.state ?? "nearby"} — a short drive`); }

  return { score: Math.max(0, Math.min(100, s)), reasons };
}
