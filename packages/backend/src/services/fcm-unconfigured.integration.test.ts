/**
 * Comportamiento de FCM cuando NO está configurado (evidencia A).
 *
 * Contrato: `sendFcmNotification` nunca lanza y nunca reporta éxito falso.
 * En el entorno de pruebas no hay FIREBASE_* configurado, igual que en un
 * despliegue donde se olvidaran las credenciales: el fallo debe quedar en los
 * logs (etapa "envío" visible) en lugar de perderse en silencio.
 */
import { UserRole } from '@prisma/client';

import { prisma } from '../config/database';
import { isFcmConfigured, sendFcmNotification } from './fcm.service';
import { logger } from '../utils/logger';

const TAG = `fcm${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

afterAll(async () => {
  await prisma.fcmToken.deleteMany({ where: { token: { contains: TAG } } });
  await prisma.customer.deleteMany({ where: { user: { email: { contains: TAG } } } });
  await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  await prisma.$disconnect();
}, 30000);

describe('FCM sin configurar', () => {
  it('reporta no configurado en este entorno', () => {
    expect(isFcmConfigured()).toBe(false);
  });

  it('no lanza ni finge éxito cuando hay tokens registrados', async () => {
    const user = await prisma.user.create({
      data: {
        email: `fcm-${TAG}@test.local`,
        password: 'x',
        phone: `57${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        name: 'FCM Test',
        role: UserRole.CUSTOMER,
        region: 'TEST',
        status: 'ACTIVE',
      },
    });
    await prisma.fcmToken.create({
      data: { userId: user.id, token: `dead-token-${TAG}`, platform: 'android' },
    });

    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

    const result = await sendFcmNotification(user.id, {
      title: 'Prueba',
      body: 'No debe lanzarse.',
    });

    expect(result).toEqual({ success: false, totalSent: 0, totalAttempted: 0 });
    // El fallo queda registrado con el conteo de tokens afectados.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`${user.id}`)
    );
    errorSpy.mockRestore();
  });

  it('sin tokens no hace nada y no loguea error', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    const result = await sendFcmNotification(`usuario-sin-tokens-${TAG}`, {
      title: 'Prueba',
      body: 'Nada que enviar.',
    });
    expect(result).toEqual({ success: false, totalSent: 0, totalAttempted: 0 });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
