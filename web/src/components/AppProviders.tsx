"use client";

import { PrivyProvider } from "@privy-io/react-auth";

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
      }}
    >
      {children}
    </PrivyProvider>
  );
}
