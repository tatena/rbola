import { tick } from "@/lib/raceLedger";

// Runs the race ledger's background tick every few seconds inside the server
// process (started once from instrumentation.ts): no-rival refunds, lost
// confirmations and payouts happen even when every player has closed the app.
const EVERY_MS = 10_000;

export function startRaceWorker() {
  const g = globalThis as unknown as { __raceWorker?: boolean };
  if (g.__raceWorker) return;
  g.__raceWorker = true;
  let running = false;
  setInterval(() => {
    if (running) return; // a slow RPC never stacks ticks
    running = true;
    tick()
      .then(() => {
        (globalThis as unknown as { __raceLastTick?: number }).__raceLastTick = Date.now();
      })
      .catch((err) => console.error("race worker tick failed", err))
      .finally(() => {
        running = false;
      });
  }, EVERY_MS).unref();
}
