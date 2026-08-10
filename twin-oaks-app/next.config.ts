import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Receipt photos straight off an iPhone camera can be large.
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
