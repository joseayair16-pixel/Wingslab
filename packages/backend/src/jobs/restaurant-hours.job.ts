import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { RestaurantStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { logger } from '../utils/logger';
import { enqueueRestaurantOrder } from '../services/order-workflow.service';

function timeToMins(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function getMexicoCityTimeInfo(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }
  
  const year = parseInt(map.year, 10);
  const month = parseInt(map.month, 10) - 1;
  const day = parseInt(map.day, 10);
  const hour = parseInt(map.hour, 10) % 24; 
  const minute = parseInt(map.minute, 10);
  
  const mxDate = new Date(year, month, day, hour, minute);
  const currentDay = mxDate.getDay();
  const currentTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const nowMins = hour * 60 + minute;
  
  return { currentDay, currentTime, nowMins };
}

function getMexicoDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Cierre deliberado (manual o pausa por pedido sin responder) ocurrido HOY en
// hora México: la apertura automática lo respeta y no reabre ese día.
function isDeliberateClosureToday(statusChangedBy: string | null, statusChangedAt: Date | null): boolean {
  if (!statusChangedAt) return false;
  if (statusChangedBy !== 'OWNER' && statusChangedBy !== 'SYSTEM_ORDER_TIMEOUT_INACTIVITY') return false;
  return getMexicoDateKey(statusChangedAt) === getMexicoDateKey(new Date());
}

// Ventana REAL de horario (sin incluir las ventanas de gracia de auto-cierre):
// turno de hoy o turno nocturno heredado del día anterior. Devuelve los minutos
// de apertura/cierre cuando ahora mismo está dentro del horario.
function findRealOpenWindow(
  operatingHours: { dayOfWeek: number; isClosed: boolean; openTime: string; closeTime: string }[],
  currentDay: number,
  yesterdayDay: number,
  nowMins: number
): { openMins: number; closeMins: number } | null {
  for (const schedule of operatingHours) {
    if (schedule.isClosed) continue;
    if (schedule.dayOfWeek !== currentDay) continue;
    const openMins = timeToMins(schedule.openTime);
    let closeMins = timeToMins(schedule.closeTime);
    if (closeMins < openMins) closeMins += 1440;
    if (nowMins >= openMins && nowMins <= closeMins) return { openMins, closeMins };
  }

  for (const schedule of operatingHours) {
    if (schedule.isClosed) continue;
    if (schedule.dayOfWeek !== yesterdayDay) continue;
    const openMins = timeToMins(schedule.openTime);
    let closeMins = timeToMins(schedule.closeTime);
    if (closeMins < openMins) closeMins += 1440;
    const nowRel = nowMins + 1440;
    if (nowRel >= openMins && nowRel <= closeMins) return { openMins, closeMins };
  }

  return null;
}

export function startRestaurantHoursJob(fastify: FastifyInstance) {
  cron.schedule('0 * * * * *', async () => {
    try {
      const restaurants = await prisma.restaurant.findMany({
        where: { status: RestaurantStatus.ACTIVE },
        include: { operatingHours: true },
      });

      const { currentDay, nowMins } = getMexicoCityTimeInfo(new Date());
      const yesterdayDay = currentDay === 0 ? 6 : currentDay - 1;
      const redis = getRedis();

      for (const restaurant of restaurants) {
        if (!restaurant.operatingHours || restaurant.operatingHours.length === 0) continue;

        let bestSchedule = null;
        let bestShiftMins = 0;

        // 1. Check Today's actual shift
        for (const schedule of restaurant.operatingHours) {
          if (schedule.isClosed) continue;
          if (schedule.dayOfWeek === currentDay) {
            const openMins = timeToMins(schedule.openTime);
            let closeMins = timeToMins(schedule.closeTime);
            if (closeMins < openMins) closeMins += 1440;
            
            if (nowMins >= openMins && nowMins <= closeMins) {
              bestSchedule = schedule;
              bestShiftMins = nowMins;
              break;
            }
          }
        }

        // 2. Check Yesterday's actual shift
        if (!bestSchedule) {
          for (const schedule of restaurant.operatingHours) {
            if (schedule.isClosed) continue;
            if (schedule.dayOfWeek === yesterdayDay) {
              const openMins = timeToMins(schedule.openTime);
              let closeMins = timeToMins(schedule.closeTime);
              if (closeMins < openMins) closeMins += 1440;
              
              const nowRel = nowMins + 1440;
              if (nowRel >= openMins && nowRel <= closeMins) {
                bestSchedule = schedule;
                bestShiftMins = nowRel;
                break;
              }
            }
          }
        }

        // 3. Check Today's grace period (auto-close monitoring)
        if (!bestSchedule) {
          for (const schedule of restaurant.operatingHours) {
            if (schedule.isClosed) continue;
            if (schedule.dayOfWeek === currentDay) {
              const openMins = timeToMins(schedule.openTime);
              let closeMins = timeToMins(schedule.closeTime);
              if (closeMins < openMins) closeMins += 1440;
              
              if (nowMins >= openMins && nowMins <= closeMins + 720) {
                bestSchedule = schedule;
                bestShiftMins = nowMins;
                break;
              }
            }
          }
        }

        // 4. Check Yesterday's grace period (auto-close monitoring)
        if (!bestSchedule) {
          for (const schedule of restaurant.operatingHours) {
            if (schedule.isClosed) continue;
            if (schedule.dayOfWeek === yesterdayDay) {
              const openMins = timeToMins(schedule.openTime);
              let closeMins = timeToMins(schedule.closeTime);
              if (closeMins < openMins) closeMins += 1440;
              
              const nowRel = nowMins + 1440;
              if (nowRel >= openMins && nowRel <= closeMins + 720) {
                bestSchedule = schedule;
                bestShiftMins = nowRel;
                break;
              }
            }
          }
        }

        if (!bestSchedule) continue;

        const openMins = timeToMins(bestSchedule.openTime);
        let closeMins = timeToMins(bestSchedule.closeTime);
        if (closeMins < openMins) closeMins += 1440;
        
        // 0. Apertura Automática (opcional por tienda)
        if (restaurant.autoOpenEnabled && !restaurant.isAcceptingOrders) {
          const realShift = findRealOpenWindow(restaurant.operatingHours, currentDay, yesterdayDay, nowMins);
          if (realShift && !restaurant.isPaused) {
            // Respetar un cierre deliberado (manual o pausa por inactividad) de HOY:
            // la tienda se reabre sola el siguiente día de apertura.
            const closedToday = isDeliberateClosureToday(restaurant.statusChangedBy, restaurant.statusChangedAt);
            if (!closedToday) {
              const opened = await prisma.restaurant.updateMany({
                where: {
                  id: restaurant.id,
                  status: 'ACTIVE',
                  autoOpenEnabled: true,
                  isPaused: false,
                  isAcceptingOrders: false,
                },
                data: {
                  isAcceptingOrders: true,
                  statusChangedAt: null,
                  statusChangedBy: null,
                  statusReason: null,
                },
              });

              if (opened.count > 0) {
                restaurant.isAcceptingOrders = true;
                logger.info(`[RestaurantHoursJob] Restaurante ${restaurant.id} (${restaurant.name}): Apertura automática.`);
                emitNotification(fastify.io, restaurant.userId, 'RESTAURANT', 'restaurant:auto_opened', {});
                await sendPushNotification(restaurant.userId, {
                  title: 'Tu negocio se abrió automáticamente 🚀',
                  body: 'Recibirás pedidos según tu horario. Si hoy no quieres atender, ciérralo manualmente.',
                  icon: '/app-icon-192.png',
                  badge: '/badge.png',
                }).catch(() => {});
              }
            }
          }
        }

        // Customer-scheduled orders stay out of the review queue and timeout
        // clock until the shop is accepting orders. Redis membership makes
        // this release idempotent across job ticks/restarts.
        if (restaurant.isAcceptingOrders && !restaurant.isPaused) {
          const scheduledOrders = await prisma.order.findMany({
            where: {
              restaurantId: restaurant.id,
              status: 'PENDING',
              scheduledDeliveryAt: { not: null },
            },
            select: {
              id: true,
              orderReference: true,
              createdAt: true,
              scheduledDeliveryAt: true,
              totalAmount: true,
              paymentMethod: true,
              customer: { select: { user: { select: { name: true, lastName: true } } } },
            },
            take: 50,
            orderBy: { createdAt: 'asc' },
          });
          for (const order of scheduledOrders) {
            const queueKey = `restaurant:queue:${restaurant.id}`;
            const alreadyQueued = await redis.zscore(queueKey, order.id);
            if (alreadyQueued !== null) continue;
            const position = await enqueueRestaurantOrder(restaurant.id, order.id, order.createdAt, { throwOnError: true });
            emitNotification(fastify.io, restaurant.userId, 'RESTAURANT', 'order:created', {
              orderId: order.id,
              orderReference: order.orderReference,
              totalAmount: order.totalAmount,
              paymentMethod: order.paymentMethod,
              customerName: [order.customer.user.name, order.customer.user.lastName].filter(Boolean).join(' ').trim() || 'Cliente SaDeL',
              queuePosition: position.position,
              queueLength: position.queueLength,
              isScheduledByCustomer: true,
              scheduledDeliveryAt: order.scheduledDeliveryAt,
            }, { requestId: `scheduled-release-${order.id}`, orderId: order.id });
            void sendPushNotification(restaurant.userId, {
              title: 'Pedido programado para revisar',
              body: `Pedido ${order.orderReference} — el cliente indicó ${order.scheduledDeliveryAt?.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}.`,
              icon: '/app-icon-192.png',
              badge: '/badge.png',
              requireInteraction: true,
              tag: `new-order-${order.id}`,
              data: { orderId: order.id, event: 'order:created', url: `/?orderId=${order.id}` },
            }).catch(error => logger.error('[RestaurantHoursJob] Falló push de pedido programado', { orderId: order.id, error }));
          }
        }

        // 1. Apertura Asistida (solo si la tienda no tiene apertura automática)
        if (!restaurant.isAcceptingOrders && !restaurant.autoOpenEnabled) {
          if (bestShiftMins >= openMins && bestShiftMins <= openMins + 4) {
            const hasPrompted = await redis.get(`prompted_open_${restaurant.id}_${currentDay}`);
            if (!hasPrompted) {
              await redis.set(`prompted_open_${restaurant.id}_${currentDay}`, '1', 'EX', 3600 * 12);
              logger.info(`[RestaurantHoursJob] Restaurante ${restaurant.id} (${restaurant.name}): Hora de apertura.`);
              emitNotification(fastify.io, restaurant.userId, 'RESTAURANT', 'restaurant:open_reminder', {}, {});
              await sendPushNotification(restaurant.userId, {
                title: '¡Es hora de abrir! ⏰',
                body: 'Tu horario de apertura ha llegado. Por favor abre tu restaurante en la app para recibir pedidos.',
                icon: '/app-icon-192.png',
                badge: '/badge.png',
                tag: `open-reminder-${restaurant.id}`,
                requireInteraction: true,
                data: {
                  url: '/',
                  event: 'restaurant:open_reminder',
                },
              }).catch(() => {});
            }
          } else if (bestShiftMins >= openMins + 15 && bestShiftMins <= openMins + 19) {
            const hasPromptedLate = await redis.get(`prompted_lateopen_${restaurant.id}_${currentDay}`);
            if (!hasPromptedLate) {
              await redis.set(`prompted_lateopen_${restaurant.id}_${currentDay}`, '1', 'EX', 3600 * 12);
              logger.info(`[RestaurantHoursJob] Restaurante ${restaurant.id} (${restaurant.name}): Apertura tardía (15 min).`);
              emitNotification(fastify.io, restaurant.userId, 'RESTAURANT', 'restaurant:late_open_reminder', {}, {});
              await sendPushNotification(restaurant.userId, {
                title: '¡Apertura Tardía! ⚠️',
                body: 'Ya pasaron 15 minutos de tu hora de apertura. Tienes clientes esperando.',
                icon: '/app-icon-192.png',
                badge: '/badge.png',
                vibrate: [500, 200, 500],
                tag: `late-open-${restaurant.id}`,
                requireInteraction: true,
                data: {
                  url: '/',
                  event: 'restaurant:late_open_reminder',
                },
              }).catch(() => {});
            }
          }
        }

        // 2. Cierre Inteligente y Auto-Cierre
        if (restaurant.isAcceptingOrders) {
          const promptAtMins = closeMins + 10;
          const automaticCloseAtMins = closeMins + 12;
          const scheduleKey = `${restaurant.id}_${bestSchedule.id}`;

          if (bestShiftMins >= promptAtMins && bestShiftMins < automaticCloseAtMins) {
            const hasPromptedClose = await redis.get(`prompted_close_${scheduleKey}`);
            if (!hasPromptedClose) {
              await redis.set(`prompted_close_${scheduleKey}`, '1', 'EX', 3600 * 36);
              logger.info(`[RestaurantHoursJob] Restaurante ${restaurant.id} (${restaurant.name}): aviso de cierre (10 min de tolerancia).`);
              emitNotification(fastify.io, restaurant.userId, 'RESTAURANT', 'restaurant:close_prompt', {}, {});
              await sendPushNotification(restaurant.userId, {
                title: '¿Cerramos tu restaurante?',
                body: 'Tu horario terminó hace 10 minutos. La tienda se cerrará automáticamente en 2 minutos si no eliges mantenerla abierta.',
                icon: '/app-icon-192.png',
                badge: '/badge.png',
                tag: `close-reminder-${scheduleKey}`,
                requireInteraction: true,
                data: { url: '/', event: 'restaurant:close_prompt' },
              }).catch(() => {});
            }
          }

          if (bestShiftMins >= automaticCloseAtMins) {
            const skipAutoClose = await redis.get(`skip_autoclose_${restaurant.id}`);
            if (!skipAutoClose) {
              const closed = await prisma.restaurant.updateMany({
                where: { id: restaurant.id, status: RestaurantStatus.ACTIVE, isAcceptingOrders: true },
                data: {
                  isAcceptingOrders: false,
                  statusChangedAt: new Date(),
                  statusChangedBy: 'SYSTEM_CLOSING_HOURS',
                  statusReason: 'Cerrado automáticamente fuera del horario de atención.',
                },
              });
              if (closed.count) {
                await redis.del(`prompted_close_${scheduleKey}`);
                logger.info(`[RestaurantHoursJob] Restaurante ${restaurant.id} (${restaurant.name}): auto-cierre tras 12 minutos.`);
              emitNotification(fastify.io, restaurant.userId, 'RESTAURANT', 'restaurant:auto_closed', {}, {});
              await sendPushNotification(restaurant.userId, {
                title: 'Restaurante Cerrado Automáticamente 💤',
                  body: 'La tienda se cerró automáticamente 2 minutos después del aviso de cierre.',
                icon: '/app-icon-192.png',
                badge: '/badge.png',
              }).catch(() => {});
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('[RestaurantHoursJob] Error crítico ejecutando job de horarios de restaurante:', error);
    }
  });

  logger.info('[RestaurantHoursJob] Tarea programada iniciada (cada minuto).');
}
