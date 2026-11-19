import { useEffect, useState } from 'preact/hooks';
import { Bit, Ring } from '../ui';
import { net } from '../lib/config';
import { factoryInfo, fmt } from '../lib/vault';

function HeroDemo() {
  // A looping illustration: days run down, a check-in refills, then silence trips the bit.
  const [t, setT] = useState(0);
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = setInterval(() => setT((x) => (x + 1) % 120), 100);
    return () => clearInterval(id);
  }, []);
  // 0-40: 90 -> 50 days, 40: check in -> 90, 40-100: 90 -> 0, 100-120 tripped
  let days: number, tripped = false, label = 'days left';
  if (t < 40) days = 90 - t;
  else if (t < 44) { days = 90; label = 'checked in'; }
  else if (t < 100) days = Math.max(0, Math.round(90 - (t - 44) * 1.62));
  else { days = 0; tripped = true; }
  return (
    <div class="card stack" style={{ '--gap': '20px', maxWidth: '360px' } as any} aria-hidden="true">
      <div class="spread"><span class="meta">Ada’s vault</span><Bit on={tripped} /></div>
      <Ring left={days / 90}>
        <div>
          <div class="big">{tripped ? 'Open' : days}</div>
          <div class="meta">{tripped ? 'for Tobi to claim' : label}</div>
        </div>
      </Ring>
      <div class="spread meta"><span>1,250 USDT0</span><span class="mono">0x7a1f…c0de</span></div>
    </div>
  );
}

export function Landing() {
  const [fee, setFee] = useState<{ setup: string; bps: number } | null>(null);
  useEffect(() => {
    factoryInfo().then((f) => f && setFee({ setup: fmt(f.setupFee, 18), bps: f.claimFeeBps })).catch(() => {});
  }, []);
  return (
    <>
      <section class="shell hero">
        <div class="row wrap" style={{ gap: '40px', alignItems: 'center', justifyContent: 'space-between' }}>
          <div class="stack" style={{ '--gap': '24px', flex: '1 1 420px' } as any}>
            <span class="tag">On-chain dead man’s switch · X Layer</span>
            <h1>Who gets your crypto if you lose your phone tomorrow?</h1>
            <p class="lead">
              Latchkey is a vault with a latch. Check in now and then. If you go quiet for longer than you chose, the latch trips and
              everything goes to the address you named: your backup wallet, or the person you love.
            </p>
            <div class="row wrap">
              <a class="btn primary" href="#/new">Set a latch</a>
              <a class="btn" href="#/proof">See the circuit</a>
            </div>
          </div>
          <div style={{ flex: '0 1 360px', width: '100%' }}><HeroDemo /></div>
        </div>
      </section>

      <section class="shell section">
        <div class="stack" style={{ '--gap': '28px' } as any}>
          <h2>Three moves. No company in the middle.</h2>
          <div class="grid3">
            <div class="card stack"><span class="mono meta">01</span><h3>Check in</h3><p class="muted">One tap, as often as you like. Each check-in restarts your window: 30 days, 90 days, a year.</p></div>
            <div class="card stack"><span class="mono meta">02</span><h3>Go quiet</h3><p class="muted">Lost phone, seed phrase gone, or worse. When the window runs out, anyone can trip the latch. A TapeOut circuit decides, and once it trips it can never be undone.</p></div>
            <div class="card stack"><span class="mono meta">03</span><h3>It opens for them</h3><p class="muted">Only the address you named can claim: your own backup wallet, or your heir. They need nothing from us, just this page and a wallet.</p></div>
          </div>
        </div>
      </section>

      <section class="shell section">
        <div class="row wrap" style={{ gap: '32px', alignItems: 'flex-start' }}>
          <div class="stack" style={{ flex: '1 1 380px' } as any}>
            <h2>Built to outlive us.</h2>
            <p class="muted">
              Inheritance apps are companies, and companies shut down. Latchkey has no servers and no admin key. The vault is a contract
              nobody can upgrade, the latch is a circuit taped out on TapeOut, and this page itself is stored on X Layer and served from
              its on-chain name.
            </p>
            {net.tapeName && <p class="mono">tape://{net.tapeName}</p>}
          </div>
          <div class="card line stack" style={{ flex: '1 1 380px' } as any}>
            <dl class="kv">
              <dt>Who holds the keys</dt><dd>You do. We never see them.</dd>
              <dt>Who can move funds</dt><dd>You, while the latch is open. Your heir, once it trips.</dd>
              <dt>What decides the trip</dt><dd>TapeOut circuit, 4 NAND + 1 LATCH</dd>
              <dt>Can we freeze it</dt><dd>No. There is no admin.</dd>
              <dt>Cost</dt><dd>{fee ? `${fee.setup} OKB once · ${fee.bps / 100}% when claimed` : 'A setup fee once, a small cut at claim'}</dd>
            </dl>
          </div>
        </div>
      </section>

      <section class="shell section">
        <div class="stack narrow" style={{ '--gap': '20px', textAlign: 'center' } as any}>
          <h2>A lost phone shouldn’t cost a lifetime of savings.</h2>
          <p class="muted">It takes about a minute. You keep full control until the day you don’t.</p>
          <div><a class="btn primary" href="#/new">Set a latch</a></div>
        </div>
      </section>
    </>
  );
}
