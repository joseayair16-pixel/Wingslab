import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { OrderStatus, BusinessType } from '@prisma/client';
import { prisma } from '../config/database';
import { sendPushNotification } from '../services/notification.service';
import { emitNotification } from '../services/socket.service';
import { logger } from '../utils/logger';

const RESTAURANT_LEVELS_MINUTES = [5, 10, 20, 35];
const STORE_LEVELS_MINUTES = [5];
const RESTAURANT_REMINDER_INTERVAL_MIN = 15;
const STORE_REMINDER_INTERVAL_MIN = 30;
const POLL_INTERVAL_SEC = 30;
const PUSH_ICON_URL = process.env.PUSH_ICON_URL || '/icon.png';
const REZAGADO_SOUND = '/sounds/rezagado.wav';

const LEVEL_STYLE = [
  {
    title: '⚠️ Pedido rezagado',
    vibrate: [300, 150, 300],
  },
  {
    title: '🔴 Pedido rezagado',
    vibrate: [600, 200, 600, 200, 600],
  },
  {
    title: '🚨 Pedido muy rezagado',
    vibrate: [800, 250, 800, 250, 800],
  },
  {
    title: '🚨🚨 Pedido crítico — Acción requerida',
    vibrate: [1000, 300, 1000, 300, 1000],
  },
];

function overdueMinutes(order: any, now: Date): number {
  const ref = order.scheduledDeliveryAt
    ? new Date(order.scheduledDeliveryAt)
    : new Date(order.preparationDeadlineAt);
  return Math.max(1, Math.floor((now.getTime() - ref.getTime()) / 60000));
}

function targetLevelFor(minutes: number, levels: number[]): number {
  let level = 0;
  for (let i = 0; i < levels.length; i++) {
    if (minutes >= levels[i]) level = i + 1;
  }
  return level;
}

export function startOverduePreparationJob(fastify: FastifyInstance) {
  cron.schedule(`*/${POLL_INTERVAL_SEC} * * * * *`, async () => {
    try {
      const now = new Date();

      await prisma.order.updateMany({
        where: {
          overdueAlertLevel: { gt: 0 },
          OR: [
            { status: { notIn: [OrderStatus.CONFIRMED, OrderStatus.PREPARING] } },
            {
              AND: [
                { status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING] } },
                {
                  OR: [
                    { scheduledDeliveryAt: { gt: now } },
                    { AND: [{ scheduledDeliveryAt: null }, { preparationDeadlineAt: { gt: now } }] },
                  ],
                },
              ],
            },
          ],
        },
        data: { overdueAlertLevel: 0, overdueAlertedAt: null },
      });

      const orders = await prisma.order.findMany({
        where: {
          status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING] },
          OR: [
            { scheduledDeliveryAt: { lte: now } },
            { scheduledDeliveryAt: null, preparationDeadlineAt: { lte: now } },
          ],
        },
        include: {
          restaurant: { select: { id: true, userId: true, name: true, businessType: true } },
        },
        take: 100,
      });

      if (orders.length === 0) return;

      for (const order of orders) {
        try {
          if (!order.restaurant) continue;

          const isStore = order.restaurant.businessType === BusinessType.STORE;
          const levelsMinutes = isStore ? STORE_LEVELS_MINUTES : RESTAURANT_LEVELS_MINUTES;
          const maxLevel = levelsMinutes.length;
          const reminderIntervalMin = isStore
            ? STORE_REMINDER_INTERVAL_MIN
            : RESTAURANT_REMINDER_INTERVAL_MIN;

          const minutes = overdueMinutes(order, now);
          const targetLevel = targetLevelFor(minutes, levelsMinutes);
          const currentLevel = order.overdueAlertLevel || 0;
          const lastAlerted: Date | null = order.overdueAlertedAt || null;
          const minsSinceLastAlert = lastAlerted
            ? (now.getTime() - lastAlerted.getTime()) / 60000
            : Infinity;

          const shouldEscalate = targetLevel > currentLevel;
          const shouldRemind = currentLevel >= maxLevel && minsSinceLastAlert >= reminderIntervalMin;

          if (!shouldEscalate && !shouldRemind) continue;

          const level = shouldEscalate ? targetLevel : currentLevel;
          const styleIndex = shouldEscalate
            ? Math.min(level, maxLevel) - 1
            : Math.min(level + 1, LEVEL_STYLE.length) - 1;
          const style = LEVEL_STYLE[styleIndex];
          const orderRef = order.dailyCounter ? `#${String(order.dailyCounter).padStart(2, '0')}` : (order.orderReference || '');

          await sendPushNotification(order.restaurant.userId, {
            title: style.title,
            body: `Pedido ${orderRef} lleva ${minutes} min de retraso. Agrega tiempo de preparación o reprograma la entrega.`,
            icon: PUSH_ICON_URL,
            badge: PUSH_ICON_URL,
            tag: `overdue-${order.id}`,
            vibrate: style.vibrate,
            requireInteraction: true,
            sound: REZAGADO_SOUND,
            data: { orderId: order.id, event: 'order:overdue', url: `/pedidos?orderId=${order.id}` },
          });

          emitNotification(fastify.io, order.restaurant.userId, 'RESTAURANT', 'order:overdue', {
            orderId: order.id,
            orderReference: orderRef,
            minutesOverdue: minutes,
            level,
            maxLevel,
            businessType: order.restaurant.businessType,
          });

          await prisma.order.update({
            where: { id: order.id },
            data: { overdueAlertLevel: level, overdueAlertedAt: now } as any,
          });

          logger.info(`[OverduePreparation] Pedido ${order.id} (${orderRef}) ${isStore ? 'TIENDA' : 'RESTAURANT'} nivel ${level} - ${minutes} min de retraso`);
        } catch (orderErr) {
          logger.error(`[OverduePreparation] Error procesando pedido ${order.id}:`, orderErr);
        }
      }
    } catch (error) {
      logger.error('[OverduePreparation] Error crítico:', error);
    }
  });

  logger.info(`[OverduePreparation] Job iniciado (c/${POLL_INTERVAL_SEC}s). Restaurantes: ${RESTAURANT_LEVELS_MINUTES.join('/')} min; Tiendas: 5 min + recordatorio c/${STORE_REMINDER_INTERVAL_MIN} min`);
}
