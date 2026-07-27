// UI language support. Natural-key i18n: the English string is the key, so
// English needs no resource file and untranslated strings fall back to
// English instead of breaking.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const LANG_STORAGE_KEY = "dhela.lang";
/** Pre-rebrand key — read once so existing users keep their language. */
const LEGACY_LANG_STORAGE_KEY = "ledgerly.lang";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "pa", label: "ਪੰਜਾਬੀ" },
] as const;

// Resources start empty and each dictionary is fetched on demand. Importing
// both statically put 1,572 translation keys (~40 KB gzipped) into the shared
// chunk, so every visitor to the public marketing page — and every crawler —
// downloaded Hindi and Punjabi for an app they had not signed into.
i18n.use(initReactI18next).init({
  resources: {},
  lng: "en",
  fallbackLng: "en",
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

/**
 * Pull in the complete Noto family for an Indic locale.
 *
 * The self-hosted faces in fonts.css only cover the Hindi/Punjabi copy on the
 * landing page — a distributor can type any Devanagari they like into a product
 * or party name, and the subset would not have it. Loading the full family costs
 * ~150 KB, so it happens here rather than on the marketing page, which is the
 * one page that has to be fast and never needs it.
 */
const INDIC_FONTS: Record<string, string> = {
  hi: "family=Noto+Sans+Devanagari:wght@400;600",
  pa: "family=Noto+Sans+Gurmukhi:wght@400;600",
};

function loadIndicFont(code: string) {
  const family = INDIC_FONTS[code];
  if (!family || typeof document === "undefined") return;
  const href = `https://fonts.googleapis.com/css2?${family}&display=swap`;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/** Fetch a dictionary once, on demand. English is the key language, so it needs none. */
async function loadLocale(code: string): Promise<void> {
  loadIndicFont(code);
  if (code === "en" || i18n.hasResourceBundle(code, "translation")) return;
  try {
    const mod = code === "hi"
      ? await import("./locales/hi.json")
      : code === "pa" ? await import("./locales/pa.json") : null;
    if (mod) i18n.addResourceBundle(code, "translation", mod.default, true, true);
  } catch {
    // A failed fetch just leaves the UI in English, which is the fallback anyway.
  }
}

/** Restore the saved language on the client (SSR always renders English). */
export function applySavedLanguage() {
  if (typeof window === "undefined") return;
  const saved =
    window.localStorage.getItem(LANG_STORAGE_KEY) ??
    window.localStorage.getItem(LEGACY_LANG_STORAGE_KEY);
  if (saved) window.localStorage.setItem(LANG_STORAGE_KEY, saved);
  if (saved && saved !== i18n.language) {
    void loadLocale(saved).then(() => i18n.changeLanguage(saved));
  }
  document.documentElement.lang = saved ?? "en";
}

export function setLanguage(code: string) {
  window.localStorage.setItem(LANG_STORAGE_KEY, code);
  void loadLocale(code).then(() => i18n.changeLanguage(code));
  document.documentElement.lang = code;
}

export default i18n;
