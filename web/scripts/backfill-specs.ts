// One-off: cards minted before the catalog existed (Aug–Sep 2026) never got
// a spec, so they can't race. Resolve each real car once through the same
// catalog path new catches use (main → pending → AI draft). First spec ever
// assigned — not a change to an issued spec. Test cards with junk names are
// left alone.
// Run on the server: cd web && set -a; . /srv/rbola/env; set +a; npx tsx scripts/backfill-specs.ts [--dry]
import fs from "node:fs";
import path from "node:path";
import { resolveSpec } from "@/lib/catalog";
import { CATCHES_DIR, REGISTRY_PATH } from "@/lib/dataDir";

const MAKES = ["Mercedes-AMG", "Porsche", "Morgan", "Lamborghini", "Audi", "Ferrari", "BMW", "Lexus"];
const dry = process.argv.includes("--dry");

async function main() {
  const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  const done = new Map<string, Awaited<ReturnType<typeof resolveSpec>>>();
  let n = 0;
  for (const rec of reg) {
    if (rec.spec_key || rec.hidden) continue;
    const name: string = rec.name ?? "";
    const make = MAKES.find((m) => name.toLowerCase().startsWith(m.toLowerCase() + " "));
    if (!make || /damtvreuli/i.test(name)) continue;
    const model = name.slice(make.length + 1).trim();
    const key = `${make}|${model}`.toLowerCase();
    if (dry) {
      console.log("would resolve", make, "/", model, rec.assetId);
      continue;
    }
    let res = done.get(key);
    if (!res) {
      const photo = fs.readFileSync(path.join(CATCHES_DIR, path.basename(rec.photo))).toString("base64");
      res = await resolveSpec({ make, model, generation: null, photoB64: photo });
      done.set(key, res);
      console.log("resolved", name, "→", res.spec_key, res.rarity, res.provisional ? "(provisional)" : "");
    }
    Object.assign(rec, {
      spec_key: res.spec_key,
      rarity: res.rarity,
      provisional: res.provisional,
      catalog_version: res.catalog_version,
    });
    n++;
  }
  if (!dry) {
    fs.copyFileSync(REGISTRY_PATH, REGISTRY_PATH + ".bak-backfill");
    // re-read right before writing so a mint that landed meanwhile isn't lost
    const fresh = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
    const byId = new Map(reg.map((r: { assetId: string }) => [r.assetId, r]));
    const merged = fresh.map((r: { assetId: string }) => byId.get(r.assetId) ?? r);
    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(merged, null, 1));
  }
  console.log(dry ? "dry run" : `backfilled ${n} cards`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
