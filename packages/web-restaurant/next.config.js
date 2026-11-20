const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');
const path = require('path');
const { frontendConfig } = require('../../config/wingslab.cjs');

// @sadel/shared se resuelve al fuente TS (ver comentario en web-customer/next.config.js).
const withSharedAlias = (config) => {
  config.webpack = (webpackConfig) => {
    webpackConfig.resolve.alias['@sadel/shared'] = path.resolve(__dirname, '../../packages/shared/src/index.ts');
    return webpackConfig;
  };
  return config;
};

module.exports = (phase) => {
  const config = withSharedAlias({
    ...frontendConfig('restaurant'),
    allowedDevOrigins: ['127.0.0.1', 'localhost'],
    devIndicators: false,
    reactStrictMode: true,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    images: {
      unoptimized: true,
    },
  });

  return config;
};
