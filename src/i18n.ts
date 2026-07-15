// UI language support. Natural-key i18n: the English string is the key, so
// English needs no resource file and untranslated strings fall back to
// English instead of breaking.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import hi from "./locales/hi.json";
import pa from "./locales/pa.json";

export const LANG_STORAGE_KEY = "ledgerly.lang";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिंदी" },
  { code: "pa", label: "ਪੰਜਾਬੀ" },
] as const;

i18n.use(initReactI18next).init({
  resources: {
    hi: { translation: hi },
    pa: { translation: pa },
  },
  lng: "en",
  fallbackLng: "en",
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

/** Restore the saved language on the client (SSR always renders English). */
export function applySavedLanguage() {
  if (typeof window === "undefined") return;
  const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
  if (saved && saved !== i18n.language) void i18n.changeLanguage(saved);
  document.documentElement.lang = saved ?? "en";
}

export function setLanguage(code: string) {
  window.localStorage.setItem(LANG_STORAGE_KEY, code);
  void i18n.changeLanguage(code);
  document.documentElement.lang = code;
}

export default i18n;
