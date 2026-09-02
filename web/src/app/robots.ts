import type { MetadataRoute } from "next";

// Only the landing page is public-facing; the app screens are pre-launch
// and stay out of search indexes (still reachable by direct URL).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/$",
      disallow: "/",
    },
  };
}
