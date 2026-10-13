/**
 * Revocación de registros push al cerrar sesión / desactivar notificaciones
 * (evidencia A).
 *
 * Sin estos endpoints, el token FCM y la suscripción web del dispositivo
 * seguían apuntando al usuario anterior después del logout: el siguiente
 * usuario del mismo dispositivo recibiría avisos ajenos (fuga de privacidad
 * en dispositivos compartidos).
 *
 * Contrato verificado:
 *  - DELETE /notifications/fcm-token y /notifications/subscription exigen JWT.
 *  - Solo borran filas del propio usuario (scoped por `sub`).
 *  - Idempotentes: borrar algo inexistente devuelve éxito con `removed: 0`.
 */
import { UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';

describe('revocación de registros push', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false });
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  async function signedToken(sub: string) {
    return app.jwt.sign({ sub, phone: '+5215500000000', role: UserRole.CUSTOMER });
  }

  describe('DELETE /notifications/fcm-token', () => {
    it('exige autenticación', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/notifications/fcm-token',
        payload: { token: 'tok-1' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('rechaza payloads inválidos', async () => {
      const token = await signedToken('user-1');
      const response = await app.inject({
        method: 'DELETE',
        url: '/notifications/fcm-token',
        headers: { authorization: `Bearer ${token}` },
        payload: { token: '' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('borra solo la fila del propio usuario y reporta removed', async () => {
      const token = await signedToken('user-1');
      const deleteMany = jest
        .spyOn(prisma.fcmToken, 'deleteMany')
        .mockResolvedValue({ count: 1 } as never);

      const response = await app.inject({
        method: 'DELETE',
        url: '/notifications/fcm-token',
        headers: { authorization: `Bearer ${token}` },
        payload: { token: 'device-token-abc' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ success: true, removed: 1 });
      expect(deleteMany).toHaveBeenCalledWith({
        where: { token: 'device-token-abc', userId: 'user-1' },
      });
    });

    it('es idempotente cuando el token ya no existe', async () => {
      const token = await signedToken('user-1');
      jest.spyOn(prisma.fcmToken, 'deleteMany').mockResolvedValue({ count: 0 } as never);

      const response = await app.inject({
        method: 'DELETE',
        url: '/notifications/fcm-token',
        headers: { authorization: `Bearer ${token}` },
        payload: { token: 'token-inexistente' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ success: true, removed: 0 });
    });
  });

  describe('DELETE /notifications/subscription', () => {
    it('exige autenticación', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/notifications/subscription',
        payload: { endpoint: 'https://push.example/abc' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('borra solo la suscripción del propio usuario', async () => {
      const token = await signedToken('user-2');
      const deleteMany = jest
        .spyOn(prisma.pushSubscription, 'deleteMany')
        .mockResolvedValue({ count: 1 } as never);

      const response = await app.inject({
        method: 'DELETE',
        url: '/notifications/subscription',
        headers: { authorization: `Bearer ${token}` },
        payload: { endpoint: 'https://push.example/abc' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ success: true, removed: 1 });
      expect(deleteMany).toHaveBeenCalledWith({
        where: { endpoint: 'https://push.example/abc', userId: 'user-2' },
      });
    });
  });

  describe('POST /notifications/unpair', () => {
    it('rechaza payload sin token ni endpoint', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/unpair',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('desvincula token y endpoint con usuario autenticado (scoped)', async () => {
      const token = await signedToken('user-auth');
      const deleteFcm = jest.spyOn(prisma.fcmToken, 'deleteMany').mockResolvedValue({ count: 1 } as never);
      const deleteWeb = jest.spyOn(prisma.pushSubscription, 'deleteMany').mockResolvedValue({ count: 1 } as never);

      const response = await app.inject({
        method: 'POST',
        url: '/notifications/unpair',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          fcmToken: 'fcm-device-123',
          endpoint: 'https://push.example/dev-123',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ success: true, removed: 2, fcm: 1, web: 1 });
      expect(deleteFcm).toHaveBeenCalledWith({
        where: { token: 'fcm-device-123', userId: 'user-auth' },
      });
      expect(deleteWeb).toHaveBeenCalledWith({
        where: { endpoint: 'https://push.example/dev-123', userId: 'user-auth' },
      });
    });

    it('desvincula por posesión de token/endpoint sin sesión activa (offline/diferido)', async () => {
      const deleteFcm = jest.spyOn(prisma.fcmToken, 'deleteMany').mockResolvedValue({ count: 1 } as never);
      const deleteWeb = jest.spyOn(prisma.pushSubscription, 'deleteMany').mockResolvedValue({ count: 0 } as never);

      const response = await app.inject({
        method: 'POST',
        url: '/notifications/unpair',
        payload: {
          fcmToken: 'fcm-device-pending',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ success: true, removed: 1, fcm: 1, web: 0 });
      expect(deleteFcm).toHaveBeenCalledWith({
        where: { token: 'fcm-device-pending' },
      });
    });
  });
});

