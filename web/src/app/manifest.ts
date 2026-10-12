import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RBOLA",
    short_name: "RBOLA",
    description:
      "Photograph real cars in the street, own them as verified cards, and race them.",
    start_url: "/catch",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#0a0a0f",
    icons: [
      // the R mark on brand black (src: public/rbola-r-mark.png)
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
