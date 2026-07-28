import { DriverAvailability, DriverStatus, OrderStatus, UserRole, UserStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';

import { prisma } from '../config/database';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { encrypt, decrypt } from '../utils/crypto';
import { checkDriverSuspension } from '../services/driver-billing.service';
import { emitNotification } from '../services/socket.service';

const listDriversQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  region: z.string().optional(),
  status: z.nativeEnum(DriverStatus).optional(),
  availability: z.nativeEnum(DriverAvailability).optional(),
  debt: z.enum(['none', 'current', 'overdue', 'suspended']).optional(),
});

const createDriverSchema = z.object({
  name: z.string().min(2, 'El nombre es obligatorio.'),
  phone: z.string().min(8, 'El telefono es obligatorio.'),
  email: z.string().email('El correo es invalido.').optional(),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  region: z.string().min(1, 'La region es obligatoria.'),
  documentNumber: z.string().min(4, 'El documento es obligatorio.'),
  documentType: z.string().min(2, 'El tipo de documento es obligatorio.'),
  profilePhoto: z.string().url('La foto debe ser una URL valida.').nullable().optional(),
  licensePhoto: z.string().url('La licencia debe ser una URL valida.').nullable().optional(),
  licenseExpiry: z.string().datetime().optional(),
  bankAccount: z.string().optional(),
  platformFeePerOrder: z.number().min(0, 'La tarifa debe ser positiva.').default(0),
  status: z.nativeEnum(DriverStatus).default(DriverStatus.ACTIVE),
  availability: z.nativeEnum(DriverAvailability).default(DriverAvailability.OFFLINE),
});

const updateDriverSchema = createDriverSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'Debes enviar al menos un campo para actualizar.' }
);

const updateDriverStatusSchema = z
  .object({
    status: z.nativeEnum(DriverStatus),
    reason: z.string().trim().max(300, 'El motivo es demasiado largo.').optional(),
  })
  .superRefine((data, context) => {
    if (data.status !== DriverStatus.ACTIVE && !data.reason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Debes capturar un motivo para este cambio de estado.',
      });
    }
  });

const deactivateDriverSchema = z.object({
  reason: z.string().trim().min(3, 'Debes capturar un motivo para desactivar al repartidor.').max(300),
});

function mapDriverStatusToUserStatus(status: DriverStatus): UserStatus {
  if (status === DriverStatus.SUSPENDED) {
    return UserStatus.SUSPENDED;
  }

  if (status === DriverStatus.INACTIVE) {
    return UserStatus.INACTIVE;
  }

  return UserStatus.ACTIVE;
}

function getLicenseState(licenseExpiry?: Date | null) {
  if (!licenseExpiry) {
    return 'missing';
  }

  const now = new Date();
  const daysUntilExpiry = (licenseExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  if (daysUntilExpiry < 0) {
    return 'expired';
  }

  if (daysUntilExpiry <= 30) {
    return 'expiring';
  }

  return 'valid';
}

export async function registerAdminDriverRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function adminDriversScope(adminDrivers) {
    adminDrivers.addHook('preHandler', authenticate);
    adminDrivers.addHook('preHandler', authorize([UserRole.ADMIN]));

    adminDrivers.get('/admin/repartidores', async (request, reply) => {
      const parsed = listDriversQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: parsed.error.issues[0]?.message || 'Query invalida.',
          },
        });
      }

      const { page, limit, search, region, status, availability, debt } = parsed.data;
      const where = {
        ...(search
          ? {
              OR: [
                { user: { name: { contains: search, mode: 'insensitive' as const } } },
                { user: { phone: { contains: search } } },
                { documentNumber: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(region ? { region } : {}),
        ...(status ? { status } : {}),
        ...(availability ? { availability } : {}),
      };

      const [items, total] = await prisma.$transaction([
        prisma.driver.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                region: true,
                status: true,
              },
            },
            _count: {
              select: {
                orders: true,
                settlements: {
                  where: { status: 'IN_REVIEW' }
                }
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.driver.count({ where }),
      ]);

      const itemsWithDebt = await Promise.all(
        items.map(async (item) => {
          const debtAnchor = item.lastBillingSettledAt || item.createdAt;

          const [activeDebtAgg, overdueCount, pendingCount] = await Promise.all([
            prisma.order.aggregate({
              where: {
                driverId: item.id,
                status: OrderStatus.DELIVERED,
                deliveredAt: { gt: debtAnchor },
              },
              _sum: { driverPlatformFee: true },
            }),
            prisma.driverBillingSettlement.count({
              where: { driverId: item.id, status: 'OVERDUE' },
            }),
            prisma.driverBillingSettlement.count({
              where: { driverId: item.id, status: 'PENDING' },
            }),
          ]);

          const activeDebt = activeDebtAgg._sum.driverPlatformFee || 0;
          const suspensionCheck = await checkDriverSuspension(prisma, item.id, item.lastBillingSettledAt, item.createdAt);

          let debtStatus: 'none' | 'current' | 'overdue' | 'suspended';
          if (suspensionCheck.isSuspendedByDebt) {
            debtStatus = 'suspended';
          } else if (overdueCount > 0) {
            debtStatus = 'overdue';
          } else if (activeDebt > 0 || pendingCount > 0) {
            debtStatus = 'current';
          } else {
            debtStatus = 'none';
          }

          return {
            ...item,
            bankAccount: item.bankAccount ? decrypt(item.bankAccount) : item.bankAccount,
            licenseState: getLicenseState(item.licenseExpiry),
            activeDebt,
            debtStatus,
          };
        })
      );

      let filteredItems = itemsWithDebt;
      if (debt) {
        filteredItems = itemsWithDebt.filter((item) => item.debtStatus === debt);
      }

      return reply.send({
        success: true,
        data: {
          items: filteredItems,
          total: debt ? filteredItems.length : total,
          page,
          limit,
          hasMore: debt ? false : page * limit < total,
        },
      });
    });

    adminDrivers.get('/admin/repartidores/overview', async (_request, reply) => {
      const drivers = await prisma.driver.findMany({
        select: {
          id: true,
          status: true,
          availability: true,
          totalDeliveries: true,
          rating: true,
          licenseExpiry: true,
          createdAt: true,
        },
      });

      const driverIds = drivers.map((driver) => driver.id);
      const activeAssignments = driverIds.length
        ? await prisma.order.count({
            where: {
              driverId: {
                in: driverIds,
              },
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
          })
        : 0;

      // Debt stats
      const pastDebtAgg = await prisma.driverBillingSettlement.aggregate({
        where: { status: { in: ['PENDING', 'OVERDUE'] } },
        _sum: { amount: true },
      });
      const totalPastDebt = pastDebtAgg._sum.amount || 0;

      const mostRecentSunday = new Date();
      mostRecentSunday.setDate(mostRecentSunday.getDate() - mostRecentSunday.getDay());
      mostRecentSunday.setHours(23, 59, 59, 999);

      const accruedDebtAgg = await prisma.order.aggregate({
        where: {
          driverId: { in: driverIds },
          status: OrderStatus.DELIVERED,
          deliveredAt: { gt: mostRecentSunday },
        },
        _sum: { driverPlatformFee: true },
      });
      const totalAccruedDebt = accruedDebtAgg._sum.driverPlatformFee || 0;

      return reply.send({
        success: true,
        data: {
          totalDrivers: drivers.length,
          activeDrivers: drivers.filter((driver) => driver.status === DriverStatus.ACTIVE).length,
          availableDrivers: drivers.filter((driver) => driver.availability === DriverAvailability.AVAILABLE).length,
          busyDrivers: drivers.filter((driver) => driver.availability === DriverAvailability.BUSY).length,
          offlineDrivers: drivers.filter((driver) => driver.availability === DriverAvailability.OFFLINE).length,
          suspendedDrivers: drivers.filter((driver) => driver.status === DriverStatus.SUSPENDED).length,
          inactiveDrivers: drivers.filter((driver) => driver.status === DriverStatus.INACTIVE).length,
          driversWithExpiredLicense: drivers.filter((driver) => getLicenseState(driver.licenseExpiry) === 'expired').length,
          driversWithExpiringLicense: drivers.filter((driver) => getLicenseState(driver.licenseExpiry) === 'expiring').length,
          activeAssignments,
          totalDeliveries: drivers.reduce((sum, driver) => sum + driver.totalDeliveries, 0),
          averageRating: drivers.length
            ? Number(
                (
                  drivers.reduce((sum, driver) => sum + driver.rating, 0) /
                  drivers.length
                ).toFixed(1)
              )
            : 0,
          newDriversThisMonth: drivers.filter((driver) => {
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            return driver.createdAt >= monthStart;
          }).length,
          totalPastDebt,
          totalAccruedDebt,
        },
      });
    });

    adminDrivers.get('/admin/repartidores/:id', async (request, reply) => {
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

      const driver = await prisma.driver.findUnique({
        where: { id: params.data.id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              status: true,
              region: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          stats: true,
        },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el repartidor.',
          },
        });
      }

      const [recentOrders, activeOrders, deliveredOrders, activeDebtAgg] = await Promise.all([
        prisma.order.findMany({
          where: {
            driverId: driver.id,
          },
          include: {
            restaurant: {
              select: {
                id: true,
                name: true,
                region: true,
              },
            },
            customer: {
              select: {
                id: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    phone: true,
                  },
                },
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 12,
        }),
        prisma.order.count({
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
        }),
        prisma.order.count({
          where: {
            driverId: driver.id,
            status: OrderStatus.DELIVERED,
          },
        }),
        prisma.order.aggregate({
          where: {
            driverId: driver.id,
            status: OrderStatus.DELIVERED,
            ...(driver.lastBillingSettledAt ? { deliveredAt: { gt: driver.lastBillingSettledAt } } : {}),
          },
          _sum: {
            driverPlatformFee: true,
          },
        }),
      ]);

      if (driver) {
        driver.bankAccount = driver.bankAccount ? decrypt(driver.bankAccount) : driver.bankAccount;
      }

      const suspensionCheck = await checkDriverSuspension(prisma, driver.id, driver.lastBillingSettledAt, driver.createdAt);

      return reply.send({
        success: true,
        data: {
          ...driver,
          licenseState: getLicenseState(driver.licenseExpiry),
          summary: {
            activeOrders,
            deliveredOrders,
            averageRating: driver.rating,
            totalDeliveries: driver.totalDeliveries,
            activeDebt: activeDebtAgg?._sum?.driverPlatformFee || 0,
            isSuspendedByDebt: suspensionCheck.isSuspendedByDebt,
            suspendedDebtAmount: suspensionCheck.suspendedDebtAmount,
            lastKnownLocation:
              driver.currentLatitude !== null && driver.currentLongitude !== null
                ? {
                    latitude: driver.currentLatitude,
                    longitude: driver.currentLongitude,
                  }
                : null,
          },
          recentOrders,
        },
      });
    });

    adminDrivers.put('/admin/repartidores/:id/billing', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const payload = z.object({
        platformFeePerOrder: z.number().min(0).optional(),
        settleDebt: z.boolean().optional(),
      }).safeParse(request.body);

      if (!params.success || !payload.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Parametros o payload invalidos.',
          },
        });
      }

      const driver = await prisma.driver.findUnique({
        where: { id: params.data.id },
      });

      if (!driver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el repartidor.',
          },
        });
      }

      const updateData: any = {};

      if (payload.data.platformFeePerOrder !== undefined) {
        updateData.platformFeePerOrder = payload.data.platformFeePerOrder;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.driver.update({
          where: { id: driver.id },
          data: updateData,
        });
      }

      if (payload.data.settleDebt === true) {
        const debtAnchor = driver.lastBillingSettledAt || driver.createdAt;
        const adminUser = getAuthenticatedUser(request);

        // Most recent Sunday 23:59:59 — only settle the PAST period, not current week
        const mostRecentSunday = new Date();
        mostRecentSunday.setDate(mostRecentSunday.getDate() - mostRecentSunday.getDay());
        mostRecentSunday.setHours(23, 59, 59, 999);

        const debtAgg = await prisma.order.aggregate({
          where: {
            driverId: driver.id,
            status: OrderStatus.DELIVERED,
            deliveredAt: { gt: debtAnchor, lte: mostRecentSunday },
          },
          _sum: { driverPlatformFee: true },
          _count: { id: true },
        });
        const amount = debtAgg._sum.driverPlatformFee || 0;

        const yy = new Date().getFullYear().toString().slice(-2);
        const mm = (new Date().getMonth() + 1).toString().padStart(2, '0');
        const dd = new Date().getDate().toString().padStart(2, '0');
        const driverShortId = driver.id.slice(-6).toUpperCase();
        const ts = Date.now().toString(36).slice(-4).toUpperCase();
        const reference = `CRT-${yy}${mm}${dd}-${driverShortId}-${ts}`;

        await prisma.$transaction(async (tx) => {
          const settlement = await tx.driverBillingSettlement.create({
            data: {
              driverId: driver.id,
              reference,
              periodStart: debtAnchor,
              periodEnd: mostRecentSunday,
              amount,
              deliveredOrders: debtAgg._count.id,
              deliveredRevenue: 0,
              platformFeeTotal: amount,
              status: 'PAID',
              settledAt: new Date(),
            }
          });

          await tx.driver.update({
            where: { id: driver.id },
            data: { lastBillingSettledAt: mostRecentSunday },
          });

          // Reactivate driver as INACTIVE (admin must manually set to ACTIVE)
          await tx.driver.update({
            where: { id: driver.id },
            data: { status: 'INACTIVE', availability: 'OFFLINE' },
          });
          await tx.user.update({
            where: { id: driver.userId },
            data: { status: 'INACTIVE' },
          });

          await tx.auditLog.create({
            data: {
              userId: adminUser.sub,
              action: 'SETTLE_DRIVER_DEBT',
              entity: 'DriverBillingSettlement',
              entityId: settlement.id,
              newValue: JSON.stringify({ amount, driverId: driver.id }),
            },
          });
        });
      }

      return reply.send({
        success: true,
        message: 'Tarifa actualizada correctamente.',
        data: { platformFeePerOrder: updateData.platformFeePerOrder ?? driver.platformFeePerOrder },
      });
    });

    adminDrivers.get('/admin/repartidores/:id/orders', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS' } });

      const query = z.object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20),
      }).safeParse(request.query);

      const { page, limit } = query.success ? query.data : { page: 1, limit: 20 };

      const [items, total] = await prisma.$transaction([
        prisma.order.findMany({
          where: { driverId: params.data.id },
          include: {
            restaurant: { select: { id: true, name: true, region: true } },
            customer: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.order.count({ where: { driverId: params.data.id } }),
      ]);

      return reply.send({
        success: true,
        data: { items, total, page, limit, hasMore: page * limit < total },
      });
    });

    adminDrivers.get('/admin/repartidores/:id/finanzas', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS' } });

      const driver = await prisma.driver.findUnique({ where: { id: params.data.id } });
      if (!driver) return reply.status(404).send({ success: false, error: { code: 'DRIVER_NOT_FOUND' } });

      const debtAnchor = driver.lastBillingSettledAt || driver.createdAt;

      // Today
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      // Week (Monday)
      const now = new Date();
      const currentDay = now.getDay();
      const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
      const startOfWeek = new Date();
      startOfWeek.setDate(now.getDate() - distanceToMonday);
      startOfWeek.setHours(0, 0, 0, 0);

      // Most recent Sunday 23:59:59
      const mostRecentSunday = new Date();
      mostRecentSunday.setDate(mostRecentSunday.getDate() - mostRecentSunday.getDay());
      mostRecentSunday.setHours(23, 59, 59, 999);

      const [todaySum, weekSum, totalDebtSum, currentDebtSum, recentSettlements, recentDeliveries, pendingSettlement] = await Promise.all([
        prisma.order.aggregate({
          where: { driverId: driver.id, status: OrderStatus.DELIVERED, deliveredAt: { gte: startOfToday } },
          _sum: { deliveryFee: true }, _count: { id: true },
        }),
        prisma.order.aggregate({
          where: { driverId: driver.id, status: OrderStatus.DELIVERED, deliveredAt: { gte: startOfWeek } },
          _sum: { deliveryFee: true, driverPlatformFee: true }, _count: { id: true },
        }),
        prisma.order.aggregate({
          where: { driverId: driver.id, status: OrderStatus.DELIVERED, deliveredAt: { gt: debtAnchor } },
          _sum: { driverPlatformFee: true },
        }),
        prisma.order.aggregate({
          where: { driverId: driver.id, status: OrderStatus.DELIVERED, deliveredAt: { gt: mostRecentSunday } },
          _sum: { driverPlatformFee: true },
        }),
        prisma.driverBillingSettlement.findMany({
          where: { driverId: driver.id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        prisma.order.findMany({
          where: { driverId: driver.id, status: OrderStatus.DELIVERED, deliveredAt: { gte: new Date(Date.now() - 7 * 86400000) } },
          select: { id: true, orderReference: true, deliveryFee: true, deliveredAt: true },
          orderBy: { deliveredAt: 'desc' },
          take: 15,
        }),
        prisma.driverBillingSettlement.findFirst({
          where: { driverId: driver.id, status: { in: ['PENDING', 'OVERDUE'] } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, dueDate: true, amount: true, reference: true },
        }),
      ]);

      const activeDebt = totalDebtSum._sum.driverPlatformFee || 0;
      const currentDebt = currentDebtSum._sum.driverPlatformFee || 0;
      const pastDebt = activeDebt - currentDebt;

      const nextSunday = new Date(mostRecentSunday);
      nextSunday.setDate(nextSunday.getDate() + 7);

      const suspensionWednesday = currentDebt > 0 ? new Date(nextSunday) : null;
      if (suspensionWednesday) suspensionWednesday.setDate(suspensionWednesday.getDate() + 3);

      return reply.send({
        success: true,
        data: {
          todayEarnings: todaySum._sum.deliveryFee || 0,
          todayTripsCount: todaySum._count.id || 0,
          weeklyEarnings: weekSum._sum.deliveryFee || 0,
          weeklyTripsCount: weekSum._count.id || 0,
          weeklyDebtAccumulated: weekSum._sum.driverPlatformFee || 0,
          activeDebt,
          pastDebt,
          currentDebt,
          lastBillingSettledAt: driver.lastBillingSettledAt,
          recentDeliveries,
          recentSettlements,
          hasPendingSettlement: !!pendingSettlement,
          pendingSettlement: pendingSettlement ? {
            id: pendingSettlement.id,
            amount: pendingSettlement.amount,
            dueDate: pendingSettlement.dueDate?.toISOString() || null,
            reference: pendingSettlement.reference,
          } : null,
          nextCutoffDate: nextSunday.toISOString(),
          nextSuspensionDate: suspensionWednesday?.toISOString() || null,
        },
      });
    });

    adminDrivers.get('/admin/repartidores/:id/settlements', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS' } });

      const settlements = await prisma.driverBillingSettlement.findMany({
        where: { driverId: params.data.id },
        orderBy: { createdAt: 'desc' },
        take: 50
      });

      return reply.send({
        success: true,
        data: settlements
      });
    });

    adminDrivers.put('/admin/repartidores/:driverId/settlements/:settlementId/status', async (request, reply) => {
      const params = z.object({ driverId: z.string(), settlementId: z.string() }).safeParse(request.params);
      const body = z.object({ status: z.enum(['PAID', 'REJECTED', 'REVERT']) }).safeParse(request.body);
      
      if (!params.success || !body.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD' }});
      }

      const settlement = await prisma.driverBillingSettlement.findUnique({
        where: { id: params.data.settlementId },
        include: { driver: { select: { userId: true } } },
      });

      if (!settlement || settlement.driverId !== params.data.driverId) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND' }});
      }

      const newStatus = body.data.status;
      const adminUser = getAuthenticatedUser(request);

      await prisma.$transaction(async (tx) => {
        // Lock-check: only allow transition if still in valid state
        const current = await tx.driverBillingSettlement.findUnique({
          where: { id: settlement.id },
          select: { status: true },
        });
        if (!current) return;

        if (newStatus === 'PAID' && current.status !== 'IN_REVIEW' && current.status !== 'OVERDUE') {
          throw new Error(`Cannot transition settlement ${settlement.id} from status ${current.status} to PAID`);
        }
        if (newStatus === 'REJECTED' && current.status !== 'IN_REVIEW') {
          throw new Error(`Cannot reject settlement ${settlement.id} with status ${current.status}`);
        }
        if (newStatus === 'REVERT' && current.status !== 'PAID') {
          throw new Error(`Cannot revert settlement ${settlement.id} with status ${current.status}`);
        }

        if (newStatus === 'REVERT') {
          // Revert: return to PENDING, restore lastBillingSettledAt to periodStart
          await tx.driverBillingSettlement.update({
            where: { id: settlement.id },
            data: {
              status: 'PENDING',
              settledAt: null,
            },
          });

          await tx.driver.update({
            where: { id: params.data.driverId },
            data: {
              lastBillingSettledAt: settlement.periodStart,
            },
          });
        } else {
          await tx.driverBillingSettlement.update({
            where: { id: settlement.id },
            data: {
              status: newStatus === 'REJECTED' ? 'PENDING' : newStatus,
              settledAt: newStatus === 'PAID' ? new Date() : undefined,
              paymentProofUrl: newStatus === 'REJECTED' ? null : undefined,
            },
          });

          if (newStatus === 'PAID') {
            await tx.driver.update({
              where: { id: params.data.driverId },
              data: {
                lastBillingSettledAt: settlement.periodEnd,
                status: 'INACTIVE',
                availability: 'OFFLINE',
              },
            });

            const driver = await tx.driver.findUnique({
              where: { id: params.data.driverId },
              select: { userId: true },
            });
            if (driver) {
              await tx.user.update({
                where: { id: driver.userId },
                data: { status: 'INACTIVE' },
              });
            }
          }
        }

        await tx.auditLog.create({
          data: {
            userId: adminUser.sub,
            action: newStatus === 'PAID' ? 'APPROVE_SETTLEMENT' : newStatus === 'REJECTED' ? 'REJECT_SETTLEMENT' : 'REVERT_SETTLEMENT',
            entity: 'DriverBillingSettlement',
            entityId: settlement.id,
            oldValue: JSON.stringify({ status: settlement.status }),
            newValue: JSON.stringify({ status: newStatus === 'REJECTED' ? 'PENDING' : newStatus === 'REVERT' ? 'PENDING' : newStatus }),
          },
        });
      });

      if (newStatus === 'PAID' || newStatus === 'REJECTED') {
        const driverUserId = settlement.driver?.userId;
        if (driverUserId) {
          emitNotification(
            fastify.io,
            driverUserId,
            'DRIVER',
            newStatus === 'PAID' ? 'settlement:approved' : 'settlement:rejected',
            { settlementId: settlement.id }
          );
        }
      }

      return reply.send({ success: true });
    });

    adminDrivers.post('/admin/repartidores', async (request, reply) => {
      const parsed = createDriverSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const normalizedPhone = parsed.data.phone.replace(/\D/g, '').slice(-10);
      const existingUser = await prisma.user.findFirst({
        where: {
          phone: { in: [parsed.data.phone.trim(), normalizedPhone, `+52${normalizedPhone}`, `+521${normalizedPhone}`] },
          role: UserRole.DRIVER,
        },
        select: { id: true },
      });

      if (existingUser) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'USER_ALREADY_EXISTS',
            message: 'Ya existe un usuario con ese telefono.',
          },
        });
      }

      const { name, phone, email, password, region, ...driverData } = parsed.data;

      const hashedPassword = await bcryptjs.hash(password, 10);
      const encryptedBankAccount = driverData.bankAccount ? encrypt(driverData.bankAccount) : driverData.bankAccount;

      const driver = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name,
            phone,
            email: email || `${phone.replace(/\D/g, '')}@sadel.local`,
            password: hashedPassword,
            role: UserRole.DRIVER,
            region,
            status: mapDriverStatusToUserStatus(driverData.status),
          },
        });

        return tx.driver.create({
          data: {
            userId: user.id,
            region,
            documentNumber: driverData.documentNumber,
            documentType: driverData.documentType,
            profilePhoto: driverData.profilePhoto || null,
            licensePhoto: driverData.licensePhoto || null,
            licenseExpiry: driverData.licenseExpiry ? new Date(driverData.licenseExpiry) : null,
            bankAccount: encryptedBankAccount,
            platformFeePerOrder: driverData.platformFeePerOrder,
            status: driverData.status,
            availability: driverData.availability,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                region: true,
                status: true,
              },
            },
          },
        });
      });

      if (driver) {
        driver.bankAccount = driver.bankAccount ? decrypt(driver.bankAccount) : driver.bankAccount;
      }

      return reply.status(201).send({
        success: true,
        data: driver,
      });
    });

    adminDrivers.patch('/admin/repartidores/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = updateDriverSchema.safeParse(request.body);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const currentDriver = await prisma.driver.findUnique({
        where: { id: params.data.id },
        include: { user: true },
      });

      if (!currentDriver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el repartidor.',
          },
        });
      }

      const { name, phone, email, region, ...driverData } = parsed.data;

      const updatedDriver = await prisma.$transaction(async (tx) => {
        if (name || phone || email || region || driverData.status) {
          await tx.user.update({
            where: { id: currentDriver.userId },
            data: {
              ...(name ? { name } : {}),
              ...(phone ? { phone } : {}),
              ...(email ? { email } : {}),
              ...(region ? { region } : {}),
              ...(driverData.status ? { status: mapDriverStatusToUserStatus(driverData.status) } : {}),
            },
          });
        }

        return tx.driver.update({
          where: { id: currentDriver.id },
          data: {
            ...(region ? { region } : {}),
            ...(driverData.documentNumber ? { documentNumber: driverData.documentNumber } : {}),
            ...(driverData.documentType ? { documentType: driverData.documentType } : {}),
            ...(driverData.profilePhoto !== undefined ? { profilePhoto: driverData.profilePhoto } : {}),
            ...(driverData.licensePhoto !== undefined ? { licensePhoto: driverData.licensePhoto } : {}),
            ...(driverData.licenseExpiry !== undefined
              ? { licenseExpiry: driverData.licenseExpiry ? new Date(driverData.licenseExpiry) : null }
              : {}),
            ...(driverData.bankAccount !== undefined ? { bankAccount: driverData.bankAccount ? encrypt(driverData.bankAccount) : null } : {}),
            ...(driverData.status ? { status: driverData.status } : {}),
            ...(driverData.availability ? { availability: driverData.availability } : {}),
            ...(driverData.platformFeePerOrder !== undefined ? { platformFeePerOrder: driverData.platformFeePerOrder } : {}),
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                region: true,
                status: true,
              },
            },
          },
        });
      });

      if (updatedDriver) {
        updatedDriver.bankAccount = updatedDriver.bankAccount ? decrypt(updatedDriver.bankAccount) : updatedDriver.bankAccount;
      }

      return reply.send({
        success: true,
        data: updatedDriver,
      });
    });

    adminDrivers.post('/admin/repartidores/:id/status', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = updateDriverStatusSchema.safeParse(request.body);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const currentDriver = await prisma.driver.findUnique({
        where: { id: params.data.id },
        include: { user: true },
      });

      if (!currentDriver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el repartidor.',
          },
        });
      }

      if (currentDriver.status === parsed.data.status) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'STATUS_UNCHANGED',
            message: 'El repartidor ya cuenta con ese estado.',
          },
        });
      }

      if (parsed.data.status !== DriverStatus.ACTIVE) {
        const activeOrders = await prisma.order.count({
          where: {
            driverId: currentDriver.id,
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

        if (activeOrders > 0) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'DRIVER_WITH_ACTIVE_ORDERS',
              message: 'No puedes suspender o desactivar un repartidor con pedidos activos.',
            },
          });
        }
      }

      const updatedDriver = await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: {
            id: currentDriver.userId,
          },
          data: {
            status: mapDriverStatusToUserStatus(parsed.data.status),
          },
        });

        return tx.driver.update({
          where: {
            id: currentDriver.id,
          },
          data: {
            status: parsed.data.status,
            availability:
              parsed.data.status === DriverStatus.ACTIVE
                ? currentDriver.availability
                : DriverAvailability.OFFLINE,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                region: true,
                status: true,
              },
            },
          },
        });
      });

      return reply.send({
        success: true,
        data: {
          ...updatedDriver,
          reason: parsed.data.reason?.trim() || null,
        },
      });
    });

    adminDrivers.delete('/admin/repartidores/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = deactivateDriverSchema.safeParse(request.body);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const currentDriver = await prisma.driver.findUnique({
        where: { id: params.data.id },
      });

      if (!currentDriver) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'No se encontro el repartidor.',
          },
        });
      }

      const activeOrders = await prisma.order.count({
        where: {
          driverId: currentDriver.id,
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

      if (activeOrders > 0) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'DRIVER_WITH_ACTIVE_ORDERS',
            message: 'No puedes eliminar logicamente un repartidor con pedidos activos.',
          },
        });
      }

      const updatedDriver = await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: {
            id: currentDriver.userId,
          },
          data: {
            status: UserStatus.INACTIVE,
          },
        });

        return tx.driver.update({
          where: {
            id: currentDriver.id,
          },
          data: {
            status: DriverStatus.INACTIVE,
            availability: DriverAvailability.OFFLINE,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                region: true,
                status: true,
              },
            },
          },
        });
      });

      return reply.send({
        success: true,
        data: {
          ...updatedDriver,
          deleted: true,
          reason: parsed.data.reason,
        },
      });
    });
  });
}
