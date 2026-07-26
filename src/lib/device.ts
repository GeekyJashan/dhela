/**
 * Coarse mobile check. Safe to call during render — every screen that uses
 * it sits under the ssr:false _authenticated route, so there is no server
 * pass to disagree with.
 */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
