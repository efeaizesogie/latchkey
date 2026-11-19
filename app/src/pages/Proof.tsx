import { useEffect, useState } from 'preact/hooks';
import { net, explorerAddr } from '../lib/config';
import { circuitInfo, stepOnChain } from '../lib/vault';
import { short } from '../lib/chain';
import { Bit } from '../ui';

const ROWS = [0, 1].flatMap((q) => [0, 1].flatMap((e) => [0, 1].map((a) => ({ q, e, a, want: q | (e & (1 - a)) }))));

function decode(hex: string) {
  const b = hex.slice(2).match(/../g)!.map((x) => parseInt(x, 16));
  const out: string[] = [];
  let i = 0, sig = 4;
  const rd = (k: number) => (b[k] << 16) | (b[k + 1] << 8) | b[k + 2];
  while (i < b.length) {
    if (b[i] === 0) { out.push(`s${sig++} = NAND(s${rd(i + 1)}, s${rd(i + 4)})`); i += 7; }
    else if (b[i] === 1) { out.push(`s${sig++} = LATCH(d = s${rd(i + 1)})`); i += 4; }
    else break;
  }
  return out;
}

function Gates() {
  // Hand-placed drawing of the 5 elements (signals as in circuit/latch.mjs).
  return (
    <svg class="gates" viewBox="0 0 560 220" role="img" aria-label="Circuit drawing: expired and NOT alive go into a NAND; NOT q and that NAND go into a final NAND whose output feeds back into the LATCH">
      <text x="8" y="44">expired</text><text x="8" y="104">alive</text>
      <path class="wire" d="M70 40 H220 V64 H236" />
      <path class="wire" d="M70 100 H96" />
      <rect class="box" x="96" y="86" width="64" height="28" rx="6" /><text x="104" y="105">NAND</text>
      <text x="166" y="128" style={{ fontSize: '11px' }}>NOT alive</text>
      <path class="wire" d="M160 100 H220 V80 H236" />
      <rect class="box" x="236" y="58" width="64" height="28" rx="6" /><text x="244" y="77">NAND</text>
      <rect class="box latch" x="96" y="160" width="64" height="28" rx="6" /><text x="102" y="179">LATCH q</text>
      <path class="wire" d="M160 174 H180" />
      <rect class="box" x="180" y="160" width="64" height="28" rx="6" /><text x="188" y="179">NAND</text>
      <text x="250" y="200" style={{ fontSize: '11px' }}>NOT q</text>
      <path class="wire" d="M244 174 H330 V124 H350" />
      <path class="wire" d="M300 72 H330 V108 H350" />
      <rect class="box" x="350" y="102" width="64" height="28" rx="6" /><text x="358" y="121">NAND</text>
      <path class="wire hot" d="M414 116 H470" /><text x="476" y="120">q′ (out)</text>
      <path class="wire hot" d="M440 116 V212 H70 V174 H96" />
    </svg>
  );
}

export function Proof() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof circuitInfo>> | null>(null);
  const [chain, setChain] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const id = net.circuitId;

  useEffect(() => {
    if (id === null) return;
    circuitInfo(id).then(setInfo).catch(() => setErr('Could not read the circuit from the processor.'));
    Promise.all(ROWS.map((r) => stepOnChain(id, r.q, r.e, r.a).then((x) => [`${r.q}${r.e}${r.a}`, x.next] as const)))
      .then((xs) => setChain(Object.fromEntries(xs)))
      .catch(() => {});
  }, [id]);

  const verified = Object.keys(chain).length === 8 && ROWS.every((r) => chain[`${r.q}${r.e}${r.a}`] === r.want);

  return (
    <section class="shell section" style={{ paddingTop: '28px' }}>
      <div class="narrow stack" style={{ '--gap': '22px' } as any}>
        <span class="tag">Don’t trust us. Read the chip.</span>
        <h2>The latch is a circuit on TapeOut.</h2>
        <p class="muted">
          Every vault stores one bit. The vault contract cannot set that bit itself: it can only ask circuit
          {id !== null ? <> <b class="mono">#{id.toString()}</b></> : ' (not deployed yet)'} on the {net.processorName} processor for the next
          value, with two inputs it computes from the clock: <i>expired</i> (the window has passed) and <i>alive</i> (the owner is checking in right now).
        </p>
        <div class="card stack" style={{ '--gap': '14px' } as any}>
          <p class="mono" style={{ fontSize: '17px' }}>q′ = q OR (expired AND NOT alive)</p>
          <p class="muted">Once q is 1, no input can make it 0 again. A check-in that arrives before anyone trips the latch always wins.</p>
          <Gates />
        </div>

        <div class="card stack">
          <div class="spread"><h3>Truth table</h3>{verified ? <span class="tag brass">8/8 match the processor</span> : <span class="meta">{id === null ? '' : 'asking the processor…'}</span>}</div>
          <table class="tt">
            <thead><tr><th>q</th><th>expired</th><th>alive</th><th>q′</th><th>on chain</th></tr></thead>
            <tbody>
              {ROWS.map((r) => {
                const c = chain[`${r.q}${r.e}${r.a}`];
                return (
                  <tr class={r.want && !r.q ? 'hit' : ''}>
                    <td>{r.q}</td><td>{r.e}</td><td>{r.a}</td><td>{r.want}</td>
                    <td>{c === undefined ? '·' : c === r.want ? `${c} ✓` : `${c} ✗`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="meta">The “on chain” column is a live <span class="mono">step()</span> call to the processor contract from your browser.</p>
        </div>

        {info && (
          <div class="card stack">
            <h3>On X Layer</h3>
            <dl class="kv">
              <dt>Processor</dt><dd>{explorerAddr(net.processor) ? <a class="mono" href={explorerAddr(net.processor)} target="_blank" rel="noreferrer">{short(net.processor)}</a> : <span class="mono">{short(net.processor)}</span>} ({net.processorName})</dd>
              <dt>Circuit</dt><dd class="mono">#{id!.toString()}</dd>
              <dt>Pins</dt><dd>{info.nIn} in · {info.nOut} out · {info.nState} state bit</dd>
              <dt>Gates</dt><dd>{info.gates} (4 NAND + 1 LATCH)</dd>
              {info.owner && <><dt>Circuit NFT owner</dt><dd class="mono">{short(info.owner)}</dd></>}
            </dl>
            <p class="meta">Netlist, {(info.netlist.length - 2) / 2} bytes (TAP-02):</p>
            <p class="mono" style={{ overflowWrap: 'anywhere', fontSize: '13px' }}>{info.netlist}</p>
            <ul class="list mono" style={{ fontSize: '13px' }}>{decode(info.netlist).map((l) => <li>{l}</li>)}</ul>
          </div>
        )}
        {err && <p class="err">{err}</p>}
        <div class="row"><Bit on={false} /><span class="muted">open</span><Bit on /><span class="muted">tripped, forever</span></div>
      </div>
    </section>
  );
}
