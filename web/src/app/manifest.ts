import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RBOLA",
    short_name: "RBOLA",
    description:
      "Photograph real cars in the street, own them as verified cards, and race them.",
    start_url: "/catch",
    display: "standalone",
    background_color: "#16181c",
    theme_color: "#16181c",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
