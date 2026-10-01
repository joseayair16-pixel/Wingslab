import cron from 'node-cron';
import { reconcileOrderRings } from '../services/order-ring.service';
import { logger } from '../utils/logger';

/**
 * Reconciliación de la alarma continua de pedidos. Se ejecuta cada 3 segundos:
 * arranca la alarma de pedidos nuevos que aún no están sonando y detiene la de
 * los que ya se resolvieron. Es la red de seguridad que garantiza que la alarma
 * del móvil se detenga aunque la aceptación ocurra en otro dispositivo.
 */
export function startOrderRingJob() {
  let isRunning = false;

  cron.schedule('*/3 * * * * *', async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      await reconcileOrderRings();
    } catch (error: any) {
      logger.error('[OrderRingJob] Error en la reconciliación de alarmas:', error?.message || error);
    } finally {
      isRunning = false;
    }
  });

  logger.info('[OrderRingJob] Tarea programada iniciada (cada 3 segundos).');
}
