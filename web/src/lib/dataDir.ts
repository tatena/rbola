import path from "node:path";

// Runtime state (catch photos + registry, race ledger, pending catalog).
// Dev: inside the project, as before. Prod: DATA_DIR on the server's disk,
// outside the app folder so redeploys never touch it.
const root = process.env.DATA_DIR;

export const CATCHES_DIR = root
  ? path.join(root, "catches")
  : path.join(process.cwd(), "public", "catches");

export const STATE_DIR = root ? path.join(root, "state") : path.join(process.cwd(), "data");

export const REGISTRY_PATH = path.join(CATCHES_DIR, "index.json");
