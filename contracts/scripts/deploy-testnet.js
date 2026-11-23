// Deploy Latchkey on X Layer TESTNET (chain 1952), where TapeOut is not deployed:
//   Tap02Processor (TAP-02 evaluator, checked against TapeOut's processor in test/testnet.test.js)
//   -> MAJ3 + latch circuits -> LatchkeyFactory (no herald: TapeSend is mainnet only) -> TestUSD faucet token.
// The factory and vault contracts are byte-for-byte the mainnet ones.
//
//   npx hardhat run scripts/deploy-testnet.js --network xlayerTestnet
// Needs TESTNET_DEPLOYER_KEY in contracts/.env.testnet (made by scripts/testnet-wallet.js), funded from the faucet.
const { ethers, network } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  if (network.name !== "xlayerTestnet" && network.name !== "hardhat" && network.name !== "localhost") throw new Error("testnet only");
  const [me] = await ethers.getSigners();
  const bal0 = await ethers.provider.getBalance(me.address);
  console.log(`network ${network.name} (chain ${(await ethers.provider.getNetwork()).chainId}), deployer ${me.address}, ${ethers.formatEther(bal0)} OKB`);
  if (bal0 === 0n) throw new Error(`fund ${me.address} with test OKB from https://web3.okx.com/xlayer/faucet first`);

  const { buildMaj3, buildLatch } = await import("../../circuit/latch.mjs");
  const proc = await (await ethers.getContractFactory("Tap02Processor")).deploy();
  await proc.waitForDeployment();
  const procAddr = await proc.getAddress();
  const tapeout = async (nl, nIn, nOut) => {
    const rc = await (await proc.tapeout(ethers.hexlify(nl), nIn, nOut)).wait();
    return rc.logs.map((l) => { try { return proc.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "TapedOut").args.circuitId;
  };
  const majId = await tapeout(buildMaj3().netlist, 3, 1);
  const latchId = await tapeout(buildLatch(procAddr, majId).netlist, 6, 2);
  console.log(`Tap02Processor ${procAddr}: MAJ3 #${majId}, latch #${latchId}`);

  const F = await ethers.getContractFactory("LatchkeyFactory");
  const factory = await F.deploy(procAddr, latchId, ethers.ZeroAddress, me.address, 0, 20); // free setup on testnet
  await factory.waitForDeployment();
  const usd = await (await ethers.getContractFactory("TestUSD")).deploy();
  await usd.waitForDeployment();

  const out = {
    network: "xlayerTestnet",
    chainId: 1952,
    processor: procAddr,
    processorName: "Latchkey TAP-02 evaluator (testnet)",
    majId: majId.toString(),
    circuitId: latchId.toString(),
    factory: await factory.getAddress(),
    implementation: await factory.implementation(),
    herald: ethers.ZeroAddress,
    container: ethers.ZeroAddress,
    tapeName: "",
    token: await usd.getAddress(),
    setupFee: "0",
    claimFeeBps: 20,
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, network.name === "xlayerTestnet" ? "testnet.json" : "testnet-local.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(`spent ${ethers.formatEther(bal0 - (await ethers.provider.getBalance(me.address)))} test OKB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
