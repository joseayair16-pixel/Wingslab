/**
 * Contrato de las acciones de pedidos del restaurante en WingsLab:
 *  - cualquier pedido del restaurante puede avanzar por una transición válida;
 *  - JWT, rol RESTAURANT y restaurante ACTIVE siguen siendo obligatorios;
 *  - el evento de socket va a la sala del propio restaurante y al cliente;
 *  - no se emite nada hacia otras salas de restaurante.
 */
import { OrderStatus, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';
import * as orderWorkflowService from '../services/order-workflow.service';
import * as notificationService from '../services/notification.service';
import * as socketService from '../services/socket.service';
import { AppError } from '../errors/app-error';

const ORDER_ID = 'wl_order_action_fixture';

function committedOrder() {
  return {
    id: ORDER_ID,
    orderReference: 'WL-TEST-001',
    status: OrderStatus.CONFIRMED,
    fulfillmentType: 'DELIVERY',
    paymentMethod: 'CASH',
    preparationTimeMinutes: 15,
    preparationDeadlineAt: new Date(),
    estimatedDeliveryTime: new Date(),
    driverId: null,
    driver: null,
    customer: { user: { id: 'customer-user-1', name: 'Cliente' } },
    restaurant: {
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      name: 'WingsLab Restaurante de Prueba',
      businessType: 'RESTAURANT',
      hasOwnDelivery: true,
    },
  };
}

describe('acciones manuales del restaurante', () => {
  let app: FastifyInstance;
  let emitSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;

  beforeAll(async () => {
    app = await buildApp({ enableRateLimit: false, enableSocketIO: true, enableJobs: false });
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      status: 'ACTIVE',
      statusReason: null,
    } as never);
    jest.spyOn(orderWorkflowService, 'dequeueRestaurantOrder')
      .mockResolvedValue({ nextOrderId: null, queueLength: 0 } as never);
    jest.spyOn(notificationService, 'sendPushNotification')
      .mockResolvedValue({ success: true, totalSent: 1, totalAttempted: 1 });
    emitSpy = jest.spyOn(socketService, 'emitNotification').mockImplementation(() => undefined);
    updateSpy = jest.spyOn(orderWorkflowService, 'updateOrderStatusByRestaurant')
      .mockResolvedValue(committedOrder() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  async function restaurantToken(role: UserRole = UserRole.RESTAURANT) {
    return app.jwt.sign({ sub: 'restaurant-user-1', phone: '+5215599999999', role });
  }

  it('permite un pedido fuera de cualquier lista de pruebas y delega propiedad/estado al servicio', async () => {
    const token = await restaurantToken();
    const response = await app.inject({
      method: 'PATCH',
      url: `/restaurant-panel/pedidos/${ORDER_ID}/aceptar`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      restaurantUserId: 'restaurant-user-1',
      orderId: ORDER_ID,
      nextStatus: OrderStatus.PREPARING,
    }));
  });

  it('exige sesión y rol de restaurante', async () => {
    const anonymous = await app.inject({ method: 'PATCH', url: `/restaurant-panel/pedidos/${ORDER_ID}/aceptar`, payload: {} });
    expect(anonymous.statusCode).toBe(401);

    const customer = await restaurantToken(UserRole.CUSTOMER);
    const wrongRole = await app.inject({
      method: 'PATCH',
      url: `/restaurant-panel/pedidos/${ORDER_ID}/aceptar`,
      headers: { authorization: `Bearer ${customer}` },
      payload: {},
    });
    expect(wrongRole.statusCode).toBe(403);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('confirma la transición y notifica al cliente y a la sala del propio restaurante', async () => {
    const token = await restaurantToken();
    const response = await app.inject({
      method: 'PATCH',
      url: `/restaurant-panel/pedidos/${ORDER_ID}/aceptar`,
      headers: { authorization: `Bearer ${token}` },
      payload: { preparationTimeMinutes: 15 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe(OrderStatus.CONFIRMED);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      restaurantUserId: 'restaurant-user-1',
      orderId: ORDER_ID,
      nextStatus: OrderStatus.PREPARING,
      preparationTimeMinutes: 15,
    }));

    const customerEmits = emitSpy.mock.calls.filter(call => call[2] === 'CUSTOMER');
    expect(customerEmits).toHaveLength(1);
    expect(customerEmits[0][1]).toBe('customer-user-1');
    expect(customerEmits[0][3]).toBe('order:accepted');

    const restaurantEmits = emitSpy.mock.calls.filter(call => call[2] === 'RESTAURANT');
    expect(restaurantEmits).toHaveLength(1);
    expect(restaurantEmits[0][1]).toBe('restaurant-user-1');
    expect(restaurantEmits[0][3]).toBe('order:accepted');

    // Ninguna sala de otro restaurante recibe el evento.
    const foreignRooms = emitSpy.mock.calls
      .filter(call => call[2] === 'RESTAURANT')
      .filter(call => call[1] !== 'restaurant-user-1');
    expect(foreignRooms).toHaveLength(0);
  });

  it('no permite reintentos ciegos: el cliente debe consultar antes de repetir', async () => {
    const token = await restaurantToken();
    const response = await app.inject({
      method: 'PATCH',
      url: `/restaurant-panel/pedidos/${ORDER_ID}/aceptar`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(200);

    // La segunda operación compite con el estado ya cambiado; el servicio
    // rechaza el estado obsoleto y la ruta no emite notificaciones prematuras.
    updateSpy.mockRejectedValueOnce(new AppError(409, 'INVALID_ORDER_TRANSITION', 'Estado no válido.'));
    const conflict = await app.inject({
      method: 'PATCH',
      url: `/restaurant-panel/pedidos/${ORDER_ID}/aceptar`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(conflict.statusCode).toBe(409);
    expect(updateSpy).toHaveBeenCalledTimes(2);
  });

  it('rechaza de forma segura un pedido ajeno o en estado inválido', async () => {
    const token = await restaurantToken();
    updateSpy.mockRejectedValueOnce(new AppError(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado para este restaurante.'));
    const response = await app.inject({
      method: 'PATCH',
      url: `/restaurant-panel/pedidos/${ORDER_ID}/aceptar`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
