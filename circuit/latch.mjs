// Latchkey latch circuit: TAP-02 netlist, reference evaluator and exhaustive check.
// Run: node circuit/latch.mjs   (writes circuit/build/latch.json)
//
// Pinout (bits packed LSB first, TAP-02 §5)
//   input 0  expired  the vault's inactivity window has passed (computed by the vault from block.timestamp)
//   input 1  alive    the owner is checking in during this beat
//   state 0  q        the latch (0 = open, 1 = tripped)
//   output 0 q'       the latch after this beat
//
// Logic: q' = q OR (expired AND NOT alive)
//   Once q is 1 it stays 1 forever: no input can clear it (irreversible).
//   A check-in that arrives before anyone trips the latch wins the race.
//
// Signals: 0 = const 0, 1 = const 1, 2 = expired, 3 = alive, then one per element:
//   4  LATCH d=8           q (previous beat)
//   5  NAND(3,3)           NOT alive
//   6  NAND(2,5)           NOT (expired AND NOT alive)
//   7  NAND(4,4)           NOT q
//   8  NAND(7,6)           q OR (expired AND NOT alive)  = q'   (output, and the LATCH's d)
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const u24 = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const NAND = (a, b) => [0x00, ...u24(a), ...u24(b)];
const LATCH = (d) => [0x01, ...u24(d)];

export const N_IN = 2;
export const N_OUT = 1;
export const NETLIST = Uint8Array.from([
  ...LATCH(8),
  ...NAND(3, 3),
  ...NAND(2, 5),
  ...NAND(4, 4),
  ...NAND(7, 6),
]);

/** Decode a NAND/LATCH-only netlist (TAP-02 §2), checking §3 rules 1, 3, 4, 5. */
export function decode(bytes, nIn, nOut) {
  const els = [];
  let i = 0;
  let sig = 2 + nIn;
  while (i < bytes.length) {
    const op = bytes[i];
    const rd = (k) => (bytes[k] << 16) | (bytes[k + 1] << 8) | bytes[k + 2];
    if (op === 0x00) {
      if (i + 7 > bytes.length) throw new Error('truncated');
      const a = rd(i + 1), b = rd(i + 4);
      if (a >= sig || b >= sig) throw new Error('NAND: future signal');
      els.push({ op: 'NAND', a, b, out: sig++ });
      i += 7;
    } else if (op === 0x01) {
      if (i + 4 > bytes.length) throw new Error('truncated');
      els.push({ op: 'LATCH', d: rd(i + 1), out: sig++ });
      i += 4;
    } else throw new Error('bad opcode');
  }
  for (const e of els) if (e.op === 'LATCH' && e.d >= sig) throw new Error('LATCH d out of range');
  if (2 + nIn + nOut > sig) throw new Error('too few signals for outputs');
  return { els, S: sig, nIn, nOut, nState: els.filter((e) => e.op === 'LATCH').length };
}

/** One beat (TAP-02 §4). state/inputs are bit arrays. */
export function beat(c, state, inputs) {
  const s = new Array(c.S).fill(0);
  s[1] = 1;
  inputs.forEach((v, k) => (s[2 + k] = v & 1));
  let li = 0;
  for (const e of c.els) s[e.out] = e.op === 'NAND' ? 1 - (s[e.a] & s[e.b]) : state[li++] & 1;
  const newState = c.els.filter((e) => e.op === 'LATCH').map((e) => s[e.d]);
  const outputs = s.slice(c.S - c.nOut);
  return { newState, outputs };
}

const spec = (q, expired, alive) => (q | (expired & (1 - alive))) & 1;

export function check() {
  const c = decode(NETLIST, N_IN, N_OUT);
  if (c.nState !== 1) throw new Error('expected one LATCH');
  const rows = [];
  for (let q = 0; q < 2; q++)
    for (let expired = 0; expired < 2; expired++)
      for (let alive = 0; alive < 2; alive++) {
        const r = beat(c, [q], [expired, alive]);
        const want = spec(q, expired, alive);
        if (r.newState[0] !== want || r.outputs[0] !== want) throw new Error(`mismatch q=${q} e=${expired} a=${alive}`);
        rows.push({ q, expired, alive, next: want });
      }
  // Irreversibility: from q=1, every input sequence keeps q=1.
  for (let k = 0; k < 4; k++) if (beat(c, [1], [k & 1, k >> 1]).newState[0] !== 1) throw new Error('latch cleared');
  return { c, rows };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { c, rows } = check();
  const hex = '0x' + Buffer.from(NETLIST).toString('hex');
  const out = {
    name: 'Latchkey latch',
    format: 'TAP-02',
    nIn: N_IN,
    nOut: N_OUT,
    nState: c.nState,
    nand: c.els.filter((e) => e.op === 'NAND').length,
    latch: c.nState,
    netlist: hex,
    sha256: '0x' + createHash('sha256').update(NETLIST).digest('hex'),
    pins: { inputs: ['expired', 'alive'], state: ['q'], outputs: ['q_next'] },
    truthTable: rows,
  };
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'build');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'latch.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(`ok: ${out.nand} NAND + ${out.latch} LATCH, ${NETLIST.length} bytes, all 8 (q, expired, alive) rows match, latch never clears`);
  console.log(hex);
}
