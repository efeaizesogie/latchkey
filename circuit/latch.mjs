// Latchkey circuits: TAP-02 netlists, a TAP-02 evaluator (NAND, LATCH, REF) and exhaustive checks.
// Run: node circuit/latch.mjs   (writes circuit/build/latch.json)
//
// Two circuits are taped out on the same processor:
//
//  MAJ3 (6 NAND, combinational): 2 of 3 guardians agree.        inputs a, b, c -> out maj(a, b, c)
//
//  LATCH v2 (2 LATCH + 1 REF to MAJ3 + NANDs): the vault's state machine.
//    inputs  0 expired     the owner's silence window has passed          (vault computes from the clock)
//            1 alive       the owner is checking in during this beat
//            2 graceOver   the grace period after the warning has passed   (vault computes from the clock)
//            3..5 g0 g1 g2 guardian confirmations
//    state   0 warn        grace period running
//            1 q           tripped (irreversible)
//    outputs 0 warn', 1 q'  (equal to the new state, so the vault can cross-check them)
//
//    warn' = NOT q AND NOT alive AND (warn OR expired)
//    q'    = q OR (NOT alive AND warn AND (graceOver OR MAJ3(g0, g1, g2)))
//
//  So: silence past the window starts a grace period (anyone can poke it); a check-in at any time before the trip
//  cancels it; the latch trips when the grace period runs out, or earlier if 2 of 3 guardians confirm.
//  Guardians cannot do anything before the owner has been silent for the whole window (warn must already be 1),
//  and once q is 1 nothing can clear it.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ a tiny netlist builder

const u24 = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const u64 = (n) => { const b = []; let x = BigInt(n); for (let i = 0; i < 8; i++) { b.unshift(Number(x & 255n)); x >>= 8n; } return b; };

class Netlist {
  constructor(nIn) { this.nIn = nIn; this.bytes = []; this.next = 2 + nIn; this.patches = []; }
  input(i) { return 2 + i; }
  nand(a, b) { this.bytes.push(0x00, ...u24(a), ...u24(b)); return this.next++; }
  not(a) { return this.nand(a, a); }
  and(a, b) { return this.not(this.nand(a, b)); }
  or(a, b) { return this.nand(this.not(a), this.not(b)); }
  /** A LATCH whose d is wired later (feedback). Returns its output signal and a setter for d. */
  latch() {
    const at = this.bytes.length;
    this.bytes.push(0x01, 0, 0, 0);
    const sig = this.next++;
    return { q: sig, wire: (d) => { this.bytes.splice(at + 1, 3, ...u24(d)); } };
  }
  /** REF record (TAP-02 §2): one beat of circuit (cpu, id) with the given input signals. Returns its output signals. */
  ref(cpu, id, ins, nOuts) {
    const addr = cpu.toLowerCase().replace(/^0x/, '').match(/../g).map((h) => parseInt(h, 16));
    this.bytes.push(0x02, ...addr, ...u64(id), ins.length, nOuts, ...ins.flatMap(u24));
    const outs = [];
    for (let i = 0; i < nOuts; i++) outs.push(this.next++);
    return outs;
  }
  build() { return Uint8Array.from(this.bytes); }
}

// ------------------------------------------------------------------ TAP-02 decoder + evaluator (with REF)

export function decode(bytes, nIn, nOut, resolve) {
  const els = [];
  let i = 0, sig = 2 + nIn, nState = 0;
  const rd24 = (k) => (bytes[k] << 16) | (bytes[k + 1] << 8) | bytes[k + 2];
  while (i < bytes.length) {
    const op = bytes[i];
    if (op === 0x00) {
      if (i + 7 > bytes.length) throw new Error('truncated');
      const a = rd24(i + 1), b = rd24(i + 4);
      if (a >= sig || b >= sig) throw new Error('NAND: future signal');
      els.push({ op: 'NAND', a, b, out: sig++ });
      i += 7;
    } else if (op === 0x01) {
      if (i + 4 > bytes.length) throw new Error('truncated');
      els.push({ op: 'LATCH', d: rd24(i + 1), out: sig++, stateAt: nState++ });
      i += 4;
    } else if (op === 0x02) {
      if (i + 31 > bytes.length) throw new Error('truncated');
      const cpu = '0x' + Buffer.from(bytes.slice(i + 1, i + 21)).toString('hex');
      let id = 0n;
      for (let k = 21; k < 29; k++) id = (id << 8n) | BigInt(bytes[i + k]);
      const nIns = bytes[i + 29], nOuts = bytes[i + 30];
      if (i + 31 + 3 * nIns > bytes.length) throw new Error('truncated');
      const ins = [];
      for (let k = 0; k < nIns; k++) { const s = rd24(i + 31 + 3 * k); if (s >= sig) throw new Error('REF: future signal'); ins.push(s); }
      const sub = resolve(cpu, id);
      if (sub.nIn !== nIns || sub.nOut !== nOuts) throw new Error('REF: pin mismatch');
      const outs = [];
      for (let k = 0; k < nOuts; k++) outs.push(sig++);
      els.push({ op: 'REF', cpu, id, ins, outs, sub, stateAt: nState });
      nState += sub.nState;
      i += 31 + 3 * nIns;
    } else throw new Error('bad opcode');
  }
  for (const e of els) if (e.op === 'LATCH' && e.d >= sig) throw new Error('LATCH d out of range');
  if (2 + nIn + nOut > sig) throw new Error('too few signals for outputs');
  return { els, S: sig, nIn, nOut, nState };
}

/** One beat (TAP-02 §4). state/inputs are bit arrays. */
export function beat(c, state, inputs) {
  const s = new Array(c.S).fill(0);
  s[1] = 1;
  inputs.forEach((v, k) => (s[2 + k] = v & 1));
  const newState = new Array(c.nState).fill(0);
  for (const e of c.els) {
    if (e.op === 'NAND') s[e.out] = 1 - (s[e.a] & s[e.b]);
    else if (e.op === 'LATCH') s[e.out] = state[e.stateAt] & 1;
    else {
      const r = beat(e.sub, state.slice(e.stateAt, e.stateAt + e.sub.nState), e.ins.map((k) => s[k]));
      e.outs.forEach((o, k) => (s[o] = r.outputs[k]));
      r.newState.forEach((v, k) => (newState[e.stateAt + k] = v));
    }
  }
  for (const e of c.els) if (e.op === 'LATCH') newState[e.stateAt] = s[e.d];
  return { newState, outputs: s.slice(c.S - c.nOut) };
}

export const pack = (bits) => {
  const out = new Uint8Array(Math.ceil(bits.length / 8) || 1);
  bits.forEach((b, i) => { if (b) out[i >> 3] |= 1 << (i & 7); });
  return out;
};

// ------------------------------------------------------------------ the two circuits

export function buildMaj3() {
  const n = new Netlist(3);
  const [a, b, c] = [n.input(0), n.input(1), n.input(2)];
  const n1 = n.nand(a, b), n2 = n.nand(a, c), n3 = n.nand(b, c);
  const t = n.nand(n1, n2); // ~(n1 & n2)
  const x = n.not(t); // n1 & n2
  n.nand(x, n3); // ~(n1 & n2 & n3) = maj
  return { nIn: 3, nOut: 1, netlist: n.build() };
}

/** The latch REFs MAJ3 at (cpu, majId), so its bytes depend on where MAJ3 was taped out. */
export function buildLatch(cpu, majId) {
  const n = new Netlist(6);
  const [expired, alive, graceOver, g0, g1, g2] = [0, 1, 2, 3, 4, 5].map((i) => n.input(i));
  const warn = n.latch();
  const q = n.latch();
  const [maj] = n.ref(cpu, majId, [g0, g1, g2], 1);
  const nAlive = n.not(alive);
  const nQ = n.not(q.q);
  // warn' = nQ & nAlive & (warn | expired)
  const wOrE = n.or(warn.q, expired);
  const warnNext = n.and(n.and(nQ, nAlive), wOrE);
  // q' = q | (nAlive & warn & (graceOver | maj))  ==  NAND(nQ, NAND(nAlive & warn, graceOver | maj))
  const gOrM = n.or(graceOver, maj);
  const x = n.nand(n.and(nAlive, warn.q), gOrM);
  // outputs must be the last two signals, in order (warn', q'): buffer warn' then compute q' last
  const warnOut = n.not(n.not(warnNext));
  const qOut = n.nand(nQ, x);
  warn.wire(warnOut);
  q.wire(qOut);
  return { nIn: 6, nOut: 2, netlist: n.build() };
}

const majSpec = (a, b, c) => (a & b) | (a & c) | (b & c);
export function latchSpec(warn, q, expired, alive, graceOver, g0, g1, g2) {
  const nA = 1 - alive;
  const warnNext = (1 - q) & nA & (warn | expired);
  const qNext = q | (nA & warn & (graceOver | majSpec(g0, g1, g2)));
  return [warnNext, qNext];
}

/** Exhaustive check of both circuits: every state and input (2^2 * 2^6 = 256 rows for the latch). */
export function check(cpu = '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355', majId = 1n) {
  const maj = buildMaj3();
  const majC = decode(maj.netlist, 3, 1, () => { throw new Error('MAJ3 has no REF'); });
  for (let v = 0; v < 8; v++) {
    const ins = [v & 1, (v >> 1) & 1, (v >> 2) & 1];
    if (beat(majC, [], ins).outputs[0] !== majSpec(...ins)) throw new Error(`MAJ3 mismatch ${ins}`);
  }
  const latch = buildLatch(cpu, majId);
  const c = decode(latch.netlist, 6, 2, (rc, rid) => {
    if (rc.toLowerCase() !== cpu.toLowerCase() || rid !== BigInt(majId)) throw new Error('REF to an unknown circuit');
    return majC;
  });
  if (c.nState !== 2) throw new Error('expected two LATCH bits');
  const rows = [];
  for (let st = 0; st < 4; st++)
    for (let v = 0; v < 64; v++) {
      const [warn, q] = [st & 1, st >> 1];
      const ins = [0, 1, 2, 3, 4, 5].map((k) => (v >> k) & 1);
      const r = beat(c, [warn, q], ins);
      const want = latchSpec(warn, q, ...ins);
      if (r.newState.join() !== want.join() || r.outputs.join() !== want.join()) throw new Error(`latch mismatch state ${st} inputs ${ins}`);
      if (q === 1 && r.newState[1] !== 1) throw new Error('latch cleared');
      if (warn === 0 && q === 0 && want[1] === 1) throw new Error('tripped without a grace period');
      rows.push({ warn, q, inputs: ins, next: want });
    }
  const nand = c.els.filter((e) => e.op === 'NAND').length;
  return { maj, majNand: majC.els.length, latch, c, nand, rows };
}

const hex = (b) => '0x' + Buffer.from(b).toString('hex');
const sha = (b) => '0x' + createHash('sha256').update(b).digest('hex');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cpu = process.env.CPU ?? '0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355';
  const majId = BigInt(process.env.MAJ_ID ?? 1);
  const { maj, majNand, latch, nand, rows } = check(cpu, majId);
  const out = {
    format: 'TAP-02',
    processor: cpu,
    maj3: { nIn: 3, nOut: 1, nState: 0, nand: majNand, latch: 0, netlist: hex(maj.netlist), sha256: sha(maj.netlist) },
    latch: {
      note: `REFs MAJ3 at (${cpu}, #${majId}); rebuilt with the real MAJ3 id at deploy time`,
      nIn: 6, nOut: 2, nState: 2, nand, latch: 2, ref: 1, gates: nand + 2 + majNand,
      netlist: hex(latch.netlist), sha256: sha(latch.netlist),
      pins: { inputs: ['expired', 'alive', 'graceOver', 'g0', 'g1', 'g2'], state: ['warn', 'q'], outputs: ['warn_next', 'q_next'] },
      equations: ["warn' = NOT q AND NOT alive AND (warn OR expired)", "q' = q OR (NOT alive AND warn AND (graceOver OR MAJ3(g0,g1,g2)))"],
    },
    rowsChecked: rows.length,
  };
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'build');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'latch.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`MAJ3: ${majNand} NAND, all 8 rows ok`);
  console.log(`LATCH v2: ${nand} NAND + 2 LATCH + REF(MAJ3), ${latch.netlist.length} bytes, all ${rows.length} (state, input) rows ok; q never clears; never trips without a grace period`);
}
