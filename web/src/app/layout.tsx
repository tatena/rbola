import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
  themeColor: "#16181c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions inject attributes into
          <body>; React would flag the mismatch as an error. Attribute-level
          suppression only — real content mismatches still surface. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
