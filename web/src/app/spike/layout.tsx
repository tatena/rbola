import { notFound } from "next/navigation";
import { CLUSTER } from "@/lib/cluster";

// dev-only tools: gone on mainnet
export default function DevOnly({ children }: { children: React.ReactNode }) {
  if (CLUSTER === "mainnet") notFound();
  return children;
}
