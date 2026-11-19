import net from 'node:net';
import dns from 'node:dns';

// Drop inherited values by name, without inspecting/logging credentials.
for (const key of Object.keys(process.env)) delete process.env[key];
process.env.PATH = '/usr/local/bin:/usr/bin:/bin';
process.env.HOME = '/tmp';
process.env.TMPDIR = '/tmp';
process.env.JEST_WORKER_ID = '1';
process.env.WINGSLAB_MODE = 'test';
process.env.NODE_ENV = 'test';
// Las pruebas herméticas usan el proveedor simulado explícitamente; producción
// siempre usa Cloudinary (valor por defecto en config/env.ts).
process.env.WINGSLAB_STORAGE_PROVIDER = 'memory';
const blocked = (): never => { throw new Error('[WingsLab] Network access forbidden in hermetic tests.'); };
jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(blocked);
jest.spyOn(net.Server.prototype, 'listen').mockImplementation(blocked);
jest.spyOn(dns, 'lookup').mockImplementation(blocked);
globalThis.fetch = blocked;
// Defense in depth only: OS/network namespace denial is still mandatory for execution.
