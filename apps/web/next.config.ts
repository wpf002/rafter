import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@rafter/types'],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
