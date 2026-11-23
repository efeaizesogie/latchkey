import { useEffect, useState } from 'preact/hooks';
import { dep, explorerAddr } from '../lib/config';
import { short } from '../lib/chain';
import { stats, heraldNotices, fmt, type Notice } from '../lib/vault';

export function Stats() {
  const [s, setS] = useState<Awaited<ReturnType<typeof stats>> | null>(null);
  const [feed, setFeed] = useState<Notice[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    stats().then(setS).catch(() => setErr('Could not read the factory.'));
    heraldNotices(10).then((r) => setFeed(r.notices)).catch(() => setFeed([]));
  }, []);
  if (!dep) return <section class="shell section"><div class="narrow"><p class="muted">Latchkey is not deployed on this network yet.</p></div></section>;
  const tile = (n: string | number, label: string) => (
    <div class="card"><div class="ring-num" style={{ fontFamily: 'var(--display)', fontStretch: '112%', fontSize: '32px', letterSpacing: '-0.02em' }}>{n}</div><div class="meta">{label}</div></div>
  );
  return (
    <section class="shell section" style={{ paddingTop: '28px' }}>
      <div class="stack" style={{ '--gap': '22px', maxWidth: '760px', margin: '0 auto' } as any}>
        <span class="tag">Read live from X Layer</span>
        <h2>Latchkey on chain</h2>
        <p class="muted">Everything on this page comes straight from the factory, the vaults, and the TapeSend hub. There is no database.</p>
        {err && <p class="err">{err}</p>}
        <div class="grid3">
          {tile(s ? s.count : '…', 'vaults created')}
          {tile(s ? s.open : '…', 'open')}
          {tile(s ? s.grace : '…', 'in a grace period')}
          {tile(s ? s.tripped : '…', 'tripped')}
          {tile(s ? s.beats : '…', 'circuit beats')}
          {tile(s ? s.sent : '…', 'TapeSend notices')}
        </div>
        <div class="card">
          <dl class="kv">
            <dt>USDT0 protected</dt><dd class="num">{s ? fmt(s.usdt0, 6, 2) : '…'}</dd>
            <dt>OKB protected</dt><dd class="num">{s ? fmt(s.okb, 18) : '…'}</dd>
            <dt>Factory</dt><dd>{explorerAddr(dep.factory) ? <a class="mono" href={explorerAddr(dep.factory)} target="_blank" rel="noreferrer">{short(dep.factory)}</a> : <span class="mono">{short(dep.factory)}</span>}</dd>
            <dt>Herald</dt><dd class="mono">{short(dep.herald)}</dd>
          </dl>
          {s && s.count > s.sampled && <p class="meta" style={{ marginTop: '10px' }}>Totals cover the first {s.sampled} vaults.</p>}
        </div>
        <div class="card stack">
          <h3>Latest TapeSend notices</h3>
          {!feed ? <p class="meta">reading…</p> : !feed.length ? <p class="muted">None yet. The herald writes when a grace period starts or a latch trips.</p> : (
            <ul class="list">
              {feed.map((n) => (
                <li>
                  <div class="spread"><b style={{ fontWeight: 500 }}>{n.subject || 'Message'}</b>{n.verified && <span class="tag">digest ok</span>}</div>
                  <p class="muted" style={{ fontSize: '14px', marginTop: '4px', overflowWrap: 'anywhere' }}>{n.body}</p>
                  <div class="meta">{new Date(n.time * 1000).toLocaleString()} · block <span class="mono">{n.blockNumber.toString()}</span> · #{n.inboxIndex}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
