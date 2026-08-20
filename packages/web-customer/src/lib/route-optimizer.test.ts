import {
  haversineKm,
  orderReferenceToTime,
  optimizeRoute,
  reorderByTokens,
  extractTokenFromRaw,
  computeShiftStats,
} from './route-optimizer';

describe('route-optimizer', () => {
  describe('haversineKm', () => {
    it('devuelve 0 para el mismo punto', () => {
      expect(haversineKm(19.0, -101.5, 19.0, -101.5)).toBe(0);
    });

    it('aproxima la distancia entre dos puntos conocidos', () => {
      // Puruarán -> Pátzcuaro (aprox ~40 km)
      const d = haversineKm(19.098, -101.521, 19.516, -101.609);
      expect(d).toBeGreaterThan(35);
      expect(d).toBeLessThan(50);
    });

    it('es simétrica', () => {
      const a = haversineKm(19.0, -101.0, 19.5, -102.0);
      const b = haversineKm(19.5, -102.0, 19.0, -101.0);
      expect(a).toBe(b);
    });
  });

  describe('orderReferenceToTime', () => {
    it('parsea el timestamp base36 de un orderReference SAD', () => {
      const ts = Date.now();
      const ref = `SAD-${ts.toString(36).toUpperCase()}-ABCDEF`;
      expect(orderReferenceToTime(ref)).toBe(ts);
    });

    it('devuelve 0 para referencias inválidas', () => {
      expect(orderReferenceToTime('')).toBe(0);
      expect(orderReferenceToTime('SAD-xyz')).toBe(0);
      expect(orderReferenceToTime('XYZ-123-ABC')).toBe(0);
    });
  });

  describe('extractTokenFromRaw', () => {
    it('extrae el token de una URL completa', () => {
      expect(extractTokenFromRaw('https://pideloporsadel.app/reparto/ver/abc123def456')).toBe('abc123def456');
    });

    it('acepta un token puro', () => {
      expect(extractTokenFromRaw('  abc123def456  ')).toBe('abc123def456');
    });

    it('acepta URL con query string', () => {
      expect(extractTokenFromRaw('https://pideloporsadel.app/reparto/ver/abc123def456?x=1')).toBe('abc123def456');
    });
  });

  describe('optimizeRoute', () => {
    // Origen en el restaurante (Puruarán).
    const origin = { lat: 19.098, lng: -101.521 };

    it('maneja lista vacía y de un solo elemento', () => {
      expect(optimizeRoute(origin, [])).toEqual({ orderedTokens: [], totalKm: 0, route: [] });
      const single = optimizeRoute(origin, [{ token: 'a', lat: 19.5, lng: -101.6, orderTime: 1 }]);
      expect(single.orderedTokens).toEqual(['a']);
      expect(single.totalKm).toBeGreaterThan(0);
    });

    it('ordena por cercanía desde el origen (vecino más cercano)', () => {
      // Punto B muy cerca del origen, punto A lejano: B debe ir primero.
      const points = [
        { token: 'A', lat: 20.0, lng: -102.0, orderTime: 100 }, // lejano, antiguo
        { token: 'B', lat: 19.1, lng: -101.5, orderTime: 200 }, // cercano
      ];
      const result = optimizeRoute(origin, points);
      expect(result.orderedTokens[0]).toBe('B');
      expect(result.orderedTokens[1]).toBe('A');
    });

    it('desempata por FIFO cuando las distancias son casi iguales', () => {
      // Ambos a distancia casi idéntica del origen: gana el más antiguo (menor orderTime).
      const points = [
        { token: 'viejo', lat: 19.2, lng: -101.6, orderTime: 50 },
        { token: 'nuevo', lat: 19.2, lng: -101.62, orderTime: 900 },
      ];
      const result = optimizeRoute(origin, points);
      expect(result.orderedTokens[0]).toBe('viejo');
    });

    it('ordena múltiples puntos (4) respetando distancia total razonable', () => {
      const points = [
        { token: 'p1', lat: 19.3, lng: -101.4, orderTime: 100 },
        { token: 'p2', lat: 19.2, lng: -101.7, orderTime: 200 },
        { token: 'p3', lat: 19.4, lng: -101.8, orderTime: 300 },
        { token: 'p4', lat: 19.05, lng: -101.52, orderTime: 400 },
      ];
      const result = optimizeRoute(origin, points);
      expect(result.orderedTokens).toHaveLength(4);
      expect(new Set(result.orderedTokens).size).toBe(4);
      // La ruta óptima no debe ser peor que el orden dado (greedy + 2-opt mejora o iguala).
      const givenOrder = ['p1', 'p2', 'p3', 'p4'];
      const givenDist = (seq: string[]) => {
        const pt = new Map(points.map((p) => [p.token, p]));
        let total = haversineKm(origin.lat, origin.lng, pt.get(seq[0])!.lat, pt.get(seq[0])!.lng);
        for (let i = 0; i < seq.length - 1; i++) {
          total += haversineKm(pt.get(seq[i])!.lat, pt.get(seq[i])!.lng, pt.get(seq[i + 1])!.lat, pt.get(seq[i + 1])!.lng);
        }
        return total;
      };
      expect(result.totalKm).toBeLessThanOrEqual(givenDist(givenOrder) + 1e-9);
    });

    it('escala a 15 pedidos sin errores', () => {
      const points = Array.from({ length: 15 }, (_, i) => ({
        token: `t${i}`,
        lat: 19.0 + Math.random() * 0.5,
        lng: -101.5 + Math.random() * 0.5,
        orderTime: 100 + i,
      }));
      const result = optimizeRoute(origin, points);
      expect(result.orderedTokens).toHaveLength(15);
      expect(new Set(result.orderedTokens).size).toBe(15);
    });
  });

  describe('reorderByTokens', () => {
    it('reordena por tokens dados y conserva los no listados al final', () => {
      const items = [
        { token: 'a', v: 1 },
        { token: 'b', v: 2 },
        { token: 'c', v: 3 },
      ];
      expect(reorderByTokens(items, ['c', 'a']).map((i) => i.token)).toEqual(['c', 'a', 'b']);
    });
  });

  describe('computeShiftStats', () => {
    it('calcula métricas correctas', () => {
      const deliveries = [
        { token: 'a', delivered: false, scannedAt: 100, data: { paymentMethod: 'CASH', totalAmount: 50 } },
        { token: 'b', delivered: false, scannedAt: 200, data: { paymentMethod: 'TRANSFER', totalAmount: 80 } },
        { token: 'c', delivered: true, scannedAt: 300, data: { paymentMethod: 'CASH', totalAmount: 30 } },
      ];
      const stats = computeShiftStats(deliveries as any);
      expect(stats.activeCount).toBe(2);
      expect(stats.completedCount).toBe(1);
      expect(stats.cashToCollect).toBe(50);
      expect(stats.cashCollected).toBe(30);
      expect(stats.totalToCollect).toBe(130);
      expect(stats.totalCollected).toBe(30);
      expect(stats.firstScan).toBe(100);
    });
  });
});