import { DriverAvailability, DriverStatus, OrderStatus, PaymentMethod, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';
import { AppError } from '../errors/app-error';
import * as orderService from '../services/order.service';
import * as restaurantBillingService from '../services/restaurant-billing.service';
import * as orderWorkflowService from '../services/order-workflow.service';
import * as socketService from '../services/socket.service';

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

function orderMetaMatcher(orderId: string): unknown {
  return expect.objectContaining({
    requestId: expect.any(String) as unknown,
    orderId,
  }) as unknown;
}

describe('http integration contracts', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      enableRateLimit: false,
      enableSocketIO: false,
    });
  });

  beforeEach(() => {
    jest.spyOn(prisma.pushSubscription, 'findMany').mockResolvedValue([] as never);
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

  it('crea pedidos y devuelve el contrato esperado para clientes autenticados', async () => {
    const token = await createToken({
      sub: 'customer-user-1',
      phone: '+5215511111111',
      role: UserRole.CUSTOMER,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    jest.spyOn(orderService, 'createOrderForCustomer').mockResolvedValue({
      id: 'order-1',
      orderReference: 'SAD-ORDER-1',
      totalAmount: 245,
      paymentMethod: PaymentMethod.CASH,
      status: OrderStatus.PENDING,
      restaurant: {
        id: 'restaurant-1',
        userId: 'restaurant-user-1',
        name: 'Tacos Centro',
        hasOwnDelivery: false,
        deliveryFee: 35,
      },
      customer: {
        id: 'customer-1',
        user: {
          id: 'customer-user-1',
          name: 'Cliente Demo',
          phone: '+5215511111111',
        },
      },
      tracking: [],
      items: [],
      address: {
        id: 'address-1',
      },
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/pedidos',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        restaurantId: 'restaurant-1',
        items: [
          {
            productId: 'product-1',
            quantity: 2,
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
        notes: 'Sin cebolla',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; orderReference: string; totalAmount: number; status: OrderStatus };
    }>(response.body);

    expect(response.statusCode).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('order-1');
    expect(body.data.orderReference).toBe('SAD-ORDER-1');
    expect(body.data.totalAmount).toBe(245);
    expect(body.data.status).toBe(OrderStatus.PENDING);
    expect(emitNotificationSpy).toHaveBeenCalledWith(
      expect.anything(),
      'restaurant-user-1',
      'RESTAURANT',
      'order:created',
      expect.objectContaining({
        orderId: 'order-1',
        customerName: 'Cliente Demo',
      }),
      orderMetaMatcher('order-1')
    );
  });

  it('acepta pedidos por transferencia con comprobante de pago', async () => {
    const token = await createToken({
      sub: 'customer-user-2',
      phone: '+5215512121212',
      role: UserRole.CUSTOMER,
    });

    jest.spyOn(orderService, 'createOrderForCustomer').mockResolvedValue({
      id: 'order-transfer-1',
      orderReference: 'SAD-TRANSFER-1',
      totalAmount: 310,
      paymentMethod: PaymentMethod.TRANSFER,
      paymentProofUrl: 'https://images.example.com/payment-proof.jpg',
      status: OrderStatus.PENDING,
      restaurant: {
        id: 'restaurant-1',
        userId: 'restaurant-user-1',
        name: 'Tacos Centro',
        hasOwnDelivery: false,
        deliveryFee: 35,
      },
      customer: {
        id: 'customer-2',
        user: {
          id: 'customer-user-2',
          name: 'Cliente Transfer',
          phone: '+5215512121212',
        },
      },
      tracking: [],
      items: [],
      address: {
        id: 'address-2',
      },
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/pedidos',
      headers: {
        authorization: `Bearer ${token}`,
      },
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
          number: '20',
          neighborhood: 'Centro',
          city: 'CDMX',
          state: 'CDMX',
          zipCode: '06000',
          country: 'MX',
          latitude: 19.4326,
          longitude: -99.1332,
        },
        paymentMethod: PaymentMethod.TRANSFER,
        paymentProofUrl: 'https://images.example.com/payment-proof.jpg',
      },
    });

    expect(response.statusCode).toBe(201);
  });

  it('propaga errores de dominio tipados al crear pedidos', async () => {
    const token = await createToken({
      sub: 'customer-user-1',
      phone: '+5215511111111',
      role: UserRole.CUSTOMER,
    });

    jest.spyOn(orderService, 'createOrderForCustomer').mockRejectedValue(
      new AppError(
        409,
        'RESTAURANT_NOT_AVAILABLE',
        'El restaurante no esta disponible para recibir pedidos.'
      )
    );

    const response = await app.inject({
      method: 'POST',
      url: '/pedidos',
      headers: {
        authorization: `Bearer ${token}`,
      },
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
      error: { code: string; message: string };
    }>(response.body);

    expect(response.statusCode).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RESTAURANT_NOT_AVAILABLE');
  });

  it('propaga el avance del restaurante al cliente por sockets', async () => {
    const token = await createToken({
      sub: 'restaurant-user-1',
      phone: '+5215533333333',
      role: UserRole.RESTAURANT,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    jest.spyOn(orderWorkflowService, 'updateOrderStatusByRestaurant').mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.CONFIRMED,
      customer: {
        user: {
          id: 'customer-user-1',
          name: 'Cliente Demo',
        },
      },
      restaurant: {
        id: 'restaurant-1',
        userId: 'restaurant-user-1',
        name: 'Tacos Centro',
      },
      driver: null,
      tracking: [],
    } as never);

    const response = await app.inject({
      method: 'PATCH',
      url: '/restaurant-panel/pedidos/order-1/aceptar',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; status: OrderStatus };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('order-1');
    expect(body.data.status).toBe(OrderStatus.CONFIRMED);
    expect(emitNotificationSpy).toHaveBeenCalledWith(
      expect.anything(),
      'customer-user-1',
      'CUSTOMER',
      'order:accepted',
      {
        orderId: 'order-1',
        status: OrderStatus.CONFIRMED,
      },
      orderMetaMatcher('order-1')
    );
  });

  it('asigna repartidor y notifica tanto al driver como al cliente', async () => {
    const token = await createToken({
      sub: 'restaurant-user-1',
      phone: '+5215533333333',
      role: UserRole.RESTAURANT,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    jest.spyOn(orderWorkflowService, 'assignDriverToOrder').mockResolvedValue({
      id: 'order-1',
      orderReference: 'SAD-ORDER-1',
      restaurant: {
        id: 'restaurant-1',
        userId: 'restaurant-user-1',
        name: 'Tacos Centro',
      },
      customer: {
        user: {
          id: 'customer-user-1',
          name: 'Cliente Demo',
        },
      },
      driver: {
        id: 'driver-1',
        userId: 'driver-user-1',
        user: {
          id: 'driver-user-1',
          name: 'Luis Repartidor',
          phone: '+5215544444444',
        },
      },
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/restaurant-panel/pedidos/order-1/asignar-repartidor',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        driverId: 'driver-1',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; orderReference: string };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('order-1');
    expect(body.data.orderReference).toBe('SAD-ORDER-1');
    expect(emitNotificationSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'driver-user-1',
      'DRIVER',
      'order:assigned',
      expect.objectContaining({
        orderId: 'order-1',
        orderReference: 'SAD-ORDER-1',
        restaurantName: 'Tacos Centro',
        customerName: 'Cliente Demo',
      }),
      orderMetaMatcher('order-1')
    );
    expect(emitNotificationSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'customer-user-1',
      'CUSTOMER',
      'order:driver-assigned',
      {
        orderId: 'order-1',
        driverName: 'Luis Repartidor',
      },
      orderMetaMatcher('order-1')
    );
  });

  it('cierra la entrega del driver y notifica al restaurante y al cliente', async () => {
    const token = await createToken({
      sub: 'driver-user-1',
      phone: '+5215544444444',
      role: UserRole.DRIVER,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    jest.spyOn(orderWorkflowService, 'updateOrderStatusByDriver').mockResolvedValue({
      id: 'order-1',
      restaurant: {
        userId: 'restaurant-user-1',
        name: 'Tacos Centro',
      },
      customer: {
        user: {
          id: 'customer-user-1',
          name: 'Cliente Demo',
        },
      },
      driver: {
        id: 'driver-1',
        userId: 'driver-user-1',
        user: {
          id: 'driver-user-1',
          name: 'Luis Repartidor',
        },
      },
    } as never);

    const response = await app.inject({
      method: 'PATCH',
      url: '/driver-panel/pedidos/order-1/entregado',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('order-1');
    expect(emitNotificationSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'restaurant-user-1',
      'RESTAURANT',
      'order:delivered',
      {
        orderId: 'order-1',
        status: 'delivered',
      },
      orderMetaMatcher('order-1')
    );
    expect(emitNotificationSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'customer-user-1',
      'CUSTOMER',
      'order:delivered',
      {
        orderId: 'order-1',
        status: 'delivered',
      },
      orderMetaMatcher('order-1')
    );
  });

  it('lista restaurantes paginados para administradores autenticados', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    jest.spyOn(prisma, '$transaction').mockResolvedValue([
      [
        {
          id: 'restaurant-1',
          name: 'Tacos Centro',
          region: 'cdmx-centro',
          status: 'ACTIVE',
          serviceFee: 5,
          user: {
            id: 'restaurant-user-1',
            name: 'Ana',
            phone: '+5215510101010',
            email: 'ana@example.com',
          },
        },
      ],
      1,
    ] as never);
    jest.spyOn(prisma.region, 'findMany').mockResolvedValue([
      {
        code: 'cdmx-centro',
        baseDeliveryFee: 25,
      },
    ] as never);
    jest.spyOn(restaurantBillingService, 'buildRestaurantBillingSummaryMap').mockResolvedValue(
      new Map([
        [
          'restaurant-1',
          {
            currentDebt: 0,
            pastDebt: 0,
            deliveredRevenue: 0,
            serviceFeeRevenue: 0,
            platformFeeRevenue: 0,
            deliveredOrders: 0,
            platformFeeRate: 0,
            serviceFee: 0,
            platformFeePerOrder: 0,
            billingCycle: 'WEEKLY',
            periodStart: new Date().toISOString(),
            periodEnd: new Date().toISOString(),
            nextChargeDate: new Date().toISOString(),
          },
        ],
      ])
    );

    const response = await app.inject({
      method: 'GET',
      url: '/admin/restaurantes?page=1&limit=10&search=taco',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { items: Array<{ id: string; name: string }>; total: number; page: number; limit: number };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.name).toBe('Tacos Centro');
    expect(body.data.total).toBe(1);
    expect(body.data.page).toBe(1);
    expect(body.data.limit).toBe(10);
  });

  it('permite al administrador actualizar el estado operativo de un restaurante desde un endpoint dedicado', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      name: 'Tacos Centro',
      description: 'Taqueria de barrio con servicio continuo',
      address: 'Av. Juarez 15',
      latitude: 19.4326,
      longitude: -99.1332,
      region: 'cdmx-centro',
      status: 'ACTIVE',
      logo: null,
      coverImage: null,
      serviceFee: 5,
      hasOwnDelivery: false,
      deliveryFee: 35,
      minDeliveryTime: 25,
      maxDeliveryTime: 45,
      contactPhone: '+5215510101010',
      email: 'tacos@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: 'restaurant-user-1',
        name: 'Ana',
        phone: '+5215510101010',
        email: 'ana@example.com',
      },
    } as never);
    jest.spyOn(prisma.restaurant, 'update').mockResolvedValue({
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      name: 'Tacos Centro',
      description: 'Taqueria de barrio con servicio continuo',
      address: 'Av. Juarez 15',
      latitude: 19.4326,
      longitude: -99.1332,
      region: 'cdmx-centro',
      status: 'SUSPENDED',
      statusReason: 'Pago semanal vencido.',
      statusChangedAt: new Date(),
      statusChangedBy: 'admin-user-1',
      serviceFee: 5,
      hasOwnDelivery: false,
      deliveryFee: 35,
      minDeliveryTime: 25,
      maxDeliveryTime: 45,
      contactPhone: '+5215510101010',
      email: 'tacos@example.com',
      user: {
        id: 'restaurant-user-1',
        name: 'Ana',
        phone: '+5215510101010',
        email: 'ana@example.com',
        region: 'cdmx-centro',
      },
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/admin/restaurantes/restaurant-1/status',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        status: 'SUSPENDED',
        reason: 'Pago semanal vencido.',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; status: string };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('restaurant-1');
    expect(body.data.status).toBe('SUSPENDED');
  });

  it('permite al administrador editar datos clave del restaurante', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-2',
      userId: 'restaurant-user-2',
      name: 'Pizza Norte',
      description: 'Pizzas artesanales',
      address: 'Insurgentes 200',
      latitude: 19.4,
      longitude: -99.1,
      region: 'cdmx-norte',
      status: 'ACTIVE',
      logo: null,
      coverImage: null,
      serviceFee: 5,
      hasOwnDelivery: true,
      deliveryFee: 25,
      minDeliveryTime: 20,
      maxDeliveryTime: 40,
      contactPhone: '+5215520202020',
      email: 'pizza@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: 'restaurant-user-2',
        name: 'Mario',
        phone: '+5215520202020',
        email: 'mario@example.com',
      },
    } as never);

    const userUpdateSpy = jest.fn().mockResolvedValue({});
    const restaurantUpdateSpy = jest.fn().mockResolvedValue({
      id: 'restaurant-2',
      userId: 'restaurant-user-2',
      name: 'Pizza Centro',
      description: 'Pizzas artesanales con masa madre',
      address: 'Insurgentes 220',
      latitude: 19.4,
      longitude: -99.1,
      region: 'cdmx-centro',
      status: 'ACTIVE',
      serviceFee: 7,
      hasOwnDelivery: true,
      deliveryFee: 30,
      minDeliveryTime: 25,
      maxDeliveryTime: 45,
      contactPhone: '+5215530303030',
      email: 'centro@example.com',
      user: {
        id: 'restaurant-user-2',
        name: 'Maria',
        phone: '+5215530303030',
        email: 'maria@example.com',
        region: 'cdmx-centro',
      },
    });

    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback({
          user: {
            update: userUpdateSpy,
          },
          restaurant: {
            update: restaurantUpdateSpy,
          },
        } as never);
      }

      return [] as never;
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/admin/restaurantes/restaurant-2',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        ownerName: 'Maria',
        ownerPhone: '+5215530303030',
        ownerEmail: 'maria@example.com',
        name: 'Pizza Centro',
        description: 'Pizzas artesanales con masa madre',
        address: 'Insurgentes 220',
        region: 'cdmx-centro',
        contactPhone: '+5215530303030',
        email: 'centro@example.com',
        serviceFee: 7,
        hasOwnDelivery: true,
        deliveryFee: 30,
        minDeliveryTime: 25,
        maxDeliveryTime: 45,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; name: string; region: string; contactPhone: string; serviceFee: number };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('restaurant-2');
    expect(body.data.name).toBe('Pizza Centro');
    expect(body.data.region).toBe('cdmx-centro');
    expect(body.data.contactPhone).toBe('+5215530303030');
    expect(body.data.serviceFee).toBe(7);
    expect(userUpdateSpy).toHaveBeenCalledWith({
      where: { id: 'restaurant-user-2' },
      data: {
        name: 'Maria',
        phone: '+5215530303030',
        email: 'maria@example.com',
        region: 'cdmx-centro',
      },
    });
    expect(restaurantUpdateSpy).toHaveBeenCalledWith({
      where: { id: 'restaurant-2' },
      data: expect.objectContaining({
        serviceFee: 7,
      }),
      include: expect.any(Object),
    });
  });

  it('permite al administrador crear un restaurante preservando la tarifa de servicio configurada', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

    const userCreateSpy = jest.fn().mockResolvedValue({
      id: 'restaurant-user-new',
    });
    const restaurantCreateSpy = jest.fn().mockResolvedValue({
      id: 'restaurant-new',
      userId: 'restaurant-user-new',
      name: 'Tacos Sur',
      description: 'Restaurante Tacos Sur creado desde el panel administrativo.',
      address: 'Pendiente de definir',
      latitude: 0,
      longitude: 0,
      region: 'cdmx-sur',
      status: 'SUSPENDED',
      statusReason: 'Alta inicial pendiente de activacion administrativa.',
      statusChangedAt: new Date(),
      statusChangedBy: 'admin-user-1',
      serviceFee: 5,
      hasOwnDelivery: false,
      deliveryFee: null,
      minDeliveryTime: 30,
      maxDeliveryTime: 45,
      contactPhone: '5511112222',
      email: '5511112222@sadel.local',
      billingCycle: 'WEEKLY',
      platformFeeRate: 0,
      billingContactEmail: '5511112222@sadel.local',
      user: {
        id: 'restaurant-user-new',
        name: 'Tacos Sur',
        phone: '5511112222',
        email: '5511112222@sadel.local',
      },
    });

    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback({
          user: {
            create: userCreateSpy,
          },
          restaurant: {
            create: restaurantCreateSpy,
          },
        } as never);
      }

      return [] as never;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/restaurantes',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        ownerName: 'Tacos Sur',
        ownerPhone: '5511112222',
        password: '123456',
        name: 'Tacos Sur',
        description: 'Restaurante Tacos Sur creado desde el panel administrativo.',
        address: 'Pendiente de definir',
        latitude: 0,
        longitude: 0,
        region: 'cdmx-sur',
        contactPhone: '5511112222',
        email: '5511112222@sadel.local',
        serviceFee: 5,
        hasOwnDelivery: false,
        minDeliveryTime: 30,
        maxDeliveryTime: 45,
        billingCycle: 'WEEKLY',
        platformFeeRate: 0,
        billingContactEmail: '5511112222@sadel.local',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; serviceFee: number; status: string };
    }>(response.body);

    expect(response.statusCode).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('restaurant-new');
    expect(body.data.serviceFee).toBe(5);
    expect(body.data.status).toBe('SUSPENDED');
    expect(restaurantCreateSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serviceFee: 5,
        status: 'SUSPENDED',
      }),
      include: expect.any(Object),
    });
  });

  it('lista comensales para el administrador con indicadores de riesgo y actividad', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({
      status: 'ACTIVE',
    } as never);
    jest.spyOn(prisma.customer, 'findMany').mockResolvedValue([
      {
        id: 'customer-1',
        totalOrders: 4,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-04-15T09:00:00.000Z'),
        user: {
          id: 'customer-user-1',
          name: 'Cliente Demo',
          phone: '+5215511111111',
          email: 'cliente@sadel.local',
          region: 'michoacan-puruaran',
          status: 'ACTIVE',
          createdAt: new Date('2026-04-01T10:00:00.000Z'),
          updatedAt: new Date('2026-04-15T09:00:00.000Z'),
        },
        _count: {
          addresses: 2,
          favorites: 1,
          reviews: 1,
        },
      },
    ] as never);
    jest.spyOn(prisma.order, 'findMany').mockResolvedValue([
      {
        customerId: 'customer-1',
        status: OrderStatus.DELIVERED,
        totalAmount: 230,
        paymentMethod: PaymentMethod.CASH,
        createdAt: new Date('2026-04-12T12:00:00.000Z'),
      },
      {
        customerId: 'customer-1',
        status: OrderStatus.CANCELLED,
        totalAmount: 0,
        paymentMethod: PaymentMethod.CASH,
        createdAt: new Date('2026-04-14T13:00:00.000Z'),
      },
    ] as never);
    jest.spyOn(prisma.transaction, 'findMany').mockResolvedValue([] as never);

    const response = await app.inject({
      method: 'GET',
      url: '/admin/usuarios?page=1&limit=10&sort=risk',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { items: Array<{ name: string; totalSpent: number; cancelledOrders: number }>; total: number };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]?.name).toBe('Cliente Demo');
    expect(body.data.items[0]?.totalSpent).toBe(230);
    expect(body.data.items[0]?.cancelledOrders).toBe(1);
  });

  it('permite al administrador suspender un comensal sin pedidos activos', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    const userFindUniqueSpy = jest.spyOn(prisma.user, 'findUnique');
    userFindUniqueSpy
      .mockResolvedValueOnce({
        status: 'ACTIVE',
      } as never)
      .mockResolvedValueOnce({
        id: 'customer-user-1',
        name: 'Cliente Demo',
        phone: '+5215511111111',
        email: 'cliente@sadel.local',
        role: 'CUSTOMER',
        region: 'michoacan-puruaran',
        status: 'ACTIVE',
        customer: {
          id: 'customer-1',
        },
      } as never);

    jest.spyOn(prisma.order, 'count').mockResolvedValue(0);
    jest.spyOn(prisma.user, 'update').mockResolvedValue({
      id: 'customer-user-1',
      name: 'Cliente Demo',
      status: 'SUSPENDED',
      phone: '+5215511111111',
      email: 'cliente@sadel.local',
      region: 'michoacan-puruaran',
      updatedAt: new Date(),
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/admin/usuarios/customer-user-1/status',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        status: 'SUSPENDED',
        reason: 'Cancelaciones reiteradas.',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; status: string; reason: string | null };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('customer-user-1');
    expect(body.data.status).toBe('SUSPENDED');
    expect(body.data.reason).toBe('Cancelaciones reiteradas.');
  });

  it('bloquea la autenticacion de cuentas suspendidas cuando el estado se puede validar', async () => {
    const token = await createToken({
      sub: 'customer-user-suspended',
      phone: '+5215599999999',
      role: UserRole.CUSTOMER,
    });

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      status: 'SUSPENDED',
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/pedidos',
      headers: {
        authorization: `Bearer ${token}`,
      },
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
      error: { code: string };
    }>(response.body);

    expect(response.statusCode).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('expone el overview ejecutivo de repartidores para administracion', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      status: 'ACTIVE',
    } as never);
    jest.spyOn(prisma.driver, 'findMany').mockResolvedValue([
      {
        id: 'driver-1',
        status: DriverStatus.ACTIVE,
        availability: DriverAvailability.AVAILABLE,
        totalDeliveries: 12,
        rating: 4.8,
        licenseExpiry: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      },
      {
        id: 'driver-2',
        status: DriverStatus.SUSPENDED,
        availability: DriverAvailability.OFFLINE,
        totalDeliveries: 4,
        rating: 4.1,
        licenseExpiry: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      },
    ] as never);
    jest.spyOn(prisma.order, 'count').mockResolvedValue(1);

    const response = await app.inject({
      method: 'GET',
      url: '/admin/repartidores/overview',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { totalDrivers: number; suspendedDrivers: number; driversWithExpiredLicense: number };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.totalDrivers).toBe(2);
    expect(body.data.suspendedDrivers).toBe(1);
    expect(body.data.driversWithExpiredLicense).toBe(1);
  });

  it('permite al administrador crear un repartidor con estado y disponibilidad inicial', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    const userFindUniqueSpy = jest.spyOn(prisma.user, 'findUnique');
    userFindUniqueSpy
      .mockResolvedValueOnce({
        status: 'ACTIVE',
      } as never)
      .mockResolvedValueOnce(null);

    const userCreateSpy = jest.fn().mockResolvedValue({
      id: 'driver-user-new',
    });
    const driverCreateSpy = jest.fn().mockResolvedValue({
      id: 'driver-new',
      userId: 'driver-user-new',
      region: 'michoacan-puruaran',
      status: DriverStatus.ACTIVE,
      availability: DriverAvailability.OFFLINE,
      rating: 0,
      totalDeliveries: 0,
      documentNumber: 'DOC-1234',
      documentType: 'INE',
      profilePhoto: null,
      licensePhoto: null,
      licenseExpiry: null,
      bankAccount: 'BBVA ****1234',
      user: {
        id: 'driver-user-new',
        name: 'Luis Repartidor',
        phone: '5510101010',
        email: '5510101010@sadel.local',
        region: 'michoacan-puruaran',
        status: 'ACTIVE',
      },
    });

    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback({
          user: {
            create: userCreateSpy,
          },
          driver: {
            create: driverCreateSpy,
          },
        } as never);
      }

      return [] as never;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/repartidores',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        name: 'Luis Repartidor',
        phone: '5510101010',
        password: 'password123',
        region: 'michoacan-puruaran',
        documentNumber: 'DOC-1234',
        documentType: 'INE',
        bankAccount: 'BBVA ****1234',
        status: 'ACTIVE',
        availability: 'OFFLINE',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; status: DriverStatus; availability: DriverAvailability };
    }>(response.body);

    expect(response.statusCode).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('driver-new');
    expect(body.data.status).toBe(DriverStatus.ACTIVE);
    expect(body.data.availability).toBe(DriverAvailability.OFFLINE);
    expect(userCreateSpy).toHaveBeenCalledWith({
      data: expect.objectContaining({
        role: 'DRIVER',
        status: 'ACTIVE',
      }),
    });
  });

  it('permite al administrador suspender un repartidor sin pedidos activos', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      status: 'ACTIVE',
    } as never);
    jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({
      id: 'driver-1',
      userId: 'driver-user-1',
      status: DriverStatus.ACTIVE,
      availability: DriverAvailability.AVAILABLE,
      user: {
        id: 'driver-user-1',
      },
    } as never);
    jest.spyOn(prisma.order, 'count').mockResolvedValue(0);

    const userUpdateSpy = jest.fn().mockResolvedValue({});
    const driverUpdateSpy = jest.fn().mockResolvedValue({
      id: 'driver-1',
      userId: 'driver-user-1',
      status: DriverStatus.SUSPENDED,
      availability: DriverAvailability.OFFLINE,
      user: {
        id: 'driver-user-1',
        name: 'Luis Repartidor',
        phone: '5510101010',
        email: 'driver@sadel.local',
        region: 'michoacan-puruaran',
        status: 'SUSPENDED',
      },
    });

    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback({
          user: {
            update: userUpdateSpy,
          },
          driver: {
            update: driverUpdateSpy,
          },
        } as never);
      }

      return [] as never;
    });

    const response = await app.inject({
      method: 'POST',
      url: '/admin/repartidores/driver-1/status',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        status: 'SUSPENDED',
        reason: 'Incidencias repetidas.',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; status: DriverStatus; reason: string | null };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('driver-1');
    expect(body.data.status).toBe(DriverStatus.SUSPENDED);
    expect(body.data.reason).toBe('Incidencias repetidas.');
  });

  it('permite al administrador dar de baja logica a un repartidor sin pedidos activos', async () => {
    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      status: 'ACTIVE',
    } as never);
    jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({
      id: 'driver-2',
      userId: 'driver-user-2',
      status: DriverStatus.ACTIVE,
      availability: DriverAvailability.OFFLINE,
    } as never);
    jest.spyOn(prisma.order, 'count').mockResolvedValue(0);

    const userUpdateSpy = jest.fn().mockResolvedValue({});
    const driverUpdateSpy = jest.fn().mockResolvedValue({
      id: 'driver-2',
      userId: 'driver-user-2',
      status: DriverStatus.INACTIVE,
      availability: DriverAvailability.OFFLINE,
      user: {
        id: 'driver-user-2',
        name: 'Mario Ruta',
        phone: '5520202020',
        email: 'mario@sadel.local',
        region: 'michoacan-puruaran',
        status: 'INACTIVE',
      },
    });

    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback({
          user: {
            update: userUpdateSpy,
          },
          driver: {
            update: driverUpdateSpy,
          },
        } as never);
      }

      return [] as never;
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/admin/repartidores/driver-2',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        reason: 'Baja administrativa.',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; status: DriverStatus; deleted: boolean };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('driver-2');
    expect(body.data.status).toBe(DriverStatus.INACTIVE);
    expect(body.data.deleted).toBe(true);
  });

  it('expone la tarifa de servicio en el catalogo y detalle publico del restaurante', async () => {
    jest.spyOn(prisma.restaurant, 'findMany').mockResolvedValue([
      {
        id: 'restaurant-public-1',
        userId: 'restaurant-user-public-1',
        name: 'Tacos Centro',
        description: 'Taqueria abierta todo el dia',
        address: 'Av. Juarez 15',
        latitude: 19.4326,
        longitude: -99.1332,
        region: 'cdmx-centro',
        logo: null,
        coverImage: null,
        status: 'ACTIVE',
        isAcceptingOrders: true,
        serviceFee: 5,
        hasOwnDelivery: false,
        deliveryFee: null,
        minDeliveryTime: 25,
        maxDeliveryTime: 45,
        contactPhone: '+5215510101010',
        email: 'tacos@example.com',
        billingCycle: 'WEEKLY',
        platformFeeRate: 0,
        lastBillingSettledAt: null,
        billingContactEmail: 'tacos@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
        operatingHours: [],
        categories: [
          {
            id: 'cat-1',
            name: 'Tacos',
          },
        ],
      },
    ] as never);
    jest.spyOn(prisma.region, 'findMany').mockResolvedValue([
      {
        code: 'cdmx-centro',
        baseDeliveryFee: 25,
      },
    ] as never);
    jest.spyOn(prisma.product, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.restaurant, 'findFirst').mockResolvedValue({
      id: 'restaurant-public-1',
      userId: 'restaurant-user-public-1',
      name: 'Tacos Centro',
      description: 'Taqueria abierta todo el dia',
      address: 'Av. Juarez 15',
      latitude: 19.4326,
      longitude: -99.1332,
      region: 'cdmx-centro',
      logo: null,
      coverImage: null,
      status: 'ACTIVE',
      serviceFee: 5,
      hasOwnDelivery: false,
      deliveryFee: null,
      minDeliveryTime: 25,
      maxDeliveryTime: 45,
      contactPhone: '+5215510101010',
      email: 'tacos@example.com',
      billingCycle: 'WEEKLY',
      platformFeeRate: 0,
      lastBillingSettledAt: null,
      billingContactEmail: 'tacos@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
      operatingHours: [],
      categories: [
        {
          id: 'cat-1',
          name: 'Tacos',
          order: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          description: null,
          restaurantId: 'restaurant-public-1',
          products: [
            {
              id: 'prod-1',
              restaurantId: 'restaurant-public-1',
              categoryId: 'cat-1',
              name: 'Taco al pastor',
              description: 'Con piña',
              price: 200,
              image: null,
              isAvailable: true,
              preparationTime: 10,
              calories: null,
              allergens: [],
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        },
      ],
    } as never);
    jest.spyOn(prisma.region, 'findUnique').mockResolvedValue({
      baseDeliveryFee: 25,
    } as never);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/restaurantes?page=1&limit=12&openOnly=false',
    });
    const detailResponse = await app.inject({
      method: 'GET',
      url: '/restaurantes/restaurant-public-1',
    });

    const listBody = parseJson<{
      success: boolean;
      data: { items: Array<{ id: string; serviceFee: number; effectiveDeliveryFee: number }> };
    }>(listResponse.body);
    const detailBody = parseJson<{
      success: boolean;
      data: { id: string; serviceFee: number; effectiveDeliveryFee: number };
    }>(detailResponse.body);

    expect(listResponse.statusCode).toBe(200);
    expect(detailResponse.statusCode).toBe(200);
    expect(listBody.data.items[0]?.serviceFee).toBe(5);
    expect(listBody.data.items[0]?.effectiveDeliveryFee).toBe(25);
    expect(detailBody.data.id).toBe('restaurant-public-1');
    expect(detailBody.data.serviceFee).toBe(5);
    expect(detailBody.data.effectiveDeliveryFee).toBe(25);
  });

  it('permite al restaurante guardar portada como data URL', async () => {
    const token = await createToken({
      sub: 'restaurant-user-9',
      phone: '+5215599999999',
      role: UserRole.RESTAURANT,
    });

    const dataUrl = 'data:image/jpeg;base64,ZmFrZS1jb3Zlci1pbWFnZQ==';

    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-9',
      userId: 'restaurant-user-9',
      name: 'Burgers Roma',
    } as never);

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      status: 'ACTIVE',
    } as never);

    const updatedRestaurantMock = {
      id: 'restaurant-9',
      userId: 'restaurant-user-9',
      name: 'Burgers Roma',
      description: 'Smash burgers y papas al momento',
      address: 'Colima 101',
      latitude: 19.41,
      longitude: -99.17,
      region: 'cdmx-centro',
      status: 'ACTIVE',
      logo: null,
      coverImage: dataUrl,
      hasOwnDelivery: true,
      deliveryFee: 25,
      minDeliveryTime: 20,
      maxDeliveryTime: 40,
      contactPhone: '+5215599999999',
      email: 'roma@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
      storeCategories: [],
    };

    const restaurantUpdateSpy = jest.fn().mockResolvedValue(updatedRestaurantMock);
    const restaurantDeleteManySpy = jest.fn().mockResolvedValue({ count: 0 });
    const restaurantFindUniqueSpy = jest.fn().mockResolvedValue(updatedRestaurantMock);

    const transactionSpy = jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
      if (typeof callback === 'function') {
        return callback({
          restaurant: {
            update: restaurantUpdateSpy,
            findUnique: restaurantFindUniqueSpy,
          },
          restaurantStoreCategory: {
            deleteMany: restaurantDeleteManySpy,
          },
        } as never);
      }
      return [] as never;
    });

    const response = await app.inject({
      method: 'PATCH',
      url: '/restaurant-panel/perfil',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        coverImage: dataUrl,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; coverImage: string };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('restaurant-9');
    expect(body.data.coverImage).toBe(dataUrl);
    expect(restaurantUpdateSpy).toHaveBeenCalledWith({
      where: { id: 'restaurant-9' },
      data: {
        coverImage: dataUrl,
        deliveryFee: null,
      },
    });
  });

  it('permite subir imagenes a traves del endpoint de uploads', async () => {
    const token = await createToken({
      sub: 'restaurant-user-media',
      phone: '+5215500000000',
      role: UserRole.RESTAURANT,
    });

    const originalEnv = {
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      bucketName: process.env.R2_BUCKET_NAME,
      publicUrl: process.env.R2_PUBLIC_URL,
    };

    process.env.R2_ACCOUNT_ID = 'demo-account';
    process.env.R2_ACCESS_KEY_ID = 'demo-key';
    process.env.R2_SECRET_ACCESS_KEY = 'demo-secret';
    process.env.R2_BUCKET_NAME = 'sadel-images';
    process.env.R2_PUBLIC_URL = 'https://images.sadel.mx';

    const s3SendSpy = jest.spyOn(require('@aws-sdk/client-s3').S3Client.prototype, 'send').mockResolvedValue({
      $metadata: { httpStatusCode: 200 },
      ETag: '"abc123"',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/uploads/images',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        kind: 'restaurant-logo',
        source: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC',
        fileName: 'logo.png',
      },
    });

    process.env.R2_ACCOUNT_ID = originalEnv.accountId;
    process.env.R2_ACCESS_KEY_ID = originalEnv.accessKeyId;
    process.env.R2_SECRET_ACCESS_KEY = originalEnv.secretAccessKey;
    process.env.R2_BUCKET_NAME = originalEnv.bucketName;
    process.env.R2_PUBLIC_URL = originalEnv.publicUrl;

    const body = parseJson<{
      success: boolean;
      data: { url: string; publicId: string; provider: string };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.url).toContain('images.sadel.mx');
    expect(body.data.provider).toBe('r2');
    expect(s3SendSpy).toHaveBeenCalled();
  });

  it('permite al restaurante eliminar un producto propio', async () => {
    const token = await createToken({
      sub: 'restaurant-user-5',
      phone: '+5215555555555',
      role: UserRole.RESTAURANT,
    });

    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-5',
      userId: 'restaurant-user-5',
      name: 'Sushi Demo',
    } as never);

    jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({
      id: 'product-5',
      restaurantId: 'restaurant-5',
      name: 'Rollo especial',
    } as never);

    const deleteSpy = jest.spyOn(prisma.product, 'delete').mockResolvedValue({
      id: 'product-5',
    } as never);

    const response = await app.inject({
      method: 'DELETE',
      url: '/restaurant-panel/productos/product-5',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('product-5');
    expect(deleteSpy).toHaveBeenCalledWith({
      where: { id: 'product-5' },
    });
  });

  it('expone errores de dominio al consultar repartidores disponibles del restaurante', async () => {
    const token = await createToken({
      sub: 'restaurant-user-1',
      phone: '+5215533333333',
      role: UserRole.RESTAURANT,
    });

    jest.spyOn(orderWorkflowService, 'getAvailableDriversForRestaurant').mockRejectedValue(
      new AppError(404, 'RESTAURANT_NOT_FOUND', 'No se encontro el restaurante asociado a este usuario.')
    );

    const response = await app.inject({
      method: 'GET',
      url: '/restaurant-panel/repartidores/disponibles',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string; message: string };
    }>(response.body);

    expect(response.statusCode).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RESTAURANT_NOT_FOUND');
  });

  it('permite al restaurante aceptar un pedido y notifica a los actores involucrados', async () => {
    const token = await createToken({
      sub: 'restaurant-user-1',
      phone: '+5215533333333',
      role: UserRole.RESTAURANT,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    jest.spyOn(orderWorkflowService, 'updateOrderStatusByRestaurant').mockResolvedValue({
      id: 'order-9',
      status: OrderStatus.CONFIRMED,
      customer: {
        id: 'customer-1',
        user: {
          id: 'customer-user-1',
          name: 'Cliente Demo',
        },
      },
      driver: {
        id: 'driver-1',
        user: {
          id: 'driver-user-1',
          name: 'Luis',
        },
      },
      restaurant: {
        id: 'restaurant-1',
        userId: 'restaurant-user-1',
        name: 'Tacos Centro',
      },
      tracking: [],
    } as never);

    const response = await app.inject({
      method: 'PATCH',
      url: '/restaurant-panel/pedidos/order-9/aceptar',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; status: OrderStatus };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('order-9');
    expect(body.data.status).toBe(OrderStatus.CONFIRMED);
    expect(emitNotificationSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'customer-user-1',
      'CUSTOMER',
      'order:accepted',
      {
        orderId: 'order-9',
        status: OrderStatus.CONFIRMED,
      },
      orderMetaMatcher('order-9')
    );
    expect(emitNotificationSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'driver-user-1',
      'DRIVER',
      'order:accepted',
      {
        orderId: 'order-9',
        status: OrderStatus.CONFIRMED,
      },
      orderMetaMatcher('order-9')
    );
  });

  it('propaga error tipado cuando no se puede asignar repartidor', async () => {
    const token = await createToken({
      sub: 'restaurant-user-1',
      phone: '+5215533333333',
      role: UserRole.RESTAURANT,
    });

    jest.spyOn(orderWorkflowService, 'assignDriverToOrder').mockRejectedValue(
      new AppError(409, 'OWN_DELIVERY_ORDER', 'Este restaurante maneja reparto propio para este pedido.')
    );

    const response = await app.inject({
      method: 'POST',
      url: '/restaurant-panel/pedidos/order-10/asignar-repartidor',
      headers: {
        authorization: `Bearer ${token}`,
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
    expect(body.error.code).toBe('OWN_DELIVERY_ORDER');
  });

  it('expone el perfil operativo del repartidor con disponibilidad y coordenadas', async () => {
    const token = await createToken({
      sub: 'driver-user-1',
      phone: '+5215544444444',
      role: UserRole.DRIVER,
    });

    jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({
      id: 'driver-1',
      userId: 'driver-user-1',
      region: 'cdmx-centro',
      status: 'ACTIVE',
      availability: DriverAvailability.AVAILABLE,
      rating: 4.8,
      totalDeliveries: 128,
      documentNumber: 'ABC123',
      documentType: 'INE',
      profilePhoto: null,
      licensePhoto: null,
      licenseExpiry: null,
      bankAccount: null,
      currentLatitude: 19.4326,
      currentLongitude: -99.1332,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: {
        id: 'driver-user-1',
        name: 'Luis',
        phone: '+5215544444444',
        region: 'cdmx-centro',
        status: 'ACTIVE',
      },
    } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/driver-panel/perfil',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; availability: DriverAvailability; currentLatitude: number | null };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('driver-1');
    expect(body.data.availability).toBe(DriverAvailability.AVAILABLE);
    expect(body.data.currentLatitude).toBe(19.4326);
  });

  it('permite al repartidor actualizar su disponibilidad', async () => {
    const token = await createToken({
      sub: 'driver-user-1',
      phone: '+5215544444444',
      role: UserRole.DRIVER,
    });

    jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({
      id: 'driver-1',
      userId: 'driver-user-1',
    } as never);
    jest.spyOn(prisma.driver, 'update').mockResolvedValue({
      id: 'driver-1',
      userId: 'driver-user-1',
      availability: DriverAvailability.OFFLINE,
      user: {
        id: 'driver-user-1',
        name: 'Luis',
        phone: '+5215544444444',
      },
    } as never);

    const response = await app.inject({
      method: 'PATCH',
      url: '/driver-panel/disponibilidad',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        availability: DriverAvailability.OFFLINE,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string; availability: DriverAvailability };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('driver-1');
    expect(body.data.availability).toBe(DriverAvailability.OFFLINE);
  });

  it('permite al repartidor marcar un pedido como entregado y notifica a cliente y restaurante', async () => {
    const token = await createToken({
      sub: 'driver-user-1',
      phone: '+5215544444444',
      role: UserRole.DRIVER,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    jest.spyOn(orderWorkflowService, 'updateOrderStatusByDriver').mockResolvedValue({
      id: 'order-driver-1',
      restaurant: {
        userId: 'restaurant-user-1',
        name: 'Tacos Centro',
      },
      customer: {
        user: {
          id: 'customer-user-1',
          name: 'Cliente Demo',
        },
      },
      driver: {
        id: 'driver-1',
        userId: 'driver-user-1',
        user: {
          id: 'driver-user-1',
          name: 'Luis',
        },
      },
    } as never);

    const response = await app.inject({
      method: 'PATCH',
      url: '/driver-panel/pedidos/order-driver-1/entregado',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { id: string };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('order-driver-1');
    expect(emitNotificationSpy).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'restaurant-user-1',
      'RESTAURANT',
      'order:delivered',
      {
        orderId: 'order-driver-1',
        status: 'delivered',
      },
      orderMetaMatcher('order-driver-1')
    );
    expect(emitNotificationSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'customer-user-1',
      'CUSTOMER',
      'order:delivered',
      {
        orderId: 'order-driver-1',
        status: 'delivered',
      },
      orderMetaMatcher('order-driver-1')
    );
  });
});
