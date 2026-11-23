// The testnet stand-in for TapeOut (Tap02Processor) must behave exactly like TapeOut's processor.
//   npx hardhat test test/testnet.test.js            (offline: spec + full vault journey)
//   FORK=1 npx hardhat test test/testnet.test.js     (also: row-by-row against the real OrderGuard processor)
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 24 * 3600;
const hex = (b) => ethers.hexlify(b);

async function tapeOutOn(proc) {
  const { buildMaj3, buildLatch } = await import("../../circuit/latch.mjs");
  const id = async (tx) => {
    const rc = await (await tx).wait();
    return rc.logs.map((l) => { try { return proc.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "TapedOut").args.circuitId;
  };
  const majId = await id(proc.tapeout(hex(buildMaj3().netlist), 3, 1));
  const latch = buildLatch(await proc.getAddress(), majId);
  const latchId = await id(proc.tapeout(hex(latch.netlist), 6, 2));
  return { majId, latchId, latchNetlist: hex(latch.netlist) };
}

describe("Tap02Processor (testnet stand-in for TapeOut)", function () {
  let proc, ids, spec;
  before(async function () {
    if (process.env.FORK === "1") await network.provider.send("hardhat_mine", ["0x1"]);
    spec = (await import("../../circuit/latch.mjs")).latchSpec;
    proc = await (await ethers.getContractFactory("Tap02Processor")).deploy();
    ids = await tapeOutOn(proc);
  });

  it("stores the netlists and reports TapeOut-style circuit info (REF gates counted)", async function () {
    expect(await proc.netlist(ids.latchId)).to.equal(ids.latchNetlist);
    expect((await proc.circuitInfo(ids.majId)).map(Number)).to.deep.equal([3, 1, 0, 6]);
    expect((await proc.circuitInfo(ids.latchId)).map(Number)).to.deep.equal([6, 2, 2, 26]);
    await expect(proc.eval(ids.latchId, "0x00")).to.be.revertedWith("has latch: use step");
    expect(await proc.eval(ids.majId, "0x05")).to.equal("0x01"); // a=1, c=1
  });

  it("rejects ill-formed netlists like TapeOut does", async function () {
    await expect(proc.tapeout("0x03", 1, 1)).to.be.revertedWith("bad opcode");
    await expect(proc.tapeout("0x00000005000000", 1, 1)).to.be.revertedWith("NAND: future signal");
    await expect(proc.tapeout("0x00000002000002", 1, 0)).to.be.revertedWith("no outputs");
    await expect(proc.tapeout("0x000000", 1, 1)).to.be.revertedWith("truncated");
  });

  it("matches the specification on all 256 (state, input) rows", async function () {
    for (let st = 0; st < 4; st++)
      for (let v = 0; v < 64; v++) {
        const w = spec(st & 1, st >> 1, ...[0, 1, 2, 3, 4, 5].map((k) => (v >> k) & 1));
        const [ns, out] = await proc.step(ids.latchId, ethers.toBeHex(st, 1), ethers.toBeHex(v, 1));
        expect(Number(ns)).to.equal(w[0] | (w[1] << 1), `state ${st} inputs ${v}`);
        expect(Number(out)).to.equal(w[0] | (w[1] << 1));
      }
  });

  it("runs the unchanged Latchkey vault end to end (no herald on testnet)", async function () {
    const [owner, heir, stranger, g1, g2] = await ethers.getSigners();
    const factory = await (await ethers.getContractFactory("LatchkeyFactory")).deploy(await proc.getAddress(), ids.latchId, ethers.ZeroAddress, owner.address, 0, 20);
    const usd = await (await ethers.getContractFactory("TestUSD")).deploy();
    await usd.connect(owner).faucet();
    await expect(usd.connect(owner).faucet()).to.be.revertedWithCustomError(usd, "TooSoon");
    await factory.createVault(heir.address, 3600, 600, [g1.address, g2.address, ethers.ZeroAddress], ethers.ZeroAddress, ethers.ZeroAddress, { value: ethers.parseEther("0.01") });
    const vault = await ethers.getContractAt("LatchkeyVault", (await factory.vaultsOf(owner.address))[0]);
    await usd.transfer(await vault.getAddress(), 500n * 10n ** 6n);
    await vault.checkIn();
    await time.increase(3601);
    await vault.connect(stranger).poke({ gasLimit: await vault.connect(stranger).poke.estimateGas() });
    expect(await vault.state()).to.equal(1);
    await vault.connect(g1).confirm();
    await vault.connect(g2).confirm();
    await vault.connect(stranger).poke();
    expect(await vault.state()).to.equal(3);
    await vault.connect(heir).claim([await usd.getAddress(), ethers.ZeroAddress]);
    expect(await usd.balanceOf(heir.address)).to.equal(499n * 10n ** 6n);
    await time.increase(10 * DAY);
  });

  (process.env.FORK === "1" ? it : it.skip)("gives the same answer as TapeOut's real processor on every row (X Layer fork)", async function () {
    const { tapeOutLatchkey } = require("../scripts/lib/tapeout");
    const [owner] = await ethers.getSigners();
    const real = await tapeOutLatchkey(owner, { open: false });
    for (let st = 0; st < 4; st++)
      for (let v = 0; v < 64; v++) {
        const a = await real.proc.step(real.latchId, ethers.toBeHex(st, 1), ethers.toBeHex(v, 1));
        const b = await proc.step(ids.latchId, ethers.toBeHex(st, 1), ethers.toBeHex(v, 1));
        expect([b[0], b[1]]).to.deep.equal([a[0], a[1]], `state ${st} inputs ${v}`);
      }
    // packing edge cases (TAP-02 §5): padding bits and extra bytes are ignored
    for (const ins of ["0x", "0xff", "0x3f00", "0xc1"]) {
      expect(await proc.step(ids.latchId, "0x01", ins)).to.deep.equal(await real.proc.step(real.latchId, "0x01", ins));
    }
  });
});
