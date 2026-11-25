const path = require('node:path');
const root = path.resolve(__dirname, '../..');
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/src/hermetic-setup.ts'],
  testMatch: ['<rootDir>/src/**/*.unit.test.ts'],
  moduleNameMapper: { '^@sadel/shared$': '<rootDir>/../shared/src/index.ts' },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: {
      rootDir: root, baseUrl: root, allowJs: true,
      // `packages/shared/src/package.json` declara el árbol como ESM para
      // Turbopack, pero Jest corre en CommonJS. Forzar el módulo aquí evita
      // que ts-jest emita `export` sin transformar (y coincide con dist/).
      module: 'CommonJS', moduleResolution: 'node', esModuleInterop: true,
      paths: { '@sadel/shared': ['packages/shared/src/index.ts'] },
    } }],
  },
  // No global setup, migrations, seeds or integration suites.
  maxWorkers: 1,
};
