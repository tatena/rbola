import fs from "node:fs";
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

// Crash-safe JSON write: temp file, fsync, rename, fsync the directory — a
// reader never sees a half-written file, and a host crash can't roll it back
// past a state we already acted on (e.g. a payout signature before broadcast).
export function writeJsonAtomic(p: string, data: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, p);
  const dir = fs.openSync(path.dirname(p), "r");
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
