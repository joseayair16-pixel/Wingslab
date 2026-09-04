/**
 * Regresión: un pedido llegaba duplicado al restaurante cuando el cliente
 * reintentaba la creación (red caída, timeout o doble toque) porque el front
 * regeneraba el clientOrderKey entre intentos. La garantía última es el
 * backend: la misma clientOrderKey NUNCA crea un segundo pedido.
 */
import { createOrderForCustomer } from './order.service';

const ACTIVE_CUSTOMER = {
  id: 'cust-1',
  isSuspendedByDebt: false,
  debtAmount: 0,
  user: { status: 'ACTIVE' },
};

function buildInput(overrides: Record<string, unknown> = {}) {
  return {
    restaurantId: 'rest-1',
    fulfillmentType: 'DELIVERY',
    paymentMethod: 'CASH',
    clientOrderKey: 'key-abc-12345',
    items: [],
    ...overrides,
  } as any;
}

describe('createOrderForCustomer — idempotencia por clientOrderKey', () => {
  it('devuelve el pedido existente sin crear uno nuevo (reintento tras timeout)', async () => {
    const existingOrder = { id: 'order-9', orderReference: 'SD-9', customerId: 'cust-1' };
    const prisma: any = {
      customer: { findUnique: jest.fn().mockResolvedValue(ACTIVE_CUSTOMER) },
      order: { findUnique: jest.fn().mockResolvedValue(existingOrder) },
      restaurant: { findUnique: jest.fn() },
    };

    const result = await createOrderForCustomer({
      prisma,
      customerUserId: 'user-1',
      input: buildInput(),
    } as any);

    expect(result.isDuplicate).toBe(true);
    expect(result.order.id).toBe('order-9');
    // La idempotencia corta el flujo: jamás toca restaurantes ni crea nada.
    expect(prisma.restaurant.findUnique).not.toHaveBeenCalled();
  });

  it('rechaza si la clave pertenece a OTRO cliente', async () => {
    const foreignOrder = { id: 'order-2', orderReference: 'SD-2', customerId: 'cust-otro' };
    const prisma: any = {
      customer: { findUnique: jest.fn().mockResolvedValue(ACTIVE_CUSTOMER) },
      order: { findUnique: jest.fn().mockResolvedValue(foreignOrder) },
      restaurant: { findUnique: jest.fn() },
    };

    await expect(
      createOrderForCustomer({
        prisma,
        customerUserId: 'user-1',
        input: buildInput(),
      } as any)
    ).rejects.toMatchObject({ code: 'ORDER_IDEMPOTENCY_FORBIDDEN' });
  });

  it('sin pedido previo con esa clave, continúa el flujo normal de creación', async () => {
    const prisma: any = {
      customer: { findUnique: jest.fn().mockResolvedValue(ACTIVE_CUSTOMER) },
      order: { findUnique: jest.fn().mockResolvedValue(null) },
      // Sin restaurante → el flujo continúa y falla después del check de
      // idempotencia, probando que no se deduplicó por error.
      restaurant: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      createOrderForCustomer({
        prisma,
        customerUserId: 'user-1',
        input: buildInput(),
      } as any)
    ).rejects.toMatchObject({ code: 'RESTAURANT_NOT_FOUND' });

    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clientOrderKey: 'key-abc-12345' } })
    );
  });
});
