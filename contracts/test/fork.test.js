// End-to-end against the REAL TapeOut contracts on an X Layer mainnet fork:
// processor (tape-out, REF, step), container Opener, TapeSend hub, SiteRegistry.
// Run: FORK=1 npx hardhat test test/fork.test.js
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { tapeOutLatchkey, PROCESSOR, HUB, SITES } = require("../scripts/lib/tapeout");

const describeFork = process.env.FORK === "1" ? describe : describe.skip;
const DAY = 24 * 3600;
const HUB_ABI = [
  "function inboxCount(bytes32) view returns (uint256)",
  "function outboxCount(address) view returns (uint256)",
  "event Sent(bytes32 indexed to, address indexed from, bytes32 indexed ref, uint256 inboxIndex, uint256 outboxIndex, bytes payload)",
];
const endpoint = (c) => ethers.zeroPadValue(ethers.toBeHex((196n << 160n) | BigInt(c)), 32);

function sentMessages(rc, hub) {
  return rc.logs
    .filter((l) => l.address.toLowerCase() === HUB.toLowerCase())
    .map((l) => hub.interface.parseLog(l))
    .map((e) => {
      const p = ethers.getBytes(e.args.payload);
      expect(ethers.hexlify(p.slice(0, 4))).to.equal("0x54530200"); // "TS", v2, public
      return { to: e.args.to, from: e.args.from, content: JSON.parse(ethers.toUtf8String(p.slice(4))) };
    });
}

describeFork("Latchkey v2 on an X Layer fork (real TapeOut processor, Opener, TapeSend hub)", function () {
  let dep, proc, factory, herald, token, hub;
  let owner, heir, stranger, treasury, g1, g2, g3, operator;

  before(async function () {
    await network.provider.send("hardhat_mine", ["0x1"]); // EDR cannot execute at the fork block itself on chain 196
    [owner, heir, stranger, treasury, g1, g2, g3, operator] = await ethers.getSigners();
    dep = await tapeOutLatchkey(owner, { log: (m) => console.log("      " + m) });
    proc = dep.proc;
    hub = new ethers.Contract(HUB, HUB_ABI, owner);

    const H = await ethers.getContractFactory("LatchkeyHerald");
    herald = await H.deploy(HUB, PROCESSOR, dep.latchId, dep.container, SITES, `${dep.latchId}.2.272.tape`, owner.address);
    await (await proc["safeTransferFrom(address,address,uint256)"](owner.address, await herald.getAddress(), dep.latchId)).wait();
    const F = await ethers.getContractFactory("LatchkeyFactory");
    factory = await F.deploy(PROCESSOR, dep.latchId, await herald.getAddress(), treasury.address, ethers.parseEther("0.001"), 20);
    await herald.setFactory(await factory.getAddress());
    token = await (await ethers.getContractFactory("MockERC20")).deploy();
  });

  async function newVault(opts = {}) {
    const g = opts.guardians ?? [g1.address, g2.address, g3.address];
    await factory.createVault(heir.address, opts.window ?? 90 * DAY, opts.grace ?? 7 * DAY, g, opts.ownerInbox ?? ethers.ZeroAddress, opts.heirInbox ?? ethers.ZeroAddress, {
      value: opts.value ?? ethers.parseEther("0.051"),
    });
    return ethers.getContractAt("LatchkeyVault", (await factory.vaultsOf(owner.address)).at(-1));
  }

  it("both circuits are on chain as built, and the latch REFs MAJ3", async function () {
    expect(await proc.netlist(dep.majId)).to.equal(dep.majNetlist);
    expect(await proc.netlist(dep.latchId)).to.equal(dep.latchNetlist);
    expect((await proc.circuitInfo(dep.majId)).map(Number)).to.deep.equal([3, 1, 0, 6]);
    const [nIn, nOut, nState, gates] = (await proc.circuitInfo(dep.latchId)).map(Number);
    expect([nIn, nOut, nState]).to.deep.equal([6, 2, 2]);
    expect(gates).to.equal(dep.latchGates); // own gates + the REF'd MAJ3 gates
    expect(await herald.ready()).to.equal(true);
  });

  it("the real processor agrees with the specification on all 256 (state, input) rows", async function () {
    const { latchSpec } = await import("../../circuit/latch.mjs");
    for (let st = 0; st < 4; st++)
      for (let v = 0; v < 64; v++) {
        const ins = [0, 1, 2, 3, 4, 5].map((k) => (v >> k) & 1);
        const want = latchSpec(st & 1, st >> 1, ...ins);
        const wantByte = want[0] | (want[1] << 1);
        const [ns, out] = await proc.step(dep.latchId, ethers.toBeHex(st, 1), ethers.toBeHex(v, 1));
        expect(Number(ns)).to.equal(wantByte, `state ${st} inputs ${v}`);
        expect(Number(out)).to.equal(wantByte, `state ${st} inputs ${v}`);
      }
  });

  it("journey: grace period, owner rescue, guardians end grace early, TapeSend notices, heir claims", async function () {
    const heirInbox = "0x7af0647557909b07E0D92C4a8F63396120F8BDB3"; // any opened container works as an inbox
    const vault = await newVault({ heirInbox });
    const vaddr = await vault.getAddress();
    await token.mint(vaddr, 1_000_000_000n);
    expect(await ethers.provider.getBalance(vaddr)).to.equal(ethers.parseEther("0.05"));

    await expect(vault.connect(stranger).poke()).to.be.revertedWithCustomError(vault, "NothingToDo");
    await expect(vault.connect(g1).confirm()).to.be.revertedWithCustomError(vault, "NoGracePeriod");

    // silence past the window: anyone starts the grace period, the herald tells Latchkey's own inbox (no owner inbox)
    await time.increase(90 * DAY + 1);
    const feed0 = await hub.inboxCount(endpoint(dep.container));
    let rc = await (await vault.connect(stranger).poke()).wait();
    expect(await vault.state()).to.equal(1);
    let msgs = sentMessages(rc, hub);
    expect(msgs.length).to.equal(1);
    expect(msgs[0].from).to.equal(dep.container);
    expect(msgs[0].to).to.equal(endpoint(dep.container));
    expect(msgs[0].content.subject).to.match(/check in/);
    expect(msgs[0].content.body).to.contain(vaddr.toLowerCase());
    expect(await hub.inboxCount(endpoint(dep.container))).to.equal(feed0 + 1n);
    console.log(`      poke (grace) gas ${rc.gasUsed}: "${msgs[0].content.subject}"`);

    // the owner was only away: a check-in cancels the grace period
    rc = await (await vault.checkIn()).wait();
    console.log(`      checkIn gas ${rc.gasUsed}`);
    expect(await vault.state()).to.equal(0);
    expect(await vault.warnedAt()).to.equal(0);

    // gone for real: grace again; one guardian is not enough, two are
    await time.increase(90 * DAY + 1);
    await vault.connect(stranger).poke();
    await expect(vault.connect(stranger).poke()).to.be.revertedWithCustomError(vault, "NothingToDo");
    await expect(vault.connect(stranger).confirm()).to.be.revertedWithCustomError(vault, "NotGuardian");
    await vault.connect(g1).confirm();
    await expect(vault.connect(stranger).poke()).to.be.revertedWithCustomError(vault, "NothingToDo");
    await vault.connect(g3).confirm();
    const heirFeed0 = await hub.inboxCount(endpoint(heirInbox));
    rc = await (await vault.connect(stranger).poke()).wait();
    console.log(`      poke (trip) gas ${rc.gasUsed}`);
    expect(await vault.state()).to.equal(3);
    msgs = sentMessages(rc, hub);
    expect(msgs[0].to).to.equal(endpoint(heirInbox));
    expect(msgs[0].content.subject).to.match(/opened for you/);
    expect(msgs[0].content.body).to.contain(heir.address.toLowerCase());
    expect(msgs[0].content.body).to.contain(`tape://${dep.latchId}.2.272.tape/#/v/${vaddr.toLowerCase()}`);
    expect(await hub.inboxCount(endpoint(heirInbox))).to.equal(heirFeed0 + 1n);

    // irreversible
    await expect(vault.checkIn()).to.be.revertedWithCustomError(vault, "IsTripped");
    await expect(vault.withdraw(ethers.ZeroAddress, 1, owner.address)).to.be.revertedWithCustomError(vault, "IsTripped");
    await expect(vault.connect(stranger).poke()).to.be.revertedWithCustomError(vault, "IsTripped");
    await expect(vault.connect(stranger).claim([ethers.ZeroAddress])).to.be.revertedWithCustomError(vault, "NotHeir");

    const h0 = await ethers.provider.getBalance(heir.address);
    rc = await (await vault.connect(heir).claim([await token.getAddress(), ethers.ZeroAddress])).wait();
    expect(await token.balanceOf(heir.address)).to.equal(998_000_000n);
    expect(await token.balanceOf(treasury.address)).to.equal(2_000_000n);
    expect((await ethers.provider.getBalance(heir.address)) - h0 + rc.gasUsed * rc.gasPrice).to.equal(ethers.parseEther("0.0499"));

    const h = await vault.history(0, 20);
    expect(h.map((r) => Number(r.stateAfter))).to.deep.equal([1, 0, 1, 3]);
    expect(Number(h[3].inputs) >> 3).to.equal(0b101); // guardians 1 and 3
  });

  it("without guardians the latch trips when the grace period runs out", async function () {
    const vault = await newVault({ guardians: [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress], window: 3600, grace: 600 });
    await time.increase(3601);
    await vault.connect(stranger).poke();
    await time.increase(300);
    await expect(vault.connect(stranger).poke()).to.be.revertedWithCustomError(vault, "NothingToDo");
    await time.increase(301);
    await vault.connect(stranger).poke();
    expect(await vault.state()).to.equal(3);
  });

  it("owner keeps full control while open; settings are validated", async function () {
    const vault = await newVault({ window: 3600, grace: 600, value: ethers.parseEther("0.011") });
    await vault.setHeir(stranger.address, ethers.ZeroAddress);
    expect(await vault.heir()).to.equal(stranger.address);
    await expect(vault.setHeir(owner.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(vault, "BadAddress");
    await vault.setTimes(7200, 1200);
    await expect(vault.setTimes(1, 1200)).to.be.revertedWithCustomError(vault, "BadWindow");
    await expect(vault.setGuardians([g1.address, g1.address, ethers.ZeroAddress])).to.be.revertedWithCustomError(vault, "BadAddress");
    await expect(vault.setGuardians([stranger.address, ethers.ZeroAddress, ethers.ZeroAddress])).to.be.revertedWithCustomError(vault, "BadAddress");
    await vault.setGuardians([g2.address, ethers.ZeroAddress, ethers.ZeroAddress]);
    await vault.withdraw(ethers.ZeroAddress, ethers.parseEther("0.01"), owner.address);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
    await expect(vault.connect(heir).checkIn()).to.be.revertedWithCustomError(vault, "NotOwner");
    expect(await vault.beats()).to.equal(4n);
    expect((await factory.vaultsForGuardian(g2.address)).length).to.be.greaterThan(0);
  });

  it("herald: only vaults can make it speak; admin can only name a site operator, once-only factory", async function () {
    await expect(herald.connect(stranger).tripped(heir.address, ethers.ZeroAddress)).to.be.revertedWithCustomError(herald, "NotVault");
    await expect(herald.setFactory(stranger.address)).to.be.revertedWithCustomError(herald, "FactorySet");
    await expect(herald.connect(stranger).setSiteOperator(stranger.address, 3600)).to.be.revertedWithCustomError(herald, "NotAdmin");
    await herald.setSiteOperator(operator.address, 3600); // the herald is the holder, so SiteRegistry accepts it
    const sites = new ethers.Contract(SITES, ["function putFile(address,string,string,bytes32,bytes)"], operator);
    const body = ethers.toUtf8Bytes("<!doctype html><title>t</title>ok");
    await sites.putFile(dep.container, "probe.html", "text/html; charset=utf-8", ethers.sha256(body), body);
  });

  it("a vault cannot be re-initialized and the factory refuses a wrong circuit", async function () {
    const vault = await ethers.getContractAt("LatchkeyVault", (await factory.vaultsOf(owner.address))[0]);
    const cfg = [stranger.address, heir.address, 3600, 600, [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress], ethers.ZeroAddress, ethers.ZeroAddress];
    await expect(vault.initialize(cfg, PROCESSOR, dep.latchId, stranger.address, 0, ethers.ZeroAddress)).to.be.revertedWithCustomError(vault, "AlreadyInitialized");
    const F = await ethers.getContractFactory("LatchkeyFactory");
    await expect(F.deploy(PROCESSOR, dep.majId, ethers.ZeroAddress, treasury.address, 0, 20)).to.be.revertedWithCustomError(F, "BadCircuit");
    await expect(F.deploy(PROCESSOR, dep.latchId, ethers.ZeroAddress, treasury.address, 0, 101)).to.be.revertedWithCustomError(F, "FeeTooHigh");
  });

  it("safety valve: a dead processor never locks out the owner or the heir (runs last: it breaks the processor)", async function () {
    const vault = await newVault({ window: 3600, grace: 600, value: ethers.parseEther("0.021") });
    await time.increase(3601);
    await expect(vault.connect(stranger).tripWithoutCircuit()).to.be.revertedWithCustomError(vault, "CircuitWorks");
    await network.provider.send("hardhat_setCode", [PROCESSOR, "0x60006000fd"]); // every call reverts
    await expect(vault.checkIn()).to.be.revertedWithCustomError(vault, "CircuitFailed");
    await expect(vault.connect(stranger).poke()).to.be.revertedWithCustomError(vault, "CircuitFailed");
    await vault.withdraw(ethers.ZeroAddress, ethers.parseEther("0.01"), owner.address);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(ethers.parseEther("0.01"));
    await time.increase(3600 + 600 + 29 * DAY);
    await expect(vault.connect(stranger).tripWithoutCircuit()).to.be.revertedWithCustomError(vault, "NothingToDo");
    await time.increase(2 * DAY);
    await expect(vault.connect(stranger).tripWithoutCircuit()).to.emit(vault, "CircuitUnavailable");
    await vault.connect(heir).claim([ethers.ZeroAddress]);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
  });
});
