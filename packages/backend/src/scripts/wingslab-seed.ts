/**
 * WingsLab synthetic fixtures.
 *
 * Creates a small, reproducible set of FICTIONAL data in the disposable
 * WingsLab database. It never touches a SaDeL database, never imports real
 * data and never sends any message, push or notification.
 *
 * Guard rails:
 *  - The target database must be one of the disposable WingsLab databases.
 *  - The instance UUID marker must match the local configuration.
 *  - Every record uses a fixed fictional identifier, so the script is idempotent.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient({
  datasourceUrl: process.env.WINGSLAB_DATABASE_URL,
  log: ['error'],
});

const ALLOWED_DATABASES = ['wingslab_migration_test', 'wingslab_local'];
const FICTIONAL_PASSWORD = 'WingsLab-Local-Only-2026';
const FICTIONAL_PHONE = '5500000001';

async function assertSafeTarget(): Promise<void> {
  const url = new URL(process.env.WINGSLAB_DATABASE_URL || '');
  if (!ALLOWED_DATABASES.includes(url.pathname.replace('/', ''))) {
    throw new Error('[WingsLab] Refusing to seed a database outside the disposable set.');
  }
  const expected = process.env.WINGSLAB_INSTANCE_ID;
  if (!expected) throw new Error('[WingsLab] Missing expected instance id.');
  // The identity marker lives in the primary WingsLab database, not in the
  // disposable one. Verify it there before touching the disposable target.
  const identity = new PrismaClient({
    datasourceUrl: process.env.WINGSLAB_IDENTITY_DATABASE_URL,
    log: ['error'],
  });
  try {
    const rows = await identity.$queryRaw<Array<{ instance_id: string }>>`
      SELECT instance_id FROM wingslab_identity.runtime WHERE singleton = true`;
    if (rows.length !== 1) throw new Error('[WingsLab] Missing instance identity marker.');
    if (rows[0].instance_id !== expected) {
      throw new Error('[WingsLab] Instance identity mismatch; refusing to seed.');
    }
  } finally {
    await identity.$disconnect();
  }
}

async function main(): Promise<void> {
  await assertSafeTarget();
  const passwordHash = await bcrypt.hash(FICTIONAL_PASSWORD, 10);
  const now = new Date();
  const region = await prisma.region.upsert({
    where: { code: 'WINGS-LAB' },
    update: {},
    create: {
      code: 'WINGS-LAB', name: 'WingsLab (fictional)', country: 'MX', state: 'CDMX', city: 'Ciudad de Pruebas',
      baseDeliveryFee: 35, deliveryRadius: 8, taxRate: 0.16, pricingModel: 'BASE_PLUS_DISTANCE',
      baseRate: 25, perKmRate: 6, minDeliveryFee: 35, maxDeliveryFee: 90, isActive: true,
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@wingslab.local' },
    update: {},
    create: {
      email: 'admin@wingslab.local', password: passwordHash, phone: '5500000000', phoneNormalized: '5500000000',
      name: 'Administrador', lastName: 'WingsLab', role: 'ADMIN', region: region.code, status: 'ACTIVE',
    },
  });
  await prisma.admin.upsert({ where: { userId: adminUser.id }, update: {}, create: { userId: adminUser.id } });

  const restaurantUser = await prisma.user.upsert({
    where: { email: 'restaurante@wingslab.local' },
    update: {},
    create: {
      email: 'restaurante@wingslab.local', password: passwordHash, phone: '5500000010', phoneNormalized: '5500000010',
      name: 'Restaurante', lastName: 'WingsLab', role: 'RESTAURANT', region: region.code, status: 'ACTIVE',
    },
  });
  const restaurant = await prisma.restaurant.upsert({
    where: { userId: restaurantUser.id },
    update: { name: 'WingsLab' },
    create: {
      userId: restaurantUser.id, name: 'WingsLab',
      description: 'Restaurante ficticio para desarrollo local.', address: 'Calle Ficticia 100, WingsLab',
      latitude: 19.4326, longitude: -99.1332, region: region.code, status: 'ACTIVE',
      isAcceptingOrders: true, isPaused: false, autoOpenEnabled: true, serviceFee: 8,
      hasOwnDelivery: true, supportsNetworkDelivery: false, pickupOnly: false,
      deliveryFee: 35, deliveryRadius: 8, deliveryPricingModel: 'BASE_PLUS_DISTANCE',
      deliveryBaseRate: 25, deliveryPerKmRate: 6, deliveryMinFee: 35, deliveryMaxFee: 90,
      minDeliveryTime: 20, maxDeliveryTime: 60, maxCashOrder: 500, acceptsCash: true,
      contactPhone: FICTIONAL_PHONE, email: 'restaurante@wingslab.local', billingCycle: 'WEEKLY',
      platformFeeRate: 0.08, platformFeePerOrder: 5, enableTicketPrinting: false, isFeatured: false,
      businessType: 'RESTAURANT',
    },
  });

  const category = await prisma.menuCategory.upsert({
    where: { id: 'wl_cat_alitas' },
    update: {},
    create: { id: 'wl_cat_alitas', restaurantId: restaurant.id, name: 'Alitas ficticias', description: 'Categoría de prueba', order: 1, deleted: false },
  });
  const products = [
    { id: 'wl_prod_alitas_6', name: 'Alitas ficticias x6', description: 'Producto de prueba', price: 120 },
    { id: 'wl_prod_alitas_12', name: 'Alitas ficticias x12', description: 'Producto de prueba', price: 210 },
    { id: 'wl_prod_papas', name: 'Papas ficticias', description: 'Producto de prueba', price: 65 },
  ];
  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: {},
      create: {
        id: product.id, restaurantId: restaurant.id, categoryId: category.id, name: product.name,
        description: product.description, price: product.price, sellBy: 'UNIT', trackStock: false,
        stock: 999, lowStockThreshold: 0, isAdultOnly: false, isAvailable: true, deleted: false,
      },
    });
  }

  const customerUser = await prisma.user.upsert({
    where: { email: 'cliente@wingslab.local' },
    update: {},
    create: {
      email: 'cliente@wingslab.local', password: passwordHash, phone: FICTIONAL_PHONE, phoneNormalized: FICTIONAL_PHONE,
      name: 'Cliente', lastName: 'Ficticio', role: 'CUSTOMER', region: region.code, status: 'ACTIVE',
    },
  });
  const customer = await prisma.customer.upsert({
    where: { userId: customerUser.id },
    update: {},
    create: { userId: customerUser.id, rating: 5, totalOrders: 0, isSuspendedByDebt: false, debtAmount: 0 },
  });
  const address = await prisma.address.upsert({
    where: { id: 'wl_addr_1' },
    update: {},
    create: {
      id: 'wl_addr_1', customerId: customer.id, street: 'Avenida Ficticia', number: '42', neighborhood: 'Centro Ficticio',
      city: 'Ciudad de Pruebas', state: 'CDMX', zipCode: '00000', country: 'MX', reference: 'Portón azul ficticio',
      latitude: 19.4330, longitude: -99.1340, isDefault: true, isActive: true,
    },
  });

  const orders = [
    { id: 'wl_order_pendiente', status: 'PENDING' as const, productId: 'wl_prod_alitas_6', quantity: 1, dailyCounter: 1 },
    { id: 'wl_order_preparando', status: 'PREPARING' as const, productId: 'wl_prod_alitas_12', quantity: 2, dailyCounter: 2 },
    { id: 'wl_order_entregado', status: 'DELIVERED' as const, productId: 'wl_prod_papas', quantity: 1, dailyCounter: 3 },
  ];
  for (const seed of orders) {
    const product = products.find(item => item.id === seed.productId)!;
    const subtotal = product.price * seed.quantity;
    const total = subtotal + 35 + 8;
    await prisma.order.upsert({
      where: { id: seed.id },
      update: {},
      create: {
        id: seed.id, orderReference: `WINGS-TEST-${String(seed.dailyCounter).padStart(3, '0')}`, dailyCounter: seed.dailyCounter,
        restaurantId: restaurant.id, customerId: customer.id, driverId: null,
        isAcceptedByDriver: false, isSupportRequested: false, supportCount: 0,
        supportRejectionCount: 0, supportAttempts: 0, noDriversAvailable: false, fulfillmentType: 'DELIVERY',
        addressId: address.id, latitude: 19.4330, longitude: -99.1340, subtotal, taxAmount: 0,
        serviceFee: 8, platformFee: 5, driverPlatformFee: 5, deliveryFee: 35,
        totalAmount: total, status: seed.status, paymentMethod: 'CASH', paymentStatus: seed.status === 'DELIVERED' ? 'COMPLETED' : 'PENDING',
        estimatedDeliveryTime: new Date(now.getTime() + 45 * 60 * 1000), deliveredByRestaurant: seed.status === 'DELIVERED',
        actualDeliveryTime: seed.status === 'DELIVERED' ? now : null, etaExtendedMinutes: 0, notes: 'Pedido ficticio de prueba',
        stuckAlertLevel: 0, overdueAlertLevel: 0, handoverPinAttempts: 0,
      },
    });
    await prisma.orderItem.upsert({
      where: { id: `${seed.id}_item_1` },
      update: {},
      create: {
        id: `${seed.id}_item_1`, orderId: seed.id, productId: product.id, quantity: seed.quantity,
        unitPrice: product.price, subtotal, sellBy: 'UNIT',
      },
    });
  }

  const counts = {
    regions: await prisma.region.count(),
    users: await prisma.user.count(),
    restaurants: await prisma.restaurant.count(),
    categories: await prisma.menuCategory.count(),
    products: await prisma.product.count(),
    customers: await prisma.customer.count(),
    drivers: await prisma.driver.count(),
    addresses: await prisma.address.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
  };
  console.log('[WingsLab] Synthetic fixtures created:', JSON.stringify(counts));
  console.log('[WingsLab] Fictional sign-in data: admin@wingslab.local / restaurante@wingslab.local / cliente@wingslab.local / repartidor@wingslab.local');
}

main()
  .catch(error => { console.error('[WingsLab] Fixture creation failed:', error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
