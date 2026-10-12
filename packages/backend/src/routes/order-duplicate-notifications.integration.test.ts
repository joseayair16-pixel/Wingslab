/**
 * Regresión: cuando el backend responde `isDuplicate`, la ruta NO debe volver a
 * encolar el pedido ni emitir notificaciones (socket, push, WhatsApp).
 *
 * Un reintento del cliente (doble toque, timeout, recarga) llega por la misma
 * ruta que un pedido nuevo; si la ruta no respetara `isDuplicate`, el
 * restaurante vería el mismo pedido dos veces en su bandeja.
 */
import { OrderStatus, PaymentMethod, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';
import * as orderService from '../services/order.service';
import * as orderWorkflowService from '../services/order-workflow.service';
import * as notificationService from '../services/notification.service';
import * as socketService from '../services/socket.service';

const duplicateOrder = {
  id: 'order-dup-1',
  orderReference: 'SAD-DUP-1',
  totalAmount: 245,
  paymentMethod: PaymentMethod.CASH,
  status: OrderStatus.PENDING,
  createdAt: new Date('2026-01-01T12:00:00.000Z'),
  restaurant: {
    id: 'restaurant-1',
    userId: 'restaurant-user-1',
    name: 'Tacos Centro',
    hasOwnDelivery: false,
    deliveryFee: 35,
  },
  customer: {
    id: 'customer-1',
    user: { id: 'customer-user-1', name: 'Cliente Demo', phone: '+5215511111111' },
  },
  tracking: [],
  items: [],
  address: { id: 'address-1' },
};

describe('POST /pedidos — un reintento duplicado no vuelve a notificar', () => {
  let app: FastifyInstance;
  let enqueueSpy: jest.SpyInstance;
  let emitSpy: jest.SpyInstance;
  let pushSpy: jest.SpyInstance;
  let createSpy: jest.SpyInstance;

  beforeAll(async () => {
    app = await buildApp({ enableRateLimit: false, enableSocketIO: true, enableJobs: false });
  });

  beforeEach(() => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      status: 'ACTIVE',
      statusReason: null,
    } as never);
    jest.spyOn(prisma.pushSubscription, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.fcmToken, 'findMany').mockResolvedValue([] as never);

    enqueueSpy = jest
      .spyOn(orderWorkflowService, 'enqueueRestaurantOrder')
      .mockResolvedValue({ position: 1, queueLength: 1 } as never);
    emitSpy = jest.spyOn(socketService, 'emitNotification').mockImplementation(() => undefined);
    pushSpy = jest.spyOn(notificationService, 'sendPushNotification').mockResolvedValue(undefined as never);
    createSpy = jest
      .spyOn(orderService, 'createOrderForCustomer')
      .mockResolvedValue({ order: duplicateOrder, isDuplicate: true } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  async function postOrder() {
    const token = await app.jwt.sign({
      sub: 'customer-user-1',
      phone: '+5215511111111',
      role: UserRole.CUSTOMER,
    });
    return app.inject({
      method: 'POST',
      url: '/pedidos',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        restaurantId: 'restaurant-1',
        clientOrderKey: 'clave-idempotente-1234',
        items: [{ productId: 'product-1', quantity: 1 }],
        fulfillmentType: 'DELIVERY',
        paymentMethod: PaymentMethod.CASH,
        deliveryAddress: {
          street: 'Av 1',
          number: '10',
          neighborhood: 'Centro',
          city: 'CDMX',
          state: 'CDMX',
          zipCode: '06000',
          country: 'MX',
          latitude: 19.43,
          longitude: -99.13,
        },
      },
    });
  }

  it('devuelve 200 con isDuplicate y NO encola ni notifica', async () => {
    const response = await postOrder();

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.success).toBe(true);
    expect(payload.isDuplicate).toBe(true);
    expect(payload.data.id).toBe('order-dup-1');

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0][0].input.clientOrderKey).toBe('clave-idempotente-1234');

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('reintentos repetidos del mismo cliente tampoco notifican', async () => {
    await postOrder();
    await postOrder();
    await postOrder();

    expect(createSpy).toHaveBeenCalledTimes(3);
    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('un pedido nuevo sí se encola y notifica (control: no se rompió el camino feliz)', async () => {
    createSpy.mockResolvedValue({ order: duplicateOrder, isDuplicate: false } as never);

    const response = await postOrder();

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body).isDuplicate).toBe(false);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });
});