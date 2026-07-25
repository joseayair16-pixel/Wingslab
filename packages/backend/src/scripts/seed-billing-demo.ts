import { BillingCycle, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

import { prisma } from '../config/database';

const DEFAULT_PLATFORM_FEE_RATE = 0.12;
const DEMO_SETTLEMENT_PREFIX = 'DEMO-BILLING';

function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function formatReference(seed: string, suffix: string) {
  return `${seed}-${suffix}`.replace(/[^A-Z0-9-]/gi, '').toUpperCase();
}

async function ensureDeliveredOrder(params: {
  restaurantId: string;
  createdAt: Date;
  sequence: number;
}) {
  const [product, customer] = await Promise.all([
    prisma.product.findFirst({
      where: { restaurantId: params.restaurantId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.customer.findFirst({
      where: {
        addresses: {
          some: {},
        },
      },
      include: {
        addresses: {
          where: { isDefault: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const address = customer?.addresses[0];

  if (!product || !customer || !address) {
    throw new Error(
      'No hay suficientes datos para sembrar pedidos demo. Se requiere al menos un producto y un cliente con direccion.'
    );
  }

  const quantity = params.sequence % 2 === 0 ? 1 : 2;
  const subtotal = roundCurrency(product.price * quantity);
  const taxAmount = roundCurrency(subtotal * 0.16);
  const serviceFee = 0;
  const deliveryFee = 20;
  const totalAmount = roundCurrency(subtotal + taxAmount + serviceFee + deliveryFee);
  const deliveredAt = addMinutes(params.createdAt, 45);
  const orderReference = formatReference(
    `${DEMO_SETTLEMENT_PREFIX}-${params.restaurantId.slice(-6)}`,
    `ORDER-${params.sequence}-${params.createdAt.getTime()}`
  ).slice(0, 40);

  return prisma.order.create({
    data: {
      orderReference,
      restaurantId: params.restaurantId,
      customerId: customer.id,
      addressId: address.id,
      latitude: address.latitude,
      longitude: address.longitude,
      subtotal,
      taxAmount,
      serviceFee,
      deliveryFee,
      totalAmount,
      status: OrderStatus.DELIVERED,
      paymentMethod: PaymentMethod.CASH,
      paymentStatus: PaymentStatus.COMPLETED,
      estimatedDeliveryTime: addMinutes(params.createdAt, 40),
      actualDeliveryTime: deliveredAt,
      deliveredAt,
      createdAt: params.createdAt,
      items: {
        create: [
          {
            productId: product.id,
            quantity,
            unitPrice: product.price,
            subtotal,
          },
        ],
      },
      tracking: {
        create: [
          {
            status: OrderStatus.DELIVERED,
            latitude: address.latitude,
            longitude: address.longitude,
            notes: 'Pedido demo generado para validar facturacion de restaurantes.',
            createdAt: deliveredAt,
          },
        ],
      },
    },
  });
}

async function main() {
  const restaurant =
    (await prisma.restaurant.findFirst({
      where: { id: process.env.BILLING_DEMO_RESTAURANT_ID || undefined },
      orderBy: { createdAt: 'asc' },
    })) ||
    (await prisma.restaurant.findFirst({
      orderBy: { createdAt: 'asc' },
    }));

  if (!restaurant) {
    throw new Error('No se encontro ningun restaurante para preparar la demo de facturacion.');
  }

  const demoSettlementReference = formatReference(DEMO_SETTLEMENT_PREFIX, restaurant.id);

  await prisma.restaurant.update({
    where: { id: restaurant.id },
    data: {
      billingCycle: BillingCycle.WEEKLY,
      platformFeeRate: DEFAULT_PLATFORM_FEE_RATE,
      billingContactEmail: restaurant.billingContactEmail || restaurant.email,
    },
  });

  const existingSettlements = await prisma.restaurantBillingSettlement.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { settledAt: 'asc' },
  });

  let deliveredOrders = await prisma.order.findMany({
    where: {
      restaurantId: restaurant.id,
      status: OrderStatus.DELIVERED,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      totalAmount: true,
      serviceFee: true,
      createdAt: true,
    },
  });

  if (deliveredOrders.length < 5) {
    const baseTime = addMinutes(new Date(), -360);
    const missingOrders = 5 - deliveredOrders.length;

    for (let index = 0; index < missingOrders; index += 1) {
      await ensureDeliveredOrder({
        restaurantId: restaurant.id,
        createdAt: addMinutes(baseTime, index * 60),
        sequence: deliveredOrders.length + index + 1,
      });
    }

    deliveredOrders = await prisma.order.findMany({
      where: {
        restaurantId: restaurant.id,
        status: OrderStatus.DELIVERED,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        totalAmount: true,
        serviceFee: true,
        createdAt: true,
      },
    });
  }

  const demoSettlement = existingSettlements.find((item) => item.reference === demoSettlementReference);
  const hasAnySettlement = existingSettlements.length > 0;

  if (!hasAnySettlement && deliveredOrders.length >= 4) {
    const settledSliceSize = Math.max(2, Math.floor(deliveredOrders.length / 2));
    const settledOrders = deliveredOrders.slice(0, settledSliceSize);
    const lastSettledOrder = settledOrders[settledOrders.length - 1];
    const periodStart = restaurant.createdAt;
    const periodEnd = lastSettledOrder.createdAt;
    const settledAt = addMinutes(lastSettledOrder.createdAt, 5);
    const deliveredRevenue = roundCurrency(
      settledOrders.reduce((sum, order) => sum + order.totalAmount, 0)
    );
    const serviceFeeRevenue = roundCurrency(
      settledOrders.reduce((sum, order) => sum + order.serviceFee, 0)
    );
    const amount = roundCurrency(serviceFeeRevenue);

    await prisma.$transaction([
      prisma.restaurant.update({
        where: { id: restaurant.id },
        data: {
          lastBillingSettledAt: settledAt,
        },
      }),
      prisma.restaurantBillingSettlement.create({
        data: {
          restaurantId: restaurant.id,
          billingCycle: BillingCycle.WEEKLY,
          feeRate: DEFAULT_PLATFORM_FEE_RATE,
          periodStart,
          periodEnd,
          settledAt,
          deliveredOrders: settledOrders.length,
          deliveredRevenue,
          amount,
          reference: demoSettlementReference,
          notes: 'Liquidacion demo creada automaticamente para validar la pagina de Restaurantes en admin.',
        },
      }),
    ]);
  } else if (demoSettlement && demoSettlement.settledAt && restaurant.lastBillingSettledAt?.getTime() !== demoSettlement.settledAt.getTime()) {
    await prisma.restaurant.update({
      where: { id: restaurant.id },
      data: {
        lastBillingSettledAt: demoSettlement.settledAt,
      },
    });
  }

  const updatedRestaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurant.id },
    select: {
      id: true,
      name: true,
      billingCycle: true,
      platformFeeRate: true,
      lastBillingSettledAt: true,
      createdAt: true,
    },
  });

  const currentDeliveredOrders = await prisma.order.findMany({
    where: {
      restaurantId: restaurant.id,
      status: OrderStatus.DELIVERED,
      createdAt: {
        gt: updatedRestaurant.lastBillingSettledAt || updatedRestaurant.createdAt,
      },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      totalAmount: true,
      serviceFee: true,
      createdAt: true,
    },
  });

  if (currentDeliveredOrders.length < 2) {
    const anchor = updatedRestaurant.lastBillingSettledAt || updatedRestaurant.createdAt;
    const missingOrders = 2 - currentDeliveredOrders.length;

    for (let index = 0; index < missingOrders; index += 1) {
      await ensureDeliveredOrder({
        restaurantId: restaurant.id,
        createdAt: addMinutes(anchor, 90 + index * 60),
        sequence: deliveredOrders.length + index + 10,
      });
    }
  }

  const finalRestaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurant.id },
    include: {
      billingSettlements: {
        orderBy: { settledAt: 'desc' },
        take: 3,
      },
      orders: {
        where: {
          status: OrderStatus.DELIVERED,
          createdAt: {
            gt: updatedRestaurant.lastBillingSettledAt || updatedRestaurant.createdAt,
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          totalAmount: true,
          serviceFee: true,
          createdAt: true,
        },
      },
    },
  });

  const currentRevenue = roundCurrency(
    finalRestaurant.orders.reduce((sum, order) => sum + order.totalAmount, 0)
  );
  const currentDebt = roundCurrency(
    finalRestaurant.orders.reduce((sum, order) => sum + order.serviceFee, 0)
  );

  console.log(
    JSON.stringify(
      {
        restaurantId: finalRestaurant.id,
        restaurantName: finalRestaurant.name,
        billingCycle: finalRestaurant.billingCycle,
        platformFeeRate: finalRestaurant.platformFeeRate,
        lastBillingSettledAt: finalRestaurant.lastBillingSettledAt,
        outstandingDeliveredOrders: finalRestaurant.orders.length,
        outstandingRevenue: currentRevenue,
        outstandingDebt: currentDebt,
        recentSettlements: finalRestaurant.billingSettlements.map((item) => ({
          reference: item.reference,
          amount: item.amount,
          settledAt: item.settledAt,
        })),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
