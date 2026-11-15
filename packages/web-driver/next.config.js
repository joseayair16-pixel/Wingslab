const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');
const { frontendConfig } = require('../../config/wingslab.cjs');

module.exports = (phase) => {
  const config = {
    ...frontendConfig('driver'),
    reactStrictMode: true,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    images: {
      unoptimized: true,
    },
  };

  return config;
};
