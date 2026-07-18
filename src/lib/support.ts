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

export function whatsappLink(text: string): string {
  return `https://wa.me/${supportPhoneDigits()}?text=${encodeURIComponent(text)}`;
}

export function emailLink(subject: string, body: string): string {
  return `mailto:${FOUNDER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
