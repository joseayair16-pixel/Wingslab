const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');
const path = require('path');

// @sadel/shared se resuelve al fuente TS (ver comentario en web-customer/next.config.js).
const withSharedAlias = (config) => {
  config.resolve = config.resolve || {};
  config.resolve.alias = { ...(config.resolve.alias || {}), '@sadel/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts') };
  return config;
};

module.exports = (phase) => {
  const config = withSharedAlias({
    reactStrictMode: true,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    images: {
      unoptimized: true,
    },
    eslint: {
      ignoreDuringBuilds: true,
    },
  });

  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    config.rewrites = async () => [
      {
        source: '/api/:path*',
        destination: 'https://sadel-production.up.railway.app/:path*',
      },
    ];
  }

  return config;
};
