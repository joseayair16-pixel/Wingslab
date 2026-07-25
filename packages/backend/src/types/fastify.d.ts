import { Server as SocketIOServer } from 'socket.io';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }

  interface FastifyRequest {
    requestContext?: {
      requestId: string;
      startedAt: number;
    };
  }
}
