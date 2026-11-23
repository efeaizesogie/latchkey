// Fork rehearsal of the whole journey with wallet-style (estimated) gas, leaving a vault to look at in the app.
//   npx hardhat run scripts/rehearse.js --network localhost
// Env: STOP=grace to stop after the grace period starts, STOP=open to stop after funding.
const { ethers, network } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  if (!["localhost", "hardhat"].includes(network.name)) throw new Error("fork only");
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "fork.json"), "utf8"));
  const [ada, tobi, stranger, gus, gia] = await ethers.getSigners();
  const factory = await ethers.getContractAt("LatchkeyFactory", dep.factory, ada);
  const est = async (c, fn, args = [], opts = {}) => {
    const gas = await c[fn].estimateGas(...args, opts);
    const rc = await (await c[fn](...args, { ...opts, gasLimit: gas })).wait();
    const failed = rc.logs.some((l) => { try { return c.interface.parseLog(l)?.name === "HeraldFailed"; } catch { return false; } });
    console.log(`  ${fn}: gas ${rc.gasUsed}${failed ? "  !! HeraldFailed" : ""}`);
    return rc;
  };
  const skip = async (s) => { await network.provider.send("evm_increaseTime", [s]); await network.provider.send("evm_mine", []); };

  const heirInbox = "0x7af0647557909b07E0D92C4a8F63396120F8BDB3"; // 15.2.272.tape
  await est(factory, "createVault", [tobi.address, 180, 60, [gus.address, gia.address, ethers.ZeroAddress], ethers.ZeroAddress, heirInbox], { value: ethers.parseEther("0.501") });
  const vault = await ethers.getContractAt("LatchkeyVault", (await factory.vaultsOf(ada.address)).at(-1));
  const vaddr = await vault.getAddress();
  if (dep.token) await (await (await ethers.getContractAt("MockERC20", dep.token, ada)).transfer(vaddr, 1250n * 10n ** 6n)).wait();
  console.log(`vault ${vaddr}`);
  if (process.env.STOP === "open") return;

  await est(vault, "checkIn");
  await skip(181);
  await est(vault.connect(stranger), "poke"); // grace period starts -> TapeSend to Latchkey's feed
  if (process.env.STOP === "grace") return;
  await est(vault.connect(gus), "confirm");
  await est(vault.connect(gia), "confirm");
  await est(vault.connect(stranger), "poke"); // trips -> TapeSend to the heir's inbox
  console.log(`state ${await vault.state()} (3 = tripped)`);
  console.log(`open http://localhost:5173/#/v/${vaddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
