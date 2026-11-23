import { useEffect, useState } from 'preact/hooks';
import { createPublicClient, http, type Hex } from 'viem';
import { net, dep, circuitId, explorerAddr, hasHerald, isTestnet } from '../lib/config';
import { chain, short } from '../lib/chain';
import { processorAbi } from '../lib/abi';
import { circuitInfo, heraldNotices } from '../lib/vault';
import { Bit } from '../ui';

// Same equations as circuit/latch.mjs
const maj = (a: number, b: number, c: number) => (a & b) | (a & c) | (b & c);
function spec(warn: number, q: number, ins: number[]) {
  const [expired, alive, graceOver, g0, g1, g2] = ins;
  const nA = 1 - alive;
  return [(1 - q) & nA & (warn | expired), q | (nA & warn & (graceOver | maj(g0, g1, g2)))];
}
const bitsOf = (v: number) => [0, 1, 2, 3, 4, 5].map((k) => (v >> k) & 1);

const KEY_ROWS: { label: string; st: number; ins: number[] }[] = [
  { label: 'Owner checks in', st: 0, ins: [0, 1, 0, 0, 0, 0] },
  { label: 'Window not over: nothing happens', st: 0, ins: [0, 0, 0, 0, 0, 0] },
  { label: 'Window over: grace period starts', st: 0, ins: [1, 0, 0, 0, 0, 0] },
  { label: 'Guardians cannot act before that', st: 0, ins: [1, 0, 0, 1, 1, 1] },
  { label: 'Check-in during grace: cancelled', st: 1, ins: [1, 1, 1, 1, 1, 0] },
  { label: 'Grace running, one guardian', st: 1, ins: [1, 0, 0, 1, 0, 0] },
  { label: 'Two guardians: trips early', st: 1, ins: [1, 0, 0, 1, 0, 1] },
  { label: 'Grace over: trips', st: 1, ins: [1, 0, 1, 0, 0, 0] },
  { label: 'Tripped stays tripped, even on a check-in', st: 3, ins: [0, 1, 0, 0, 0, 0] },
];

function decode(hex: string) {
  const b = hex.slice(2).match(/../g)!.map((x) => parseInt(x, 16));
  const out: string[] = [];
  let i = 0, sig = 8; // 2 constants + 6 inputs
  const rd = (k: number) => (b[k] << 16) | (b[k + 1] << 8) | b[k + 2];
  while (i < b.length) {
    if (b[i] === 0) { out.push(`s${sig++} = NAND(s${rd(i + 1)}, s${rd(i + 4)})`); i += 7; }
    else if (b[i] === 1) { out.push(`s${sig++} = LATCH(d = s${rd(i + 1)})`); i += 4; }
    else if (b[i] === 2) {
      const cpu = '0x' + b.slice(i + 1, i + 21).map((x) => x.toString(16).padStart(2, '0')).join('');
      let id = 0n;
      for (let k = 21; k < 29; k++) id = (id << 8n) | BigInt(b[i + k]);
      const nIns = b[i + 29], nOuts = b[i + 30];
      const ins = Array.from({ length: nIns }, (_, k) => `s${rd(i + 31 + 3 * k)}`);
      const outs = Array.from({ length: nOuts }, () => `s${sig++}`);
      out.push(`${outs.join(', ')} = REF(${short(cpu)} #${id})(${ins.join(', ')})`);
      i += 31 + 3 * nIns;
    } else break;
  }
  return out;
}

function Diagram() {
  // Block view of the latch: what feeds the two state bits.
  return (
    <svg class="gates big-labels" viewBox="0 0 600 270" role="img" aria-label="Guardian inputs feed the MAJ3 circuit by REF; MAJ3 or grace-over, with warn and not alive, sets q; expired or warn, with not q and not alive, sets warn">
      <text x="4" y="36">g0 g1 g2</text>
      <path class="wire" d="M92 31 H112" />
      <rect class="box" x="112" y="12" width="136" height="38" rx="6" /><text x="122" y="37">REF → MAJ3</text>
      <text x="4" y="92">graceOver</text>
      <path class="wire" d="M248 31 H262 V66 H276" /><path class="wire" d="M104 87 H276" />
      <rect class="box" x="276" y="56" width="56" height="40" rx="6" /><text x="290" y="82">OR</text>
      <text x="4" y="146">warn, ¬alive</text>
      <path class="wire" d="M124 141 H372 V100 H386" /><path class="wire" d="M332 76 H386" />
      <rect class="box" x="386" y="60" width="62" height="44" rx="6" /><text x="398" y="88">AND</text>
      <text x="4" y="196">q</text>
      <path class="wire" d="M24 191 H462 V102 H476" /><path class="wire" d="M448 82 H476" />
      <rect class="box latch" x="476" y="60" width="56" height="44" rx="6" /><text x="490" y="88">OR</text>
      <path class="wire hot" d="M532 82 H552" /><text x="556" y="88">q′</text>
      <text x="4" y="252">(expired ∨ warn), ¬q, ¬alive</text>
      <path class="wire" d="M300 247 H476" />
      <rect class="box latch" x="476" y="226" width="62" height="40" rx="6" /><text x="488" y="252">AND</text>
      <path class="wire hot" d="M538 246 H552" /><text x="552" y="236">warn′</text>
    </svg>
  );
}

export function Proof() {
  const [latchInfo, setLatchInfo] = useState<Awaited<ReturnType<typeof circuitInfo>> | null>(null);
  const [majInfo, setMajInfo] = useState<Awaited<ReturnType<typeof circuitInfo>> | null>(null);
  const [checked, setChecked] = useState<{ ok: number; bad: number; done: number }>({ ok: 0, bad: 0, done: 0 });
  const [sent, setSent] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const id = circuitId;

  useEffect(() => {
    if (id === null || !dep) return;
    circuitInfo(id).then(setLatchInfo).catch(() => setErr('Could not read the circuit from the processor.'));
    circuitInfo(BigInt(dep.majId)).then(setMajInfo).catch(() => {});
    heraldNotices(1).then((r) => setSent(r.total)).catch(() => {});
    // all 256 (state, input) rows against the real processor, batched (TapeKit's nodes accept batches of 10)
    const c = createPublicClient({ chain, transport: http(net.rpcs[0], { batch: { batchSize: 10 }, retryCount: 2 }) });
    let live = true;
    (async () => {
      let ok = 0, bad = 0;
      for (let st = 0; st < 4 && live; st++) {
        const res = await Promise.all(
          Array.from({ length: 64 }, (_, v) =>
            c.readContract({ address: net.processor, abi: processorAbi, functionName: 'step', args: [id, `0x0${st}` as Hex, `0x${v.toString(16).padStart(2, '0')}` as Hex] })
              .then(([ns]) => parseInt(ns as string, 16) & 3)
              .catch(() => -1)
          )
        );
        res.forEach((n, v) => {
          const w = spec(st & 1, st >> 1, bitsOf(v));
          if (n === (w[0] | (w[1] << 1))) ok++;
          else bad++;
        });
        if (live) setChecked({ ok, bad, done: (st + 1) * 64 });
      }
    })();
    return () => { live = false; };
  }, [id]);

  const phase = (st: number) => (st & 2 ? 'tripped' : st & 1 ? 'grace' : 'open');

  return (
    <section class="shell section" style={{ paddingTop: '28px' }}>
      <div class="narrow stack" style={{ '--gap': '22px' } as any}>
        <h2>The latch is a circuit on TapeOut.</h2>
        <p class="muted">
          Every vault stores two bits: <i>warn</i> (a grace period is running) and <i>q</i> (tripped). The vault contract cannot set them itself.
          It can only ask circuit {id !== null ? <b class="mono">#{id.toString()}</b> : '(not deployed yet)'} on the {net.processorName} processor for the next
          state, with six input bits it computes from the clock and the guardians’ confirmations.
        </p>
        <div class="card stack" style={{ '--gap': '14px' } as any}>
          <p class="mono" style={{ fontSize: '15px' }}>warn′ = NOT q AND NOT alive AND (warn OR expired)</p>
          <p class="mono" style={{ fontSize: '15px' }}>q′ = q OR (NOT alive AND warn AND (graceOver OR MAJ3(g0,g1,g2)))</p>
          <p class="muted">A trip always needs a grace period first, a check-in before the trip always wins, guardians can only shorten a grace period that has already started, and once q is 1 nothing can clear it.</p>
          <Diagram />
          {dep && <p class="meta">MAJ3 (2 of 3 agree) is its own taped-out circuit, <span class="mono">#{dep.majId}</span>. The latch includes it by REF, TapeOut’s way to build chips from other chips.</p>}
        </div>

        <div class="card stack">
          <div class="spread" style={{ flexWrap: 'wrap' }}>
            <h3>What it does</h3>
            {checked.done === 256 ? (
              <span class={`tag ${checked.bad ? '' : 'brass'}`}>{checked.ok}/256 rows match the processor</span>
            ) : (
              <span class="meta">{id === null ? '' : `checking ${checked.done}/256 rows on chain…`}</span>
            )}
          </div>
          <table class="tt">
            <thead><tr><th style={{ textAlign: 'left' }}>case</th><th>from</th><th>to</th></tr></thead>
            <tbody>
              {KEY_ROWS.map((r) => {
                const [w, q] = spec(r.st & 1, r.st >> 1, r.ins);
                const to = w | (q << 1);
                return (
                  <tr class={to & 2 && !(r.st & 2) ? 'hit' : ''}>
                    <td style={{ textAlign: 'left', fontFamily: 'var(--body)' }}>{r.label}</td>
                    <td>{phase(r.st)}</td><td>{phase(to)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="meta">The badge above is your browser calling <span class="mono">step()</span> on the processor for every one of the 256 combinations of state and inputs, and comparing with the equations.</p>
        </div>

        {latchInfo && dep && (
          <div class="card stack">
            <h3>On X Layer</h3>
            <dl class="kv">
              <dt>Processor</dt><dd>{explorerAddr(net.processor) ? <a class="mono" href={explorerAddr(net.processor)} target="_blank" rel="noreferrer">{short(net.processor)}</a> : <span class="mono">{short(net.processor)}</span>} ({net.processorName})</dd>
              <dt>Latch circuit</dt><dd class="mono">#{id!.toString()}</dd>
              <dt>Pins</dt><dd>{latchInfo.nIn} in · {latchInfo.nOut} out · {latchInfo.nState} state bits</dd>
              <dt>Gates</dt><dd>{latchInfo.gates} (own NANDs and LATCHes, plus MAJ3’s {majInfo ? majInfo.gates : '…'} by REF)</dd>
              <dt>Held by</dt><dd class="mono">{latchInfo.owner ? short(latchInfo.owner) : '…'}{latchInfo.owner && dep.herald && latchInfo.owner.toLowerCase() === dep.herald.toLowerCase() ? ' (Latchkey herald)' : ''}</dd>
              {hasHerald && <><dt>Its container</dt><dd class="mono">{short(dep.container)}</dd>
              <dt>Website</dt><dd class="mono">tape://{dep.tapeName}</dd>
              <dt>TapeSend messages</dt><dd>{sent ?? '…'} sent by this container</dd></>}
            </dl>
            {hasHerald && <p class="meta">One container, three roles: it is the chip’s wallet, this website’s home on DeWEB, and the address Latchkey’s TapeSend notices come from.</p>}
            {isTestnet && <p class="note">On testnet, TapeOut isn’t deployed, so these exact netlists run on Latchkey’s own TAP-02 evaluator. Our tests check it against TapeOut’s real processor on all 256 rows. On mainnet, the circuits run on TapeOut itself, with TapeSend notices and the DeWEB site.</p>}
            <p class="meta">Netlist, {(latchInfo.netlist.length - 2) / 2} bytes (TAP-02):</p>
            <ul class="list mono" style={{ fontSize: '12.5px' }}>{decode(latchInfo.netlist).map((l) => <li>{l}</li>)}</ul>
          </div>
        )}
        {err && <p class="err">{err}</p>}
        <div class="row"><Bit on={false} /><span class="muted">open</span><Bit on /><span class="muted">tripped, forever</span></div>
      </div>
    </section>
  );
}
