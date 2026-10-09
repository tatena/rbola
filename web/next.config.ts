import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // phone testing: dev assets are requested via the tunnel / LAN IP, which
  // Next blocks by default as cross-origin
  allowedDevOrigins: ["*.trycloudflare.com", "172.16.51.153"],
  // hide the floating dev-tools badge — noise during phone testing
  devIndicators: false,
  // The app is served from app.rbola.fun; this same build on Vercel
  // (rbola.fun) has no backend, so app routes there bounce across. Host-gated
  // (Next anchors the regex), so app.rbola.fun, localhost and tunnels are
  // untouched. Temporary (307) while the hosting split is still settling.
  async redirects() {
    return [
      // the app opens on the camera — the landing page lives on rbola.fun
      {
        source: "/",
        has: [{ type: "host", value: "app\\.rbola\\.fun" }],
        destination: "/catch",
        permanent: false,
      },
      {
        source: "/:route(catch|garage|race|me|upload)/:rest*",
        has: [{ type: "host", value: "(www\\.)?rbola\\.fun" }],
        destination: "https://app.rbola.fun/:route/:rest*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
