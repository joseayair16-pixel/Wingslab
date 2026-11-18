/**
 * Socket.io Service - Real-time notifications
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';
import { businessPrincipalAllowed } from '../config/single-restaurant';

type NotificationMeta = {
  requestId?: string;
  orderId?: string;
};

export type SocketTokenPayload = { sub: string; role: string };
export type SocketTokenVerifier = (token?: unknown) => SocketTokenPayload | null;

type AuthenticatedSocket = Socket & {
  data: { userId?: string; role?: string };
};

function getRoom(socket: AuthenticatedSocket): string | null {
  if (!socket.data.userId || !socket.data.role) {
    return null;
  }
  return `${socket.data.role}:${socket.data.userId}`;
}

export const setupSocketIO = (io: SocketIOServer, verifyToken?: SocketTokenVerifier) => {
  // Autenticacion obligatoria en el handshake: sin JWT valido no hay conexion.
  io.use(async (socket: AuthenticatedSocket, next) => {
    if (!verifyToken) {
      // Entornos de prueba sin JWT configurado.
      return next();
    }
    const auth = verifyToken(socket.handshake.auth?.token);
    if (!auth) {
      logger.warn(`Socket connection rejected (missing/invalid token): ${socket.id}`);
      return next(new Error('UNAUTHORIZED'));
    }
    try {
      if (!await businessPrincipalAllowed(prisma, auth)) return next(new Error('UNAUTHORIZED'));
    } catch { return next(new Error('UNAUTHORIZED')); }
    socket.data.userId = auth.sub;
    socket.data.role = auth.role;
    next();
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`User connected: ${socket.id}`);

    // La sala siempre se deriva del token verificado; lo que envie el cliente se ignora.
    socket.on('join-room', () => {
      try {
        const room = getRoom(socket);
        if (!room) {
          logger.warn(`join-room without authenticated identity from ${socket.id}`);
          return;
        }
        socket.join(room);
        logger.info(`${socket.id} joined room ${room}`);
      } catch (error) {
        logger.error('Error in join-room handler', { socketId: socket.id, error });
      }
    });

    // Leave room
    socket.on('leave-room', () => {
      try {
        const room = getRoom(socket);
        if (!room) return;
        socket.leave(room);
        logger.info(`${socket.id} left room ${room}`);
      } catch (error) {
        logger.error('Error in leave-room handler', { socketId: socket.id, error });
      }
    });

    // Driver location update — solo el propio driver puede emitir su posicion.
    socket.on('driver:location', (data: unknown) => {
      try {
        if (socket.data.role !== 'DRIVER' || !socket.data.userId) {
          logger.warn(`driver:location rejected (not an authenticated driver): ${socket.id}`);
          return;
        }
        const location = data as { latitude?: number; longitude?: number } | null;
        if (
          location &&
          typeof location.latitude === 'number' &&
          Number.isFinite(location.latitude) &&
          typeof location.longitude === 'number' &&
          Number.isFinite(location.longitude)
        ) {
          // Location is published only through the authenticated order action,
          // which checks assignment and targets the customer/restaurant rooms.
          // Never broadcast a driver's coordinates to every connected session.
          return;
        }
      } catch (error) {
        logger.error('Error in driver:location handler', { socketId: socket.id, error });
      }
    });

    // Handle disconnection
    socket.on('disconnect', (reason: string) => {
      logger.info(`User disconnected: ${socket.id} (${reason})`);
    });

    // Error handling at socket level
    socket.on('error', (error: Error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });
  });

  // Global error handling for the io server
  io.engine.on('connection_error', (error: Error) => {
    logger.error('Socket.io engine connection error:', error);
  });

  logger.info('Socket.io setup complete');
};

/**
 * Emit notification to specific user
 */
export const emitNotification = (
  io: SocketIOServer,
  userId: string,
  role: string,
  event: string,
  data: unknown,
  meta?: NotificationMeta
) => {
  try {
    const room = `${role}:${userId}`;
    const payload =
      typeof data === 'object' && data !== null
        ? {
            ...(data as Record<string, unknown>),
            meta: {
              requestId: meta?.requestId,
              orderId: meta?.orderId,
              event,
              emittedAt: new Date().toISOString(),
            },
          }
        : {
            data,
            meta: {
              requestId: meta?.requestId,
              orderId: meta?.orderId,
              event,
              emittedAt: new Date().toISOString(),
            },
          };

    io.to(room).emit(event, payload);
    logger.info('Notification emitted', {
      room,
      event,
      requestId: meta?.requestId,
      orderId: meta?.orderId,
    });
  } catch (error) {
    logger.error('Error emitting notification', {
      userId,
      role,
      event,
      error,
    });
  }
};
