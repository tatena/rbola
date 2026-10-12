import type { Metadata } from "next";
import Landing from "@/components/Landing";
import "./landing.css";

// Public landing page (rbola.fun, Vercel) per Claude Design "RBOLA Landing".
// The app itself is served from app.rbola.fun (Hetzner); app routes hit on
// rbola.fun are redirected across in next.config.ts. Styling is scoped to
// landing.css so this page deploys regardless of app-screen work in flight.

export const metadata: Metadata = {
  title: "RBOLA — Own the cars that turn your head",
};

export default function Home() {
  return <Landing />;
}
