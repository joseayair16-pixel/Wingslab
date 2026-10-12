/**
 * Concurrencia e idempotencia en creación de pedidos (base de datos REAL).
 *
 * A diferencia de order-idempotency.test.ts (prisma mockeado), aquí dos
 * transacciones corren de verdad en paralelo contra PostgreSQL:
 *  - misma clave concurrente → una sola fila + respuesta idempotente;
 *  - claves distintas con 1 activo previo → el tope de 2 se respeta;
 *  - el reintento no descuenta stock ni incrementa contadores dos veces.
 *
 * Requiere DATABASE_URL apuntando a una BD de pruebas aislada (ver CI).
 * Limpia todos sus fixtures al terminar.
 */
import { PaymentMethod, UserRole } from '@prisma/client';

import { prisma } from '../config/database';
import { createOrderForCustomer } from './order.service';

const TAG = `idem${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
const LAT = 19.4326;
const LNG = -99.1332;

function loc() {
  return { latitude: LAT, longitude: LNG, accuracy: 10, capturedAt: Date.now() };
}

async function createCustomer() {
  const user = await prisma.user.create({
    data: {
      email: `idem-${TAG}-${Math.floor(Math.random() * 1e9)}@test.local`,
      password: 'x',
      phone: `55${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      name: 'Idem Test',
      role: UserRole.CUSTOMER,
      region: 'TEST',
      status: 'ACTIVE',
    },
  });
  const customer = await prisma.customer.create({ data: { userId: user.id } });
  return { user, customer };
}

async function createRestaurant() {
  const user = await prisma.user.create({
    data: {
      email: `idem-rest-${TAG}-${Math.floor(Math.random() * 1e9)}@test.local`,
      password: 'x',
      phone: `56${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      name: 'Idem Rest',
      role: UserRole.RESTAURANT,
      region: 'TEST',
      status: 'ACTIVE',
    },
  });
  const restaurant = await prisma.restaurant.create({
    data: {
      userId: user.id,
      name: `Idem Rest ${TAG}`,
      description: 'd',
      address: 'Calle 1',
      latitude: LAT,
      longitude: LNG,
      region: 'TEST',
      contactPhone: '5500000000',
      email: `idem-rest-${TAG}@test.local`,
      isAcceptingOrders: true,
    },
  });
  const category = await prisma.menuCategory.create({
    data: { restaurantId: restaurant.id, name: `Cat ${TAG}` },
  });
  return { user, restaurant, category };
}

async function createProduct(categoryId: string, restaurantId: string, opts?: { trackStock?: boolean; stock?: number }) {
  return prisma.product.create({
    data: {
      restaurantId,
      categoryId,
      name: `Prod ${TAG}`,
      description: 'd',
      price: 100,
      isAvailable: true,
      trackStock: opts?.trackStock ?? false,
      stock: opts?.stock ?? 0,
    },
  });
}

function baseInput(restaurantId: string, productId: string, overrides: Record<string, unknown> = {}) {
  return {
    restaurantId,
    items: [{ productId, quantity: 2 }],
    fulfillmentType: 'PICKUP',
    paymentMethod: PaymentMethod.CASH,
    locationVerified: true,
    currentLocation: loc(),
    ...overrides,
  } as any;
}

async function countActive(customerId: string) {
  return prisma.order.count({
    where: {
      customerId,
      status: { notIn: ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'] },
    },
  });
}

afterAll(async () => {
  await prisma.order.deleteMany({ where: { customer: { user: { email: { contains: TAG } } } } });
  await prisma.product.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.menuCategory.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.restaurant.deleteMany({ where: { name: { contains: TAG } } });
  await prisma.customer.deleteMany({ where: { user: { email: { contains: TAG } } } });
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.$disconnect();
}, 30000);

describe('creación de pedidos — concurrencia real', () => {
  it('dos solicitudes concurrentes con la misma clave crean un solo pedido', async () => {
    const { customer } = await createCustomer();
    const { restaurant, category } = await createRestaurant();
    const product = await createProduct(category.id, restaurant.id);
    const key = `idem-key-${TAG}-a`;

    const [r1, r2] = await Promise.all([
      createOrderForCustomer({ prisma, customerUserId: customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: key }) }),
      createOrderForCustomer({ prisma, customerUserId: customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: key }) }),
    ]);

    const ids = [r1.order.id, r2.order.id];
    expect(new Set(ids).size).toBe(1);
    expect([r1.isDuplicate, r2.isDuplicate].filter(Boolean)).toHaveLength(1);
    expect(await prisma.order.count({ where: { clientOrderKey: key } })).toBe(1);
  }, 30000);

  it('el reintento tras éxito recupera el original sin efectos duplicados', async () => {
    const { customer } = await createCustomer();
    const { restaurant, category } = await createRestaurant();
    const product = await createProduct(category.id, restaurant.id, { trackStock: true, stock: 5 });
    const key = `idem-key-${TAG}-b`;
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { totalOrders: true } });

    const first = await createOrderForCustomer({ prisma, customerUserId: customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: key }) });
    expect(first.isDuplicate).toBe(false);
    const second = await createOrderForCustomer({ prisma, customerUserId: customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: key }) });
    expect(second.isDuplicate).toBe(true);
    expect(second.order.id).toBe(first.order.id);

    const stock = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, select: { stock: true } });
    expect(stock.stock).toBe(3);
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id }, select: { totalOrders: true } });
    expect(after.totalOrders).toBe(before.totalOrders + 1);
  }, 30000);

  it('claves distintas concurrentes con 1 activo previo nunca superan 2 activos', async () => {
    const { customer } = await createCustomer();
    const { restaurant, category } = await createRestaurant();
    const product = await createProduct(category.id, restaurant.id);

    await createOrderForCustomer({ prisma, customerUserId: customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: `idem-key-${TAG}-c0` }) });
    expect(await countActive(customer.id)).toBe(1);

    const results = await Promise.allSettled([
      createOrderForCustomer({ prisma, customerUserId: customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: `idem-key-${TAG}-c1` }) }),
      createOrderForCustomer({ prisma, customerUserId: customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: `idem-key-${TAG}-c2` }) }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const reason = (failed[0] as PromiseRejectedResult).reason as any;
    expect(reason?.code ?? reason?.message).toMatch(/ACTIVE_ORDERS_LIMIT_EXCEEDED|2 pedidos/);
    expect(await countActive(customer.id)).toBe(2);
  }, 30000);

  it('dos compras legítimas sucesivas con el mismo contenido crean dos pedidos', async () => {
    const { customer } = await createCustomer();
    const { restaurant, category } = await createRestaurant();
    const product = await createProduct(category.id, restaurant.id);

    const r1 = await createOrderForCustomer({ prisma, customerUserId: customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: `idem-key-${TAG}-d1` }) });
    const r2 = await createOrderForCustomer({ prisma, customerUserId: customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: `idem-key-${TAG}-d2` }) });
    expect(r1.isDuplicate).toBe(false);
    expect(r2.isDuplicate).toBe(false);
    expect(r1.order.id).not.toBe(r2.order.id);
  }, 30000);

  it('sin clave se crea con normalidad (compatibilidad con clientes anteriores)', async () => {
    const { customer } = await createCustomer();
    const { restaurant, category } = await createRestaurant();
    const product = await createProduct(category.id, restaurant.id);
    const { clientOrderKey: _omit, ...noKey } = baseInput(restaurant.id, product.id, {});

    const result = await createOrderForCustomer({ prisma, customerUserId: customer.userId, input: noKey });
    expect(result.isDuplicate).toBe(false);
    expect(result.order.id).toBeTruthy();
  }, 30000);

  it('la clave de otro cliente se rechaza sin crear un pedido nuevo', async () => {
    const owner = await createCustomer();
    const intruder = await createCustomer();
    const { restaurant, category } = await createRestaurant();
    const product = await createProduct(category.id, restaurant.id);
    const key = `idem-key-${TAG}-e`;

    const mine = await createOrderForCustomer({ prisma, customerUserId: owner.customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: key }) });
    expect(mine.isDuplicate).toBe(false);

    await expect(
      createOrderForCustomer({ prisma, customerUserId: intruder.customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: key }) })
    ).rejects.toMatchObject({ code: 'ORDER_IDEMPOTENCY_FORBIDDEN' });

    expect(await prisma.order.count({ where: { clientOrderKey: key } })).toBe(1);
    expect(await countActive(intruder.customer.id)).toBe(0);
  }, 30000);

  it('la misma clave usada en paralelo por dos clientes: gana uno y el otro recibe 403', async () => {
    const a = await createCustomer();
    const b = await createCustomer();
    const { restaurant, category } = await createRestaurant();
    const product = await createProduct(category.id, restaurant.id);
    const key = `idem-key-${TAG}-f`;

    const results = await Promise.allSettled([
      createOrderForCustomer({ prisma, customerUserId: a.customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: key }) }),
      createOrderForCustomer({ prisma, customerUserId: b.customer.userId, input: baseInput(restaurant.id, product.id, { clientOrderKey: key }) }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ code: 'ORDER_IDEMPOTENCY_FORBIDDEN' });
    expect(await prisma.order.count({ where: { clientOrderKey: key } })).toBe(1);
  }, 30000);
}, 120000);
