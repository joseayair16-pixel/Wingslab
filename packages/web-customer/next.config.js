/** @type {import('next').NextConfig} */
const path = require('path');
const { frontendConfig } = require('../../config/wingslab.cjs');
const nextConfig = {
  ...frontendConfig('customer'),
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  devIndicators: false,
  reactStrictMode: true,
  // El alias apunta al fuente TS (no al dist CJS) para que react-refresh no
  // procese módulos CJS. Solo aplica al build de producción, que usa webpack:
  // Turbopack ya resuelve los paquetes del monorepo a su fuente.
  webpack: (config) => {
    config.resolve.alias['@sadel/shared'] = path.resolve(
      __dirname,
      '../../packages/shared/src/index.ts'
    );
    return config;
  },
  // Next 16 exige un bloque `turbopack` cuando hay `webpack`: sin él aborta el
  // dev server. Vacío es correcto, no hay nada que migrar (el alias de arriba
  // solo lo usa el build de producción con webpack).
  turbopack: {},
  images: { remotePatterns: [] },
  // Los pedidos viven en la sección de la cuenta. Esta redirección HTTP se
  // aplica antes de renderizar, así que enlaces antiguos, marcadores y avisos
  // que apunten a `/pedidos` nunca devuelven 404.
  async redirects() {
    return [
      { source: '/pedidos', destination: '/cuenta#pedidos', permanent: false },
    ];
  },
};

module.exports = nextConfig;
