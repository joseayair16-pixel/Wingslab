export type RoutePoint = { lat: number; lng: number };

export function isFreshRouteLocation(point: RoutePoint, timestamp: number, now: number): boolean {
  return Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
    Number.isFinite(point.lng) && Math.abs(point.lng) <= 180 &&
    Number.isFinite(timestamp) && timestamp <= now + 10000 && now - timestamp <= 120000;
}

export type RouteBudget = { attempts: number; lastRequest: number };
const budgets = new Map<string, RouteBudget>();

/** Shared across map mounts; sessionStorage also preserves limits after reload. */
export function reserveRouteRequest(key: string, now: number): 'reserved' | 'cooldown' | 'exhausted' {
  let budget = budgets.get(key) || { attempts: 0, lastRequest: 0 };
  try {
    const saved = JSON.parse(sessionStorage.getItem(`wl-route-budget:${key}`) || 'null');
    if (saved && Number.isInteger(saved.attempts) && saved.attempts >= 0 && Number.isFinite(saved.lastRequest)) {
      budget = { attempts: Math.max(budget.attempts, saved.attempts), lastRequest: Math.max(budget.lastRequest, saved.lastRequest) };
    }
  } catch { /* Storage unavailable: retain the in-memory limit. */ }
  if (budget.attempts >= 12) return 'exhausted';
  if (budget.attempts > 0 && now - budget.lastRequest < 60000) return 'cooldown';
  budget = { attempts: budget.attempts + 1, lastRequest: now };
  budgets.set(key, budget);
  try { sessionStorage.setItem(`wl-route-budget:${key}`, JSON.stringify(budget)); } catch { /* In-memory fallback. */ }
  return 'reserved';
}

/** Distancia aproximada al segmento, suficiente para detectar desvíos GPS locales. */
export function distanceToRouteMeters(point: RoutePoint, route: RoutePoint[]): number {
  if (route.length < 2) return Infinity;
  const scale = Math.cos(point.lat * Math.PI / 180);
  const project = (p: RoutePoint) => ({ x: (p.lng - point.lng) * 111320 * scale, y: (p.lat - point.lat) * 111320 });
  let nearest = Infinity;
  for (let i = 1; i < route.length; i++) {
    const a = project(route[i - 1]);
    const b = project(route[i]);
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / length)) : 0;
    nearest = Math.min(nearest, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return nearest;
}
