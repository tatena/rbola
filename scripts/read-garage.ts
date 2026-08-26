// the future "garage view": one DAS call returns every cNFT a wallet owns
import { DEVNET_RPC, FOUNDER_WALLET } from "./common.ts";

if (!process.env.HELIUS_API_KEY) {
  console.error("HELIUS_API_KEY missing in scripts/.env — DAS needs Helius");
  process.exit(1);
}

const res = await fetch(DEVNET_RPC, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "rbola",
    method: "getAssetsByOwner",
    params: { ownerAddress: FOUNDER_WALLET, page: 1, limit: 50 },
  }),
});
const { result, error } = await res.json();
if (error) throw new Error(JSON.stringify(error));

console.log(`assets owned by ${FOUNDER_WALLET}: ${result.total}`);
for (const a of result.items) {
  console.log(
    `- ${a.content?.metadata?.name ?? "(unnamed)"} | ${a.interface} | compressed: ${a.compression?.compressed} | id: ${a.id}`,
  );
}
