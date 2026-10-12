import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RBOLA",
  description:
    "Photograph real cars in the street, own them as verified cards, and race them.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RBOLA",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      {/* suppressHydrationWarning: browser extensions inject attributes into
          <body>; React would flag the mismatch as an error. Attribute-level
          suppression only — real content mismatches still surface. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
