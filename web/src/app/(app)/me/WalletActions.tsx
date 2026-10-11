"use client";

import { useState } from "react";
import {
  useFundWallet,
  useSignAndSendTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { authHeaders } from "@/lib/authHeaders";
import { CHAIN, explorerTx } from "@/lib/cluster";

// ME → ADD SOL / WITHDRAW. Real SOL on mainnet, so players must be able to
// get it in and out. ADD SOL opens Privy's funding flow (when enabled in the
// Privy dashboard), else copies the address to send to. WITHDRAW: the server
// builds the transfer, the player's wallet signs and sends it.

const FEE = 5_000; // one signature
const RENT_MIN = 890_880; // a wallet left with less than this (but not 0) is rejected

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bs58(bytes: Uint8Array): string {
  let n = BigInt("0x" + (Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") || "0"));
  let out = "";
  while (n > BigInt(0)) {
    out = B58[Number(n % BigInt(58))] + out;
    n /= BigInt(58);
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const button: React.CSSProperties = {
  background: "#14141A",
  border: ".5px solid rgba(201,179,126,.55)",
  boxShadow: "0 10px 28px rgba(0,0,0,.5), inset 0 .5px 0 rgba(255,255,255,.07)",
};

export function copyText(text: string) {
  return navigator.clipboard?.writeText(text).catch(() => {});
}

export default function WalletActions({
  owner,
  lamports,
  onSent,
}: {
  owner: string;
  lamports: number | null;
  onSent: () => void;
}) {
  const { fundWallet } = useFundWallet();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const addSol = async () => {
    try {
      await fundWallet({ address: owner, options: { chain: CHAIN } });
      onSent();
    } catch {
      // funding not enabled / closed: the address is how SOL gets in
      await copyText(owner);
      setNote("ADDRESS COPIED · SEND SOL TO IT");
      setTimeout(() => setNote(null), 3000);
    }
  };

  return (
    <>
      <div
        className="fixed inset-x-0 z-10 mx-auto flex w-full max-w-[430px] flex-col gap-2 px-5"
        style={{ bottom: "calc(max(env(safe-area-inset-bottom), 16px) + 82px)" }}
      >
        {note && (
          <span className="text-center font-mono text-[9px] tracking-[.2em] text-accent">
            {note}
          </span>
        )}
        <div className="flex gap-[9px]">
          {(
            [
              ["ADD SOL", addSol],
              ["WITHDRAW", () => setOpen(true)],
            ] as const
          ).map(([label, fn]) => (
            <button
              key={label}
              onClick={fn}
              className="flex h-[50px] flex-1 items-center justify-center rounded-[14px] transition-transform active:scale-[.97]"
              style={button}
            >
              <span className="pl-[.28em] font-mono text-[11px] font-semibold leading-none tracking-[.28em] text-foreground">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
      {open && (
        <WithdrawSheet
          owner={owner}
          lamports={lamports}
          onClose={() => setOpen(false)}
          onSent={onSent}
        />
      )}
    </>
  );
}

function WithdrawSheet({
  owner,
  lamports,
  onClose,
  onSent,
}: {
  owner: string;
  lamports: number | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);

  const max = lamports === null ? 0 : Math.max(0, lamports - FEE);
  const send = async () => {
    setError(null);
    const value = Math.round(Number(amount) * 1e9);
    if (!to.trim()) return setError("Enter an address");
    if (!(value > 0)) return setError("Enter an amount");
    if (value > max) return setError("More than this wallet holds");
    const left = (lamports ?? 0) - value - FEE;
    if (left > 0 && left < RENT_MIN) return setError("Leave at least 0.001 SOL, or send MAX");
    const wallet = wallets.find((w) => w.address === owner) ?? wallets[0];
    if (!wallet) return setError("Wallet not ready");
    setBusy(true);
    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ owner, to: to.trim(), lamports: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "withdraw failed");
      const { signature } = await signAndSendTransaction({
        transaction: b64ToBytes(json.tx),
        wallet,
        chain: CHAIN,
      });
      setSig(bs58(signature));
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const field =
    "h-[46px] w-full rounded-[12px] bg-white/[.04] px-4 font-mono text-[13px] text-foreground outline-none placeholder:text-foreground/30 focus:border-accent/60";
  const fieldStyle = { border: ".5px solid rgba(233,231,226,.16)" };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative flex w-full max-w-[430px] flex-col gap-4 rounded-t-[22px] px-5 pt-6"
        style={{
          background: "#101015",
          borderTop: ".5px solid rgba(201,179,126,.35)",
          paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 12px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="font-mono text-[10px] tracking-[.24em] text-foreground/50">
          WITHDRAW SOL
        </span>
        {sig ? (
          <>
            <span className="text-[22px] font-light text-foreground-bright">Sent</span>
            <a
              href={explorerTx(sig)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[9px] tracking-[.22em] text-foreground/50"
            >
              VIEW ON SOLANA EXPLORER ↗
            </a>
          </>
        ) : (
          <>
            <input
              className={field}
              style={fieldStyle}
              placeholder="Solana address"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="flex gap-2">
              <input
                className={field}
                style={fieldStyle}
                placeholder="0.00 SOL"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              />
              <button
                onClick={() => setAmount(String(max / 1e9))}
                className="h-[46px] flex-none rounded-[12px] px-4 font-mono text-[10px] tracking-[.2em] text-accent"
                style={fieldStyle}
              >
                MAX
              </button>
            </div>
            {error && <span className="text-[13px] text-foreground/70">{error}</span>}
          </>
        )}
        <button
          onClick={sig ? onClose : send}
          disabled={busy}
          className="flex h-[50px] w-full items-center justify-center rounded-[14px] transition-transform active:scale-[.97] disabled:opacity-60"
          style={button}
        >
          <span className="pl-[.28em] font-mono text-[11px] font-semibold tracking-[.28em] text-foreground">
            {sig ? "DONE" : busy ? "SENDING" : "SEND"}
          </span>
        </button>
      </div>
    </div>
  );
}
