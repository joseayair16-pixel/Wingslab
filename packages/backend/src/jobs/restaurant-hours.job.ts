import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { RestaurantStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { logger } from '../utils/logger';

function addMinutes(timeString: string, minutesToAdd: number): string {
  const [hStr, mStr] = timeString.split(':');
  let h = parseInt(hStr, 10);
  let m = parseInt(mStr, 10);
  
  m += minutesToAdd;
  h += Math.floor(m / 60);
  m = m % 60;
  h = h % 24;
  
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

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
        
        // 1. Apertura Asistida
        if (!restaurant.isAcceptingOrders) {
          if (bestShiftMins >= openMins && bestShiftMins <= openMins + 4) {
            const hasPrompted = await redis.get(`prompted_open_${restaurant.id}_${currentDay}`);
            if (!hasPrompted) {
              await redis.set(`prompted_open_${restaurant.id}_${currentDay}`, '1', 'EX', 3600 * 12);
              logger.info(`[RestaurantHoursJob] Restaurante ${restaurant.id} (${restaurant.name}): Hora de apertura.`);
              emitNotification(fastify.io, restaurant.userId, 'RESTAURANT', 'restaurant:open_reminder', {}, {});
              await sendPushNotification(restaurant.userId, {
                title: '¡Es hora de abrir! ⏰',
                body: 'Tu horario de apertura ha llegado. Por favor abre tu restaurante en la app para recibir pedidos.',
                icon: '/SaDeL.png',
                badge: '/SaDeL.png',
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
                icon: '/SaDeL.png',
                badge: '/SaDeL.png',
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
          const autoCloseStartMins = closeMins + 10;
          const autoCloseEndMins = closeMins + 720; // 12 hour grace window
          const hardLimitMins = closeMins + 180; // 3 hours

          if (bestShiftMins >= closeMins && bestShiftMins <= closeMins + 9) {
            const hasPromptedClose = await redis.get(`prompted_close_${restaurant.id}_${currentDay}`);
            if (!hasPromptedClose) {
              await redis.set(`prompted_close_${restaurant.id}_${currentDay}`, '1', 'EX', 3600 * 12);
              logger.info(`[RestaurantHoursJob] Restaurante ${restaurant.id} (${restaurant.name}): Hora de cierre alcanzada.`);
              emitNotification(fastify.io, restaurant.userId, 'RESTAURANT', 'restaurant:close_prompt', {}, {});
            }
          } else if (bestShiftMins >= autoCloseStartMins && bestShiftMins <= autoCloseEndMins) {
            const skipAutoClose = await redis.get(`skip_autoclose_${restaurant.id}`);
            const isPastHardLimit = bestShiftMins >= hardLimitMins;
            
            if (!skipAutoClose || isPastHardLimit) {
              const reason = isPastHardLimit ? 'Límite máximo de 3 horas excedido' : '10+ min tarde sin posponer';
              logger.info(`[RestaurantHoursJob] Restaurante ${restaurant.id} (${restaurant.name}): Auto-cierre forzado (${reason}).`);
              
              await prisma.restaurant.update({
                where: { id: restaurant.id },
                data: {
                  isAcceptingOrders: false,
                  statusChangedAt: new Date(),
                  statusChangedBy: 'SYSTEM_CLOSING_HOURS',
                  statusReason: 'Cerrado automáticamente fuera del horario de atención.',
                },
              });

              emitNotification(fastify.io, restaurant.userId, 'RESTAURANT', 'restaurant:auto_closed', {}, {});
              
              const bodyMsg = isPastHardLimit 
                ? 'Cierre de emergencia: Has superado el límite absoluto de 3 horas de extensión. Tu restaurante ha sido apagado.' 
                : 'Han pasado más de 10 minutos desde tu hora de cierre o tu extensión terminó. Si sigues atendiendo, vuelve a abrirlo.';

              await sendPushNotification(restaurant.userId, {
                title: 'Restaurante Cerrado Automáticamente 💤',
                body: bodyMsg,
                icon: '/SaDeL.png',
                badge: '/SaDeL.png',
              }).catch(() => {});
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
