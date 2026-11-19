// End-to-end journey against the REAL TapeOut processor on an X Layer mainnet fork.
// Run: FORK=1 npx hardhat test test/fork.test.js
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const latch = require("../../circuit/build/latch.json");

const PROCESSOR = "0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355"; // OrderGuard
const PROC_ABI = [
  "function TAPEOUT_FEE() view returns (uint256)",
  "function transistors() view returns (address)",
  "function tapeout(bytes nl, uint32 nIn, uint32 nOut) payable returns (uint256)",
  "function nextId() view returns (uint256)",
  "function circuitInfo(uint256) view returns (uint32,uint32,uint32,uint32)",
  "function netlist(uint256) view returns (bytes)",
  "function step(uint256 id, bytes state, bytes inputs) view returns (bytes, bytes)",
  "function ownerOf(uint256) view returns (address)",
  "event TapedOut(uint256 indexed circuitId, address indexed author, uint32 gateCount, uint32 nState)",
];
const T_ABI = [
  "function mint(uint256 id, uint256 amount) payable",
  "function mintPrice() view returns (uint256)",
  "function protocolFee() view returns (uint256)",
];

const describeFork = process.env.FORK === "1" ? describe : describe.skip;

describeFork("Latchkey on an X Layer fork (real TapeOut processor)", function () {
  let proc, circuitId, factory, token, owner, heir, stranger, treasury;

  before(async function () {
    await network.provider.send("hardhat_mine", ["0x1"]); // EDR cannot execute at the fork block itself on chain 196
    [owner, heir, stranger, treasury] = await ethers.getSigners();
    proc = new ethers.Contract(PROCESSOR, PROC_ABI, owner);
    const t = new ethers.Contract(await proc.transistors(), T_ABI, owner);
    const price = await t.mintPrice();
    const pfee = await t.protocolFee();
    const tapeFee = await proc.TAPEOUT_FEE();

    const before = await ethers.provider.getBalance(owner.address);
    await (await t.mint(0, latch.nand, { value: price * BigInt(latch.nand) + pfee })).wait();
    await (await t.mint(1, latch.latch, { value: price * BigInt(latch.latch) + pfee })).wait();
    const rc = await (await proc.tapeout(latch.netlist, latch.nIn, latch.nOut, { value: tapeFee })).wait();
    const ev = rc.logs.map((l) => { try { return proc.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TapedOut");
    circuitId = ev.args.circuitId;
    const spent = before - (await ethers.provider.getBalance(owner.address));
    console.log(`      taped out circuit #${circuitId}, cost incl. gas ${ethers.formatEther(spent)} OKB`);

    const F = await ethers.getContractFactory("LatchkeyFactory");
    factory = await F.deploy(PROCESSOR, circuitId, treasury.address, ethers.parseEther("0.001"), 20);
    token = await (await ethers.getContractFactory("MockERC20")).deploy();
  });

  it("the circuit on chain is our netlist", async function () {
    expect(await proc.netlist(circuitId)).to.equal(latch.netlist);
    const [nIn, nOut, nState, gates] = await proc.circuitInfo(circuitId);
    expect([nIn, nOut, nState, gates].map(Number)).to.deep.equal([2, 1, 1, 5]);
    expect(await proc.ownerOf(circuitId)).to.equal(owner.address);
  });

  it("the real processor agrees with our truth table on every row", async function () {
    for (const r of latch.truthTable) {
      const [ns, out] = await proc.step(circuitId, ethers.toBeHex(r.q, 1), ethers.toBeHex(r.expired | (r.alive << 1), 1));
      expect(Number(ns)).to.equal(r.next, JSON.stringify(r));
      expect(Number(out)).to.equal(r.next, JSON.stringify(r));
    }
  });

  it("full journey: create, fund, check in, go quiet, trip, claim", async function () {
    const WINDOW = 90 * 24 * 3600;
    await expect(factory.createVault(heir.address, WINDOW, { value: ethers.parseEther("0.0005") })).to.be.revertedWithCustomError(
      factory,
      "SetupFee"
    );
    const tTreasury0 = await ethers.provider.getBalance(treasury.address);
    const tx = await factory.createVault(heir.address, WINDOW, { value: ethers.parseEther("0.051") });
    const rc = await tx.wait();
    const vaultAddr = (await factory.vaultsOf(owner.address))[0];
    const vault = await ethers.getContractAt("LatchkeyVault", vaultAddr);
    expect(await ethers.provider.getBalance(vaultAddr)).to.equal(ethers.parseEther("0.05"));
    expect((await ethers.provider.getBalance(treasury.address)) - tTreasury0).to.equal(ethers.parseEther("0.001"));
    console.log(`      createVault gas ${rc.gasUsed}`);

    await token.mint(vaultAddr, 1_000_000_000n); // 1,000 USDT

    // not yet: nobody can trip, the heir cannot claim
    await expect(vault.connect(stranger).trip()).to.be.revertedWithCustomError(vault, "NotYet");
    await expect(vault.connect(heir).claim([await token.getAddress()])).to.be.revertedWithCustomError(vault, "NotTripped");
    expect(await vault.canTrip()).to.equal(false);

    // check in after 80 days: window restarts
    await time.increase(80 * 24 * 3600);
    const ci = await (await vault.checkIn()).wait();
    console.log(`      checkIn gas ${ci.gasUsed}`);
    await time.increase(80 * 24 * 3600);
    await expect(vault.connect(stranger).trip()).to.be.revertedWithCustomError(vault, "NotYet");

    // owner even rescues it after the deadline, before anyone trips
    await time.increase(20 * 24 * 3600);
    expect(await vault.canTrip()).to.equal(true);
    await vault.checkIn();
    expect(await vault.latch()).to.equal(0);

    // then goes quiet for good
    await time.increase(WINDOW + 1);
    const tr = await (await vault.connect(stranger).trip()).wait();
    console.log(`      trip gas ${tr.gasUsed}`);
    expect(await vault.latch()).to.equal(1);
    const beatEvt = tr.logs.map((l) => vault.interface.parseLog(l)).find((e) => e && e.name === "Beat");
    expect(beatEvt.args.stateBefore).to.equal(0);
    expect(beatEvt.args.stateAfter).to.equal(1);

    // irreversible: owner can no longer act
    await expect(vault.checkIn()).to.be.revertedWithCustomError(vault, "IsTripped");
    await expect(vault.withdraw(ethers.ZeroAddress, 1, owner.address)).to.be.revertedWithCustomError(vault, "IsTripped");
    await expect(vault.connect(stranger).trip()).to.be.revertedWithCustomError(vault, "IsTripped");
    await expect(vault.connect(stranger).claim([ethers.ZeroAddress])).to.be.revertedWithCustomError(vault, "NotHeir");

    // heir claims USDT and OKB; 0.2% goes to the treasury
    const h0 = await ethers.provider.getBalance(heir.address);
    const cl = await (await vault.connect(heir).claim([await token.getAddress(), ethers.ZeroAddress])).wait();
    console.log(`      claim gas ${cl.gasUsed}`);
    expect(await token.balanceOf(heir.address)).to.equal(998_000_000n);
    expect(await token.balanceOf(treasury.address)).to.equal(2_000_000n);
    const gasCost = cl.gasUsed * cl.gasPrice;
    expect((await ethers.provider.getBalance(heir.address)) - h0 + gasCost).to.equal(ethers.parseEther("0.0499"));
    expect(await ethers.provider.getBalance(vaultAddr)).to.equal(0n);
  });

  it("owner keeps full control while open (withdraw, change heir, change window)", async function () {
    await factory.createVault(heir.address, 3600, { value: ethers.parseEther("0.011") });
    const vault = await ethers.getContractAt("LatchkeyVault", (await factory.vaultsOf(owner.address))[1]);
    await vault.setHeir(stranger.address);
    expect(await vault.heir()).to.equal(stranger.address);
    await expect(vault.setHeir(owner.address)).to.be.revertedWithCustomError(vault, "BadAddress");
    await vault.setWindow(7200);
    await expect(vault.setWindow(1)).to.be.revertedWithCustomError(vault, "BadWindow");
    await vault.withdraw(ethers.ZeroAddress, ethers.parseEther("0.01"), owner.address);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
    await expect(vault.connect(heir).checkIn()).to.be.revertedWithCustomError(vault, "NotOwner");
    expect(await vault.beats()).to.equal(3n);
  });

  it("a vault cannot be re-initialized and the factory refuses a wrong circuit", async function () {
    const vault = await ethers.getContractAt("LatchkeyVault", (await factory.vaultsOf(owner.address))[0]);
    await expect(
      vault.initialize(stranger.address, heir.address, 3600, PROCESSOR, circuitId, stranger.address, 0)
    ).to.be.revertedWithCustomError(vault, "AlreadyInitialized");
    const F = await ethers.getContractFactory("LatchkeyFactory");
    await expect(F.deploy(PROCESSOR, 15, treasury.address, 0, 20)).to.be.revertedWithCustomError(F, "BadCircuit"); // Daily Cap, combinational
    await expect(F.deploy(PROCESSOR, circuitId, treasury.address, 0, 101)).to.be.revertedWithCustomError(F, "FeeTooHigh");
  });
});
