import { PaymentMethod, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import * as orderService from '../services/order.service';
import * as socketService from '../services/socket.service';
import * as orderWorkflowService from '../services/order-workflow.service';

const VALID_ORDER_PAYLOAD = {
  restaurantId: 'test-restaurant-1',
  items: [{ productId: 'test-product-1', quantity: 1 }],
  fulfillmentType: 'DELIVERY',
  deliveryAddress: {
    street: 'Calle Test',
    number: '123',
    neighborhood: 'Centro',
    city: 'Ciudad',
    state: 'Estado',
    zipCode: '12345',
    country: 'México',
    latitude: 19.4326,
    longitude: -99.1332,
  },
  paymentMethod: 'TRANSFER',
  paymentProofUrl: 'https://example.com/comprobante.jpg',
  notes: 'Test order',
};

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

describe('order security validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      enableRateLimit: false,
      enableSocketIO: false,
      enableJobs: false,
    });
  });

  beforeEach(() => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(orderService, 'createOrderForCustomer').mockResolvedValue({
      order: {
        id: 'mock-order-1',
        orderReference: 'SAD-REF-001',
        dailyCounter: 1,
        totalAmount: 100,
        paymentMethod: 'TRANSFER',
        createdAt: new Date(),
        restaurant: { id: 'test-restaurant-1', userId: 'restaurant-user-1' },
        customer: { user: { name: 'Test Customer' } },
      },
      isDuplicate: false,
    } as any);
    jest.spyOn(orderWorkflowService, 'enqueueRestaurantOrder').mockResolvedValue({
      position: 1,
      queueLength: 1,
    } as any);
    jest.spyOn(socketService, 'emitNotification').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  function createToken(payload: { sub: string; phone: string; role: UserRole }) {
    return app.jwt.sign(payload);
  }

  describe('esquema de entrada (Zod)', () => {
    it('acepta locationVerified: true en el body', async () => {
      const token = await createToken({
        sub: 'customer-1', phone: '+5215511111111', role: UserRole.CUSTOMER,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/pedidos',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...VALID_ORDER_PAYLOAD, locationVerified: true },
      });

      expect(response.statusCode).toBe(201);
    });

    it('acepta locationVerified: false en el body', async () => {
      const token = await createToken({
        sub: 'customer-1', phone: '+5215511111111', role: UserRole.CUSTOMER,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/pedidos',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...VALID_ORDER_PAYLOAD, locationVerified: false },
      });

      expect(response.statusCode).toBe(201);
    });

    it('locationVerified por defecto es false si no se envía', async () => {
      const token = await createToken({
        sub: 'customer-1', phone: '+5215511111111', role: UserRole.CUSTOMER,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/pedidos',
        headers: { authorization: `Bearer ${token}` },
        payload: VALID_ORDER_PAYLOAD,
      });

      expect(response.statusCode).toBe(201);
    });

    it('rechaza TRANSFER sin comprobante', async () => {
      const token = await createToken({
        sub: 'customer-1', phone: '+5215511111111', role: UserRole.CUSTOMER,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/pedidos',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          ...VALID_ORDER_PAYLOAD,
          paymentMethod: 'TRANSFER',
          paymentProofUrl: undefined,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = parseJson<any>(response.payload);
      expect(body.success).toBe(false);
    });

    it('rechaza DELIVERY sin dirección', async () => {
      const token = await createToken({
        sub: 'customer-1', phone: '+5215511111111', role: UserRole.CUSTOMER,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/pedidos',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...VALID_ORDER_PAYLOAD, deliveryAddress: undefined },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rechaza items vacío', async () => {
      const token = await createToken({
        sub: 'customer-1', phone: '+5215511111111', role: UserRole.CUSTOMER,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/pedidos',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...VALID_ORDER_PAYLOAD, items: [] },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('servicio: ubicación y pago', () => {
    it('pasa locationVerified=true al servicio', async () => {
      const spy = jest.spyOn(orderService, 'createOrderForCustomer');
      const token = await createToken({
        sub: 'customer-1', phone: '+5215511111111', role: UserRole.CUSTOMER,
      });

      await app.inject({
        method: 'POST',
        url: '/pedidos',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          ...VALID_ORDER_PAYLOAD,
          paymentMethod: 'TRANSFER' as const,
          locationVerified: true,
        },
      });

      expect(spy).toHaveBeenCalled();
      const input = spy.mock.calls[0][0].input;
      expect(input.locationVerified).toBe(true);
    });

    it('locationVerified=false por defecto al servicio', async () => {
      const spy = jest.spyOn(orderService, 'createOrderForCustomer');
      const token = await createToken({
        sub: 'customer-1', phone: '+5215511111111', role: UserRole.CUSTOMER,
      });

      await app.inject({
        method: 'POST',
        url: '/pedidos',
        headers: { authorization: `Bearer ${token}` },
        payload: { ...VALID_ORDER_PAYLOAD, paymentMethod: 'TRANSFER' as const },
      });

      expect(spy).toHaveBeenCalled();
      const input = spy.mock.calls[0][0].input;
      expect(input.locationVerified).toBe(false);
    });
  });
});
