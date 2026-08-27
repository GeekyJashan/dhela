/** Founder / support contact used across billing and the assistant. */
export const FOUNDER_EMAIL = "jsehgal2003@gmail.com";

// VITE_SUPPORT_PHONE overrides; this default is the public support number.
const DEFAULT_PHONE = "6284782476";

export function supportPhoneDigits(): string {
  const p = (import.meta.env.VITE_SUPPORT_PHONE ?? "").replace(/\D/g, "");
  const digits = p || DEFAULT_PHONE;
  return digits.length === 10 ? "91" + digits : digits;
}

/** "+91 62847 82476" for display. */
export function supportPhoneDisplay(): string {
  const d = supportPhoneDigits();
  const local = d.startsWith("91") && d.length === 12 ? d.slice(2) : d;
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

/**
 * An Indian phone number in the form a dialler and WhatsApp both accept.
 *
 * Numbers arrive from listings and from typing, so they turn up as
 * "+91 98765 43210", "098765-43210", "9876543210" and worse. Everything
 * non-numeric goes, a leading zero goes, and a bare ten digits gets 91 in
 * front — a ten-digit Indian mobile sent to WhatsApp without a country code
 * opens somebody else's chat.
 *
 * Returns null when there is nothing dialable, so the caller can hide the
 * button rather than offer one that fails.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10) d = `91${d}`;
  // 12 is 91 plus ten. Shorter is a landline without an STD code or a typo,
  // and dialling it would just fail in the operator's hand.
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** tel: link for a real phone call. */
export function telLink(phone: string | null | undefined): string | null {
  const d = normalisePhone(phone);
  return d ? `tel:+${d}` : null;
}

/**
 * A WhatsApp deep link. Defaults to the founder's number, which is what every
 * support link in the app wants; pass a number to message someone else, as the
 * leads screen does. An Indian mobile typed without a country code would open
 * the wrong chat, so a bare 10-digit number gets 91 in front of it.
 */
export function whatsappLink(text: string, phone?: string | null): string {
  const to = normalisePhone(phone) ?? supportPhoneDigits();
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export function emailLink(subject: string, body: string): string {
  return `mailto:${FOUNDER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** UPI handle for plan payments — the same one encoded in public/upi-qr.png. */
export const UPI_VPA = "jsehgal2003@okaxis";
const UPI_PAYEE = "Jashan Sehgal";

/**
 * Deep link that opens a UPI app with payee and amount already filled.
 * Only does anything on a phone with a UPI app installed, so callers
 * should keep the QR available as the desktop path.
 *
 * The VPA is left unencoded: "@" is a legal sub-delimiter in a query and
 * some UPI apps mishandle it percent-encoded.
 */
export function upiPayLink(amount: number, note: string): string {
  return `upi://pay?pa=${UPI_VPA}&pn=${encodeURIComponent(UPI_PAYEE)}`
    + `&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
}
