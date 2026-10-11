// Runs once when the server starts (Next.js instrumentation hook).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RACE_KEYPAIR_PATH) {
    const { startRaceWorker } = await import("@/lib/raceWorker");
    startRaceWorker();
  }
}
