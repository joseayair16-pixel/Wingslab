/** @type {import('next').NextConfig} */
const path = require('path');
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    // Resolver @sadel/shared directo al fuente TS: evita que el pipeline de
    // dev aplique react-refresh sobre dist CJS (import.meta fuera de módulo).
    config.resolve.alias['@sadel/shared'] = path.resolve(
      __dirname,
      '../../packages/shared/src/index.ts'
    );
    return config;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pub-3520d4c651424664b0fe934a0dbed662.r2.dev',
        pathname: '/**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://sadel-production.up.railway.app/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
