import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the API domain for images
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.educms.io' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};

export default nextConfig;
