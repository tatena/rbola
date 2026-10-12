// Create the card tree (Bubblegum v2) on the server, signed by the mint payer
// — the tree is private, so only its creator (the payer) can mint into it.
// Keys never leave the server; this prints public addresses only.
//
//   KEYPAIR=/srv/rbola/keys/mainnet-payer.json CLUSTER=mainnet \
//   HELIUS_API_KEY=... node scripts/create-tree.mjs [--dry]
//
// --dry prints the exact rent and the payer balance without spending.
// Defaults (founder call 10-11): depth 14 / buffer 64 / canopy 8 = 16,384 cards.
import fs from "node:fs";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { generateSigner, keypairIdentity } from "@metaplex-foundation/umi";
import { createTreeV2, mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import { getMerkleTreeSize } from "@metaplex-foundation/mpl-account-compression";

const DEPTH = Number(process.env.DEPTH ?? 14);
const BUFFER = Number(process.env.BUFFER ?? 64);
const CANOPY = Number(process.env.CANOPY ?? 8);
const cluster = process.env.CLUSTER === "mainnet" ? "mainnet" : "devnet";
const dry = process.argv.includes("--dry");

const umi = createUmi(
  `https://${cluster}.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
).use(mplBubblegum());
const secret = new Uint8Array(JSON.parse(fs.readFileSync(process.env.KEYPAIR, "utf8")));
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

const size = getMerkleTreeSize(DEPTH, BUFFER, CANOPY);
const rent = await umi.rpc.getRent(size);
const balance = await umi.rpc.getBalance(umi.identity.publicKey);
const sol = (v) => Number(v.basisPoints) / 1e9;
console.log(`cluster: ${cluster}`);
console.log(`payer: ${umi.identity.publicKey} (balance ${sol(balance)} SOL)`);
console.log(`tree: depth ${DEPTH} / buffer ${BUFFER} / canopy ${CANOPY} = ${2 ** DEPTH} cards`);
console.log(`tree rent: ${sol(rent)} SOL (${size} bytes) + tree config + fees ≈ 0.003 SOL`);
if (dry) process.exit(0);
if (Number(balance.basisPoints) < Number(rent.basisPoints) + 5_000_000) {
  console.error("payer balance too low for the tree rent + fees — fund it first");
  process.exit(1);
}

const merkleTree = generateSigner(umi);
const builder = await createTreeV2(umi, {
  merkleTree,
  maxDepth: DEPTH,
  maxBufferSize: BUFFER,
  canopyDepth: CANOPY,
});
await builder.sendAndConfirm(umi);
const after = await umi.rpc.getBalance(umi.identity.publicKey);
console.log(`spent: ${sol(balance) - sol(after)} SOL`);
console.log(`MERKLE_TREE=${merkleTree.publicKey}`);
