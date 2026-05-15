import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16: Turbopack is the default bundler.
  // Turbopack handles browser-only module exclusions (fs, path, crypto) automatically.
  turbopack: {},
};

export default nextConfig;
