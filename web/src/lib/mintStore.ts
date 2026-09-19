// Client-side draft-mint store. The mint API call runs here in the background
// so the mint screen can hand off to the garage immediately (ADDED TO GARAGE →
// sealing card) while the cNFT is actually minting.

export type Frame = { x: number; y: number; width: number; height: number };

export type Draft = {
  photo: string;
  name: string;
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

async function run() {
  if (!draft) return;
  const mine = draft;
  try {
    const res = await fetch("/api/catch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        photo: mine.photo,
        name: mine.name,
        lat: mine.lat,
        lon: mine.lon,
        frame: mine.frame,
      }),
    });
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
