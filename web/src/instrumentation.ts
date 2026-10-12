// Runs once when the server starts (Next.js instrumentation hook).
export async function register() {
  // mainnet without login checks would mint and race for anyone's wallet
  if (process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet" && !process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    throw new Error("refusing to start: mainnet requires NEXT_PUBLIC_PRIVY_APP_ID");
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.RACE_KEYPAIR_PATH) {
    const { startRaceWorker } = await import("@/lib/raceWorker");
    startRaceWorker();
  }
}
