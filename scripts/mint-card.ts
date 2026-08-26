import fs from "node:fs";
import {
  mintV2,
  parseLeafFromMintV2Transaction,
} from "@metaplex-foundation/mpl-bubblegum";
import { none, publicKey } from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import { FOUNDER_WALLET, makeUmi, printBalance } from "./common.ts";

const umi = makeUmi();
const { tree } = JSON.parse(
  fs.readFileSync(new URL(".keys/tree.json", import.meta.url), "utf8"),
);

const before = await printBalance(umi, "balance before");

const { signature } = await mintV2(umi, {
  leafOwner: publicKey(FOUNDER_WALLET),
  merkleTree: publicKey(tree),
  metadata: {
    name: "RBOLA #001 · Pagani Zonda",
    uri: "https://rbola.io/cards/001.json", // placeholder — metadata hosting is a later step
    sellerFeeBasisPoints: 500,
    collection: none(),
    creators: [],
  },
}).sendAndConfirm(umi);

const after = await printBalance(umi, "balance after");
console.log(`mint cost: ${Number(before - after) / 1e9} SOL`);

const sig58 = base58.deserialize(signature)[0];
console.log("tx:", `https://explorer.solana.com/tx/${sig58}?cluster=devnet`);

// the node needs a moment to index the tx before it can be parsed
let leaf;
for (let attempt = 0; ; attempt++) {
  try {
    leaf = await parseLeafFromMintV2Transaction(umi, signature);
    break;
  } catch (e) {
    if (attempt >= 5) throw e;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
console.log("asset id:", leaf.id);
console.log("owner:", FOUNDER_WALLET);
