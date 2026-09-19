"use client";

import { useRef, useState } from "react";
import { shortAddress, useOwner } from "@/lib/useOwner";

// TEMPORARY tool for the pitch-deck shoot: bulk-upload car photos and mint
// them as cards to the logged-in wallet (founder wallet when logged out).
// Not linked from the nav; delete after the deck is recorded.

type Row = {
  id: number;
  dataUrl: string;
  name: string;
  status: "ready" | "minting" | "done" | "error";
  error?: string;
};

// mirror the camera pipeline's scale so cards look consistent
async function downscale(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const max = 1600;
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function nameFromFile(file: File) {
  return file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 24);
}

export default function UploadPage() {
  const { owner, pending, authenticated } = useOwner();
  const [rows, setRows] = useState<Row[]>([]);
  const [minting, setMinting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const dataUrl = await downscale(file);
      setRows((r) => [
        ...r,
        {
          id: nextId.current++,
          dataUrl,
          name: nameFromFile(file),
          status: "ready",
        },
      ]);
    }
  }

  function patch(id: number, p: Partial<Row>) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...p } : row)));
  }

  // sequential — parallel mints race on the tree
  async function mintAll() {
    setMinting(true);
    for (const row of rows) {
      if (row.status === "done" || row.status === "minting") continue;
      patch(row.id, { status: "minting", error: undefined });
      try {
        const res = await fetch("/api/catch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photo: row.dataUrl,
            name: row.name || "Unnamed",
            frame: null,
            owner: owner ?? undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        patch(row.id, { status: "done" });
      } catch (e) {
        patch(row.id, {
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    setMinting(false);
  }

  const mintable = rows.filter((r) => r.status !== "done").length;
  const statusColor: Record<Row["status"], string> = {
    ready: "rgba(242,241,238,.4)",
    minting: "#C9B37E",
    done: "#C9B37E",
    error: "rgba(242,241,238,.75)",
  };
  const statusText: Record<Row["status"], string> = {
    ready: "READY",
    minting: "MINTING…",
    done: "IN GARAGE ✓",
    error: "FAILED — TAP MINT AGAIN",
  };

  return (
    <div
      className="flex min-h-dvh flex-col px-5"
      style={{
        background: "linear-gradient(180deg,#0A0A0F,#101015)",
        paddingTop: "max(env(safe-area-inset-top), 24px)",
        paddingBottom: "calc(max(env(safe-area-inset-bottom), 16px) + 72px)",
      }}
    >
      <span className="font-mono text-xs font-semibold leading-none tracking-[.28em] text-foreground">
        UPLOAD
      </span>
      <span
        className="mt-2 font-mono text-[9px] leading-[1.6] tracking-[.14em]"
        style={{ color: "rgba(242,241,238,.34)" }}
      >
        TEMP TOOL · MINTS TO{" "}
        {pending
          ? "…"
          : owner
            ? shortAddress(owner)
            : "FOUNDER WALLET (NOT LOGGED IN)"}
      </span>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="mt-5 flex h-11 w-full items-center justify-center rounded-[14px]"
        style={{ border: ".5px solid rgba(233,231,226,.22)" }}
      >
        <span
          className="font-mono text-[10px] font-medium leading-none tracking-[.28em]"
          style={{ color: "rgba(242,241,238,.7)" }}
        >
          ADD PHOTOS
        </span>
      </button>

      <div className="mt-4 flex flex-col gap-[10px]">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-3">
            <span
              className="block h-[52px] w-[68px] flex-none overflow-hidden rounded-[9px] bg-surface"
              style={{ border: ".5px solid rgba(233,231,226,.12)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.dataUrl}
                alt={row.name}
                className="h-full w-full object-cover"
              />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
              <input
                value={row.name}
                maxLength={24}
                disabled={row.status === "done" || row.status === "minting"}
                onChange={(e) => patch(row.id, { name: e.target.value })}
                className="w-full bg-transparent text-[13px] leading-none text-foreground outline-none disabled:opacity-60"
                style={{
                  borderBottom: ".5px solid rgba(233,231,226,.14)",
                  paddingBottom: 5,
                }}
                placeholder="Car name"
              />
              <span
                className="font-mono text-[8px] leading-none tracking-[.16em]"
                style={{ color: statusColor[row.status] }}
              >
                {statusText[row.status]}
              </span>
            </span>
            {row.status !== "minting" && row.status !== "done" && (
              <button
                type="button"
                aria-label="Remove"
                onClick={() =>
                  setRows((r) => r.filter((x) => x.id !== row.id))
                }
                className="flex h-8 w-8 flex-none items-center justify-center rounded-full font-mono text-[11px]"
                style={{
                  border: ".5px solid rgba(233,231,226,.16)",
                  color: "rgba(242,241,238,.5)",
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {rows.length > 0 && mintable > 0 && (
        <button
          type="button"
          disabled={minting || pending}
          onClick={() => void mintAll()}
          className="mt-6 flex h-[50px] w-full items-center justify-center rounded-[14px] disabled:opacity-50"
          style={{
            background: "#C9B37E",
            boxShadow: "0 10px 28px rgba(0,0,0,.5)",
          }}
        >
          <span className="font-mono text-[11px] font-semibold leading-none tracking-[.28em] text-background">
            {minting
              ? "MINTING…"
              : `MINT ${mintable} CARD${mintable === 1 ? "" : "S"}`}
          </span>
        </button>
      )}

      {rows.length === 0 && (
        <span
          className="mt-8 text-center font-mono text-[9px] leading-[1.8] tracking-[.14em]"
          style={{ color: "rgba(242,241,238,.28)" }}
        >
          {authenticated || pending
            ? "PICK CAR PHOTOS · NAME THEM · MINT · OPEN GARAGE"
            : "TIP: LOG IN ON THE ME TAB FIRST FOR A CLEAN DEMO GARAGE"}
        </span>
      )}
    </div>
  );
}
