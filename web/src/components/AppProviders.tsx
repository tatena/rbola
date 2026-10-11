"use client";

import { useEffect } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { authHeaders } from "@/lib/authHeaders";
import { useOwner } from "@/lib/useOwner";
import { CHAIN, CLUSTER, PUBLIC_RPC, explorerHome } from "@/lib/cluster";

// App-wide auth (Privy, chosen in the wallet spike). Without the app id the
// app still renders — screens hide their auth controls via hasAuth.
export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark", accentColor: "#C9B37E" },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
        // the wallet needs an RPC for the chain it signs on (race entries) —
        // public endpoint or a domain-locked key, never the server's key
        solana: {
          rpcs: {
            [CHAIN]: {
              rpc: createSolanaRpc(PUBLIC_RPC),
              rpcSubscriptions: createSolanaRpcSubscriptions(PUBLIC_RPC.replace(/^http/, "ws")),
              blockExplorerUrl: explorerHome,
            },
          },
        },
      }}
    >
      <StarterSol />
      {children}
    </PrivyProvider>
  );
}

// New player → ask the server for starter devnet SOL once per wallet (the
// server decides; it only tops up near-empty wallets, once ever).
function StarterSol() {
  const { owner } = useOwner();
  useEffect(() => {
    if (!owner || CLUSTER !== "devnet") return; // no faucet on mainnet
    const key = `rbola.starter.${owner}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {}
    authHeaders()
      .then((headers) =>
        fetch("/api/faucet", { method: "POST", headers, body: JSON.stringify({ owner }) }),
      )
      .then((r) => r.json())
      .then((j) => {
        // settled for good once sent, or the server says it never will be
        if (j.sent || j.reason === "already dripped" || j.reason === "wallet funded") {
          try {
            localStorage.setItem(key, "1");
          } catch {}
        }
      })
      .catch(() => {});
  }, [owner]);
  return null;
}
