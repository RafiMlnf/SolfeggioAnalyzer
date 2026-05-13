import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence turbopack warning since we don't need webpack config anymore
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Fixes npm packages that depend on `fs` module
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
