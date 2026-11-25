/** The active section is the last heading that reached the visible menu edge. */
export function categoryAtScrollLine(sections: Array<{ id: string; top: number }>, line: number): string | null {
  if (!sections.length) return null;
  let active = sections[0].id;
  for (const section of sections) {
    if (section.top <= line) active = section.id;
    else break;
  }
  return active;
}

/** Change as the next heading enters the unobstructed viewport, not after it passes underneath the bar. */
export function categoryScrollLine(headerHeight: number, barHeight: number, viewportHeight: number): number {
  return headerHeight + barHeight + Math.min(72, Math.max(24, viewportHeight * 0.08));
}
