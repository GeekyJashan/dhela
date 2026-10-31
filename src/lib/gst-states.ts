/**
 * GST state codes.
 *
 * The first two digits of a GSTIN are the state, and the pair of states on a
 * sale is what decides IGST against CGST plus SGST. Lifted out of
 * gstin.functions.ts so a screen can use it without importing a module full
 * of server functions and API keys.
 */
export const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "28": "Andhra Pradesh (old)",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh", "97": "Other Territory",
};

/** Codes in numeric order, for a picker. "28" is the retired AP code — still
 *  recognised on old GSTINs, never offered as a new choice. */
export const STATE_OPTIONS = Object.entries(STATE_CODES)
  .filter(([code]) => code !== "28")
  .sort(([a], [b]) => a.localeCompare(b));

export const stateName = (code: string | null | undefined) =>
  code ? STATE_CODES[code.trim()] ?? null : null;
