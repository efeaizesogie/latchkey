import { useEffect, useRef, useState } from 'preact/hooks';
import { parseUnits, isAddress, getAddress, type Address, type Hash } from 'viem';
import { account, send, sendValue, explain, same, short, chainNow, forkSkip, type TxStage } from '../lib/chain';
import { vaultAbi, erc20Abi } from '../lib/abi';
import { net, isFork, explorerAddr, WINDOWS, type Token } from '../lib/config';
import { loadVault, duration, windowLabel, fmt, type VaultView } from '../lib/vault';
import { Bit, Ring, Qr, Copy, Err, TxNote, useNow } from '../ui';
import { picker } from '../app';

type Act = { stage: TxStage; hash?: Hash; what: string };

export function VaultPage({ address }: { address: Address }) {
  const [v, setV] = useState<VaultView | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [offset, setOffset] = useState(0); // chain clock minus local clock
  const [act, setAct] = useState<Act>({ stage: 'idle', what: '' });
  const [err, setErr] = useState<string | null>(null);
  const local = useNow(1000);
  const now = local + offset;
  const fresh = new URLSearchParams(location.hash.split('?')[1] ?? '').has('new');

  async function refresh() {
    try {
      const [vv, t] = await Promise.all([loadVault(address), chainNow()]);
      setV(vv);
      setOffset(t - Math.floor(Date.now() / 1000));
      setLoadErr(null);
    } catch (e) {
      setLoadErr(isAddress(address) ? 'Could not read this vault. Check the link, or try again in a moment.' : 'This link does not contain a valid vault address.');
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [address]);

  async function run(what: string, fn: (on: (s: TxStage, h?: Hash) => void) => Promise<unknown>) {
    setErr(null);
    if (!account.value) { picker.value = true; return; }
    try {
      await fn((stage, hash) => setAct({ stage, hash, what }));
      await refresh();
    } catch (e) {
      setAct({ stage: 'idle', what });
      setErr(explain(e));
    }
  }
  const busy = act.stage === 'preparing' || act.stage === 'signing' || act.stage === 'pending';

  if (loadErr) return <section class="shell section"><div class="narrow stack"><h2>Vault not found</h2><p class="muted">{loadErr}</p><p><a href="#/">Back to Latchkey</a></p></div></section>;
  if (!v) return <section class="shell section"><div class="narrow"><p class="muted" aria-live="polite">Reading the vault from {net.name}…</p></div></section>;

  const isOwner = same(account.value, v.owner);
  const isHeir = same(account.value, v.heir);
  const tripped = v.latch === 1;
  const left = v.deadline - now;
  const expired = left <= 0;
  const role = isOwner ? 'You own this vault' : isHeir ? 'You are the receiver' : 'Watching';
  const funded = v.balances.filter((b) => b.raw > 0n);

  return (
    <section class="shell section" style={{ paddingTop: '28px' }}>
      <div class="narrow stack" style={{ '--gap': '20px' } as any}>
        <div class="spread">
          <div class="stack" style={{ '--gap': '4px' } as any}>
            <span class="meta">{role}</span>
            <span class="mono">{short(v.address)}</span>
          </div>
          <Bit on={tripped} />
        </div>

        {fresh && isOwner && !tripped && (
          <p class="note">Vault created. Fund it below, then send the link to {short(v.heir)} or keep it with your papers.</p>
        )}

        {/* ---------------------------------------------------------------- state */}
        {!tripped && (
          <div class="card stack" style={{ '--gap': '20px', textAlign: 'center' } as any}>
            <Ring left={left / v.window}>
              <div>
                <div class="big">{expired ? '0' : duration(left).split(' ').slice(0, 2).join(' ')}</div>
                <div class="meta">{expired ? 'window passed' : 'until the latch can trip'}</div>
              </div>
            </Ring>
            <p class="muted">
              {expired
                ? isOwner
                  ? 'Your window has passed, but nobody has tripped the latch yet. Check in now to keep it open.'
                  : 'The owner has been quiet longer than their window. Anyone can now trip the latch.'
                : `Last check-in ${duration(now - v.lastCheckIn)} ago. Window: ${windowLabel(v.window)}.`}
            </p>
            {isOwner && (
              <button class="btn primary block" disabled={busy} onClick={() => run('Check in', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'checkIn' }, on))}>
                {busy && act.what === 'Check in' ? 'Checking in…' : 'Check in'}
              </button>
            )}
            {!isOwner && expired && (
              <button class="btn primary block" disabled={busy} onClick={() => run('Trip the latch', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'trip' }, on))}>
                Trip the latch
              </button>
            )}
            {!account.value && !expired && <button class="btn block" onClick={() => (picker.value = true)}>Connect to check in</button>}
          </div>
        )}

        {tripped && (
          <div class="card stack" style={{ '--gap': '20px', textAlign: 'center', justifyItems: 'center' } as any}>
            <div style={{ display: 'grid', placeItems: 'center' }}><Bit on big /></div>
            <h2>{isHeir ? (funded.length ? 'This vault is yours to claim.' : 'Claimed. It’s all in your wallet.') : 'The latch has tripped.'}</h2>
            <p class="muted">
              Tripped {duration(now - v.trippedAt)} ago by the TapeOut circuit. It cannot be reopened.{' '}
              {isHeir ? '' : `Only ${short(v.heir)} can claim.`}
            </p>
            {isHeir && (
              <>
                <dl class="kv" style={{ width: '100%', textAlign: 'left' }}>
                  {funded.length === 0 && <><dt>Balance</dt><dd>Nothing left. Anything sent here later can be claimed too.</dd></>}
                  {funded.map((b) => (<><dt>{b.token.symbol}</dt><dd class="num">{b.text}</dd></>))}
                  {funded.length > 0 && v.claimFeeBps > 0 && <><dt>Latchkey fee</dt><dd>{v.claimFeeBps / 100}% of each</dd></>}
                </dl>
                {funded.length > 0 && <button
                  class="btn primary block" disabled={busy}
                  onClick={() => run('Claim', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'claim', args: [funded.map((b) => b.token.address ?? '0x0000000000000000000000000000000000000000')] }, on))}
                >
                  Claim to my wallet
                </button>}
              </>
            )}
            {!account.value && <button class="btn block" onClick={() => (picker.value = true)}>I’m the receiver: connect</button>}
          </div>
        )}

        <Err msg={err} />
        <TxNote stage={act.stage} hash={act.hash} what={act.what} />

        {/* ---------------------------------------------------------------- balances */}
        <div class="card stack">
          <div class="spread"><h3>In the vault</h3>{explorerAddr(v.address) && <a class="meta" href={explorerAddr(v.address)} target="_blank" rel="noreferrer">OKLink</a>}</div>
          <dl class="kv">
            {v.balances.map((b) => (<><dt>{b.token.symbol}</dt><dd class="num">{b.text}</dd></>))}
          </dl>
          <dl class="kv">
            <dt>Opens for</dt><dd class="mono">{short(v.heir)}</dd>
            <dt>Owner</dt><dd class="mono">{short(v.owner)}</dd>
            <dt>Window</dt><dd>{windowLabel(v.window)}</dd>
          </dl>
        </div>

        {isOwner && !tripped && <Fund v={v} busy={busy} run={run} />}
        {isOwner && !tripped && <Manage v={v} busy={busy} run={run} />}
        {isOwner && !tripped && <Share v={v} />}

        <History v={v} />

        {isFork && (
          <div class="dev stack noprint" style={{ '--gap': '8px' } as any}>
            <p class="meta">Fork-only rehearsal: move the local chain’s clock.</p>
            <div class="row wrap">
              <button class="btn small" onClick={async () => { await forkSkip(Math.floor(v.window / 2)); refresh(); }}>Skip half a window</button>
              <button class="btn small" onClick={async () => { await forkSkip(v.window + 1); refresh(); }}>Skip a whole window</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Fund({ v, busy, run }: { v: VaultView; busy: boolean; run: (w: string, fn: (on: any) => Promise<unknown>) => void }) {
  const [tok, setTok] = useState<Token>(net.tokens[0]);
  const [amt, setAmt] = useState('');
  let raw = 0n, bad = false;
  try { raw = amt.trim() ? parseUnits(amt.trim(), tok.decimals) : 0n; } catch { bad = true; }
  return (
    <div class="card stack" style={{ '--gap': '16px' } as any}>
      <h3>Add funds</h3>
      <p class="muted">Send to the vault address from any wallet, or withdraw from OKX straight to it on the X Layer network.</p>
      <div class="row wrap" style={{ alignItems: 'flex-start', gap: '16px' }}>
        <Qr text={v.address} />
        <div class="stack" style={{ '--gap': '10px', flex: '1 1 200px', minWidth: 0 } as any}>
          <p class="mono" style={{ overflowWrap: 'anywhere' }}>{v.address}</p>
          <Copy text={v.address} label="Copy address" />
        </div>
      </div>
      <hr class="hr" />
      <div class="chips" role="group" aria-label="Token">
        {net.tokens.map((t) => (
          <button class="chip" style={{ minHeight: '48px' }} aria-pressed={t.symbol === tok.symbol} onClick={() => setTok(t)}><b>{t.symbol}</b></button>
        ))}
      </div>
      <input class={`input ${bad ? 'bad' : ''}`} inputMode="decimal" placeholder={`Amount in ${tok.symbol}`} value={amt} onInput={(e) => setAmt((e.target as HTMLInputElement).value)} />
      <button
        class="btn block" disabled={busy || bad || raw === 0n}
        onClick={() => run(`Deposit ${tok.symbol}`, (on) =>
          tok.address
            ? send({ address: tok.address, abi: erc20Abi, functionName: 'transfer', args: [v.address, raw] }, on)
            : sendValue(v.address, raw, on))}
      >
        Deposit {amt || ''} {tok.symbol}
      </button>
    </div>
  );
}

function Manage({ v, busy, run }: { v: VaultView; busy: boolean; run: (w: string, fn: (on: any) => Promise<unknown>) => void }) {
  const [open, setOpen] = useState<'' | 'heir' | 'window' | 'withdraw'>('');
  const [heir, setHeir] = useState('');
  const [win, setWin] = useState(v.window);
  const [wTok, setWTok] = useState<Token>(net.tokens[0]);
  const [wAmt, setWAmt] = useState('');
  const bal = v.balances.find((b) => b.token.symbol === wTok.symbol)?.raw ?? 0n;
  let raw = 0n, bad = false;
  try { raw = wAmt.trim() ? parseUnits(wAmt.trim(), wTok.decimals) : 0n; } catch { bad = true; }
  return (
    <div class="card stack" style={{ '--gap': '12px' } as any}>
      <h3>Settings</h3>
      <p class="meta">Every change also counts as a check-in.</p>
      <ul class="list">
        <li>
          <div class="spread"><span>Receiver <span class="mono meta">{short(v.heir)}</span></span><button class="linkbtn" onClick={() => setOpen(open === 'heir' ? '' : 'heir')}>Change</button></div>
          {open === 'heir' && (
            <div class="stack" style={{ marginTop: '12px', '--gap': '10px' } as any}>
              <input class="input" placeholder="0x… new receiver" value={heir} onInput={(e) => setHeir((e.target as HTMLInputElement).value)} />
              <button class="btn small" disabled={busy || !isAddress(heir.trim())} onClick={() => run('Change receiver', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'setHeir', args: [getAddress(heir.trim())] }, on))}>Save receiver</button>
            </div>
          )}
        </li>
        <li>
          <div class="spread"><span>Window <span class="meta">{windowLabel(v.window)}</span></span><button class="linkbtn" onClick={() => setOpen(open === 'window' ? '' : 'window')}>Change</button></div>
          {open === 'window' && (
            <div class="stack" style={{ marginTop: '12px', '--gap': '10px' } as any}>
              <div class="chips">{WINDOWS.map((w) => <button class="chip" style={{ minHeight: '48px' }} aria-pressed={win === w.seconds} onClick={() => setWin(w.seconds)}><b>{w.label}</b></button>)}</div>
              <button class="btn small" disabled={busy || win === v.window} onClick={() => run('Change window', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'setWindow', args: [BigInt(win)] }, on))}>Save window</button>
            </div>
          )}
        </li>
        <li>
          <div class="spread"><span>Take funds back</span><button class="linkbtn" onClick={() => setOpen(open === 'withdraw' ? '' : 'withdraw')}>Withdraw</button></div>
          {open === 'withdraw' && (
            <div class="stack" style={{ marginTop: '12px', '--gap': '10px' } as any}>
              <div class="chips">{net.tokens.map((t) => <button class="chip" style={{ minHeight: '48px' }} aria-pressed={t.symbol === wTok.symbol} onClick={() => setWTok(t)}><b>{t.symbol}</b></button>)}</div>
              <div class="row"><input class="input" inputMode="decimal" placeholder="Amount" value={wAmt} onInput={(e) => setWAmt((e.target as HTMLInputElement).value)} /><button class="btn small quiet" onClick={() => setWAmt(fmt(bal, wTok.decimals, wTok.decimals).replace(/,/g, ''))}>Max</button></div>
              <button class="btn small" disabled={busy || bad || raw === 0n || raw > bal} onClick={() => run('Withdraw', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'withdraw', args: [wTok.address ?? '0x0000000000000000000000000000000000000000', raw, account.value!] }, on))}>Withdraw to my wallet</button>
            </div>
          )}
        </li>
      </ul>
    </div>
  );
}

function ics(v: VaultView) {
  // Remind at 50% and 80% of the window, repeating with the window.
  const stamp = (t: number) => new Date(t * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const days = Math.max(1, Math.round((v.window * 0.5) / 86400));
  const link = location.href.split('?')[0];
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Latchkey//EN', 'BEGIN:VEVENT',
    `UID:${v.address}@latchkey`, `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
    `DTSTART:${stamp(v.lastCheckIn + Math.floor(v.window * 0.5))}`, 'DURATION:PT15M',
    `RRULE:FREQ=DAILY;INTERVAL=${days}`,
    'SUMMARY:Latchkey: check in', `DESCRIPTION:Tap Check in so your latch stays open. ${link}`, `URL:${link}`,
    'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Latchkey check-in', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function Share({ v }: { v: VaultView }) {
  const link = location.href.split('?')[0];
  const a = useRef<HTMLAnchorElement>(null);
  return (
    <div class="card stack" style={{ '--gap': '14px' } as any}>
      <h3>Don’t forget, and don’t keep it secret</h3>
      <p class="muted">Put check-in reminders in your calendar, and give the receiver this link. It only lets them watch until the latch trips.</p>
      <div class="row wrap">
        <a
          ref={a} class="btn small" download="latchkey-check-in.ics"
          href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics(v))}`}
        >Add reminders to calendar</a>
        <Copy text={link} label="Copy vault link" />
        <button class="btn small quiet" onClick={() => print()}>Print a card</button>
      </div>
    </div>
  );
}

function History({ v }: { v: VaultView }) {
  if (!v.history.length) return null;
  return (
    <div class="card stack">
      <div class="spread"><h3>Every beat of the circuit</h3><a class="meta" href="#/proof">What is this?</a></div>
      <ul class="list">
        {v.history.slice(0, 12).map((h) => (
          <li class="spread">
            <div>
              <div>{h.stateAfter === 1 && h.stateBefore === 0 ? 'Latch tripped' : h.alive ? 'Check-in' : 'Trip attempt'}</div>
              <div class="meta">{new Date(Number(h.time) * 1000).toLocaleString()} · block <span class="mono">{h.blockNumber.toString()}</span></div>
            </div>
            <span class="mono meta" title="state, inputs (expired, alive) → new state">
              {h.stateBefore} · {h.expired}{h.alive} → <b style={{ color: h.stateAfter ? '#e9b44c' : undefined }}>{h.stateAfter}</b>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
