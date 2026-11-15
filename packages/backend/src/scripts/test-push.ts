import '../config/blocked-operation';
import { sendPushNotification } from '../services/notification.service';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

async function runTest() {
  logger.info('Iniciando prueba de Push Notification...');

  // Buscar la primera suscripción disponible
  const subscription = await prisma.pushSubscription.findFirst({
    include: { user: true },
  });

  if (!subscription) {
    logger.error('No se encontraron suscripciones en la base de datos.');
    logger.info('👉 Para probar esto: Entra a la web, otorga permisos de notificación y luego corre este script.');
    process.exit(1);
  }

  logger.info(`Enviando notificación de prueba a ${subscription.user.name} (User ID: ${subscription.userId})...`);

  const result = await sendPushNotification(subscription.userId, {
    title: '🚀 ¡Prueba de Éxito!',
    body: 'Si estás viendo esto, el sistema de notificaciones Push de SaDeL funciona perfectamente.',
    data: { test: true },
  });

  if (result.success) {
    logger.info('¡Notificación enviada con éxito!');
  } else {
    logger.error('Fallo al enviar la notificación.', result);
  }

  process.exit(0);
}

runTest().catch((error) => {
  logger.error('Error en el script de prueba:', error);
  process.exit(1);
});
