import fs from "node:fs";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { keypairIdentity, type Umi } from "@metaplex-foundation/umi";
import "dotenv/config";

export const DEVNET_RPC =
  process.env.HELIUS_API_KEY !== undefined
    ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : "https://api.devnet.solana.com";

// the founder's Privy embedded wallet — cards are minted to her
export const FOUNDER_WALLET = "HCAbceo5Y8Vdh5QLVLHBGosUretLdguX4yYrUqLXTe1t";

export function makeUmi(): Umi {
  const umi = createUmi(DEVNET_RPC).use(mplBubblegum());
  const secret = new Uint8Array(
    JSON.parse(fs.readFileSync(new URL(".keys/spike.json", import.meta.url), "utf8")),
  );
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));
  return umi;
}

export async function printBalance(umi: Umi, label: string): Promise<bigint> {
  const b = await umi.rpc.getBalance(umi.identity.publicKey);
  console.log(`${label}: ${Number(b.basisPoints) / 1e9} SOL`);
  return b.basisPoints;
}
