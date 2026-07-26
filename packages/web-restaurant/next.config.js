const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

module.exports = (phase) => {
  const config = {
    reactStrictMode: true,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next-build',
    images: {
      unoptimized: true,
    },
    eslint: {
      ignoreDuringBuilds: true,
    },
  };

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

