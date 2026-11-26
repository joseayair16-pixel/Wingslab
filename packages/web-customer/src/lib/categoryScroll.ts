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

/** Avoid flickering when small layout or scroll changes straddle a heading. */
export function stableCategoryAtScrollLine(sections: Array<{ id: string; top: number }>, line: number, current: string | null, margin = 12): string | null {
  const next = categoryAtScrollLine(sections, line);
  const currentIndex = sections.findIndex(section => section.id === current);
  const nextIndex = sections.findIndex(section => section.id === next);
  if (currentIndex < 0 || nextIndex < 0 || currentIndex === nextIndex) return next;
  if (nextIndex > currentIndex && line < sections[nextIndex].top + margin) return current;
  if (nextIndex < currentIndex && line >= sections[currentIndex].top - margin) return current;
  return next;
}

/** Change as the next heading enters the unobstructed viewport, not after it passes underneath the bar. */
export function categoryScrollLine(headerHeight: number, barHeight: number, viewportHeight: number): number {
  return headerHeight + barHeight + Math.min(72, Math.max(24, viewportHeight * 0.08));
}
