/** Mac desktop with touch emulation must not be mistaken for iPadOS. */
export function isAppleMobileBrowser(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1 && !/(?:Chrome|Chromium|Edg|OPR)\//i.test(userAgent);
}
