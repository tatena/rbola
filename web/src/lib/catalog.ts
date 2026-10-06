// The car catalog: single source of truth for card specs. Two layers:
// - main catalog (src/data/catalog/main.json) — founder-verified, versioned;
//   entries are frozen once published (the never-buff/nerf promise).
// - pending catalog (data/catalog-pending.json) — AI-drafted on the spot when
//   a verified catch isn't listed yet, so the player never hits a dead end.
//   Cards minted from pending entries are PROVISIONAL: they read the live
//   entry and settle when the founder promotes it to main (one-time
//   settlement, then frozen — Option B, locked 2026-10-06). Provisional cards
//   are excluded from paid races until settled (the race gate).

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import mainCatalog from "@/data/catalog/main.json";

const SPEC_MODEL = process.env.VERIFY_MODEL ?? "claude-opus-4-8";
const PENDING_PATH = path.join(process.cwd(), "data", "catalog-pending.json");

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export type Spec = {
  hp: number;
  zero_to_100: number; // seconds
  top_speed_kmh: number;
  weight_kg: number;
};

export type CatalogEntry = {
  spec_key: string;
  make: string;
  model: string;
  generation: string | null;
  years: string | null;
  spec: Spec;
  rarity: Rarity;
  status: "verified" | "pending";
  // pending-only provenance
  spec_confidence?: "high" | "medium" | "low";
  created_at?: string;
};

export type Resolution = {
  spec_key: string;
  rarity: Rarity;
  provisional: boolean;
  catalog_version: string;
};

// game stats derived from the spec — one tunable place, pure function
export type Stats = { speed: number; accel: number; handling: number };

export function deriveStats(spec: Spec): Stats {
  const clamp = (v: number) => Math.max(1, Math.min(100, Math.round(v)));
  // v0 normalization ranges chosen to spread the real fleet across 1–100:
  // top speed 100–430 km/h, 0–100 in 2.2–16s, power-to-weight 40–900 hp/ton
  const speed = clamp(((spec.top_speed_kmh - 100) / (430 - 100)) * 100);
  const accel = clamp(((16 - spec.zero_to_100) / (16 - 2.2)) * 100);
  const hpPerTon = spec.hp / (spec.weight_kg / 1000);
  const power = ((hpPerTon - 40) / (900 - 40)) * 100;
  const lightness = ((2200 - spec.weight_kg) / (2200 - 900)) * 100;
  const handling = clamp(power * 0.6 + lightness * 0.4);
  return { speed, accel, handling };
}

function slug(...parts: Array<string | null>): string {
  return parts
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// --- pending catalog (server-side JSON, keyed by spec_key) ---

function loadPending(): CatalogEntry[] {
  try {
    return JSON.parse(fs.readFileSync(PENDING_PATH, "utf8"));
  } catch {
    return [];
  }
}

function savePending(entries: CatalogEntry[]) {
  fs.mkdirSync(path.dirname(PENDING_PATH), { recursive: true });
  fs.writeFileSync(PENDING_PATH, JSON.stringify(entries, null, 1));
}

export function getEntry(specKey: string): CatalogEntry | null {
  const main = (mainCatalog.entries as CatalogEntry[]).find(
    (e) => e.spec_key === specKey,
  );
  if (main) return { ...main, status: "verified" };
  return loadPending().find((e) => e.spec_key === specKey) ?? null;
}

// --- AI spec draft: one knowledge call for cars not in any catalog ---

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    generation: {
      type: ["string", "null"],
      description: "the generation shown in the photo, if determinable",
    },
    years: { type: ["string", "null"], description: "production years" },
    hp: { type: "integer" },
    zero_to_100: { type: "number", description: "0-100 km/h, seconds" },
    top_speed_kmh: { type: "integer" },
    weight_kg: { type: "integer", description: "curb weight" },
    rarity: {
      type: "string",
      enum: ["common", "uncommon", "rare", "epic", "legendary"],
      description: "how rare this car is on a typical city street, globally",
    },
    spec_confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: [
    "generation",
    "years",
    "hp",
    "zero_to_100",
    "top_speed_kmh",
    "weight_kg",
    "rarity",
    "spec_confidence",
  ],
  additionalProperties: false,
} as const;

type SpecDraft = {
  generation: string | null;
  years: string | null;
  rarity: Rarity;
  spec_confidence: "high" | "medium" | "low";
} & Spec;

let client: Anthropic | null = null;

async function draftSpec(
  make: string,
  model: string,
  generationHint: string | null,
  photoB64: string,
): Promise<SpecDraft> {
  client ??= new Anthropic();
  const response = await client.messages.create({
    model: SPEC_MODEL,
    max_tokens: 512,
    output_config: { format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: photoB64 },
          },
          {
            type: "text",
            text:
              `Factory base specs for the ${make} ${model}` +
              (generationHint ? ` (${generationHint})` : "") +
              ` — the photo shows the exact car; use it to confirm the generation. ` +
              `Metric units. Pick the most common production trim of that generation, not a one-off or tuned variant. ` +
              `spec_confidence "high" only if you are sure of the exact generation and its numbers.`,
          },
        ],
      },
    ],
  });
  const text = response.content.find((b) => b.type === "text");
  if (!text) throw new Error("spec draft returned no result");
  return JSON.parse(text.text) as SpecDraft;
}

// hallucination rails — a draft outside these bounds still mints, but is
// stored low-confidence so founder review prioritizes it
function specWithinBounds(s: Spec): boolean {
  return (
    s.hp >= 20 &&
    s.hp <= 2200 &&
    s.zero_to_100 >= 1.5 &&
    s.zero_to_100 <= 40 &&
    s.top_speed_kmh >= 60 &&
    s.top_speed_kmh <= 550 &&
    s.weight_kg >= 400 &&
    s.weight_kg <= 4000
  );
}

// --- resolver: main catalog → pending catalog → fresh AI draft ---

export async function resolveSpec(input: {
  make: string;
  model: string;
  generation: string | null;
  photoB64: string;
}): Promise<Resolution> {
  const { make, model, generation, photoB64 } = input;
  const modelKey = slug(make, model);

  // 1. main catalog — match make+model, disambiguate generation
  const candidates = (mainCatalog.entries as CatalogEntry[]).filter(
    (e) => slug(e.make, e.model) === modelKey,
  );
  if (candidates.length === 1) {
    return verifiedResolution(candidates[0]);
  }
  if (candidates.length > 1) {
    // cheap disambiguation first: the recognizer's generation string
    const genSlug = generation ? slug(generation) : null;
    const byGen = genSlug
      ? candidates.find(
          (e) => e.generation && genSlug.includes(slug(e.generation)),
        )
      : null;
    if (byGen) return verifiedResolution(byGen);
    // ambiguous — let the draft call confirm the generation from the photo,
    // then retry the match; fall through to pending/draft if still unknown
    const draft = await draftSpec(make, model, generation, photoB64);
    const confirmed = draft.generation
      ? candidates.find(
          (e) =>
            e.generation &&
            slug(draft.generation!).includes(slug(e.generation)),
        )
      : null;
    if (confirmed) return verifiedResolution(confirmed);
    return pendingResolution(make, model, draft);
  }

  // 2 + 3. pending catalog, else fresh draft. Pending dedup is by make+model
  // only — the recognizer's generation WORDING wobbles between calls, and a
  // duplicate draft is worse than two generations sharing one quarantine
  // entry (founder review splits those on promotion if needed)
  const existing = loadPending().find(
    (e) => slug(e.make, e.model) === modelKey,
  );
  if (existing) {
    return {
      spec_key: existing.spec_key,
      rarity: existing.rarity,
      provisional: true,
      catalog_version: "pending",
    };
  }
  const draft = await draftSpec(make, model, generation, photoB64);
  return pendingResolution(make, model, draft);
}

function verifiedResolution(entry: CatalogEntry): Resolution {
  return {
    spec_key: entry.spec_key,
    rarity: entry.rarity,
    provisional: false,
    catalog_version: String(mainCatalog.version),
  };
}

function pendingResolution(
  make: string,
  model: string,
  draft: SpecDraft,
): Resolution {
  const spec: Spec = {
    hp: draft.hp,
    zero_to_100: draft.zero_to_100,
    top_speed_kmh: draft.top_speed_kmh,
    weight_kg: draft.weight_kg,
  };
  const entry: CatalogEntry = {
    spec_key: slug(make, model, draft.generation),
    make,
    model,
    generation: draft.generation,
    years: draft.years,
    spec,
    rarity: draft.rarity,
    status: "pending",
    spec_confidence: specWithinBounds(spec) ? draft.spec_confidence : "low",
    created_at: new Date().toISOString(),
  };
  const pending = loadPending();
  // another catch may have drafted the same car meanwhile — keep the first
  // (same make+model rule as the lookup above)
  const existing = pending.find(
    (e) => slug(e.make, e.model) === slug(make, model),
  );
  if (!existing) savePending([...pending, entry]);
  const final = existing ?? entry;
  return {
    spec_key: final.spec_key,
    rarity: final.rarity,
    provisional: true,
    catalog_version: "pending",
  };
}
