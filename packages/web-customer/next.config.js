/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/sadel-production.up.railway.app/:path*',
        destination: 'https://sadel-production.up.railway.app/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
