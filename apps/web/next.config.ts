import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1',
  },
  // Allow the API domain for images if needed
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.educms.io' },
    ],
  },
};

export default nextConfig;
