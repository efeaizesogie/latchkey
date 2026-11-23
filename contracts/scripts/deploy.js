// Deploy Latchkey v2 on X Layer (or a local fork):
//   1. tape out MAJ3 and the latch (REF to MAJ3) on TapeOut's OrderGuard processor; open the latch's container
//   2. bind the on-chain name <latch id>.2.<cpu index>.tape to that container (DomainBinding)
//   3. deploy LatchkeyHerald, hand it the latch circuit NFT (it now speaks over TapeSend as Latchkey's container)
//   4. deploy LatchkeyFactory wired to the circuit and the herald; let the deployer update the site as operator
//
//   Fork rehearsal:  FORK=1 npx hardhat node          (terminal 1)
//                    npx hardhat run scripts/deploy.js --network localhost
//   X Layer:         (contracts/.env: DEPLOYER_KEY, TREASURY) npx hardhat run scripts/deploy.js --network xlayer
//
// Env: MAJ_ID / LATCH_ID (reuse earlier tape-outs), TREASURY (default deployer), SETUP_FEE (OKB, default 0.001),
//      CLAIM_BPS (default 20), OPERATOR_TTL (seconds, default and SiteRegistry maximum 30 days; renew with herald.setSiteOperator), MONTHS (name binding, default 120).
const { ethers, network } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");
const { tapeOutLatchkey, PROCESSOR, HUB, SITES, BINDING } = require("./lib/tapeout");

async function main() {
  const live = network.name === "xlayer";
  if (network.name === "localhost" || network.name === "hardhat") await network.provider.send("hardhat_mine", ["0x1"]);
  const [me, heir, stranger] = await ethers.getSigners();
  const bal0 = await ethers.provider.getBalance(me.address);
  console.log(`network ${network.name}, deployer ${me.address}, balance ${ethers.formatEther(bal0)} OKB`);

  const dep = await tapeOutLatchkey(me, { majId: process.env.MAJ_ID, latchId: process.env.LATCH_ID, log: console.log });

  // on-chain name: <circuit id>.<area code 2 = X Layer>.<processor number in the factory>
  const fac = new ethers.Contract("0x1f09DAeFA827f02CBb40967cc91b259763760761", ["function cpuCount() view returns (uint256)", "function cpuAt(uint256) view returns (address)"], me);
  let cpuIndex = 272;
  if ((await fac.cpuAt(cpuIndex)).toLowerCase() !== PROCESSOR.toLowerCase()) {
    const n = Number(await fac.cpuCount());
    for (cpuIndex = 0; cpuIndex < n; cpuIndex++) if ((await fac.cpuAt(cpuIndex)).toLowerCase() === PROCESSOR.toLowerCase()) break;
  }
  const tapeName = `${dep.latchId}.2.${cpuIndex}.tape`;

  const holder = await dep.proc.ownerOf(dep.latchId);
  if (holder.toLowerCase() === me.address.toLowerCase()) {
    const binding = new ethers.Contract(BINDING, ["function monthlyFee() view returns (uint256)", "function isLive(string,address) view returns (bool)", "function bind(string,address,uint256) payable"], me);
    if (!(await binding.isLive(tapeName, dep.container))) {
      const months = BigInt(process.env.MONTHS || 120);
      await (await binding.bind(tapeName, dep.container, months, { value: (await binding.monthlyFee()) * months })).wait();
      console.log(`bound ${tapeName}`);
    }
  }

  const H = await ethers.getContractFactory("LatchkeyHerald");
  const herald = await H.deploy(HUB, PROCESSOR, dep.latchId, dep.container, SITES, tapeName, me.address);
  await herald.waitForDeployment();
  const heraldAddr = await herald.getAddress();
  if (holder.toLowerCase() === me.address.toLowerCase()) await (await dep.proc.safeTransferFrom(me.address, heraldAddr, dep.latchId)).wait();
  if (!(await herald.ready())) throw new Error("the herald does not hold the latch circuit");

  const treasury = process.env.TREASURY || me.address;
  const setupFee = ethers.parseEther(process.env.SETUP_FEE || "0.001");
  const claimBps = Number(process.env.CLAIM_BPS || 20);
  const F = await ethers.getContractFactory("LatchkeyFactory");
  const factory = await F.deploy(PROCESSOR, dep.latchId, heraldAddr, treasury, setupFee, claimBps);
  await factory.waitForDeployment();
  await (await herald.setFactory(await factory.getAddress())).wait();
  await (await herald.setSiteOperator(me.address, Number(process.env.OPERATOR_TTL || 30 * 24 * 3600))).wait();

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    processor: PROCESSOR,
    majId: dep.majId.toString(),
    circuitId: dep.latchId.toString(),
    container: dep.container,
    tapeName,
    herald: heraldAddr,
    factory: await factory.getAddress(),
    implementation: await factory.implementation(),
    treasury,
    setupFee: setupFee.toString(),
    claimFeeBps: claimBps,
    deployedAt: new Date().toISOString(),
    tx: factory.deploymentTransaction().hash,
  };
  if (!live) {
    const token = await (await ethers.getContractFactory("MockERC20")).deploy();
    await token.waitForDeployment();
    for (const s of [me, heir, stranger]) await (await token.mint(s.address, 5_000n * 10n ** 6n)).wait();
    out.token = await token.getAddress();
  }
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, live ? "xlayer.json" : "fork.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  console.log(`total spent ${ethers.formatEther(bal0 - (await ethers.provider.getBalance(me.address)))} OKB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
