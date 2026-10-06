// Client-side draft-mint store. The mint API call runs here in the background
// so the mint screen can hand off to the garage immediately (ADDED TO GARAGE →
// sealing card) while the cNFT is actually minting.

export type Frame = { x: number; y: number; width: number; height: number };

export type Draft = {
  photo: string;
  name: string;
  // signed verdict from /api/verify — /api/catch refuses to mint without it
  verification: string;
  lat?: number;
  lon?: number;
  caughtAt?: string;
  frame: Frame | null;
  status: "sealing" | "minted" | "error";
  assetId: string | null;
  error: string | null;
};

let draft: Draft | null = null;
const subs = new Set<() => void>();

function emit() {
  subs.forEach((fn) => fn());
}

export function getDraft(): Draft | null {
  return draft;
}

export function getServerDraft(): Draft | null {
  return null;
}

export function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function clearDraft() {
  draft = null;
  emit();
}

export function startMint(input: {
  photo: string;
  name: string;
  verification: string;
  lat?: number;
  lon?: number;
  caughtAt?: string;
  frame: Frame | null;
}) {
  draft = { ...input, status: "sealing", assetId: null, error: null };
  emit();
  void run();
}

export function retryMint() {
  if (!draft) return;
  draft = { ...draft, status: "sealing", error: null };
  emit();
  void run();
}

function postCatch(mine: Draft, verification: string) {
  return fetch("/api/catch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      photo: mine.photo,
      verification,
      lat: mine.lat,
      lon: mine.lon,
      frame: mine.frame,
    }),
  });
}

async function run() {
  if (!draft) return;
  const mine = draft;
  try {
    let res = await postCatch(mine, mine.verification);
    if (res.status === 403) {
      // verification token expired (sheet sat open >10 min, or a retry long
      // after a failed mint) — re-verify the same photo and try once more
      const vr = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: mine.photo }),
      });
      const vj = await vr.json();
      if (!vr.ok || !vj.verified) {
        throw new Error(vj.message ?? vj.error ?? "verification expired");
      }
      mine.verification = vj.token;
      res = await postCatch(mine, vj.token);
    }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    if (draft === mine) {
      draft = { ...mine, status: "minted", assetId: json.assetId };
      emit();
    }
  } catch (e) {
    if (draft === mine) {
      draft = {
        ...mine,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      };
      emit();
    }
  }
}

// --- garage data cache: lets /garage render the full ring instantly on
// arrival (the mint screen warms it) instead of popping in after fetch ---

export type GarageSnapshot = { cards: unknown[]; sol: number | null };

let garageCache: GarageSnapshot | null = null;

export function getGarageCache(): GarageSnapshot | null {
  return garageCache;
}

export function setGarageCache(snap: GarageSnapshot) {
  garageCache = snap;
}

export function warmGarageCache() {
  fetch("/api/garage")
    .then((r) => r.json())
    .then((j) => {
      if (!j.error) garageCache = { cards: j.cards ?? [], sol: j.sol ?? null };
    })
    .catch(() => {});
}
