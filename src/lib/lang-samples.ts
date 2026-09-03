/**
 * Five sidebar labels in three languages, inlined.
 *
 * These used to be read from hi.json/pa.json so the demo couldn't drift from
 * the real app — correct instinct, but it shipped both full dictionaries
 * (1,572 keys, ~40 KB gzipped) to every visitor of a marketing page to render
 * five words. The drift guarantee now lives in the e2e suite, which asserts
 * these match the locale files, so the cost is paid in CI instead.
 */
export const SAMPLE_KEYS = ["Upload bill", "Purchases", "Retailers", "Payments", "E-way bills"];
export const LANG_SAMPLES = [
  { code: "en", label: "English", rows: SAMPLE_KEYS },
  { code: "hi", label: "हिंदी", rows: ["बिल अपलोड करें", "खरीद", "रिटेलर", "भुगतान", "ई-वे बिल"] },
  { code: "pa", label: "ਪੰਜਾਬੀ", rows: ["ਬਿੱਲ ਅੱਪਲੋਡ ਕਰੋ", "ਖਰੀਦ", "ਰਿਟੇਲਰ", "ਭੁਗਤਾਨ", "ਈ-ਵੇ ਬਿੱਲ"] },
];
