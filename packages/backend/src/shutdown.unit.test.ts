import { buildApp } from './app';

it('cierra el transporte WebSocket antes de la limpieza final de Socket.IO', async () => {
  const app = await buildApp({ enableSocketIO: true, enableJobs: false, enableRateLimit: false });
  const engineClose = jest.spyOn(app.io.engine, 'close');
  const socketClose = jest.spyOn(app.io, 'close');

  try {
    await app.close();

    expect(engineClose).toHaveBeenCalled();
    expect(socketClose).toHaveBeenCalledTimes(1);
    expect(engineClose.mock.invocationCallOrder[0]).toBeLessThan(socketClose.mock.invocationCallOrder[0]);
  } finally {
    jest.restoreAllMocks();
  }
});
