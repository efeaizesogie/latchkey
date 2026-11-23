// Live check of the X Layer testnet deployment (real time, real blocks):
//   1. the evaluator answers all 256 (state, input) rows of the latch as specified
//   2. a full journey: faucet -> vault (1 min window, 1 min grace) -> deposit -> grace -> trip -> a separate heir claims
//   npx hardhat run scripts/verify-testnet.js --network xlayerTestnet
const { ethers, network } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function main() {
  if (network.name !== "xlayerTestnet") throw new Error("testnet only");
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "testnet.json"), "utf8"));
  const [me] = await ethers.getSigners();
  const { latchSpec } = await import("../../circuit/latch.mjs");

  const proc = await ethers.getContractAt("Tap02Processor", dep.processor);
  let ok = 0;
  for (let st = 0; st < 4; st++) {
    const rows = await Promise.all(Array.from({ length: 64 }, (_, v) => proc.step(dep.circuitId, ethers.toBeHex(st, 1), ethers.toBeHex(v, 1))));
    rows.forEach(([ns], v) => {
      const w = latchSpec(st & 1, st >> 1, ...[0, 1, 2, 3, 4, 5].map((k) => (v >> k) & 1));
      if (Number(ns) === (w[0] | (w[1] << 1))) ok++;
    });
  }
  console.log(`evaluator: ${ok}/256 rows match the specification`);
  if (ok !== 256) process.exit(1);

  // reads are pinned to the transaction's block: the public testnet RPC is load-balanced and a node can lag
  // a throwaway heir for this check, funded with a little test OKB for gas
  const heir = ethers.Wallet.createRandom().connect(ethers.provider);
  await (await me.sendTransaction({ to: heir.address, value: ethers.parseEther("0.002") })).wait();

  const usd = await ethers.getContractAt("TestUSD", dep.token);
  if ((await usd.balanceOf(me.address)) < 100n * 10n ** 6n) await (await usd.faucet()).wait();
  const factory = await ethers.getContractAt("LatchkeyFactory", dep.factory);
  let rc = await (await factory.createVault(heir.address, 60, 60, [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress], ethers.ZeroAddress, ethers.ZeroAddress)).wait();
  const vaultAddr = (await factory.vaultsOf(me.address)).at(-1);
  const vault = await ethers.getContractAt("LatchkeyVault", vaultAddr);
  console.log(`vault ${vaultAddr} (create tx ${rc.hash})`);
  await (await usd.transfer(vaultAddr, 100n * 10n ** 6n)).wait();
  await (await vault.checkIn()).wait();
  console.log("deposited 100 tUSDT0, checked in; waiting 65 s for the window…");
  await wait(65);
  rc = await (await vault.poke()).wait();
  console.log(`grace period started (state ${await vault.state({ blockTag: rc.blockNumber })}, tx ${rc.hash}); waiting 65 s…`);
  await wait(65);
  rc = await (await vault.poke()).wait();
  console.log(`latch tripped (state ${await vault.state({ blockTag: rc.blockNumber })}, tx ${rc.hash})`);
  rc = await (await vault.connect(heir).claim([dep.token])).wait();
  console.log(`heir claimed: ${ethers.formatUnits(await usd.balanceOf(heir.address, { blockTag: rc.blockNumber }), 6)} tUSDT0 (tx ${rc.hash})`);
  console.log(`see https://web3.okx.com/explorer/x-layer-testnet/address/${vaultAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
