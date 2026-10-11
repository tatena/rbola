// The one network switch. NEXT_PUBLIC_SOLANA_CLUSTER is baked in at build
// time (deploy builds each target with its own env: staging = devnet,
// app.rbola.fun = mainnet), so server and browser always agree. Default devnet.

export type Cluster = "devnet" | "mainnet";

export const CLUSTER: Cluster =
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet" ? "mainnet" : "devnet";

// wallet-standard chain id Privy signs on
export const CHAIN = `solana:${CLUSTER}` as const;

// server-side Helius RPC + DAS (the API key never reaches the browser: it isn't
// NEXT_PUBLIC, so it's undefined in client bundles)
export const heliusRpc = () =>
  `https://${CLUSTER}.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;

// browser RPC for the embedded wallet: our own /api/rpc proxy (server key,
// method allowlist), so no RPC key ships to phones. Subscriptions (wallet
// confirmations) use the public websocket endpoint.
export const browserRpc = () =>
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  (typeof window === "undefined"
    ? "http://localhost/api/rpc" // SSR placeholder: nothing fetches during render
    : `${window.location.origin}/api/rpc`);

export const PUBLIC_WS =
  CLUSTER === "mainnet" ? "wss://api.mainnet-beta.solana.com" : "wss://api.devnet.solana.com";

// public origin baked into card metadata (on-chain, permanent)
export const APP_URL =
  process.env.APP_URL ??
  (CLUSTER === "mainnet" ? "https://app.rbola.fun" : "https://staging.rbola.fun");

export const explorerTx = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}${CLUSTER === "devnet" ? "?cluster=devnet" : ""}`;

export const explorerHome = `https://explorer.solana.com/${CLUSTER === "devnet" ? "?cluster=devnet" : ""}`;
