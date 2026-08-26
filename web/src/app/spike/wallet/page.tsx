"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage, useWallets } from "@privy-io/react-auth/solana";

const DEVNET_RPC = "https://api.devnet.solana.com";
const LAMPORTS_PER_SOL = 1_000_000_000;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(DEVNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

export default function WalletSpike() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();

  const wallet = wallets[0];
  const address = wallet?.address;

  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    const result = await rpc<{ value: number }>("getBalance", [address]);
    setBalance(result.value / LAMPORTS_PER_SOL);
  }, [address]);

  useEffect(() => {
    refreshBalance().catch(() => {});
  }, [refreshBalance]);

  async function airdrop() {
    if (!address) return;
    setError(null);
    setBusy("Requesting devnet SOL…");
    try {
      await rpc<string>("requestAirdrop", [address, LAMPORTS_PER_SOL]);
      // the airdrop lands when the transaction is confirmed — poll a few times
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        await refreshBalance();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sign() {
    if (!wallet) return;
    setError(null);
    setBusy("Signing…");
    try {
      const { signature: sig } = await signMessage({
        message: new TextEncoder().encode("RBOLA wallet spike"),
        wallet,
      });
      setSignature(
        Array.from(sig.slice(0, 16), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("") + "…",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center bg-[#16181c] text-neutral-400">
        loading…
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col gap-4 bg-[#16181c] p-4 text-neutral-200">
      <h1 className="text-lg font-bold tracking-widest text-[#f0a500]">
        WALLET SPIKE
      </h1>

      {!authenticated ? (
        <button
          onClick={login}
          className="rounded-lg bg-[#f0a500] p-3 font-bold text-black"
        >
          Log in with email
        </button>
      ) : (
        <>
          <section className="flex flex-col gap-1 text-sm">
            <p className="text-neutral-500">logged in as {user?.email?.address}</p>
            <p className="break-all">
              wallet: <b>{address ?? "creating…"}</b>
            </p>
            {address && (
              <a
                className="text-[#f0a500] underline"
                href={`https://explorer.solana.com/address/${address}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
              >
                view on Solana Explorer (devnet)
              </a>
            )}
            <p>
              balance:{" "}
              <b>{balance === null ? "…" : `${balance.toFixed(4)} SOL`}</b>{" "}
              (devnet)
            </p>
          </section>

          <div className="flex flex-col gap-2">
            <button
              onClick={airdrop}
              disabled={!address || busy !== null}
              className="rounded-lg bg-[#f0a500] p-3 font-bold text-black disabled:opacity-50"
            >
              Get 1 devnet SOL
            </button>
            <button
              onClick={sign}
              disabled={!wallet || busy !== null}
              className="rounded-lg border border-neutral-600 p-3 disabled:opacity-50"
            >
              Sign a message
            </button>
            <button onClick={logout} className="p-2 text-sm text-neutral-500">
              log out
            </button>
          </div>

          {busy && <p className="text-sm text-neutral-400">{busy}</p>}
          {signature && (
            <p className="break-all text-sm">
              signature: <b>{signature}</b> — the invisible wallet can sign ✓
            </p>
          )}
          {error && (
            <p className="rounded bg-red-950 p-2 text-sm text-red-300">
              {error}
            </p>
          )}
        </>
      )}
    </main>
  );
}
