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
      paths: { '@sadel/shared': ['packages/shared/src/index.ts'] },
    } }],
  },
  // No global setup, migrations, seeds or integration suites.
  maxWorkers: 1,
};
