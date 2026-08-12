import { DriverAvailability, UserRole, OrderStatus, PaymentMethod } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';

import { prisma } from '../config/database';
import { sendAppError } from '../errors/http';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import {
  driverActiveOrderListSelect,
  driverHistoryOrderListSelect,
} from '../services/order-selects';
import { emitNotification } from '../services/socket.service';
import {
  getDriverScopedOrder,
  updateOrderStatusByDriver,
  autoAssignDriver,
  sweepUnassignedOrdersForRegion,
  incrementDriverRejection,
  getDriverRejectionCount,
} from '../services/order-workflow.service';
import { getOrCreateRequestContext } from '../utils/request-context';
import { sendPushNotification } from '../services/notification.service';
import { sendWhatsAppOrderDelivered } from '../services/whatsapp.service';
import {
  checkDriverSuspension,
  enforceDriverBillingSuspension,
  getDriverOverdueDebt,
} from '../services/driver-billing.service';
import { urlToKey, deleteImages } from '../services/storage.service';

const availabilitySchema = z.object({
  availability: z.enum([
    DriverAvailability.AVAILABLE,
    DriverAvailability.BUSY,
    DriverAvailability.OFFLINE,
  ]),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6, 'La contraseña actual debe tener al menos 6 caracteres.'),
    newPassword: z.string().min(6, 'La nueva contraseña debe tener al menos 6 caracteres.'),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'La nueva contraseña debe ser diferente a la actual.',
    path: ['newPassword'],
  });

export async function registerDriverPanelRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function driverScope(driverPanel) {
    driverPanel.addHook('preHandler', authenticate);
    driverPanel.addHook('preHandler', authorize([UserRole.DRIVER]));

    driverPanel.get('/driver-panel/perfil', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const driver = await prisma.driver.findUnique({
        where: { userId: user.sub },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              region: true,
              status: true,
              profilePhoto: true,
            },
          },
        },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el perfil del repartidor.',
          },
        });
      }

      await enforceDriverBillingSuspension(prisma, driver.id, user.sub);

      const updatedDriver = await prisma.driver.findUnique({
        where: { userId: user.sub },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              region: true,
              status: true,
              profilePhoto: true,
            },
          },
        },
      });

      if (!updatedDriver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el perfil del repartidor.',
          },
        });
      }

      const suspensionCheck = await checkDriverSuspension(
        prisma,
        updatedDriver.id,
        updatedDriver.lastBillingSettledAt,
        updatedDriver.createdAt
      );

      return reply.send({
        success: true,
        data: {
          ...updatedDriver,
          availability: suspensionCheck.isSuspendedByDebt ? 'OFFLINE' : updatedDriver.availability,
          isSuspendedByDebt: suspensionCheck.isSuspendedByDebt,
          suspendedDebtAmount: suspensionCheck.suspendedDebtAmount,
        },
      });
    });

    const updatePhotoSchema = z.object({
      profilePhoto: z.string().url('La foto debe ser una URL valida.').nullable(),
    });

    driverPanel.patch('/driver-panel/perfil/photo', async (request, reply) => {
      const parsed = updatePhotoSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);

      const currentUser = await prisma.user.findUnique({
        where: { id: user.sub },
        select: { profilePhoto: true },
      });

      if (currentUser?.profilePhoto && parsed.data.profilePhoto !== currentUser.profilePhoto) {
        await deleteImages([urlToKey(currentUser.profilePhoto)]);
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.sub },
        data: {
          profilePhoto: parsed.data.profilePhoto,
        },
        select: {
          id: true,
          name: true,
          phone: true,
          profilePhoto: true,
        },
      });

      return reply.send({
        success: true,
        data: updatedUser,
      });
    });

    driverPanel.get('/driver-panel/billetera', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const driver = await prisma.driver.findUnique({
        where: { userId: user.sub },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontró el perfil del repartidor.',
          },
        });
      }

      // 1. Calculate Today's Earnings
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const todaySum = await prisma.order.aggregate({
        where: {
          driverId: driver.id,
          status: OrderStatus.DELIVERED,
          deliveredAt: { gte: startOfToday },
        },
        _sum: {
          deliveryFee: true,
        },
        _count: {
          id: true,
        },
      });

      // 2. Calculate Weekly Earnings (Starting Monday)
      const now = new Date();
      const currentDay = now.getDay();
      const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
      const startOfWeek = new Date();
      startOfWeek.setDate(now.getDate() - distanceToMonday);
      startOfWeek.setHours(0, 0, 0, 0);

      const weekSum = await prisma.order.aggregate({
        where: {
          driverId: driver.id,
          status: OrderStatus.DELIVERED,
          deliveredAt: { gte: startOfWeek },
        },
        _sum: {
          deliveryFee: true,
        },
        _count: {
          id: true,
        },
      });

      // 3. Calculate debt split: past period (before most recent Sunday) vs current period
      const debtAnchor = driver.lastBillingSettledAt || driver.createdAt;

      // Most recent Sunday at 23:59:59
      const mostRecentSunday = new Date();
      const dayOfWeek = mostRecentSunday.getDay();
      mostRecentSunday.setDate(mostRecentSunday.getDate() - dayOfWeek);
      mostRecentSunday.setHours(23, 59, 59, 999);

      const totalDebtSum = await prisma.order.aggregate({
        where: {
          driverId: driver.id,
          status: OrderStatus.DELIVERED,
          deliveredAt: { gt: debtAnchor },
        },
        _sum: { driverPlatformFee: true },
      });

      // Current week debt (orders after most recent Sunday)
      const currentDebtSum = await prisma.order.aggregate({
        where: {
          driverId: driver.id,
          status: OrderStatus.DELIVERED,
          deliveredAt: { gt: mostRecentSunday },
        },
        _sum: { driverPlatformFee: true },
      });

      const currentDebt = currentDebtSum._sum.driverPlatformFee || 0;
      const activeDebt = totalDebtSum._sum.driverPlatformFee || 0;

      const pastDebt = await getDriverOverdueDebt(
        prisma,
        driver.id,
        driver.lastBillingSettledAt,
        driver.createdAt
      );

      // 4. Get recent settlements
      const recentSettlements = await prisma.driverBillingSettlement.findMany({
        where: { driverId: driver.id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      // 5. Calculate next cutoff / suspension dates
      let nextCutoffDate: string | null = null;
      let nextCutoffLabel: string | null = null;
      let nextSuspensionDate: string | null = null;

      const nextSunday = new Date(mostRecentSunday);
      nextSunday.setDate(nextSunday.getDate() + 7);
      nextCutoffDate = nextSunday.toISOString();
      nextCutoffLabel = nextSunday.toLocaleDateString('es-MX', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      });

      // If there's current-period debt, the suspension date is next Wednesday
      if (currentDebt > 0) {
        const suspensionWednesday = new Date(nextSunday);
        suspensionWednesday.setDate(nextSunday.getDate() + 3);
        suspensionWednesday.setHours(23, 59, 59, 999);
        nextSuspensionDate = suspensionWednesday.toISOString();
      }

      // 6. Get last 7 days of recent deliveries
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const recentDeliveries = await prisma.order.findMany({
        where: {
          driverId: driver.id,
          status: OrderStatus.DELIVERED,
          deliveredAt: { gte: sevenDaysAgo },
        },
        select: {
          id: true,
          orderReference: true,
          deliveryFee: true,
          deliveredAt: true,
        },
        orderBy: {
          deliveredAt: 'desc',
        },
        take: 15,
      });

      // 7. Check if there's a pending/overdue settlement needing payment
      const pendingSettlement = await prisma.driverBillingSettlement.findFirst({
        where: {
          driverId: driver.id,
          status: { in: ['PENDING', 'OVERDUE'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, dueDate: true, amount: true },
      });

      return reply.send({
        success: true,
        data: {
          todayEarnings: todaySum._sum.deliveryFee || 0,
          todayTripsCount: todaySum._count.id || 0,
          weeklyEarnings: weekSum._sum.deliveryFee || 0,
          weeklyTripsCount: weekSum._count.id || 0,
          activeDebt,
          currentDebt,
          pastDebt,
          lastBillingSettledAt: driver.lastBillingSettledAt,
          recentDeliveries,
          recentSettlements,
          hasPendingSettlement: !!pendingSettlement,
          pendingSettlementDueDate: pendingSettlement?.dueDate?.toISOString() || null,
          nextCutoffDate,
          nextCutoffLabel,
          nextSuspensionDate,
        },
      });
    });

    driverPanel.get('/driver-panel/billetera/deuda', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const driver = await prisma.driver.findUnique({
        where: { userId: user.sub },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'Repartidor no encontrado',
          },
        });
      }

      const debtAnchor = driver.lastBillingSettledAt || driver.createdAt;

      // Most recent Sunday at 23:59:59
      const mostRecentSunday = new Date();
      const dayOfWeek = mostRecentSunday.getDay();
      mostRecentSunday.setDate(mostRecentSunday.getDate() - dayOfWeek);
      mostRecentSunday.setHours(23, 59, 59, 999);

      // Current week orders = delivered after most recent Sunday (regardless of debtAnchor)
      const currentOrders = await prisma.order.findMany({
        where: {
          driverId: driver.id,
          status: OrderStatus.DELIVERED,
          deliveredAt: { gt: mostRecentSunday },
          driverPlatformFee: { gt: 0 },
        },
        select: {
          id: true,
          orderReference: true,
          deliveredAt: true,
          driverPlatformFee: true,
        },
        orderBy: { deliveredAt: 'desc' },
      });

      // Past orders: check settlements first, then fall back to anchor-based logic
      const activeSettlement = await prisma.driverBillingSettlement.findFirst({
        where: {
          driverId: driver.id,
          status: { in: ['OVERDUE', 'PENDING'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { periodStart: true, periodEnd: true, amount: true },
      });

      let pastOrders: Array<{
        id: string;
        orderReference: string;
        deliveredAt: Date | null;
        driverPlatformFee: number;
      }> = [];
      let pastDebt = 0;

      if (activeSettlement) {
        const orders = await prisma.order.findMany({
          where: {
            driverId: driver.id,
            status: OrderStatus.DELIVERED,
            deliveredAt: { gt: activeSettlement.periodStart, lte: activeSettlement.periodEnd },
            driverPlatformFee: { gt: 0 },
          },
          select: {
            id: true,
            orderReference: true,
            deliveredAt: true,
            driverPlatformFee: true,
          },
          orderBy: { deliveredAt: 'desc' },
        });
        pastOrders = orders;
        pastDebt = activeSettlement.amount;
      } else if (debtAnchor < mostRecentSunday) {
        const orders = await prisma.order.findMany({
          where: {
            driverId: driver.id,
            status: OrderStatus.DELIVERED,
            deliveredAt: { gt: debtAnchor, lte: mostRecentSunday },
            driverPlatformFee: { gt: 0 },
          },
          select: {
            id: true,
            orderReference: true,
            deliveredAt: true,
            driverPlatformFee: true,
          },
          orderBy: { deliveredAt: 'desc' },
        });
        pastOrders = orders;
        pastDebt = pastOrders.reduce((sum, o) => sum + (o.driverPlatformFee || 0), 0);
      }

      return reply.send({
        success: true,
        data: {
          pastOrders,
          pastDebt,
          currentOrders,
          currentDebt: currentOrders.reduce((sum, o) => sum + (o.driverPlatformFee || 0), 0),
          totalDebt:
            pastDebt + currentOrders.reduce((sum, o) => sum + (o.driverPlatformFee || 0), 0),
        },
      });
    });

    driverPanel.get('/driver-panel/billetera/settlements', async (request, reply) => {
      try {
        const user = getAuthenticatedUser(request);
        const driver = await prisma.driver.findUnique({ where: { userId: user.sub } });
        if (!driver)
          return reply
            .status(404)
            .send({
              success: false,
              error: { code: 'DRIVER_NOT_FOUND', message: 'No encontrado' },
            });

        const settlements = await prisma.driverBillingSettlement.findMany({
          where: { driverId: driver.id },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });

        return reply.send({ success: true, data: settlements });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message, stack: err.stack });
      }
    });

    driverPanel.post('/driver-panel/billetera/settlements', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const payload = z.object({ paymentProofUrl: z.string().url() }).safeParse(request.body);

      if (!payload.success)
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD' } });

      const driver = await prisma.driver.findUnique({ where: { userId: user.sub } });
      if (!driver)
        return reply.status(404).send({ success: false, error: { code: 'DRIVER_NOT_FOUND' } });

      // Atomic find-or-create using a transaction to prevent race conditions
      const result = await prisma.$transaction(async (tx) => {
        // Find existing PENDING or OVERDUE settlement with lock
        const existing = await tx.driverBillingSettlement.findFirst({
          where: {
            driverId: driver.id,
            status: { in: ['PENDING', 'OVERDUE'] },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existing) {
          const updated = await tx.driverBillingSettlement.update({
            where: { id: existing.id },
            data: {
              status: 'IN_REVIEW',
              paymentProofUrl: payload.data.paymentProofUrl,
            },
          });
          return { settlement: updated, isNew: false };
        }

        // No existing — create one for past period only
        const debtAnchor = driver.lastBillingSettledAt || driver.createdAt;

        const mostRecentSunday = new Date();
        mostRecentSunday.setDate(mostRecentSunday.getDate() - mostRecentSunday.getDay());
        mostRecentSunday.setHours(23, 59, 59, 999);

        const pastDebtAgg = await tx.order.aggregate({
          where: {
            driverId: driver.id,
            status: 'DELIVERED',
            deliveredAt: { gt: debtAnchor, lte: mostRecentSunday },
            driverPlatformFee: { gt: 0 },
          },
          _sum: { driverPlatformFee: true },
          _count: { id: true },
        });

        const amount = pastDebtAgg._sum.driverPlatformFee || 0;
        if (amount <= 0) {
          return { settlement: null, isNew: false, error: 'NO_DEBT' };
        }

        const yy = mostRecentSunday.getFullYear().toString().slice(-2);
        const mm = (mostRecentSunday.getMonth() + 1).toString().padStart(2, '0');
        const dd = mostRecentSunday.getDate().toString().padStart(2, '0');
        const driverShortId = driver.id.slice(-6).toUpperCase();
        const ts = Date.now().toString(36).slice(-4).toUpperCase();
        const reference = `CRT-${yy}${mm}${dd}-${driverShortId}-${ts}`;

        const dueDate = new Date(mostRecentSunday);
        dueDate.setDate(dueDate.getDate() + 3);
        dueDate.setHours(23, 59, 59, 999);

        const created = await tx.driverBillingSettlement.create({
          data: {
            driverId: driver.id,
            reference,
            periodStart: debtAnchor,
            periodEnd: mostRecentSunday,
            dueDate,
            amount,
            deliveredOrders: pastDebtAgg._count.id,
            deliveredRevenue: 0,
            platformFeeTotal: amount,
            status: 'IN_REVIEW',
            paymentProofUrl: payload.data.paymentProofUrl,
          },
        });

        return { settlement: created, isNew: true };
      });

      if (result.error === 'NO_DEBT') {
        return reply
          .status(400)
          .send({
            success: false,
            error: { code: 'NO_DEBT', message: 'No hay deuda del periodo anterior para pagar.' },
          });
      }

      return reply.send({ success: true, data: result.settlement });
    });

    driverPanel.get('/driver-panel/billetera/periodo-actual/pedidos', async (request, reply) => {
      try {
        const user = getAuthenticatedUser(request);
        const driver = await prisma.driver.findUnique({ where: { userId: user.sub } });
        if (!driver)
          return reply.status(404).send({ success: false, error: { code: 'DRIVER_NOT_FOUND' } });

        const query = request.query as { periodStart?: string; periodEnd?: string };
        const debtAnchor = driver.lastBillingSettledAt || driver.createdAt;

        const deliveredAtFilter: any = { gt: debtAnchor };
        if (query.periodStart) {
          deliveredAtFilter.gte = new Date(query.periodStart);
        }
        if (query.periodEnd) {
          deliveredAtFilter.lte = new Date(query.periodEnd);
        }

        const debtOrders = await prisma.order.findMany({
          where: {
            driverId: driver.id,
            status: 'DELIVERED',
            deliveredAt: deliveredAtFilter,
            driverPlatformFee: { gt: 0 },
          },
          select: {
            id: true,
            orderReference: true,
            deliveredAt: true,
            deliveryFee: true,
            driverPlatformFee: true,
            customer: {
              select: {
                user: { select: { name: true } },
              },
            },
          },
          orderBy: { deliveredAt: 'desc' },
        });

        return reply.send({
          success: true,
          data: {
            orders: debtOrders,
            totalDebt: debtOrders.reduce(
              (sum: number, o: any) => sum + (o.driverPlatformFee || 0),
              0
            ),
          },
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    });

    driverPanel.get('/driver-panel/billetera/grafica', async (request, reply) => {
      const { weekOffset = '0' } = request.query as { weekOffset?: string };
      const offset = parseInt(weekOffset, 10);

      if (isNaN(offset) || offset < 0 || offset > 7) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_OFFSET',
            message: 'Solo puedes consultar hasta 8 semanas hacia atrás.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const driver = await prisma.driver.findUnique({
        where: { userId: user.sub },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontró el perfil del repartidor.',
          },
        });
      }

      const now = new Date();
      const currentDay = now.getDay();
      const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;

      // Start of current week (Monday)
      const currentMonday = new Date(now);
      currentMonday.setDate(now.getDate() - distanceToMonday);
      currentMonday.setHours(0, 0, 0, 0);

      // Target week start
      const targetMonday = new Date(currentMonday);
      targetMonday.setDate(currentMonday.getDate() - offset * 7);

      // Target week end (Sunday 23:59:59)
      const targetSunday = new Date(targetMonday);
      targetSunday.setDate(targetMonday.getDate() + 6);
      targetSunday.setHours(23, 59, 59, 999);

      const orders = await prisma.order.findMany({
        where: {
          driverId: driver.id,
          status: OrderStatus.DELIVERED,
          deliveredAt: {
            gte: targetMonday,
            lte: targetSunday,
          },
        },
        select: {
          deliveryFee: true,
          deliveredAt: true,
        },
      });

      // Aggregate by day of week (0=Mon, 1=Tue, ..., 6=Sun)
      const days = [
        { label: 'L', date: new Date(targetMonday), earnings: 0, trips: 0 },
        {
          label: 'M',
          date: new Date(targetMonday.getTime() + 86400000 * 1),
          earnings: 0,
          trips: 0,
        },
        {
          label: 'X',
          date: new Date(targetMonday.getTime() + 86400000 * 2),
          earnings: 0,
          trips: 0,
        },
        {
          label: 'J',
          date: new Date(targetMonday.getTime() + 86400000 * 3),
          earnings: 0,
          trips: 0,
        },
        {
          label: 'V',
          date: new Date(targetMonday.getTime() + 86400000 * 4),
          earnings: 0,
          trips: 0,
        },
        {
          label: 'S',
          date: new Date(targetMonday.getTime() + 86400000 * 5),
          earnings: 0,
          trips: 0,
        },
        {
          label: 'D',
          date: new Date(targetMonday.getTime() + 86400000 * 6),
          earnings: 0,
          trips: 0,
        },
      ];

      for (const order of orders) {
        if (!order.deliveredAt) continue;
        const d = order.deliveredAt.getDay();
        const idx = d === 0 ? 6 : d - 1; // 0=Sunday mapped to 6
        if (idx >= 0 && idx <= 6) {
          days[idx].earnings += order.deliveryFee;
          days[idx].trips += 1;
        }
      }

      return reply.send({
        success: true,
        data: {
          weekStart: targetMonday,
          weekEnd: targetSunday,
          chartData: days.map((d) => ({
            label: d.label,
            date: d.date.toISOString(),
            earnings: d.earnings,
            trips: d.trips,
          })),
        },
      });
    });

    driverPanel.patch('/driver-panel/disponibilidad', async (request, reply) => {
      const parsed = availabilitySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const driver = await prisma.driver.findUnique({
        where: { userId: user.sub },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el perfil del repartidor.',
          },
        });
      }

      if (parsed.data.availability === DriverAvailability.AVAILABLE) {
        await enforceDriverBillingSuspension(prisma, driver.id, user.sub);

        const freshDriver = await prisma.driver.findUnique({
          where: { userId: user.sub },
          select: {
            id: true,
            lastBillingSettledAt: true,
            createdAt: true,
            availability: true,
            status: true,
          },
        });

        if (freshDriver) {
          const suspensionCheck = await checkDriverSuspension(
            prisma,
            freshDriver.id,
            freshDriver.lastBillingSettledAt,
            freshDriver.createdAt
          );
          if (suspensionCheck.isSuspendedByDebt) {
            return reply.status(403).send({
              success: false,
              error: {
                code: 'DRIVER_SUSPENDED',
                message: `Cuenta suspendida por adeudo vencido de $${suspensionCheck.suspendedDebtAmount.toFixed(2)}. Liquide su saldo con administración.`,
              },
            });
          }
        }
      }

      const updatedDriver = await prisma.driver.update({
        where: { id: driver.id },
        data: {
          availability: parsed.data.availability,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
      });
      if (updatedDriver.availability === DriverAvailability.AVAILABLE) {
        // Smart Sweep: Try to rescue any pending orders in this region
        setTimeout(async () => {
          try {
            const assignedOrders = await sweepUnassignedOrdersForRegion(
              prisma,
              updatedDriver.region
            );
            for (const { order, driver: assignedDriver } of assignedOrders) {
              emitNotification(
                fastify.io,
                assignedDriver.userId,
                'DRIVER',
                'order:assigned',
                {
                  orderId: order.id,
                  orderReference: order.orderReference,
                  restaurantName: order.restaurant.name,
                  customerName: order.customer.user.name,
                },
                { orderId: order.id }
              );
              emitNotification(
                fastify.io,
                order.customer.user.id,
                'CUSTOMER',
                'order:driver-assigned',
                {
                  orderId: order.id,
                  driverName: assignedDriver.user.name,
                },
                { orderId: order.id }
              );
              emitNotification(
                fastify.io,
                order.restaurant.userId,
                'RESTAURANT',
                'order:driver-assigned',
                {
                  orderId: order.id,
                  driverName: assignedDriver.user.name,
                },
                { orderId: order.id }
              );
            }
          } catch (err) {
            console.error('Sweep failed on driver available:', err);
          }
        }, 500); // Small delay to let the driver status commit finish
      }
      return reply.send({
        success: true,
        data: updatedDriver,
      });
    });

    driverPanel.patch('/driver-panel/password', async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);

      const dbUser = await prisma.user.findUnique({
        where: { id: user.sub },
        select: { password: true },
      });

      if (!dbUser) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'No se encontro el usuario del repartidor.',
          },
        });
      }

      const isPasswordHash = (pwd: string) => /^\$2[aby]\$\d{2}\$/.test(pwd);

      const passwordMatches = isPasswordHash(dbUser.password)
        ? await bcryptjs.compare(parsed.data.currentPassword, dbUser.password)
        : dbUser.password === parsed.data.currentPassword;

      if (!passwordMatches) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_CURRENT_PASSWORD',
            message: 'La contraseña actual es incorrecta.',
          },
        });
      }

      const hashedPassword = await bcryptjs.hash(parsed.data.newPassword, 10);

      await prisma.user.update({
        where: { id: user.sub },
        data: { password: hashedPassword },
      });

      return reply.send({
        success: true,
        message: 'Contraseña actualizada exitosamente.',
      });
    });

    driverPanel.get('/driver-panel/pedidos/pendientes', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const driver = await prisma.driver.findUnique({
        where: { userId: user.sub },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el perfil del repartidor.',
          },
        });
      }

      const items = await prisma.order.findMany({
        where: {
          driverId: driver.id,
          status: {
            in: ['CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'],
          },
        },
        select: driverActiveOrderListSelect,
        orderBy: { createdAt: 'desc' },
      });

      const statusPriority: Record<string, number> = {
        IN_TRANSIT: 0,
        PICKED_UP: 1,
        READY: 2,
        PREPARING: 3,
        CONFIRMED: 4,
      };

      const sortedItems = [...items].sort((a, b) => {
        const priorityA = statusPriority[a.status] ?? 99;
        const priorityB = statusPriority[b.status] ?? 99;

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        if (a.batchId && b.batchId && a.batchId === b.batchId) {
          return (a.deliverySequence ?? 999) - (b.deliverySequence ?? 999);
        }

        const prepA = a.preparationDeadlineAt ? new Date(a.preparationDeadlineAt).getTime() : null;
        const prepB = b.preparationDeadlineAt ? new Date(b.preparationDeadlineAt).getTime() : null;

        if (prepA !== null && prepB !== null) {
          return prepA - prepB;
        }
        if (prepA !== null) return -1;
        if (prepB !== null) return 1;

        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

      return reply.send({
        success: true,
        data: sortedItems,
      });
    });

    driverPanel.get('/driver-panel/pedidos/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const order = await getDriverScopedOrder(prisma, user.sub, params.data.id);

      if (!order) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'No se encontro el pedido.',
          },
        });
      }

      return reply.send({
        success: true,
        data: order,
      });
    });

    const driverActions = [
      {
        path: '/driver-panel/pedidos/:id/aceptar',
        action: 'accept' as const,
        restaurantEvent: 'order:driver-accepted',
        customerEvent: 'order:driver-accepted',
      },
      {
        path: '/driver-panel/pedidos/:id/rechazar',
        action: 'reject' as const,
        restaurantEvent: 'order:driver-rejected',
        customerEvent: 'order:driver-rejected',
      },
      {
        path: '/driver-panel/pedidos/:id/recogido',
        action: 'picked_up' as const,
        restaurantEvent: 'order:picked-up',
        customerEvent: 'order:picked-up',
      },
      {
        path: '/driver-panel/pedidos/:id/en-camino',
        action: 'in_transit' as const,
        restaurantEvent: 'order:in-transit',
        customerEvent: 'order:in-transit',
        pushTitle: '¡Tu pedido va en camino! 🛵',
        pushBody: 'El repartidor recogió tu pedido y va hacia tu dirección.',
        pushVibrate: [300, 100, 300, 100, 300], // 3 pulses
        pushRequireInteraction: false,
      },
      {
        path: '/driver-panel/pedidos/:id/entregado',
        action: 'delivered' as const,
        restaurantEvent: 'order:delivered',
        customerEvent: 'order:delivered',
        pushTitle: '¡Pedido entregado! 🎉',
        pushBody: 'Tu pedido ha sido entregado exitosamente. ¡Que lo disfrutes!',
        pushVibrate: [1000, 500, 1000, 500, 1000], // 3 long pulses
        pushRequireInteraction: true,
      },
    ];

    for (const routeConfig of driverActions) {
      const rateLimitConfig =
        routeConfig.action === 'accept' || routeConfig.action === 'reject'
          ? { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }
          : {};
      driverPanel.patch(routeConfig.path, rateLimitConfig, async (request, reply) => {
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

        if (!params.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_PARAMS',
              message: params.error.issues[0]?.message || 'Parametros invalidos.',
            },
          });
        }

        const user = getAuthenticatedUser(request);
        const requestContext = getOrCreateRequestContext(request);

        try {
          const order = await updateOrderStatusByDriver({
            prisma,
            driverUserId: user.sub,
            orderId: params.data.id,
            action: routeConfig.action,
            pin: (request.body as any)?.pin,
          });

          // Si el repartidor rechaza, re-despachar de forma automática e inmediata al siguiente mejor repartidor
          if (routeConfig.action === 'reject') {
            try {
              const driver = await prisma.driver.findUnique({
                where: { userId: user.sub },
              });
              const currentDriverId = driver?.id;

              if (currentDriverId) {
                setTimeout(async () => {
                  try {
                    const assignResult = await autoAssignDriver(
                      prisma,
                      params.data.id,
                      order.restaurant.userId,
                      currentDriverId
                    );
                    if (assignResult.success && assignResult.driver && assignResult.order) {
                      const updatedOrder = assignResult.order;

                      // Emitir notificaciones para el nuevo repartidor y el cliente en tiempo real
                      emitNotification(
                        fastify.io,
                        assignResult.driver.userId,
                        'DRIVER',
                        'order:assigned',
                        {
                          orderId: updatedOrder.id,
                          orderReference: updatedOrder.orderReference,
                          restaurantName: updatedOrder.restaurant.name,
                          customerName: updatedOrder.customer.user.name,
                        },
                        {
                          requestId: requestContext.requestId,
                          orderId: updatedOrder.id,
                        }
                      );

                      emitNotification(
                        fastify.io,
                        updatedOrder.customer.user.id,
                        'CUSTOMER',
                        'order:driver-assigned',
                        {
                          orderId: updatedOrder.id,
                          driverName: assignResult.driver.user.name,
                        },
                        {
                          requestId: requestContext.requestId,
                          orderId: updatedOrder.id,
                        }
                      );

                      // Notify restaurant that driver was assigned
                      emitNotification(
                        fastify.io,
                        order.restaurant.userId,
                        'RESTAURANT',
                        'order:driver-assigned',
                        {
                          orderId: updatedOrder.id,
                          driverName: assignResult.driver.user.name,
                        },
                        {
                          requestId: requestContext.requestId,
                          orderId: updatedOrder.id,
                        }
                      );

                      request.log.info(
                        `Auto-assigned new driver ${assignResult.driver.id} to order ${params.data.id} after rejection by driver ${currentDriverId} in background.`
                      );
                    } else {
                      request.log.info(
                        `No immediate backup driver found for order ${params.data.id}. Order will be retried by the sweep cron.`
                      );
                    }
                  } catch (err) {
                    console.error('Failed to auto-reassign driver on reject in background:', err);
                  }
                }, 3500);
              }
            } catch (err) {
              console.error('Failed to fetch driver on reject:', err);
            }
          }

          request.log.info(
            `[DEBUG] Emitiendo ${routeConfig.restaurantEvent} al room RESTAURANT:${order.restaurant.userId} | orderId: ${params.data.id}`
          );
          emitNotification(
            fastify.io,
            order.restaurant.userId,
            'RESTAURANT',
            routeConfig.restaurantEvent,
            {
              orderId: params.data.id,
              status: routeConfig.action,
            },
            {
              requestId: requestContext.requestId,
              orderId: params.data.id,
            }
          );

          emitNotification(
            fastify.io,
            order.customer.user.id,
            'CUSTOMER',
            routeConfig.customerEvent,
            {
              orderId: params.data.id,
              status: routeConfig.action,
            },
            {
              requestId: requestContext.requestId,
              orderId: params.data.id,
            }
          );

          if (routeConfig.pushTitle && routeConfig.pushBody) {
            request.log.info(
              `[Push] Intentando enviar notificacion push al comensal ${order.customer.user.id} para la accion ${routeConfig.action}`
            );
            try {
              const pushResult = await sendPushNotification(order.customer.user.id, {
                title: routeConfig.pushTitle,
                body: routeConfig.pushBody,
                icon: '/app-icon-192.png',
                badge: '/badge.png',
                vibrate: routeConfig.pushVibrate,
                requireInteraction: routeConfig.pushRequireInteraction,
                data: {
                  orderId: params.data.id,
                  event: routeConfig.customerEvent,
                  url: `/?orderId=${params.data.id}`,
                },
              });
              request.log.info(
                `[Push] Resultado de notificacion push para comensal ${order.customer.user.id}: ${JSON.stringify(pushResult)}`
              );
            } catch (pushErr) {
              request.log.error(
                pushErr as any,
                `[Push] Error al enviar notificacion push al comensal ${order.customer.user.id}`
              );
            }
          }
          if (routeConfig.action === 'delivered') {
            void (async () => {
              try {
                const customer = await prisma.customer.findUnique({
                  where: { userId: order.customer.user.id },
                  select: { whatsappNotifications: true },
                });
                const userPhone = (
                  await prisma.user.findUnique({
                    where: { id: order.customer.user.id },
                    select: { phone: true },
                  })
                )?.phone;
                if (customer?.whatsappNotifications && userPhone) {
                  void sendWhatsAppOrderDelivered({
                    customerPhone: userPhone,
                    customerName: order.customer.user.name,
                    restaurantName: order.restaurant.name,
                    orderReference: order.orderReference,
                  });
                }
              } catch {}
            })();
          }
          if (routeConfig.action === 'delivered' || routeConfig.action === 'reject') {
            // Smart Sweep: The driver freed up a slot, let's see if they can take another pending order
            setTimeout(async () => {
              try {
                const driver = await prisma.driver.findUnique({ where: { userId: user.sub } });
                if (driver && driver.availability === DriverAvailability.AVAILABLE) {
                  const assignedOrders = await sweepUnassignedOrdersForRegion(
                    prisma,
                    driver.region
                  );
                  for (const { order: sweptOrder, driver: assignedDriver } of assignedOrders) {
                    emitNotification(
                      fastify.io,
                      assignedDriver.userId,
                      'DRIVER',
                      'order:assigned',
                      {
                        orderId: sweptOrder.id,
                        orderReference: sweptOrder.orderReference,
                        restaurantName: sweptOrder.restaurant.name,
                        customerName: sweptOrder.customer.user.name,
                      },
                      { orderId: sweptOrder.id }
                    );
                    emitNotification(
                      fastify.io,
                      sweptOrder.customer.user.id,
                      'CUSTOMER',
                      'order:driver-assigned',
                      {
                        orderId: sweptOrder.id,
                        driverName: assignedDriver.user.name,
                      },
                      { orderId: sweptOrder.id }
                    );
                    emitNotification(
                      fastify.io,
                      sweptOrder.restaurant.userId,
                      'RESTAURANT',
                      'order:driver-assigned',
                      {
                        orderId: sweptOrder.id,
                        driverName: assignedDriver.user.name,
                      },
                      { orderId: sweptOrder.id }
                    );
                  }
                }
              } catch (err) {
                console.error('Sweep failed on driver freeing up slot:', err);
              }
            }, 3000); // Slight delay to ensure the current order status transaction is fully settled
          }

          return reply.send({
            success: true,
            data: order,
          });
        } catch (error) {
          return sendAppError(reply, error);
        }
      });
    }

    driverPanel.patch('/driver-panel/pedidos/:id/llegue', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await getDriverScopedOrder(prisma, user.sub, params.data.id);

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido.',
            },
          });
        }

        // Only a delivery in transit can be marked as "arrived at the customer".
        if (order.status !== OrderStatus.IN_TRANSIT) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'INVALID_ORDER_STATUS',
              message: 'Solo puedes notificar tu llegada mientras el pedido esta en camino.',
            },
          });
        }

        // Persist the "arrived" state via tracking so frontend can reconstruct it on reload.
        // Guarded so repeated taps don't spam tracking rows or reset the arrival timestamp
        // (which is the anchor for the 10/15 min abandoned-delivery thresholds).
        if (!order.driverArrivedAtCustomer) {
          await prisma.orderTracking.create({
            data: {
              orderId: order.id,
              status: order.status, // Remains IN_TRANSIT
              notes: 'DRIVER_ARRIVED',
            },
          });

          // Record when the driver reached the customer's door. This timestamp is the
          // anchor for the abandoned-delivery thresholds (10min transfer / 15min cash).
          await prisma.order.update({
            where: { id: order.id },
            data: { driverArrivedAtCustomer: new Date() },
          });
        }

        emitNotification(
          fastify.io,
          order.customer.user.id,
          'CUSTOMER',
          'order:driver-arrived',
          {
            orderId: params.data.id,
            status: 'ARRIVED',
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        await sendPushNotification(order.customer.user.id, {
          title: '¡Ya llegué!',
          body: 'El repartidor está afuera de tu domicilio con tu pedido.',
          icon: '/app-icon-192.png',
          badge: '/badge.png',
          vibrate: [400, 100, 400, 100, 400, 100, 800], // custom warning pattern
          requireInteraction: true,
          data: {
            orderId: params.data.id,
            event: 'order:driver-arrived',
            url: `/?orderId=${params.data.id}`,
          },
        });

        return reply.send({
          success: true,
          data: await getDriverScopedOrder(prisma, user.sub, params.data.id),
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ─── DEJAR EN LUGAR SEGURO (abandoned delivery - transfer) ────────────
    // TRANSFER orders that were already paid: after 10 min without the customer
    // coming out, the driver may leave the order in a safe place and complete
    // the delivery (no PIN required - payment already collected).
    driverPanel.patch('/driver-panel/pedidos/:id/dejar-lugar-seguro', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await getDriverScopedOrder(prisma, user.sub, params.data.id);
        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido asignado a este repartidor.',
            },
          });
        }

        if (order.status !== OrderStatus.IN_TRANSIT) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'INVALID_ORDER_STATUS',
              message: 'El pedido ya no esta en camino y no puede marcarse como dejado.',
            },
          });
        }

        if (order.paymentMethod !== PaymentMethod.TRANSFER) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'INVALID_PAYMENT_METHOD',
              message: 'Esta opcion solo aplica a pedidos pagados por transferencia.',
            },
          });
        }

        if (!order.driverArrivedAtCustomer) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'DRIVER_NOT_ARRIVED',
              message: 'Debes registrar que llegaste con el cliente antes de continuar.',
            },
          });
        }

        const waitMs = Date.now() - new Date(order.driverArrivedAtCustomer).getTime();
        const SAFE_PLACE_WAIT_MS = 10 * 60 * 1000;
        if (waitMs < SAFE_PLACE_WAIT_MS) {
          const faltaMin = Math.ceil((SAFE_PLACE_WAIT_MS - waitMs) / 60000);
          return reply.status(409).send({
            success: false,
            error: {
              code: 'ARRIVAL_TIMEOUT_NOT_ELAPSED',
              message: `Aun no han pasado los 10 minutos. Intenta en ${faltaMin} minuto(s) o confirma la entrega con el cliente.`,
            },
          });
        }

        const updatedOrder = await updateOrderStatusByDriver({
          prisma,
          driverUserId: user.sub,
          orderId: params.data.id,
          action: 'safe_place',
          pin: undefined,
        });

        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:delivered',
          {
            orderId: params.data.id,
            status: 'safe_place',
          },
          { requestId: requestContext.requestId, orderId: params.data.id }
        );

        emitNotification(
          fastify.io,
          order.customer.user.id,
          'CUSTOMER',
          'order:delivered',
          {
            orderId: params.data.id,
            status: 'safe_place',
          },
          { requestId: requestContext.requestId, orderId: params.data.id }
        );

        try {
          await sendPushNotification(order.customer.user.id, {
            title: 'Tu pedido fue dejado en un lugar seguro',
            body: 'El repartidor espero mas de 10 minutos y dejo tu pedido en un lugar seguro. ¡Recogelo cuando puedas!',
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [300, 100, 300],
            requireInteraction: true,
            data: {
              orderId: params.data.id,
              event: 'order:delivered',
              url: `/?orderId=${params.data.id}`,
            },
          });
        } catch (pushErr) {
          request.log.error(pushErr as any, '[Push] Error al notificar entrega en lugar seguro');
        }

        return reply.send({ success: true, data: updatedOrder });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ─── CLIENTE NO SALIO - LIBERAR PEDIDO (abandoned delivery - cash) ─────
    // CASH orders: after 15 min without the customer coming out, the driver may
    // release the order. The order is marked delivered, a billing settlement is
    // created for the customer's debt and the customer is suspended until paid.
    driverPanel.patch('/driver-panel/pedidos/:id/cliente-no-salio', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await getDriverScopedOrder(prisma, user.sub, params.data.id);
        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido asignado a este repartidor.',
            },
          });
        }

        if (order.status !== OrderStatus.IN_TRANSIT) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'INVALID_ORDER_STATUS',
              message: 'El pedido ya no esta en camino y no puede liberarse.',
            },
          });
        }

        if (order.paymentMethod !== PaymentMethod.CASH) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'INVALID_PAYMENT_METHOD',
              message: 'Esta opcion solo aplica a pedidos pagados en efectivo.',
            },
          });
        }

        if (!order.driverArrivedAtCustomer) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'DRIVER_NOT_ARRIVED',
              message: 'Debes registrar que llegaste con el cliente antes de continuar.',
            },
          });
        }

        const arrivedAtCustomer = order.driverArrivedAtCustomer;
        const waitMs = Date.now() - new Date(arrivedAtCustomer).getTime();
        const NO_SHOW_WAIT_MS = 15 * 60 * 1000;
        if (waitMs < NO_SHOW_WAIT_MS) {
          const faltaMin = Math.ceil((NO_SHOW_WAIT_MS - waitMs) / 60000);
          return reply.status(409).send({
            success: false,
            error: {
              code: 'ARRIVAL_TIMEOUT_NOT_ELAPSED',
              message: `Aun no han pasado los 15 minutos. Intenta en ${faltaMin} minuto(s) o confirma la entrega con el cliente.`,
            },
          });
        }

        // Idempotency guard: never create a second debt for the same order.
        const existingSettlement = await prisma.customerBillingSettlement.findUnique({
          where: { orderId: order.id },
          select: { id: true },
        });
        if (existingSettlement) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'SETTLEMENT_ALREADY_EXISTS',
              message: 'Este pedido ya genero una deuda. Revisa con soporte.',
            },
          });
        }

        // 1) Create the debt + suspend the customer + log a support ticket ATOMICALLY.
        //    The unique(orderId) constraint serializes concurrent releases: if two
        //    requests tap "liberar" at once only one creates the settlement and the
        //    other hits P2002 -> 409. Creating the debt BEFORE marking the order
        //    delivered guarantees we never end with a delivered-but-unbilled order.
        let settlementId: string;
        try {
          const created = await prisma.$transaction(async (tx) => {
            const reference = `CUS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

            const settlement = await tx.customerBillingSettlement.create({
              data: {
                customerId: order.customer.id,
                reference,
                orderId: order.id,
                amount: order.totalAmount,
                status: 'PENDING',
                dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                notes: `Pedido no recibido - el repartidor llego y espero 15+ minutos sin respuesta del cliente. Pedido #${order.orderReference}.`,
              },
            });

            // debtAmount accumulates: a customer may owe for more than one order.
            await tx.customer.update({
              where: { id: order.customer.id },
              data: { isSuspendedByDebt: true, debtAmount: { increment: order.totalAmount } },
            });

            await tx.user.update({
              where: { id: order.customer.user.id },
              data: { status: 'SUSPENDED' },
            });

            await tx.supportTicket.create({
              data: {
                type: 'ORDER',
                subject: 'Cliente no salio a recibir pedido',
                description: [
                  `Pedido: #${order.orderReference}`,
                  `Repartidor: ${order.driver?.user?.name || 'N/A'}`,
                  `Hora de llegada al domicilio: ${arrivedAtCustomer.toISOString()}`,
                  `Tiempo de espera: 15+ minutos`,
                  `Monto del pedido: $${order.totalAmount.toFixed(2)}`,
                  `Restaurante: ${order.restaurant.name}`,
                  `Referencia de deuda: ${settlement.reference}`,
                ].join('\n'),
                status: 'PENDING',
                customerId: order.customer.id,
                orderNumber: order.orderReference,
                storeName: order.restaurant.name,
              },
            });

            return settlement;
          });
          settlementId = created.id;
        } catch (debtErr: any) {
          if (debtErr?.code === 'P2002') {
            return reply.status(409).send({
              success: false,
              error: {
                code: 'SETTLEMENT_ALREADY_EXISTS',
                message: 'Este pedido ya genero una deuda. Revisa con soporte.',
              },
            });
          }
          throw debtErr;
        }

        // 2) Complete the delivery (DELIVERED status, driver freed up, stats).
        let updatedOrder: Awaited<ReturnType<typeof updateOrderStatusByDriver>>;
        try {
          updatedOrder = await updateOrderStatusByDriver({
            prisma,
            driverUserId: user.sub,
            orderId: params.data.id,
            action: 'no_show',
            pin: undefined,
          });
        } catch (deliveryErr) {
          // Compensation: the delivery could not be completed (e.g. the status
          // changed concurrently). Undo the debt so the customer is not charged
          // for an order that is not actually released.
          try {
            await prisma.$transaction(async (tx) => {
              await tx.customerBillingSettlement.delete({ where: { id: settlementId } });
              const remaining = await tx.customerBillingSettlement.aggregate({
                where: { customerId: order.customer.id, status: { not: 'PAID' } },
                _sum: { amount: true },
              });
              const remainingDebt = remaining._sum.amount || 0;
              await tx.customer.update({
                where: { id: order.customer.id },
                data: remainingDebt > 0
                  ? { isSuspendedByDebt: true, debtAmount: remainingDebt }
                  : { isSuspendedByDebt: false, debtAmount: 0 },
              });
              if (remainingDebt === 0) {
                await tx.user.update({
                  where: { id: order.customer.user.id },
                  data: { status: 'ACTIVE' },
                });
              }
            });
          } catch (compErr) {
            request.log.error(
              compErr as any,
              '[Deuda] No se pudo revertir la deuda tras fallar la entrega'
            );
          }
          throw deliveryErr;
        }

        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:delivered',
          {
            orderId: params.data.id,
            status: 'no_show',
          },
          { requestId: requestContext.requestId, orderId: params.data.id }
        );

        emitNotification(
          fastify.io,
          order.customer.user.id,
          'CUSTOMER',
          'account:suspended',
          {
            reason: 'unpaid_delivery',
            orderId: params.data.id,
          },
          { requestId: requestContext.requestId, orderId: params.data.id }
        );

        try {
          await sendPushNotification(order.customer.user.id, {
            title: 'No pudimos entregar tu pedido',
            body: 'El repartidor llego a tu domicilio y espero, pero no saliste a recibirlo. Para volver a pedir en SaDeL, cubre el saldo pendiente en la app.',
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [400, 100, 400, 100, 800],
            requireInteraction: true,
            data: { orderId: params.data.id, event: 'account:suspended', url: '/mi-deuda' },
          });
        } catch (pushErr) {
          request.log.error(
            pushErr as any,
            '[Push] Error al notificar suspension por pedido no recibido'
          );
        }

        return reply.send({ success: true, data: updatedOrder });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    driverPanel.patch('/driver-panel/pedidos/:id/llegue-restaurante', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await getDriverScopedOrder(prisma, user.sub, params.data.id);

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido.',
            },
          });
        }

        // Persist the "arrived_restaurant" state via tracking
        await prisma.orderTracking.create({
          data: {
            orderId: order.id,
            status: order.status,
            notes: 'DRIVER_ARRIVED_RESTAURANT',
          },
        });

        // Update driverArrivedAt to enable pickup-alert job to exclude arrived drivers
        await prisma.order.update({
          where: { id: order.id },
          data: { driverArrivedAt: new Date() },
        });

        // Notify restaurant via socket
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:driver-arrived-restaurant',
          {
            orderId: params.data.id,
            orderReference: order.orderReference,
            status: order.status,
            driverName: order.driver?.user?.name || 'El repartidor',
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        // Notify restaurant via push notification
        try {
          const pushResult = await sendPushNotification(order.restaurant.userId, {
            title: '🛵 Repartidor en el Establecimiento',
            body: `${order.driver?.user?.name || 'El repartidor'} ha llegado a tu local por el pedido #${order.dailyCounter || order.orderReference.slice(-6)}.`,
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            tag: `driver-arrived-${order.id}`,
            vibrate: [300, 100, 300, 100, 300],
            requireInteraction: true,
            data: {
              orderId: order.id,
              event: 'order:driver-arrived-restaurant',
              url: `/?orderId=${order.id}`,
            },
          });
          if (!pushResult.success) {
            console.warn(
              `[Push] Llegue-restaurante push no enviado a ${order.restaurant.userId}: ${pushResult.reason}`
            );
          }
        } catch (pushErr) {
          console.error(
            `[Push] Error al enviar llegue-restaurante a ${order.restaurant.userId}:`,
            pushErr
          );
        }

        return reply.send({
          success: true,
          data: order,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ─── DRIVER RELEASE ORDER (liberar) ─────────────────────────────
    // Permite al repartidor liberarse de un pedido si lleva 8+ min esperando en el restaurante.
    // El repartidor queda bloqueado permanentemente de este pedido (excludedDriverIds).
    driverPanel.patch('/driver-panel/pedidos/:id/liberar', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await getDriverScopedOrder(prisma, user.sub, params.data.id);

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido asignado a este repartidor.',
            },
          });
        }

        if (!order.driver) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'NO_DRIVER_ASSIGNED',
              message: 'No hay repartidor asignado a este pedido.',
            },
          });
        }

        if (!order.driverArrivedAt) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'DRIVER_NOT_ARRIVED',
              message: 'Debes llegar al restaurante antes de liberar el pedido.',
            },
          });
        }

        const waitMs = Date.now() - new Date(order.driverArrivedAt).getTime();
        const WAIT_REQUIRED_MS = 8 * 60 * 1000;
        if (waitMs < WAIT_REQUIRED_MS) {
          const faltaMs = WAIT_REQUIRED_MS - waitMs;
          return reply.status(409).send({
            success: false,
            error: {
              code: 'WAIT_TIME_NOT_MET',
              message: `Debes esperar al menos ${Math.ceil(faltaMs / 60000)} minutos más antes de liberar el pedido.`,
            },
          });
        }

        const validStatuses: OrderStatus[] = [
          OrderStatus.CONFIRMED,
          OrderStatus.PREPARING,
          OrderStatus.READY,
        ];
        if (!validStatuses.includes(order.status)) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'INVALID_ORDER_STATUS',
              message: 'El pedido ya fue recogido o entregado y no puede liberarse.',
            },
          });
        }

        const driver = order.driver;
        if (!driver) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'NO_DRIVER_ASSIGNED',
              message: 'No hay repartidor asignado a este pedido.',
            },
          });
        }

        // Verificar que este repartidor no haya liberado ya este pedido (2+ veces)
        const releaseCount = await getDriverRejectionCount(order.id, driver.id);
        if (releaseCount >= 2) {
          return reply.status(409).send({
            success: false,
            error: { code: 'ALREADY_RELEASED', message: 'Ya liberaste este pedido anteriormente.' },
          });
        }

        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              driverId: null,
              driverAssignedAt: null,
              isAcceptedByDriver: false,
              noDriversAvailable: false,
            },
          });

          // Bloquear este repartidor de este pedido (2 rejections = excluded)
          await incrementDriverRejection(order.id, driver.id);
          await incrementDriverRejection(order.id, driver.id);

          const activeOrdersCount = await tx.order.count({
            where: {
              driverId: driver.id,
              status: {
                in: [
                  OrderStatus.CONFIRMED,
                  OrderStatus.PREPARING,
                  OrderStatus.READY,
                  OrderStatus.PICKED_UP,
                  OrderStatus.IN_TRANSIT,
                ],
              },
            },
          });

          if (activeOrdersCount === 0) {
            await tx.driver.update({
              where: { id: driver.id },
              data: { availability: DriverAvailability.AVAILABLE },
            });
          }

          await tx.orderTracking.create({
            data: {
              orderId: order.id,
              status: order.status,
              notes: `Repartidor libero el pedido por espera prolongada (${Math.round(waitMs / 60000)} min).`,
            },
          });
        });

        // Notificar al restaurante
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:driver-released',
          {
            orderId: params.data.id,
            orderReference: order.orderReference,
            status: order.status,
            driverName: driver.user?.name || 'El repartidor',
          },
          { requestId: requestContext.requestId, orderId: params.data.id }
        );

        // Notificar al cliente
        emitNotification(
          fastify.io,
          order.customer.user.id,
          'CUSTOMER',
          'order:driver-unassigned',
          {
            orderId: params.data.id,
            message: 'El repartidor fue liberado del pedido y se asignará uno nuevo.',
          },
          { requestId: requestContext.requestId, orderId: params.data.id }
        );

        // Auto-asignar un nuevo repartidor (excluyendo al que liberó)
        setTimeout(async () => {
          try {
            const assignResult = await autoAssignDriver(
              prisma,
              params.data.id,
              order.restaurant.userId,
              driver.id
            );
            if (assignResult.success && assignResult.driver && assignResult.order) {
              const newOrder = assignResult.order;

              emitNotification(
                fastify.io,
                assignResult.driver.userId,
                'DRIVER',
                'order:assigned',
                {
                  orderId: newOrder.id,
                  orderReference: newOrder.orderReference,
                  restaurantName: newOrder.restaurant.name,
                  customerName: newOrder.customer.user.name,
                },
                { requestId: requestContext.requestId, orderId: newOrder.id }
              );

              emitNotification(
                fastify.io,
                order.restaurant.userId,
                'RESTAURANT',
                'order:driver-assigned',
                {
                  orderId: newOrder.id,
                  driverName: assignResult.driver.user.name,
                },
                { requestId: requestContext.requestId, orderId: newOrder.id }
              );

              emitNotification(
                fastify.io,
                newOrder.customer.user.id,
                'CUSTOMER',
                'order:driver-assigned',
                {
                  orderId: newOrder.id,
                  driverName: assignResult.driver.user.name,
                },
                { requestId: requestContext.requestId, orderId: newOrder.id }
              );
            } else {
              await prisma.order.update({
                where: { id: params.data.id },
                data: { noDriversAvailable: true },
              });

              emitNotification(
                fastify.io,
                order.restaurant.userId,
                'RESTAURANT',
                'order:no-drivers-available',
                {
                  orderId: params.data.id,
                  message:
                    'No hay repartidores disponibles. Puedes solicitar apoyo a otros establecimientos o asumir el reparto.',
                },
                { requestId: requestContext.requestId, orderId: params.data.id }
              );
            }
          } catch (assignErr) {
            console.error('Failed to auto-reassign driver on release:', assignErr);
          }
        }, 300);

        return reply.send({
          success: true,
          data: order,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ─── BATCH PICKUP ───────────────────────────────────────────────
    driverPanel.patch('/driver-panel/pedidos/batch/:batchId/recogido', async (request, reply) => {
      const params = z.object({ batchId: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'batchId requerido.' },
        });
      }

      const user = getAuthenticatedUser(request);
      const { pickupBatchOrders, buildBatchProgress } = await import('../services/batch.service');

      try {
        const orders = await pickupBatchOrders(prisma as any, params.data.batchId, user.sub);
        if (orders.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'No se encontraron ordenes en este lote para el repartidor.',
            },
          });
        }

        const progress = buildBatchProgress(orders);

        const { getBatchRestaurantUserId } = await import('../services/batch.service');
        const restaurantUserId = await getBatchRestaurantUserId(prisma as any, params.data.batchId);
        if (restaurantUserId) {
          emitNotification(
            fastify.io,
            restaurantUserId,
            'RESTAURANT',
            'order:batch-picked-up',
            {
              batchId: params.data.batchId,
              orderCount: orders.length,
              orderIds: orders.map((o) => o.id),
              orderReferences: orders.map((o) => o.orderReference),
            },
            {
              requestId: getOrCreateRequestContext(request).requestId,
              orderId: orders[0]?.id || '',
            }
          );
        }

        return reply.send({ success: true, data: { orders, progress } });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ─── BATCH INFO ────────────────────────────────────────────────
    driverPanel.get('/driver-panel/pedidos/batch/:batchId', async (request, reply) => {
      const params = z.object({ batchId: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'batchId requerido.' },
        });
      }

      const user = getAuthenticatedUser(request);
      const { getBatchById, buildBatchProgress } = await import('../services/batch.service');

      try {
        const batchOrders = await getBatchById(prisma as any, params.data.batchId, user.sub);
        if (batchOrders.length === 0) {
          return reply.send({ success: true, data: { batch: null } });
        }
        const progress = buildBatchProgress(batchOrders);
        return reply.send({ success: true, data: { batch: batchOrders, progress } });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    const locationUpdateSchema = z.object({
      coords: z
        .array(z.number())
        .length(2, 'Las coordenadas deben contener exactamente [latitud, longitud]'),
    });

    driverPanel.post('/driver-panel/ubicacion', async (request, reply) => {
      const parsed = locationUpdateSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos inválidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const driver = await prisma.driver.findUnique({
        where: { userId: user.sub },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontró el perfil del repartidor.',
          },
        });
      }

      const [latitude, longitude] = parsed.data.coords;

      await prisma.driver.update({
        where: { id: driver.id },
        data: {
          currentLatitude: latitude,
          currentLongitude: longitude,
        },
      });

      // Emitir ubicación en tiempo real a clientes que tengan pedidos activos en tránsito o recogidos con este repartidor
      const activeOrders = await prisma.order.findMany({
        where: {
          driverId: driver.id,
          status: { in: ['PICKED_UP', 'IN_TRANSIT'] },
        },
        select: {
          id: true,
          customer: {
            select: {
              user: {
                select: { id: true },
              },
            },
          },
        },
      });

      if (activeOrders.length > 0) {
        await prisma.order.updateMany({
          where: { id: { in: activeOrders.map((order) => order.id) } },
          data: {
            lastDriverLatitude: latitude,
            lastDriverLongitude: longitude,
            lastDriverLocationAt: new Date(),
          },
        });
      }

      const requestContext = getOrCreateRequestContext(request);

      for (const order of activeOrders) {
        emitNotification(
          fastify.io,
          order.customer.user.id,
          'CUSTOMER',
          'order:driver-location',
          {
            orderId: order.id,
            latitude,
            longitude,
          },
          {
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );
      }

      return reply.send({
        success: true,
      });
    });

    driverPanel.get('/driver-panel/historial', async (request, reply) => {
      const { query } = request as { query: { page?: string; limit?: string } };
      const page = parseInt(query.page || '1', 10);
      const limit = parseInt(query.limit || '20', 10);
      const skip = (page - 1) * limit;

      const user = getAuthenticatedUser(request);
      const driver = await prisma.driver.findUnique({
        where: { userId: user.sub },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el perfil del repartidor.',
          },
        });
      }

      const items = await prisma.order.findMany({
        where: {
          driverId: driver.id,
          status: 'DELIVERED',
        },
        select: driverHistoryOrderListSelect,
        orderBy: { deliveredAt: 'desc' },
        skip,
        take: limit + 1,
      });

      const hasMore = items.length > limit;
      const paginatedItems = hasMore ? items.slice(0, limit) : items;

      return reply.send({
        success: true,
        data: {
          items: paginatedItems,
          hasMore,
        },
      });
    });
  });
}
