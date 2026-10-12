import cron from 'node-cron';
import { prisma } from '../config/database';
import { createBillingSettlement } from '../services/restaurant-billing.service';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

async function processAllRestaurants(): Promise<void> {
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  console.log(`[BillingJob] Found ${restaurants.length} active restaurants to process.`);

  for (const restaurant of restaurants) {
    try {
      console.log(`[BillingJob] Processing ${restaurant.name} (${restaurant.id})...`);
      const settlement = await createBillingSettlement(restaurant.id);
      if (settlement) {
        console.log(`[BillingJob] Successfully created settlement for ${restaurant.name}.`);
      }
    } catch (error) {
      console.error(`[BillingJob] Failed to create settlement for ${restaurant.name}:`, error);
    }
  }
}

async function catchUpMissedCuts(): Promise<void> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - MS_PER_WEEK);

  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, lastBillingSettledAt: true, createdAt: true },
  });

  if (restaurants.length === 0) return;

  const allSettlements = await prisma.restaurantBillingSettlement.findMany({
    where: { status: { in: ['PENDING', 'OVERDUE'] } },
    select: { restaurantId: true, periodEnd: true },
  });

  const pendingMap = new Map<string, Date>();
  for (const s of allSettlements) {
    const existing = pendingMap.get(s.restaurantId);
    if (!existing || s.periodEnd > existing) pendingMap.set(s.restaurantId, s.periodEnd);
  }

  const toProcess: Array<{ id: string; name: string }> = [];

  for (const r of restaurants) {
    try {
      const lastSettled = r.lastBillingSettledAt || r.createdAt;

      const latestPending = pendingMap.get(r.id);
      if (latestPending && latestPending >= lastSettled) continue;

      const deliveredCount = await prisma.order.count({
        where: {
          restaurantId: r.id,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: { gte: lastSettled },
        },
      });

      if (deliveredCount === 0) {
        if (lastSettled < weekAgo) {
          await prisma.restaurant.update({
            where: { id: r.id },
            data: { lastBillingSettledAt: now },
          });
          console.log(`[BillingJob] Catch-up: Marcado como procesado ${r.name} (${r.id}) — sin pedidos.`);
        }
        continue;
      }

      toProcess.push({ id: r.id, name: r.name });
    } catch (error) {
      console.error(`[BillingJob] Catch-up: Error al verificar ${r.name}:`, error);
    }
  }

  if (toProcess.length === 0) {
    console.log('[BillingJob] Catch-up: Todos los restaurantes están al día.');
    return;
  }

  console.log(`[BillingJob] Catch-up: ${toProcess.length} restaurante(s) requieren corte.`);
  for (const r of toProcess) {
    try {
      console.log(`[BillingJob] Catch-up: Procesando ${r.name} (${r.id})...`);
      await createBillingSettlement(r.id);
      console.log(`[BillingJob] Catch-up: Corte creado para ${r.name}.`);
    } catch (error) {
      console.error(`[BillingJob] Catch-up: Error al crear corte para ${r.name}:`, error);
    }
  }
}

export function startBillingJob() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await catchUpMissedCuts();
    } catch (error) {
      console.error('[BillingJob] Error en verificación cada 15 min:', error);
    }
  });

  cron.schedule('59 23 * * 0', async () => {
    console.log('[BillingJob] Iniciando corte semanal...');
    try {
      await processAllRestaurants();
      console.log('[BillingJob] Corte semanal completado.');
    } catch (error) {
      console.error('[BillingJob] Error crítico en corte semanal:', error);
    }
  });

  catchUpMissedCuts().then(() => {
    console.log('[BillingJob] Verificación inicial completada.');
  });

  console.log('[BillingJob] Programado: domingo 23:59 corte + verificación cada 15 min.');
}
