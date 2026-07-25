import { PaymentMethod, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';
import { AppError } from '../errors/app-error';
import * as orderService from '../services/order.service';
import * as orderWorkflowService from '../services/order-workflow.service';
import * as socketService from '../services/socket.service';

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

describe('order lifecycle failure contracts', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      enableRateLimit: false,
      enableSocketIO: false,
    });
  });

  beforeEach(() => {
    jest.spyOn(orderWorkflowService, 'autoAssignDriver').mockResolvedValue({
      success: false,
      driver: null,
      order: null,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  async function createToken(payload: { sub: string; phone: string; role: UserRole }) {
    return app.jwt.sign(payload);
  }

  it('rechaza asignar repartidor no disponible y no emite sockets basura', async () => {
    const restaurantToken = await createToken({
      sub: 'restaurant-user-1',
      phone: '+5215533333333',
      role: UserRole.RESTAURANT,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    jest.spyOn(orderWorkflowService, 'assignDriverToOrder').mockRejectedValue(
      new AppError(
        409,
        'DRIVER_NOT_AVAILABLE',
        'El repartidor no esta disponible o no pertenece a la region.'
      )
    );

    const response = await app.inject({
      method: 'POST',
      url: '/restaurant-panel/pedidos/order-1/asignar-repartidor',
      headers: {
        authorization: `Bearer ${restaurantToken}`,
      },
      payload: {
        driverId: 'driver-1',
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string; message: string };
    }>(response.body);

    expect(response.statusCode).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DRIVER_NOT_AVAILABLE');
    expect(emitNotificationSpy).not.toHaveBeenCalled();
  });

  it('rechaza transiciones invalidas del restaurante y evita notificaciones inconsistentes', async () => {
    const restaurantToken = await createToken({
      sub: 'restaurant-user-1',
      phone: '+5215533333333',
      role: UserRole.RESTAURANT,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    jest.spyOn(orderWorkflowService, 'updateOrderStatusByRestaurant').mockRejectedValue(
      new AppError(
        409,
        'INVALID_ORDER_TRANSITION',
        'La accion no es valida para el estado actual del pedido.'
      )
    );

    const response = await app.inject({
      method: 'PATCH',
      url: '/restaurant-panel/pedidos/order-1/listo',
      headers: {
        authorization: `Bearer ${restaurantToken}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string };
    }>(response.body);

    expect(response.statusCode).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_ORDER_TRANSITION');
    expect(emitNotificationSpy).not.toHaveBeenCalled();
  });

  it('rechaza acciones invalidas del driver y no avanza el flujo en silencio', async () => {
    const driverToken = await createToken({
      sub: 'driver-user-1',
      phone: '+5215544444444',
      role: UserRole.DRIVER,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    jest.spyOn(orderWorkflowService, 'updateOrderStatusByDriver').mockRejectedValue(
      new AppError(
        409,
        'INVALID_ORDER_TRANSITION',
        'La accion no es valida para el estado actual del pedido.'
      )
    );

    const response = await app.inject({
      method: 'PATCH',
      url: '/driver-panel/pedidos/order-1/entregado',
      headers: {
        authorization: `Bearer ${driverToken}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string };
    }>(response.body);

    expect(response.statusCode).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_ORDER_TRANSITION');
    expect(emitNotificationSpy).not.toHaveBeenCalled();
  });

  it('protege el historial del cliente cuando no existe el perfil asociado', async () => {
    const customerToken = await createToken({
      sub: 'customer-user-missing',
      phone: '+5215511111111',
      role: UserRole.CUSTOMER,
    });

    const customerFindUniqueSpy = jest.spyOn(prisma.customer, 'findUnique') as unknown as jest.Mock;
    customerFindUniqueSpy.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/me/pedidos?page=1&limit=10',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string; message: string };
    }>(response.body);

    expect(response.statusCode).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('protege el panel del driver cuando no existe perfil operativo', async () => {
    const driverToken = await createToken({
      sub: 'driver-user-missing',
      phone: '+5215544444444',
      role: UserRole.DRIVER,
    });

    const driverFindUniqueSpy = jest.spyOn(prisma.driver, 'findUnique') as unknown as jest.Mock;
    driverFindUniqueSpy.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/driver-panel/pedidos/pendientes',
      headers: {
        authorization: `Bearer ${driverToken}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string; message: string };
    }>(response.body);

    expect(response.statusCode).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DRIVER_NOT_FOUND');
  });

  it('bloquea crear pedido sin sesion antes de tocar servicios de negocio', async () => {
    const createOrderSpy = jest.spyOn(orderService, 'createOrderForCustomer');

    const response = await app.inject({
      method: 'POST',
      url: '/pedidos',
      payload: {
        restaurantId: 'restaurant-1',
        items: [
          {
            productId: 'product-1',
            quantity: 1,
          },
        ],
        deliveryAddress: {
          street: 'Av. Juarez',
          number: '15',
          neighborhood: 'Centro',
          city: 'CDMX',
          state: 'CDMX',
          zipCode: '06000',
          country: 'MX',
          latitude: 19.4326,
          longitude: -99.1332,
        },
        paymentMethod: PaymentMethod.CASH,
      },
    });

    const body = parseJson<{
      success: boolean;
      meta: { requestId: string };
      error: { code: string };
    }>(response.body);

    expect(response.statusCode).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(typeof body.meta.requestId).toBe('string');
    expect(response.headers['x-request-id']).toBe(body.meta.requestId);
    expect(createOrderSpy).not.toHaveBeenCalled();
  });

  it('rechaza acceso cruzado entre roles antes de operar el pedido', async () => {
    const customerToken = await createToken({
      sub: 'customer-user-1',
      phone: '+5215511111111',
      role: UserRole.CUSTOMER,
    });

    const workflowSpy = jest.spyOn(orderWorkflowService, 'updateOrderStatusByRestaurant');

    const response = await app.inject({
      method: 'PATCH',
      url: '/restaurant-panel/pedidos/order-1/aceptar',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string };
    }>(response.body);

    expect(response.statusCode).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(workflowSpy).not.toHaveBeenCalled();
  });

  it('refleja cuando el driver ya no esta disponible para aceptar un pedido', async () => {
    const driverToken = await createToken({
      sub: 'driver-user-1',
      phone: '+5215544444444',
      role: UserRole.DRIVER,
    });

    jest.spyOn(orderWorkflowService, 'updateOrderStatusByDriver').mockRejectedValue(
      new AppError(
        409,
        'DRIVER_NOT_AVAILABLE',
        'El repartidor no esta disponible para aceptar pedidos.'
      )
    );

    const response = await app.inject({
      method: 'PATCH',
      url: '/driver-panel/pedidos/order-1/aceptar',
      headers: {
        authorization: `Bearer ${driverToken}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string; message: string };
    }>(response.body);

    expect(response.statusCode).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DRIVER_NOT_AVAILABLE');
  });
});
