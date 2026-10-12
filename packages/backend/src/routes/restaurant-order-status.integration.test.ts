/**
 * Contrato de avisos al comensal cuando el restaurante acepta o marca listo
 * un pedido (evidencia A).
 *
 * Cubre el lado servidor del reporte "no me aparece pedido aceptado / pedido
 * listo": si esta ruta deja de emitir el evento socket al room del cliente o
 * de enviar el push, el comensal con la app abierta no se entera por ningún
 * canal (en primer plano no hay push del sistema por diseño).
 *
 * Se mockean los colaboradores con efectos reales (BD, FCM), pero la ruta,
 * la autenticación, los esquemas y el cableado evento→destinatario son reales.
 */
import { OrderStatus, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';
import * as orderWorkflowService from '../services/order-workflow.service';
import * as notificationService from '../services/notification.service';
import * as socketService from '../services/socket.service';

function pickupOrder() {
  return {
    id: 'order-1',
    status: OrderStatus.CONFIRMED,
    fulfillmentType: 'PICKUP',
    preparationDeadlineAt: null,
    estimatedDeliveryTime: null,
    driverId: null,
    driver: null,
    customer: { user: { id: 'customer-user-1' } },
    restaurant: { id: 'restaurant-1', name: 'Tacos Centro', hasOwnDelivery: true },
  };
}

function deliveryOrder() {
  return {
    ...pickupOrder(),
    fulfillmentType: 'DELIVERY',
    status: OrderStatus.READY,
  };
}

describe('avisos al comensal al aceptar y marcar listo', () => {
  let app: FastifyInstance;
  let emitSpy: jest.SpyInstance;
  let pushSpy: jest.SpyInstance;

  beforeAll(async () => {
    app = await buildApp({ enableRateLimit: false, enableSocketIO: true, enableJobs: false });
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    // Guard de la ruta: el restaurante del JWT debe existir y estar ACTIVE.
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      status: 'ACTIVE',
      statusReason: null,
    } as never);
    jest
      .spyOn(orderWorkflowService, 'dequeueRestaurantOrder')
      .mockResolvedValue({ nextOrderId: null, queueLength: 0 } as never);
    emitSpy = jest.spyOn(socketService, 'emitNotification').mockImplementation(() => undefined);
    pushSpy = jest
      .spyOn(notificationService, 'sendPushNotification')
      .mockResolvedValue({ success: true, totalSent: 1, totalAttempted: 1 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  async function restaurantToken() {
    return app.jwt.sign({
      sub: 'restaurant-user-1',
      phone: '+5215599999999',
      role: UserRole.RESTAURANT,
    });
  }

  it('aceptar emite order:accepted al room del cliente y push de confirmación', async () => {
    const updateSpy = jest
      .spyOn(orderWorkflowService, 'updateOrderStatusByRestaurant')
      .mockResolvedValue(pickupOrder() as never);
    const token = await restaurantToken();

    const response = await app.inject({
      method: 'PATCH',
      url: '/restaurant-panel/pedidos/order-1/aceptar',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantUserId: 'restaurant-user-1',
        orderId: 'order-1',
        nextStatus: OrderStatus.CONFIRMED,
      })
    );

    // Socket al room CUSTOMER del comensal, con el estado nuevo.
    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      'customer-user-1',
      'CUSTOMER',
      'order:accepted',
      { orderId: 'order-1', status: OrderStatus.CONFIRMED },
      expect.objectContaining({ orderId: 'order-1' })
    );

    // Push al mismo comensal, con evento de confirmación (no de alarma).
    expect(pushSpy).toHaveBeenCalledWith(
      'customer-user-1',
      expect.objectContaining({
        title: expect.stringContaining('confirmado'),
        data: expect.objectContaining({ orderId: 'order-1', event: 'order:accepted' }),
      })
    );
    const pushPayload = pushSpy.mock.calls[0][1];
    expect(pushPayload.nativeRing).not.toBe(true);
    expect(String(pushPayload.tag || '')).not.toMatch(/^(new-order-|order-assigned-)/);
  });

  it('marcar listo (delivery) emite order:ready al room del cliente y push', async () => {
    jest
      .spyOn(orderWorkflowService, 'updateOrderStatusByRestaurant')
      .mockResolvedValue(deliveryOrder() as never);
    const token = await restaurantToken();

    const response = await app.inject({
      method: 'PATCH',
      url: '/restaurant-panel/pedidos/order-1/listo',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);

    expect(emitSpy).toHaveBeenCalledWith(
      expect.anything(),
      'customer-user-1',
      'CUSTOMER',
      'order:ready',
      { orderId: 'order-1', status: OrderStatus.READY },
      expect.objectContaining({ orderId: 'order-1' })
    );

    expect(pushSpy).toHaveBeenCalledWith(
      'customer-user-1',
      expect.objectContaining({
        data: expect.objectContaining({ orderId: 'order-1', event: 'order:ready' }),
      })
    );
    const pushPayload = pushSpy.mock.calls[0][1];
    expect(pushPayload.nativeRing).not.toBe(true);
  });

  it('rechaza sin autenticación antes de tocar el negocio', async () => {
    const updateSpy = jest.spyOn(orderWorkflowService, 'updateOrderStatusByRestaurant');

    const response = await app.inject({
      method: 'PATCH',
      url: '/restaurant-panel/pedidos/order-1/aceptar',
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
