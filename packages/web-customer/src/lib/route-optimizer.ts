/**
 * Utilidades puras para la "Ruta Inteligente" del repartidor propio.
 *
 * Todas las funciones son puras (sin estado ni I/O) para poder testearlas de
 * forma aislada. El algoritmo combina una semilla greedy (vecino más cercano)
 * con una mejora local 2-opt, y desempata por FIFO (pedido más antiguo primero)
 * cuando dos destinos están a distancia casi igual.
 */

export type RoutePoint = {
  token: string;
  lat: number;
  lng: number;
  /** Timestamp numérico (ms) del pedido; se extrae de orderReference (base36). */
  orderTime: number;
};

export type RouteResult = {
  orderedTokens: string[];
  totalKm: number;
  /** Distancia desde el origen al primer destino + recorrido completo. */
  route: string[];
};

/** Distancia haversine en kilómetros entre dos puntos geográficos. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Extrae el timestamp (ms) de un orderReference tipo "SAD-<base36 timestamp>-<random>".
 * Si no se puede parsear, devuelve 0 (equivale a "muy antiguo" para FIFO).
 */
export function orderReferenceToTime(orderReference: string): number {
  if (!orderReference) return 0;
  const parts = orderReference.split('-');
  if (parts.length >= 3 && parts[0] === 'SAD') {
    const ts = parseInt(parts[1], 36);
    if (Number.isFinite(ts) && ts > 0) return ts;
  }
  return 0;
}

/**
 * Ordena los puntos de entrega empezando desde el origen (restaurante) con la
 * heurística vecino más cercano y mejora 2-opt. Desempata por orderTime (FIFO).
 * Escala bien para decenas de pedidos (2-opt con iteraciones limitadas).
 */
export function optimizeRoute(
  origin: { lat: number; lng: number },
  points: RoutePoint[]
): RouteResult {
  if (points.length === 0) {
    return { orderedTokens: [], totalKm: 0, route: [] };
  }
  if (points.length === 1) {
    const single = points[0];
    const d = haversineKm(origin.lat, origin.lng, single.lat, single.lng);
    return { orderedTokens: [single.token], totalKm: d, route: [single.token] };
  }

  // Matriz de distancias (km) entre todos los puntos (incluido origen).
  const n = points.length;
  const dist: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }

  // Distancia desde el origen a cada punto.
  const fromOrigin = points.map((p) => haversineKm(origin.lat, origin.lng, p.lat, p.lng));

  // Semilla greedy: partir del destino más cercano al origen y encadenar por
  // vecino más cercano, con desempate FIFO.
  const order: number[] = [];
  const visited = new Set<number>();
  let current = -1; // -1 = origen
  while (order.length < n) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;
      const d = current === -1 ? fromOrigin[i] : dist[current][i];
      // Desempate por distancia: si está casi igual (±15%), gana el más antiguo.
      if (
        d < bestDist * 0.85 ||
        (d <= bestDist * 1.15 && points[i].orderTime < (order.length > 0 ? points[order[order.length - 1]].orderTime : Infinity))
      ) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    visited.add(bestIdx);
    order.push(bestIdx);
    current = bestIdx;
  }

  // Mejora 2-opt: intercambiar dos tramos y aceptar si reduce la ruta total.
  const routeDist = (seq: number[]): number => {
    let total = fromOrigin[seq[0]];
    for (let k = 0; k < seq.length - 1; k++) {
      total += dist[seq[k]][seq[k + 1]];
    }
    return total;
  };

  let improved = true;
  let iterations = 0;
  const MAX_ITER = n * n * 2;
  while (improved && iterations < MAX_ITER) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const currentDist = routeDist(order);
        const candidate = [...order];
        candidate.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse());
        const candidateDist = routeDist(candidate);
        if (candidateDist < currentDist - 1e-9) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
    iterations++;
  }

  const totalKm = routeDist(order);
  const route = order.map((i) => points[i].token);
  return { orderedTokens: route, totalKm, route };
}

/**
 * Reordena una lista de entregas según un orden dado por tokens.
 * Los que no estén en el orden se conservan al final.
 */
export function reorderByTokens<T extends { token: string }>(
  items: T[],
  orderedTokens: string[]
): T[] {
  const byToken = new Map(items.map((it) => [it.token, it]));
  const result: T[] = [];
  for (const t of orderedTokens) {
    const item = byToken.get(t);
    if (item) {
      result.push(item);
      byToken.delete(t);
    }
  }
  for (const item of byToken.values()) result.push(item);
  return result;
}

/** Extrae el token de un raw que puede ser una URL completa o el token puro. */
export function extractTokenFromRaw(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/(?:reparto\/ver\/)?([a-f0-9]{8,})/i);
  return match ? match[1] : trimmed;
}

/** Calcula las métricas de la jornada del repartidor a partir de sus entregas. */
export function computeShiftStats<T extends { token: string; delivered: boolean; scannedAt?: number; data: { paymentMethod: string; totalAmount: number } }>(deliveries: T[]) {
  const active = deliveries.filter((d) => !d.delivered);
  const completed = deliveries.filter((d) => d.delivered);
  const cashToCollect = active
    .filter((d) => d.data.paymentMethod === 'CASH')
    .reduce((sum, d) => sum + (d.data.totalAmount || 0), 0);
  const cashCollected = completed
    .filter((d) => d.data.paymentMethod === 'CASH')
    .reduce((sum, d) => sum + (d.data.totalAmount || 0), 0);
  const totalToCollect = active.reduce((sum, d) => sum + (d.data.totalAmount || 0), 0);
  const totalCollected = completed.reduce((sum, d) => sum + (d.data.totalAmount || 0), 0);
  const firstScan = deliveries.length > 0
    ? Math.min(...deliveries.map((d) => d.scannedAt || 0))
    : 0;
  return {
    activeCount: active.length,
    completedCount: completed.length,
    cashToCollect,
    cashCollected,
    totalToCollect,
    totalCollected,
    firstScan,
  };
}