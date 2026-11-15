import { createOrderActionFlight, createOrderSyncGate, mergeConfirmedOrder, reconcileOrders } from './order-sync';

type Order = {
  id: string;
  status: string;
  updatedAt?: string;
  totalAmount: number;
  preparationTimeMinutes?: number;
  items?: Array<{ id: string; quantity: number }>;
  address?: { street: string; number: string };
  customer?: { user?: { name?: string } };
};

const base: Order = {
  id: 'order-1',
  status: 'PENDING',
  updatedAt: '2026-11-14T23:00:00.000Z',
  totalAmount: 163,
  items: [{ id: 'item-1', quantity: 1 }],
  address: { street: 'Avenida Ficticia', number: '42' },
  customer: { user: { name: 'Cliente Integral' } },
};

describe('fusión de datos confirmados del servidor', () => {
  it('conserva los campos completos que la respuesta parcial no incluye', () => {
    const merged = mergeConfirmedOrder(base, { id: 'order-1', status: 'CONFIRMED', updatedAt: '2026-11-14T23:00:05.000Z' });
    expect(merged.status).toBe('CONFIRMED');
    expect(merged.items).toEqual(base.items);
    expect(merged.address).toEqual(base.address);
    expect(merged.customer).toEqual(base.customer);
    expect(merged.totalAmount).toBe(163);
  });

  it('aplica solo los campos presentes en la respuesta', () => {
    const merged = mergeConfirmedOrder(base, { id: 'order-1', status: 'CONFIRMED', preparationTimeMinutes: 15, updatedAt: '2026-11-14T23:00:05.000Z' });
    expect(merged.preparationTimeMinutes).toBe(15);
    expect(merged.totalAmount).toBe(163);
  });

  it('ignora una respuesta más antigua que el estado actual', () => {
    const current: Order = { ...base, status: 'PREPARING', updatedAt: '2026-11-14T23:10:00.000Z' };
    const merged = mergeConfirmedOrder(current, { id: 'order-1', status: 'CONFIRMED', updatedAt: '2026-11-14T23:00:05.000Z' });
    expect(merged.status).toBe('PREPARING');
  });

  it('no retrocede el estado con una respuesta sin marca de tiempo', () => {
    const current: Order = { ...base, status: 'PREPARING', updatedAt: '2026-11-14T23:10:00.000Z' };
    const merged = mergeConfirmedOrder(current, { id: 'order-1', status: 'CONFIRMED' });
    expect(merged.status).toBe('PREPARING');
  });

  it('ignora una respuesta de otro pedido', () => {
    const merged = mergeConfirmedOrder(base, { id: 'otro-pedido', status: 'READY' });
    expect(merged).toBe(base);
  });

  it('reconcilia la lista completa con el servidor sin perder pedidos locales', () => {
    const local: Order[] = [{ ...base, status: 'CONFIRMED' }];
    const remote: Order[] = [{ ...base, status: 'CONFIRMED', updatedAt: '2026-11-14T23:00:05.000Z' }];
    const result = reconcileOrders(local, remote);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('CONFIRMED');
  });
});

describe('puerta de sincronización', () => {
  it('descarta una respuesta que começou antes de la última carga', () => {
    const gate = createOrderSyncGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.current(first)).toBe(false);
    expect(gate.current(second)).toBe(true);
  });

  it('descarta respuestas en curso cuando la sesión o el pedido cambian', () => {
    const gate = createOrderSyncGate();
    const ticket = gate.begin();
    expect(gate.current(ticket)).toBe(true);
    gate.invalidate();
    expect(gate.current(ticket)).toBe(false);
  });
});

describe('protección contra doble clic', () => {
  it('permite una sola operación concurrente por pedido', () => {
    const flight = createOrderActionFlight();
    expect(flight.acquire('order-1')).toBe(true);
    expect(flight.acquire('order-1')).toBe(false);
    expect(flight.acquire('order-2')).toBe(true);
  });

  it('libera el bloqueo al terminar la operación', () => {
    const flight = createOrderActionFlight();
    flight.acquire('order-1');
    flight.release('order-1');
    expect(flight.acquire('order-1')).toBe(true);
    expect(flight.has('order-1')).toBe(true);
  });
});
