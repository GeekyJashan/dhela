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
 * A WhatsApp deep link. Defaults to the founder's number, which is what every
 * support link in the app wants; pass a number to message someone else, as the
 * leads screen does. An Indian mobile typed without a country code would open
 * the wrong chat, so a bare 10-digit number gets 91 in front of it.
 */
export function whatsappLink(text: string, phone?: string | null): string {
  let to = supportPhoneDigits();
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 10) to = digits.length === 10 ? `91${digits}` : digits;
  }
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
