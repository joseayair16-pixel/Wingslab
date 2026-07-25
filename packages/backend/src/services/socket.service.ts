/**
 * Socket.io Service - Real-time notifications
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';

type NotificationMeta = {
  requestId?: string;
  orderId?: string;
};

// Validar que el userId y role no contengan caracteres peligrosos
function isValidRoomParam(value: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

export const setupSocketIO = (io: SocketIOServer) => {
  io.on('connection', (socket: Socket) => {
    logger.info(`User connected: ${socket.id}`);

    // Join room for user (e.g., restaurant, driver, customer)
    socket.on('join-room', (userId: string, role: string) => {
      try {
        if (!userId || !role) {
          logger.warn(`Invalid join-room params from ${socket.id}`);
          return;
        }
        if (!isValidRoomParam(userId) || !isValidRoomParam(role)) {
          logger.warn(`Invalid characters in join-room params from ${socket.id}`);
          return;
        }
        const room = `${role}:${userId}`;
        socket.join(room);
        logger.info(`${socket.id} joined room ${room}`);
      } catch (error) {
        logger.error('Error in join-room handler', { socketId: socket.id, error });
      }
    });

    // Leave room
    socket.on('leave-room', (userId: string, role: string) => {
      try {
        if (!userId || !role) return;
        const room = `${role}:${userId}`;
        socket.leave(room);
        logger.info(`${socket.id} left room ${room}`);
      } catch (error) {
        logger.error('Error in leave-room handler', { socketId: socket.id, error });
      }
    });

    // Driver location update
    socket.on('driver:location', (data: unknown) => {
      try {
        const location = data as { userId?: string; latitude?: number; longitude?: number } | null;
        if (location?.userId && typeof location.latitude === 'number' && typeof location.longitude === 'number') {
          socket.broadcast.emit(`driver:location:${location.userId}`, {
            latitude: location.latitude,
            longitude: location.longitude,
          });
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
