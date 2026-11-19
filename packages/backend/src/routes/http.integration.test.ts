import { DriverAvailability, OrderStatus, PaymentMethod, UserRole } from '@prisma/client';
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
      enableSocketIO: true,
      enableJobs: false,
    });
  });

  beforeEach(() => {
    // El middleware de auth consulta el estado del usuario; concedemos ACTIVE
    // salvo en los tests que mockean SUSPENDED a propósito.
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      status: 'ACTIVE',
      statusReason: null,
    } as never);
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
    jest.spyOn(prisma.pushSubscription, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.fcmToken, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.restaurantBillingSettlement, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.region, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma, '$transaction').mockImplementation((queries: unknown[]) =>
      Promise.all(queries)
    );
    jest.spyOn(orderWorkflowService, 'autoAssignDriver').mockResolvedValue({
      success: false,
      driver: null,
      order: null,
    } as any);
    jest.spyOn(prisma.order, 'findUnique').mockImplementation(async ({ where }: { where?: { id?: string } } = {}) => {
      if (where?.id === 'order-1' || where?.id === 'order-10') {
        return {
          supportRestaurantId: null,
          status: OrderStatus.READY,
          driverId: null,
          fulfillmentType: 'DELIVERY',
          restaurant: { hasOwnDelivery: false },
        } as never;
      }
      return null as never;
    });
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
      order: {
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
      },
      isDuplicate: false,
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
      order: {
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
      },
      isDuplicate: false,
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







  it('permite autenticar a un comensal suspendido pero le bloquea crear pedidos', async () => {
    const token = await createToken({
      sub: 'customer-user-suspended',
      phone: '+5215599999999',
      role: UserRole.CUSTOMER,
    });

    // El middleware deja pasar a SUSPENDED (puede ver su cuenta), pero el
    // guard de creación de pedidos lo bloquea.
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      status: 'SUSPENDED',
    } as never);
    jest.spyOn(prisma.customer, 'findUnique').mockResolvedValue({
      id: 'customer-1',
      isSuspendedByDebt: false,
      debtAmount: 0,
      user: {
        status: 'SUSPENDED',
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
    expect(body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('permite a un comensal suspendido consultar su deuda', async () => {
    const token = await createToken({
      sub: 'customer-user-suspended',
      phone: '+5215599999999',
      role: UserRole.CUSTOMER,
    });

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'SUSPENDED' } as never);
    jest.spyOn(prisma.customer, 'findUnique').mockResolvedValue({
      id: 'customer-1',
      isSuspendedByDebt: true,
      debtAmount: 120,
    } as never);
    jest.spyOn(prisma.customerBillingSettlement, 'findFirst').mockResolvedValue({
      id: 'settlement-1',
      reference: 'REF-1',
      amount: 120,
      status: 'PENDING',
      paymentProofUrl: null,
      createdAt: new Date(),
      dueDate: new Date(),
      order: {
        orderReference: 'SAD-ORDER-1',
        totalAmount: 120,
        createdAt: new Date(),
        restaurant: { name: 'Tacos Centro' },
      },
    } as never);

    const response = await app.inject({
      method: 'GET',
      url: '/customer/deuda',
      headers: { authorization: `Bearer ${token}` },
    });

    const body = parseJson<{
      success: boolean;
      data: { hasDebt: boolean; isSuspendedByDebt: boolean; debtAmount: number };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.hasDebt).toBe(true);
    expect(body.data.debtAmount).toBe(120);
  });

  it('permite a un comensal suspendido registrar el pago de su deuda', async () => {
    const token = await createToken({
      sub: 'customer-user-suspended',
      phone: '+5215599999999',
      role: UserRole.CUSTOMER,
    });

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'SUSPENDED' } as never);
    jest.spyOn(prisma.customer, 'findUnique').mockResolvedValue({ id: 'customer-1' } as never);
    jest.spyOn(prisma.customerBillingSettlement, 'findFirst').mockResolvedValue({
      id: 'settlement-1',
      status: 'PENDING',
    } as never);
    jest.spyOn(prisma.customerBillingSettlement, 'update').mockResolvedValue({
      id: 'settlement-1',
      status: 'IN_REVIEW',
      paymentProofUrl: 'https://cdn.example.com/proof.jpg',
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/customer/deuda/pagar',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        settlementId: 'settlement-1',
        paymentProofUrl: 'https://cdn.example.com/proof.jpg',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = parseJson<{ success: boolean; data: { status: string } }>(response.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('IN_REVIEW');
  });

  it('bloquea a un repartidor suspendido para ponerse disponible', async () => {
    const token = await createToken({
      sub: 'driver-user-suspended',
      phone: '+5215588888888',
      role: UserRole.DRIVER,
    });

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'SUSPENDED' } as never);
    jest.spyOn(prisma.driver, 'findUnique').mockResolvedValue({
      id: 'driver-suspended',
      userId: 'driver-user-suspended',
      lastBillingSettledAt: null,
      createdAt: new Date(),
      availability: DriverAvailability.OFFLINE,
      status: 'SUSPENDED',
    } as never);

    const response = await app.inject({
      method: 'PATCH',
      url: '/driver-panel/disponibilidad',
      headers: { authorization: `Bearer ${token}` },
      payload: { availability: DriverAvailability.AVAILABLE },
    });
    const body = parseJson<{ success: boolean; error: { code: string } }>(response.body);
    expect(response.statusCode).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DRIVER_SUSPENDED');
  });

  it('bloquea a un restaurante suspendido para operar pero le permite operaciones de cuenta', async () => {
    const token = await createToken({
      sub: 'restaurant-user-suspended',
      phone: '+5215577777777',
      role: UserRole.RESTAURANT,
    });

    // El user.status del restaurante queda ACTIVE; la suspension vive en
    // restaurant.status y el guard requireRestaurantOperable la hace cumplir.
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-suspended',
      userId: 'restaurant-user-suspended',
      status: 'SUSPENDED',
      statusReason: 'Pago vencido.',
    } as never);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/restaurant-panel/productos/product-1',
      headers: { authorization: `Bearer ${token}` },
    });

    const deleteBody = parseJson<{
      success: boolean;
      error: { code: string };
    }>(deleteResponse.body);

    expect(deleteResponse.statusCode).toBe(409);
    expect(deleteBody.success).toBe(false);
    expect(deleteBody.error.code).toBe('RESTAURANT_STATUS_BLOCKED');
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

  it('calcula la tarifa dinamica por distancia en el detalle publico de un restaurante con envio propio', async () => {
    jest.spyOn(prisma.restaurant, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.region, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.region, 'findUnique').mockResolvedValue(null as never);
    jest.spyOn(prisma.product, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.restaurant, 'findFirst').mockResolvedValue({
      id: 'restaurant-own-delivery',
      userId: 'restaurant-user-own',
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
      deliveryFee: 35,
      deliveryRadius: 15,
      deliveryPricingModel: 'distance',
      deliveryBaseRate: 20,
      deliveryPerKmRate: 8,
      deliveryMinFee: 15,
      deliveryMaxFee: 100,
      minDeliveryTime: 20,
      maxDeliveryTime: 40,
      contactPhone: '+5215520202020',
      email: 'pizza@example.com',
      billingCycle: 'WEEKLY',
      platformFeeRate: 0,
      lastBillingSettledAt: null,
      billingContactEmail: 'pizza@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
      operatingHours: [],
      categories: [],
    } as never);

    const detailResponse = await app.inject({
      method: 'GET',
      url: '/restaurantes/restaurant-own-delivery?latitude=19.4&longitude=-99.0',
    });

    const detailBody = parseJson<{
      success: boolean;
      data: {
        id: string;
        pricingModel: string;
        effectiveDeliveryFee: number;
        distanceKm: number;
      };
    }>(detailResponse.body);

    expect(detailResponse.statusCode).toBe(200);
    expect(detailBody.data.id).toBe('restaurant-own-delivery');
    expect(detailBody.data.pricingModel).toBe('distance');
    expect(detailBody.data.distanceKm).toBeGreaterThan(1);
    const expectedFee = Math.round((20 + Math.max(0, detailBody.data.distanceKm - 1) * 8) * 100) / 100;
    expect(detailBody.data.effectiveDeliveryFee).toBe(expectedFee);
    expect(detailBody.data.effectiveDeliveryFee).toBeGreaterThan(20);
    expect(detailBody.data.effectiveDeliveryFee).toBeLessThanOrEqual(100);
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
      status: 'ACTIVE',
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
        pickupOnly: false,
      },
    });
  });

  it('permite subir imagenes a traves del endpoint de uploads', async () => {
    const token = await createToken({
      sub: 'restaurant-user-media',
      phone: '+5215500000000',
      role: UserRole.RESTAURANT,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/uploads/images',
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: {
        kind: 'restaurant-logo',
        source: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        fileName: 'logo.png',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { url: string; publicId: string; provider: string };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.url).toMatch(/^data:image\/webp;base64,/);
    expect(body.data.provider).toBe('memory');
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
      status: 'ACTIVE',
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
      headers: { authorization: `Bearer ${token}` },
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
