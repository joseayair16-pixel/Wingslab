/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
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
