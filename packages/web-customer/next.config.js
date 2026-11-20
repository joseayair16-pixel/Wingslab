/** @type {import('next').NextConfig} */
const path = require('path');
const { frontendConfig } = require('../../config/wingslab.cjs');
const nextConfig = {
  ...frontendConfig('customer'),
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  devIndicators: false,
  reactStrictMode: true,
  webpack: (config) => {
    // Resolver @sadel/shared directo al fuente TS: evita que el pipeline de
    // dev aplique react-refresh sobre dist CJS (import.meta fuera de módulo).
    config.resolve.alias['@sadel/shared'] = path.resolve(
      __dirname,
      '../../packages/shared/src/index.ts'
    );
    return config;
  },
  images: { remotePatterns: [] },
};

module.exports = nextConfig;
