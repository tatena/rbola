import fs from "node:fs";
import { createTreeV2 } from "@metaplex-foundation/mpl-bubblegum";
import { generateSigner } from "@metaplex-foundation/umi";
import { makeUmi, printBalance } from "./common.ts";

// depth 14 = 2^14 = 16,384 card slots; buffer 64 = valid pairing for depth 14
const MAX_DEPTH = 14;
const MAX_BUFFER = 64;

const umi = makeUmi();
console.log("payer:", umi.identity.publicKey);
const before = await printBalance(umi, "balance before");

const merkleTree = generateSigner(umi);
const builder = await createTreeV2(umi, {
  merkleTree,
  maxDepth: MAX_DEPTH,
  maxBufferSize: MAX_BUFFER,
});
await builder.sendAndConfirm(umi);

const after = await printBalance(umi, "balance after");
console.log(`tree rent + fees: ${Number(before - after) / 1e9} SOL`);
console.log("merkle tree:", merkleTree.publicKey);
console.log(
  `explorer: https://explorer.solana.com/address/${merkleTree.publicKey}?cluster=devnet`,
);

fs.writeFileSync(
  new URL(".keys/tree.json", import.meta.url),
  JSON.stringify({ tree: merkleTree.publicKey }),
);
