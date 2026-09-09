import {
  DriverAvailability,
  OrderStatus,
  PaymentMethod,
  UserRole,
} from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';
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

type TrackingEntry = {
  id: string;
  status: OrderStatus;
  notes: string;
  createdAt: string;
};

type FlowState = {
  orderId: string;
  orderReference: string;
  status: OrderStatus;
  customerProfileId: string;
  customerUserId: string;
  customerName: string;
  restaurantId: string;
  restaurantUserId: string;
  restaurantName: string;
  driverId: string;
  driverUserId: string;
  driverName: string;
  driverPhone: string;
  address: {
    id: string;
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    reference: string;
    latitude: number;
    longitude: number;
  };
  items: Array<{
    id: string;
    quantity: number;
    specialInstructions: string;
    product: {
      id: string;
      name: string;
      image: string | null;
    };
  }>;
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  estimatedDeliveryTime: string;
  createdAt: string;
  driverAssigned: boolean;
  tracking: TrackingEntry[];
};

function createInitialState(): FlowState {
  const now = new Date('2026-04-18T15:00:00.000Z');

  return {
    orderId: 'order-flow-1',
    orderReference: 'SAD-FLOW-1',
    status: OrderStatus.PENDING,
    customerProfileId: 'customer-profile-1',
    customerUserId: 'customer-user-1',
    customerName: 'Cliente Demo',
    restaurantId: 'restaurant-1',
    restaurantUserId: 'restaurant-user-1',
    restaurantName: 'Tacos Centro',
    driverId: 'driver-1',
    driverUserId: 'driver-user-1',
    driverName: 'Luis Repartidor',
    driverPhone: '+5215544444444',
    address: {
      id: 'address-1',
      street: 'Av. Juarez',
      number: '15',
      neighborhood: 'Centro',
      city: 'CDMX',
      state: 'CDMX',
      zipCode: '06000',
      country: 'MX',
      reference: 'Porton negro',
      latitude: 19.4326,
      longitude: -99.1332,
    },
    items: [
      {
        id: 'order-item-1',
        quantity: 2,
        specialInstructions: 'Sin cebolla',
        product: {
          id: 'product-1',
          name: 'Taco al pastor',
          image: null,
        },
      },
    ],
    subtotal: 210,
    taxAmount: 21,
    deliveryFee: 35,
    totalAmount: 266,
    paymentMethod: PaymentMethod.CASH,
    paymentStatus: 'PENDING',
    estimatedDeliveryTime: new Date(now.getTime() + 45 * 60 * 1000).toISOString(),
    createdAt: now.toISOString(),
    driverAssigned: false,
    tracking: [
      {
        id: 'tracking-1',
        status: OrderStatus.PENDING,
        notes: 'Pedido creado correctamente.',
        createdAt: now.toISOString(),
      },
    ],
  };
}

function appendTracking(state: FlowState, status: OrderStatus, notes: string) {
  state.tracking.push({
    id: `tracking-${state.tracking.length + 1}`,
    status,
    notes,
    createdAt: new Date(Date.parse(state.createdAt) + state.tracking.length * 60_000).toISOString(),
  });
}

function buildCustomerOrderDetail(state: FlowState) {
  return {
    id: state.orderId,
    orderReference: state.orderReference,
    status: state.status,
    totalAmount: state.totalAmount,
    subtotal: state.subtotal,
    taxAmount: state.taxAmount,
    deliveryFee: state.deliveryFee,
    paymentMethod: state.paymentMethod,
    paymentStatus: state.paymentStatus,
    estimatedDeliveryTime: state.estimatedDeliveryTime,
    notes: 'Sin salsa verde',
    createdAt: state.createdAt,
    restaurant: {
      id: state.restaurantId,
      name: state.restaurantName,
      logo: null,
      contactPhone: '+5215533333333',
    },
    driver: state.driverAssigned
      ? {
          id: state.driverId,
          user: {
            name: state.driverName,
            phone: state.driverPhone,
          },
        }
      : null,
    address: state.address,
    items: state.items,
    tracking: state.tracking,
  };
}

function buildCustomerOrderListItem(state: FlowState) {
  return {
    id: state.orderId,
    orderReference: state.orderReference,
    status: state.status,
    totalAmount: state.totalAmount,
    paymentMethod: state.paymentMethod,
    createdAt: state.createdAt,
    estimatedDeliveryTime: state.estimatedDeliveryTime,
    restaurant: {
      id: state.restaurantId,
      name: state.restaurantName,
      logo: null,
    },
    address: {
      street: state.address.street,
      number: state.address.number,
      neighborhood: state.address.neighborhood,
      reference: state.address.reference,
    },
  };
}

function buildDriverPendingItem(state: FlowState) {
  return {
    id: state.orderId,
    orderReference: state.orderReference,
    status: state.status,
    totalAmount: state.totalAmount,
    estimatedDeliveryTime: state.estimatedDeliveryTime,
    restaurant: {
      id: state.restaurantId,
      name: state.restaurantName,
      address: 'Av. Reforma 100',
      latitude: 19.43,
      longitude: -99.13,
    },
    customer: {
      user: {
        name: state.customerName,
        phone: '+5215511111111',
      },
    },
    address: state.address,
  };
}

describe('order lifecycle integration flow', () => {
  let app: FastifyInstance;
  let state: FlowState;

  beforeAll(async () => {
    app = await buildApp({
      enableRateLimit: false,
      enableSocketIO: true,
      enableJobs: false,
    });
  });

  beforeEach(() => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      status: 'ACTIVE',
      statusReason: null,
    } as never);
    state = createInitialState();
    jest.spyOn(prisma.pushSubscription, 'findMany').mockResolvedValue([] as never);

    jest.spyOn(orderService, 'createOrderForCustomer').mockImplementation(async () => ({
      order: {
        id: state.orderId,
        orderReference: state.orderReference,
        totalAmount: state.totalAmount,
        paymentMethod: state.paymentMethod,
        status: state.status,
        restaurant: {
          id: state.restaurantId,
          userId: state.restaurantUserId,
          name: state.restaurantName,
          hasOwnDelivery: false,
          deliveryFee: state.deliveryFee,
        },
        customer: {
          id: state.customerProfileId,
          user: {
            id: state.customerUserId,
            name: state.customerName,
            phone: '+5215511111111',
          },
        },
        tracking: state.tracking,
        items: state.items,
        address: {
          id: state.address.id,
        },
      },
      isDuplicate: false,
    }) as never);

    jest
      .spyOn(orderWorkflowService, 'updateOrderStatusByRestaurant')
      .mockImplementation(async ({ nextStatus, trackingNote }) => {
        state.status = nextStatus;
        appendTracking(state, nextStatus, trackingNote);

        return {
          id: state.orderId,
          status: state.status,
          restaurant: {
            id: state.restaurantId,
            userId: state.restaurantUserId,
            name: state.restaurantName,
          },
          customer: {
            id: state.customerProfileId,
            user: {
              id: state.customerUserId,
              name: state.customerName,
            },
          },
          driver: state.driverAssigned
            ? {
                id: state.driverId,
                user: {
                  id: state.driverUserId,
                  name: state.driverName,
                },
              }
            : null,
          tracking: state.tracking,
        } as never;
      });

    jest.spyOn(orderWorkflowService, 'assignDriverToOrder').mockImplementation(async () => {
      state.driverAssigned = true;
      appendTracking(state, state.status, `Repartidor asignado: ${state.driverName}`);

      return {
        id: state.orderId,
        orderReference: state.orderReference,
        restaurant: {
          id: state.restaurantId,
          userId: state.restaurantUserId,
          name: state.restaurantName,
        },
        customer: {
          id: state.customerProfileId,
          user: {
            id: state.customerUserId,
            name: state.customerName,
          },
        },
        driver: {
          id: state.driverId,
          userId: state.driverUserId,
          user: {
            id: state.driverUserId,
            name: state.driverName,
            phone: state.driverPhone,
          },
        },
      } as never;
    });

    jest.spyOn(orderWorkflowService, 'autoAssignDriver').mockResolvedValue({
      success: false,
      driver: null,
      order: null,
    } as any);

    jest.spyOn(orderWorkflowService, 'updateOrderStatusByDriver').mockImplementation(async ({ action }) => {
      if (action === 'accept') {
        appendTracking(state, state.status, 'Repartidor acepto el pedido.');
      }

      if (action === 'picked_up') {
        state.status = OrderStatus.PICKED_UP;
        appendTracking(state, state.status, 'Repartidor recogio el pedido.');
      }

      if (action === 'in_transit') {
        state.status = OrderStatus.IN_TRANSIT;
        appendTracking(state, state.status, 'Repartidor va en camino.');
      }

      if (action === 'delivered') {
        state.status = OrderStatus.DELIVERED;
        appendTracking(state, state.status, 'Pedido entregado al cliente.');
      }

      return {
        id: state.orderId,
        restaurant: {
          userId: state.restaurantUserId,
          name: state.restaurantName,
        },
        customer: {
          user: {
            id: state.customerUserId,
            name: state.customerName,
          },
        },
        driver: {
          id: state.driverId,
          userId: state.driverUserId,
          user: {
            id: state.driverUserId,
            name: state.driverName,
          },
        },
      } as never;
    });

    const customerFindUniqueSpy = jest.spyOn(prisma.customer, 'findUnique') as unknown as jest.Mock;
    customerFindUniqueSpy.mockImplementation(async ({ where }) => {
      if (where.userId === state.customerUserId) {
        return {
          id: state.customerProfileId,
          userId: state.customerUserId,
        } as never;
      }

      return null as never;
    });

    const driverFindUniqueSpy = jest.spyOn(prisma.driver, 'findUnique') as unknown as jest.Mock;
    driverFindUniqueSpy.mockImplementation(async ({ where }) => {
      if (where.userId === state.driverUserId) {
        return {
          id: state.driverId,
          userId: state.driverUserId,
          availability: DriverAvailability.AVAILABLE,
        } as never;
      }

      return null as never;
    });

    const prismaTransactionSpy = jest.spyOn(prisma, '$transaction') as unknown as jest.Mock;
    prismaTransactionSpy.mockImplementation(async (input: unknown) => {
      if (Array.isArray(input)) {
        return [[buildCustomerOrderListItem(state)], 1];
      }

      return null;
    });

    const orderFindManySpy = jest.spyOn(prisma.order, 'findMany') as unknown as jest.Mock;
    orderFindManySpy.mockImplementation(async (args?: { where?: { driverId?: string; status?: unknown } }) => {
      if (args?.where?.driverId) {
        if (args.where.status === 'DELIVERED') {
          return state.status === OrderStatus.DELIVERED ? [buildDriverPendingItem(state)] : [];
        }

        return state.driverAssigned && state.status !== OrderStatus.DELIVERED
          ? [buildDriverPendingItem(state)]
          : [];
      }

      return [];
    });

    const orderFindFirstSpy = jest.spyOn(prisma.order, 'findFirst') as unknown as jest.Mock;
    orderFindFirstSpy.mockImplementation(async ({ where }: { where?: { id?: string; customerId?: string } }) => {
      if (where?.id === state.orderId && where?.customerId === state.customerProfileId) {
        return buildCustomerOrderDetail(state) as never;
      }

      return null as never;
    });

    const orderFindUniqueSpy = jest.spyOn(prisma.order, 'findUnique') as unknown as jest.Mock;
    orderFindUniqueSpy.mockImplementation(async ({ where }: { where?: { id?: string } }) => {
      if (where?.id === state.orderId) {
        return {
          supportRestaurantId: null,
          status: state.status,
          driverId: state.driverAssigned ? state.driverId : null,
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

  it('mantiene el flujo customer -> restaurant -> driver -> customer con contratos consistentes', async () => {
    const customerToken = await createToken({
      sub: state.customerUserId,
      phone: '+5215511111111',
      role: UserRole.CUSTOMER,
    });
    const restaurantToken = await createToken({
      sub: state.restaurantUserId,
      phone: '+5215533333333',
      role: UserRole.RESTAURANT,
    });
    const driverToken = await createToken({
      sub: state.driverUserId,
      phone: state.driverPhone,
      role: UserRole.DRIVER,
    });

    const emitNotificationSpy = jest
      .spyOn(socketService, 'emitNotification')
      .mockImplementation(() => undefined);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/pedidos',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
      payload: {
        restaurantId: state.restaurantId,
        items: [
          {
            productId: 'product-1',
            quantity: 2,
            specialInstructions: 'Sin cebolla',
          },
        ],
        deliveryAddress: state.address,
        paymentMethod: state.paymentMethod,
        notes: 'Sin salsa verde',
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const restaurantAcceptResponse = await app.inject({
      method: 'PATCH',
      url: `/restaurant-panel/pedidos/${state.orderId}/aceptar`,
      headers: {
        authorization: `Bearer ${restaurantToken}`,
      },
    });

    const restaurantPreparingResponse = await app.inject({
      method: 'PATCH',
      url: `/restaurant-panel/pedidos/${state.orderId}/preparacion`,
      headers: {
        authorization: `Bearer ${restaurantToken}`,
      },
    });

    const restaurantReadyResponse = await app.inject({
      method: 'PATCH',
      url: `/restaurant-panel/pedidos/${state.orderId}/listo`,
      headers: {
        authorization: `Bearer ${restaurantToken}`,
      },
    });

    const assignDriverResponse = await app.inject({
      method: 'POST',
      url: `/restaurant-panel/pedidos/${state.orderId}/asignar-repartidor`,
      headers: {
        authorization: `Bearer ${restaurantToken}`,
      },
      payload: {
        driverId: state.driverId,
      },
    });

    const driverPendingResponse = await app.inject({
      method: 'GET',
      url: '/driver-panel/pedidos/pendientes',
      headers: {
        authorization: `Bearer ${driverToken}`,
      },
    });

    const driverAcceptResponse = await app.inject({
      method: 'PATCH',
      url: `/driver-panel/pedidos/${state.orderId}/aceptar`,
      headers: {
        authorization: `Bearer ${driverToken}`,
      },
    });

    const driverPickedUpResponse = await app.inject({
      method: 'PATCH',
      url: `/driver-panel/pedidos/${state.orderId}/recogido`,
      headers: {
        authorization: `Bearer ${driverToken}`,
      },
    });

    const driverTransitResponse = await app.inject({
      method: 'PATCH',
      url: `/driver-panel/pedidos/${state.orderId}/en-camino`,
      headers: {
        authorization: `Bearer ${driverToken}`,
      },
    });

    const driverDeliveredResponse = await app.inject({
      method: 'PATCH',
      url: `/driver-panel/pedidos/${state.orderId}/entregado`,
      headers: {
        authorization: `Bearer ${driverToken}`,
      },
    });

    const customerOrdersResponse = await app.inject({
      method: 'GET',
      url: '/me/pedidos?page=1&limit=10',
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });

    const customerDetailResponse = await app.inject({
      method: 'GET',
      url: `/me/pedidos/${state.orderId}`,
      headers: {
        authorization: `Bearer ${customerToken}`,
      },
    });

    const driverHistoryResponse = await app.inject({
      method: 'GET',
      url: '/driver-panel/historial',
      headers: {
        authorization: `Bearer ${driverToken}`,
      },
    });

    const customerOrdersBody = parseJson<{
      success: boolean;
      data: { items: Array<{ id: string; status: OrderStatus }>; total: number };
    }>(customerOrdersResponse.body);

    const customerDetailBody = parseJson<{
      success: boolean;
      data: {
        id: string;
        status: OrderStatus;
        tracking: TrackingEntry[];
        driver: { user: { name: string } } | null;
      };
    }>(customerDetailResponse.body);

    const driverPendingBody = parseJson<{
      success: boolean;
      data: Array<{ id: string; status: OrderStatus }>;
    }>(driverPendingResponse.body);

    const driverHistoryBody = parseJson<{
      success: boolean;
      data: { items: Array<{ id: string; status: OrderStatus }>; hasMore: boolean };
    }>(driverHistoryResponse.body);

    expect(restaurantAcceptResponse.statusCode).toBe(200);
    expect(restaurantPreparingResponse.statusCode).toBe(200);
    expect(restaurantReadyResponse.statusCode).toBe(200);
    expect(assignDriverResponse.statusCode).toBe(200);
    expect(driverPendingResponse.statusCode).toBe(200);
    expect(driverAcceptResponse.statusCode).toBe(200);
    expect(driverPickedUpResponse.statusCode).toBe(200);
    expect(driverTransitResponse.statusCode).toBe(200);
    expect(driverDeliveredResponse.statusCode).toBe(200);
    expect(customerOrdersResponse.statusCode).toBe(200);
    expect(customerDetailResponse.statusCode).toBe(200);
    expect(driverHistoryResponse.statusCode).toBe(200);

    expect(driverPendingBody.data).toHaveLength(1);
    expect(driverPendingBody.data[0]?.id).toBe(state.orderId);
    expect(customerOrdersBody.data.total).toBe(1);
    expect(customerOrdersBody.data.items[0]?.status).toBe(OrderStatus.DELIVERED);
    expect(customerDetailBody.data.id).toBe(state.orderId);
    expect(customerDetailBody.data.status).toBe(OrderStatus.DELIVERED);
    expect(customerDetailBody.data.driver?.user.name).toBe(state.driverName);
    expect(customerDetailBody.data.tracking.map((item) => item.status)).toEqual([
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.READY,
      OrderStatus.READY,
      OrderStatus.PICKED_UP,
      OrderStatus.IN_TRANSIT,
      OrderStatus.DELIVERED,
    ]);
    expect(driverHistoryBody.data.items).toHaveLength(1);
    expect(driverHistoryBody.data.items[0]?.status).toBe(OrderStatus.DELIVERED);

    expect(emitNotificationSpy).toHaveBeenCalledWith(
      expect.anything(),
      state.restaurantUserId,
      'RESTAURANT',
      'order:created',
      expect.objectContaining({
        orderId: state.orderId,
      }),
      orderMetaMatcher(state.orderId)
    );
    expect(emitNotificationSpy).toHaveBeenCalledWith(
      expect.anything(),
      state.customerUserId,
      'CUSTOMER',
      'order:accepted',
      expect.objectContaining({
        orderId: state.orderId,
      }),
      orderMetaMatcher(state.orderId)
    );
    expect(emitNotificationSpy).toHaveBeenCalledWith(
      expect.anything(),
      state.driverUserId,
      'DRIVER',
      'order:assigned',
      expect.objectContaining({
        orderId: state.orderId,
      }),
      orderMetaMatcher(state.orderId)
    );
    expect(emitNotificationSpy).toHaveBeenCalledWith(
      expect.anything(),
      state.customerUserId,
      'CUSTOMER',
      'order:delivered',
      expect.objectContaining({
        orderId: state.orderId,
      }),
      orderMetaMatcher(state.orderId)
    );
  });
});
