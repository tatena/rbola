"use client";

import { useEffect } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useOwner } from "@/lib/useOwner";

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
        // the wallet needs an RPC for the chain it signs on (race entries are
        // devnet transfers) — public endpoint, no API key in the client bundle
        solana: {
          rpcs: {
            "solana:devnet": {
              rpc: createSolanaRpc("https://api.devnet.solana.com"),
              rpcSubscriptions: createSolanaRpcSubscriptions("wss://api.devnet.solana.com"),
              blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
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
    if (!owner) return;
    const key = `rbola.starter.${owner}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {}
    fetch("/api/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner }),
    })
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
