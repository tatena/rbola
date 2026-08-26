"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[#16181c] p-4">
        <p className="rounded bg-red-950 p-4 text-sm text-red-300">
          NEXT_PUBLIC_PRIVY_APP_ID is not set — add it to web/.env.local and
          restart the dev server.
        </p>
      </main>
    );
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "dark", accentColor: "#f0a500" },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
