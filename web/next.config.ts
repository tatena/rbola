import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // phone testing: dev assets are requested via the tunnel / LAN IP, which
  // Next blocks by default as cross-origin
  allowedDevOrigins: ["*.trycloudflare.com", "172.16.51.153"],
  // hide the floating dev-tools badge — noise during phone testing
  devIndicators: false,
};

export default nextConfig;
