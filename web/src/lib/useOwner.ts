"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth/solana";

export const hasAuth = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export type OwnerState = {
  // resolved Solana wallet of the logged-in user (null when logged out)
  owner: string | null;
  // true while auth is initializing OR the embedded wallet is still being
  // created — do NOT fetch garage data in this window, or the API's
  // logged-out fallback would show someone else's cards
  pending: boolean;
  authenticated: boolean;
};

export function useOwner(): OwnerState {
  if (!hasAuth) return { owner: null, pending: false, authenticated: false };
  // hasAuth is a build-time constant, so the hook order is stable at runtime
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useOwnerWithPrivy();
}

function useOwnerWithPrivy(): OwnerState {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  if (!ready) return { owner: null, pending: true, authenticated: false };
  if (!authenticated) {
    return { owner: null, pending: false, authenticated: false };
  }
  // embedded wallet creation is async after first login — check both the
  // live wallets list and the user's linked accounts
  const linked = user?.linkedAccounts?.find(
    (a) => a.type === "wallet" && "chainType" in a && a.chainType === "solana",
  ) as { address?: string } | undefined;
  const owner = wallets[0]?.address ?? linked?.address ?? null;
  return { owner, pending: owner === null, authenticated: true };
}

export function shortAddress(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
