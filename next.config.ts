import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "**.run.app",
    "**.scf.usercontent.goog",
    "**.usercontent.goog",
    "**.proxy.googlers.com",
    "**.googleusercontent.com",
    "**.google.com",
    "**.web.app",
    "localhost",
    "127.0.0.1",
  ],
  experimental: {
    reactDebugChannel: false,
    optimizePackageImports: ["lucide-react"],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  devIndicators: false,
};

export default nextConfig;
