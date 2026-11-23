import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Bit, Ring } from '../ui';
import { dep } from '../lib/config';
import { factoryInfo, fmt } from '../lib/vault';
import ridges from '../img/ridges.webp'; // Unsplash, YiChuan Li (4hBAaQ5iHLY) — inlined, so the page stays 100% on-chain
import valley from '../img/valley.webp'; // Unsplash, Raghav Yadav (lPmuLHB1QBM)
import './landing.css';

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Reveal [data-reveal] children once, and toggle .is-live on [data-live] while they are on screen. */
function useScrollLife(root: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || reduced()) {
      el.querySelectorAll('[data-reveal]').forEach((n) => n.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => {
        const t = e.target as HTMLElement;
        if (t.hasAttribute('data-reveal') && e.isIntersecting) t.classList.add('in');
        if (t.hasAttribute('data-live')) t.classList.toggle('is-live', e.isIntersecting && !reduced());
      }),
      { threshold: 0.2 }
    );
    el.querySelectorAll('[data-reveal], [data-live]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, []);
}

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.3 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return [ref, on] as const;
}

/* ------------------------------------------------------------------ device + app fragments */

function Phone({ children, time = '9:41' }: { children: ComponentChildren; time?: string }) {
  return (
    <div class="phone" aria-hidden="true">
      <div class="phone__screen">
        <div class="phone__island" />
        <div class="phone__status"><span>{time}</span><span>●●● ▮</span></div>
        <div class="app">{children}</div>
      </div>
    </div>
  );
}

type Scene = 'set' | 'checkin' | 'quiet' | 'grace' | 'tripped';

function AppScreen({ scene, days }: { scene: Scene; days?: number }) {
  const top = (label: string, on = false, tag?: string) => (
    <div class="app__top">
      <div><div class="app__title">{label}</div><div class="app__addr">0x7a1f…c0de</div></div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>{tag && <span class={`tag ${on ? 'brass' : ''}`} style={{ fontSize: '10px' }}>{tag}</span>}<Bit on={on} /></div>
    </div>
  );
  if (scene === 'set')
    return (
      <div class="scene" key="set" style={{ display: 'contents' }}>
        {top('New vault')}
        <div class="app__card" style={{ textAlign: 'left', alignItems: 'stretch' }}>
          <div class="app__title">Step 4 of 4</div>
          <div style={{ fontSize: '15px', lineHeight: 1.4 }}>If I don’t check in for <b>90 days</b>, a <b>7 day</b> grace period starts. Then it opens for <b class="mono">0x7099…79C8</b>.</div>
        </div>
        <div class="app__rows"><div><span>Guardians</span><span>2</span></div><div><span>Deposit</span><span>1,250 USDT0</span></div><div><span>Setup fee</span><span>0.001 OKB</span></div></div>
        <div style={{ flex: 1 }} />
        <div class="app__btn">Create vault</div>
      </div>
    );
  if (scene === 'grace')
    return (
      <div class="scene" key="grace" style={{ display: 'contents' }}>
        {top('Your vault', false, 'grace period')}
        <div class="app__card">
          <Ring left={0.42} warn><div><div class="big">3 days</div><div class="meta">of grace left</div></div></Ring>
          <div class="app__note">2 of 2 guardians confirmed. Anyone can now trip the latch.</div>
        </div>
        <div style={{ flex: 1 }} />
        <div class="app__btn">Trip the latch</div>
      </div>
    );
  if (scene === 'tripped')
    return (
      <div class="scene" key="tripped" style={{ display: 'contents' }}>
        {top('You are the receiver', true, 'tripped')}
        <div class="app__card" style={{ paddingBlock: '20px' }}>
          <div style={{ display: 'grid', placeItems: 'center' }}><div class="bit on" style={{ '--size': '92px' } as any}><span class="roll">1</span></div></div>
          <div style={{ fontFamily: 'var(--display)', fontStretch: '112%', fontSize: '18px' }}>This vault is yours to claim.</div>
        </div>
        <div class="app__rows"><div><span>USDT0</span><span>1,250</span></div><div><span>OKB</span><span>0.5</span></div></div>
        <div style={{ flex: 1 }} />
        <div class="app__btn">Claim to my wallet</div>
      </div>
    );
  const d = days ?? 90;
  return (
    <div class="scene" key={scene} style={{ display: 'contents' }}>
      {top('Your vault')}
      <div class="app__card">
        <Ring left={d / 90}><div><div class="big">{d === 0 ? '0' : `${d} days`}</div><div class="meta">{d === 0 ? 'window passed' : 'until grace can start'}</div></div></Ring>
        <div class="app__note">{scene === 'checkin' ? 'Checked in · window restarted' : d === 0 ? 'No check-in for 90 days.' : 'Last check-in 2 days ago.'}</div>
      </div>
      <div class="app__rows"><div><span>In the vault</span><span>1,250 USDT0</span></div><div><span>Opens for</span><span class="mono">0x7099…79C8</span></div></div>
      <div style={{ flex: 1 }} />
      <div class={`app__btn ${scene === 'checkin' ? 'pressed' : ''}`}>Check in</div>
    </div>
  );
}

function HeroPhone() {
  // idle loop: days tick down, a check-in refills the ring
  const [d, setD] = useState(88);
  useEffect(() => {
    if (reduced()) return;
    const id = setInterval(() => setD((x) => (x <= 61 ? 90 : x - 1)), 900);
    return () => clearInterval(id);
  }, []);
  return (
    <div class="stage">
      <Phone><AppScreen scene={d === 90 ? 'checkin' : 'open' as Scene} days={d} /></Phone>
      <div class="frag frag--notice bob" aria-hidden="true">
        <span class="ico"><Mark /></span>
        <b>Latchkey · TapeSend</b>
        <small>Your grace period has started. One check-in cancels it.</small>
      </div>
      <div class="frag frag--chip bob late" aria-hidden="true"><span class="dot" />step() · circuit #{dep?.circuitId ?? '27'} → open</div>
    </div>
  );
}

function Mark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="12" r="5.25" stroke="#ececf2" stroke-width="1.6" />
      <path d="M13.25 12H22" stroke="#ececf2" stroke-width="1.6" />
      <rect x="17" y="12.75" width="3.5" height="3.5" fill="#e9b44c" />
    </svg>
  );
}

/* ------------------------------------------------------------------ the self-playing film */

const FILM: { when: string; title: string; body: string; scene: Scene; days?: number; ms: number }[] = [
  { when: 'Day 0', title: 'Set your latch', body: 'Name a receiver, a silence window, a grace period and up to three guardians. Fund it from any wallet, or withdraw straight from OKX.', scene: 'set', ms: 4200 },
  { when: 'Day 47', title: 'Check in', body: 'One tap. The TapeOut circuit takes a beat, and the window starts again. You keep full control the whole time.', scene: 'checkin', days: 90, ms: 3600 },
  { when: 'Day 137', title: 'Go quiet', body: 'Lost phone, lost seed, or worse. When the window runs out, anyone can start the grace period, and a TapeSend message goes out.', scene: 'quiet', days: 0, ms: 3800 },
  { when: 'Grace', title: 'Guardians confirm', body: 'Two of your three guardians confirm you are gone, so the grace period ends early. One check-in from you would cancel it all.', scene: 'grace', ms: 4000 },
  { when: 'Tripped', title: 'It opens for them', body: 'The circuit flips the bit, forever. Your heir gets a TapeSend message and claims to their own wallet. No company involved.', scene: 'tripped', ms: 4600 },
];

function Film() {
  const [i, setI] = useState(0);
  const [ref, inView] = useInView<HTMLDivElement>();
  const [held, setHeld] = useState(false);
  const playing = inView && !held && !reduced();
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setI((x) => (x + 1) % FILM.length), FILM[i].ms);
    return () => clearTimeout(t);
  }, [i, playing]);
  const s = FILM[i];
  return (
    <div data-reveal><div ref={ref} class={`film ${playing ? '' : 'paused'}`} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
      <Phone time={i === 4 ? '7:02' : '9:41'}><AppScreen scene={s.scene} days={s.days} /></Phone>
      <ol class="steps-list" aria-label="How a latch trips">
        {FILM.map((f, k) => (
          <li>
            <button class="step-btn" aria-current={k === i} onClick={() => setI(k)} style={{ '--dur': `${f.ms}ms` } as any}>
              <span class="when">{f.when}</span>
              <b>{f.title}</b>
              <small>{f.body}</small>
              <span class="bar"><i key={`${k}-${i}`} /></span>
            </button>
          </li>
        ))}
      </ol>
    </div></div>
  );
}

/* ------------------------------------------------------------------ count-up stats */

function Count({ to, suffix = '', prefix = '' }: { to: number; suffix?: string; prefix?: string }) {
  const [ref, inView] = useInView<HTMLElement>();
  const [v, setV] = useState(reduced() ? to : 0);
  useEffect(() => {
    if (!inView || reduced()) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 1200);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView]);
  return <b ref={ref as any}>{prefix}{v}{suffix}</b>;
}

/* ------------------------------------------------------------------ page */

export function Landing() {
  const [fee, setFee] = useState<{ setup: string; bps: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useScrollLife(root);
  useEffect(() => {
    factoryInfo().then((f) => f && setFee({ setup: fmt(f.setupFee, 18), bps: f.claimFeeBps })).catch(() => {});
  }, []);
  // guardians filling in, for card 2
  const [g, setG] = useState(0);
  useEffect(() => {
    if (reduced()) { setG(2); return; }
    const id = setInterval(() => setG((x) => (x + 1) % 4), 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div ref={root}>
      {/* ---------------------------------------------------------------- hero */}
      <section class="lp-hero">
        <div class="lp-hero__photo" style={{ backgroundImage: `url(${ridges})` }} />
        <div class="lp-hero__shade" />
        <div class="shell lp-hero__grid">
          <div class="stack" style={{ '--gap': '26px' } as any}>
            <span class="eyebrow" data-reveal><i />On-chain dead man’s switch · X Layer</span>
            <h1 data-reveal data-reveal-delay="1">Who gets your crypto <span class="dim">if you lose your phone tomorrow?</span></h1>
            <p class="lead" data-reveal data-reveal-delay="2">
              Latchkey is a vault with a latch. Check in now and then. If you go quiet for longer than you chose, the latch trips and
              everything goes to the address you named: your backup wallet, or the person you love.
            </p>
            <div class="row wrap" data-reveal data-reveal-delay="3">
              <a class="btn primary" href="#/new">Set a latch <span class="arrow">→</span></a>
              <a class="btn glass" href="#/proof">See the circuit</a>
            </div>
          </div>
          <div data-reveal data-reveal-delay="2"><HeroPhone /></div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- built on */}
      <section class="strip" aria-label="Built on">
        <div class="shell strip__row">
          {[['TapeOut', 'circuits · REF'], ['X Layer', 'chain 196'], ['DeWEB', 'site on chain'], ['TapeSend', 'notices'], ['TapeKit', 'gateway']].map(([a, b]) => (
            <div class="strip__item">{a}<small>{b}</small></div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- film */}
      <section class="shell section">
        <div class="lp-head" data-reveal>
          <span class="eyebrow"><i />Watch a latch trip</span>
          <h2 class="lp-h2">One quiet season. <span class="dim">Then it opens for them.</span></h2>
        </div>
        <Film />
      </section>

      {/* ---------------------------------------------------------------- three moves, with living fragments */}
      <section class="shell section">
        <div class="lp-head" data-reveal>
          <span class="eyebrow"><i />How it works</span>
          <h2 class="lp-h2">Three moves. <span class="dim">No company in the middle.</span></h2>
        </div>
        <div class="lgrid">
          <article class="lcard" data-live data-reveal>
            <div class="lcard__art">
              <div class="press-wrap">
                <div class="chipf toast-f"><span class="tick">✓</span>Checked in · window restarted</div>
                <div class="big-btn">Check in</div>
                <svg class="cursor" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6 1.5L10 19z" fill="#ececf2" stroke="#15151d" stroke-width="1.2" /></svg>
              </div>
            </div>
            <div class="lcard__text"><span class="n">01</span><h3>Check in</h3><p><b>One tap, as often as you like.</b> Each check-in restarts your window: 30 days, 90 days, a year.</p></div>
          </article>
          <article class="lcard" data-live data-reveal data-reveal-delay="1">
            <div class="lcard__art">
              <div class="stackf">
                <div class="chipf notice dim"><span>Latchkey · TapeSend</span><small>Your grace period has started.</small></div>
                <div class="chipf notice"><span>Grace period · 7 days</span><small>One check-in from the owner cancels it.</small></div>
                <div class="chipf guards">
                  <span class={`gdot ${g >= 1 ? 'on' : ''}`}>G1</span><span class={`gdot ${g >= 2 ? 'on' : ''}`}>G2</span><span class="gdot">G3</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--ink-3)', fontSize: '12px' }}>{Math.min(g, 2)} of 3 confirmed</span>
                </div>
              </div>
            </div>
            <div class="lcard__text"><span class="n">02</span><h3>Go quiet</h3><p><b>Lost phone, seed gone, or worse.</b> A grace period starts and you get a TapeSend message. Still quiet, or two guardians confirm, and the circuit trips the latch for good.</p></div>
          </article>
          <article class="lcard" data-live data-reveal data-reveal-delay="2">
            <div class="lcard__art">
              <div class="chipf receipt">
                <div class="rhead"><Bit on /><div><div style={{ fontSize: '14px' }}>Claimed</div><div class="meta">to 0x7099…79C8</div></div></div>
                <div class="rrow"><span>USDT0</span><span>1,247.50</span></div>
                <div class="rrow"><span>OKB</span><span>0.499</span></div>
                <div class="rrow"><span>Latchkey fee</span><span>0.2%</span></div>
              </div>
            </div>
            <div class="lcard__text"><span class="n">03</span><h3>It opens for them</h3><p><b>Only the address you named can claim:</b> your own backup wallet, or your heir. They need nothing from us, just this page and a wallet.</p></div>
          </article>
        </div>
      </section>

      {/* ---------------------------------------------------------------- built to outlive us */}
      <section class="shell section">
        <div class="row wrap" style={{ gap: '40px', alignItems: 'flex-start' }}>
          <div class="stack" style={{ flex: '1 1 380px', '--gap': '20px' } as any} data-reveal>
            <span class="eyebrow"><i />Can’t disappear</span>
            <h2 class="lp-h2">Built to outlive us. <span class="dim">Even this page.</span></h2>
            <p class="lp-sub">
              Inheritance apps are companies, and companies shut down. Latchkey has no servers, and nobody holds an admin key over your vault or your money. The vault is a contract
              nobody can upgrade, the latch is a circuit taped out on TapeOut, notices travel over TapeSend, and this page itself is stored
              on X Layer in the circuit’s own container and served from its on-chain name.
            </p>
            <div class="addrbar"><span class="lock">●</span><span>tape://{dep?.tapeName ?? '27.2.272.tape'}</span><span class="badge">100% on-chain</span></div>
          </div>
          <div class="card line stack" style={{ flex: '1 1 380px' } as any} data-reveal data-reveal-delay="1">
            <dl class="kv">
              <dt>Who holds the keys</dt><dd>You do. We never see them.</dd>
              <dt>Who can move funds</dt><dd>You, while the latch is open. Your heir, once it trips.</dd>
              <dt>What decides the trip</dt><dd>Two TapeOut circuits: the latch, and a 2-of-3 majority it includes by REF</dd>
              <dt>Who tells you</dt><dd>TapeSend, from Latchkey’s own container</dd>
              <dt>Can we freeze it</dt><dd>No. Nobody has admin power over vaults or funds.</dd>
              <dt>Cost</dt><dd>{fee ? `${fee.setup} OKB once · ${fee.bps / 100}% when claimed` : 'A setup fee once, a small cut at claim'}</dd>
            </dl>
          </div>
        </div>
        <div class="stats" style={{ marginTop: '64px' }} data-reveal>
          <div class="stat"><Count to={26} /><span>gates decide every vault</span></div>
          <div class="stat"><Count to={256} suffix="/256" /><span>cases checked against the processor</span></div>
          <div class="stat"><Count to={0} /><span>servers, databases or admin keys over funds</span></div>
          <div class="stat"><b>&lt;1¢</b><span>to check in on X Layer</span></div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- CTA */}
      <section class="shell section">
        <div class="cta-photo" data-reveal>
          <div class="cta-photo__bg" style={{ backgroundImage: `url(${valley})` }} />
          <div class="stack narrow" style={{ '--gap': '20px' } as any}>
            <h2 class="lp-h2" style={{ margin: '0 auto' }}>A lost phone shouldn’t cost <span class="dim">a lifetime of savings.</span></h2>
            <p class="muted">It takes about a minute. You keep full control until the day you don’t.</p>
            <div class="row wrap" style={{ justifyContent: 'center' }}>
              <a class="btn primary" href="#/new">Set a latch <span class="arrow">→</span></a>
              <a class="btn glass" href="#/stats">See it on chain</a>
            </div>
          </div>
        </div>
        <div class="wordmark" aria-hidden="true"><span>Latchkey</span></div>
      </section>
    </div>
  );
}
