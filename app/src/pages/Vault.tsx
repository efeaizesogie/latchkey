import { useEffect, useRef, useState } from 'preact/hooks';
import { parseUnits, isAddress, getAddress, type Address, type Hash } from 'viem';
import { account, send, sendValue, explain, same, short, chainNow, forkSkip, type TxStage } from '../lib/chain';
import { vaultAbi, erc20Abi } from '../lib/abi';
import { net, dep, isFork, explorerAddr, WINDOWS, GRACES, ZERO, type Token } from '../lib/config';
import { loadVault, duration, windowLabel, fmt, heraldNotices, resolveInbox, type VaultView, type Notice } from '../lib/vault';
import { Bit, Ring, Qr, Copy, Err, TxNote, useNow } from '../ui';
import { picker } from '../app';

type Act = { stage: TxStage; hash?: Hash; what: string };
type Run = (what: string, fn: (on: (s: TxStage, h?: Hash) => void) => Promise<unknown>) => void;

export function VaultPage({ address }: { address: Address }) {
  const [v, setV] = useState<VaultView | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
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
      heraldNotices(30).then((r) => setNotices(r.notices.filter((n) => n.body.includes(address.toLowerCase())))).catch(() => {});
    } catch {
      setLoadErr(isAddress(address) ? 'Could not read this vault. Check the link, or try again in a moment.' : 'This link does not contain a valid vault address.');
    }
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [address]);

  const run: Run = async (what, fn) => {
    setErr(null);
    if (!account.value) { picker.value = true; return; }
    try {
      await fn((stage, hash) => setAct({ stage, hash, what }));
      await refresh();
    } catch (e) {
      setAct({ stage: 'idle', what });
      setErr(explain(e));
    }
  };
  const busy = act.stage === 'preparing' || act.stage === 'signing' || act.stage === 'pending';

  if (loadErr) return <section class="shell section"><div class="narrow stack"><h2>Vault not found</h2><p class="muted">{loadErr}</p><p><a href="#/">Back to Latchkey</a></p></div></section>;
  if (!v) return <section class="shell section"><div class="narrow"><p class="muted" aria-live="polite">Reading the vault from {net.name}…</p></div></section>;

  const isOwner = same(account.value, v.owner);
  const isHeir = same(account.value, v.heir);
  const seat = v.seats.findIndex((g) => g !== ZERO && same(account.value, g));
  const isGuardian = seat >= 0;
  const confirmedCount = [0, 1, 2].filter((i) => (v.confirmations >> i) & 1).length;
  const role = isOwner ? 'You own this vault' : isHeir ? 'You are the receiver' : isGuardian ? `You are guardian ${seat + 1}` : 'Watching';
  const funded = v.balances.filter((b) => b.raw > 0n);
  const poke = (what: string) => run(what, (on) => send({ address: v.address, abi: vaultAbi, functionName: 'poke' }, on));

  // what the circuit would do on a poke right now (same rule as the circuit; the contract asks the circuit itself)
  const windowLeft = v.deadline - now;
  const graceLeft = v.graceEndsAt - now;
  const canStartGrace = v.phase === 'open' && windowLeft <= 0;
  const canTrip = v.phase === 'grace' && (graceLeft <= 0 || confirmedCount >= 2);

  return (
    <section class="shell section" style={{ paddingTop: '28px' }}>
      <div class="narrow stack" style={{ '--gap': '20px' } as any}>
        <div class="spread">
          <div class="stack" style={{ '--gap': '4px' } as any}>
            <span class="meta">{role}</span>
            <span class="mono">{short(v.address)}</span>
          </div>
          <div class="row" style={{ gap: '8px' }}>
            <span class={`tag ${v.phase === 'open' ? '' : 'brass'}`}>{v.phase === 'open' ? 'open' : v.phase === 'grace' ? 'grace period' : 'tripped'}</span>
            <Bit on={v.phase === 'tripped'} />
          </div>
        </div>

        {fresh && isOwner && v.phase === 'open' && (
          <p class="note">Vault created. Fund it below, then send the link to {short(v.heir)} and your guardians, or keep it with your papers.</p>
        )}

        {/* ---------------------------------------------------------------- open */}
        {v.phase === 'open' && (
          <div class="card stack" style={{ '--gap': '20px', textAlign: 'center' } as any}>
            <Ring left={windowLeft / v.window}>
              <div>
                <div class="big">{windowLeft <= 0 ? '0' : duration(windowLeft).split(' ').slice(0, 2).join(' ')}</div>
                <div class="meta">{windowLeft <= 0 ? 'silence window passed' : 'until a grace period can start'}</div>
              </div>
            </Ring>
            <p class="muted">
              {windowLeft <= 0
                ? isOwner
                  ? 'Your window has passed, but no grace period has started. Check in now to keep it open.'
                  : `The owner has been quiet longer than ${windowLabel(v.window)}. Anyone can now start the ${windowLabel(v.grace)} grace period.`
                : `Last check-in ${duration(now - v.lastCheckIn)} ago. Window ${windowLabel(v.window)}, then a ${windowLabel(v.grace)} grace period.`}
            </p>
            {isOwner && <CheckIn v={v} busy={busy} run={run} />}
            {!isOwner && canStartGrace && <button class="btn primary block" disabled={busy} onClick={() => poke('Start grace period')}>Start the grace period</button>}
            {!account.value && !canStartGrace && <button class="btn block" onClick={() => (picker.value = true)}>Connect to check in</button>}
          </div>
        )}

        {/* ---------------------------------------------------------------- grace */}
        {v.phase === 'grace' && (
          <div class="card stack" style={{ '--gap': '20px', textAlign: 'center' } as any}>
            <Ring left={Math.max(0, graceLeft) / v.grace} warn>
              <div>
                <div class="big">{graceLeft <= 0 ? '0' : duration(graceLeft).split(' ').slice(0, 2).join(' ')}</div>
                <div class="meta">{graceLeft <= 0 ? 'grace period over' : 'of grace period left'}</div>
              </div>
            </Ring>
            <p class="muted">
              {isOwner
                ? 'You have been quiet past your window, so a grace period started. One check-in cancels it.'
                : canTrip
                  ? confirmedCount >= 2 && graceLeft > 0
                    ? 'Two guardians confirmed. Anyone can now trip the latch.'
                    : 'The grace period is over and the owner did not check in. Anyone can now trip the latch.'
                  : 'The owner has been quiet past their window. They can still cancel this with one check-in.'}
            </p>
            {v.guardians.length > 0 && (
              <p class="meta">{confirmedCount} of {v.guardians.length} guardian{v.guardians.length > 1 ? 's' : ''} confirmed{v.guardians.length >= 2 ? ' · 2 end the grace period early' : ''}</p>
            )}
            {isOwner && <CheckIn v={v} busy={busy} run={run} />}
            {isGuardian && !((v.confirmations >> seat) & 1) && !canTrip && (
              <button class="btn primary block" disabled={busy} onClick={() => run('Confirm', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'confirm' }, on))}>
                I confirm the owner is gone
              </button>
            )}
            {isGuardian && (v.confirmations >> seat) & 1 ? <p class="meta">You confirmed. A check-in by the owner clears all confirmations.</p> : null}
            {!isOwner && canTrip && <button class="btn primary block" disabled={busy} onClick={() => poke('Trip the latch')}>Trip the latch</button>}
          </div>
        )}

        {/* ---------------------------------------------------------------- tripped */}
        {v.phase === 'tripped' && (
          <div class="card stack" style={{ '--gap': '20px', textAlign: 'center' } as any}>
            <div style={{ display: 'grid', placeItems: 'center' }}><Bit on big /></div>
            <h2>{isHeir ? (funded.length ? 'This vault is yours to claim.' : 'Claimed. It’s all in your wallet.') : 'The latch has tripped.'}</h2>
            <p class="muted">
              Tripped {duration(now - v.trippedAt)} ago by its TapeOut circuit. It cannot be reopened.{' '}
              {isHeir ? '' : `Only ${short(v.heir)} can claim.`}
            </p>
            {isHeir && (
              <>
                <dl class="kv" style={{ width: '100%', textAlign: 'left' }}>
                  {funded.length === 0 && <><dt>Balance</dt><dd>Nothing left. Anything sent here later can be claimed too.</dd></>}
                  {funded.map((b) => <><dt>{b.token.symbol}</dt><dd class="num">{b.text}</dd></>)}
                  {funded.length > 0 && v.claimFeeBps > 0 && <><dt>Latchkey fee</dt><dd>{v.claimFeeBps / 100}% of each</dd></>}
                </dl>
                {funded.length > 0 && (
                  <button
                    class="btn primary block" disabled={busy}
                    onClick={() => run('Claim', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'claim', args: [funded.map((b) => b.token.address ?? ZERO)] }, on))}
                  >
                    Claim to my wallet
                  </button>
                )}
              </>
            )}
            {!account.value && <button class="btn block" onClick={() => (picker.value = true)}>I’m the receiver: connect</button>}
          </div>
        )}

        <Err msg={err} />
        <TxNote stage={act.stage} hash={act.hash} what={act.what} />

        {/* ---------------------------------------------------------------- details */}
        <div class="card stack">
          <div class="spread">
            <h3>In the vault</h3>
            <span class="meta">
              {v.agreement.agreed === true ? `Agreed by ${v.agreement.nodes} independent nodes` : v.agreement.agreed === false ? 'Nodes disagree: reload' : ''}
              {explorerAddr(v.address) && <> · <a href={explorerAddr(v.address)} target="_blank" rel="noreferrer">OKLink</a></>}
            </span>
          </div>
          <dl class="kv">{v.balances.map((b) => <><dt>{b.token.symbol}</dt><dd class="num">{b.text}</dd></>)}</dl>
          <dl class="kv">
            <dt>Opens for</dt><dd class="mono">{short(v.heir)}</dd>
            <dt>Owner</dt><dd class="mono">{short(v.owner)}</dd>
            <dt>Window · grace</dt><dd>{windowLabel(v.window)} · {windowLabel(v.grace)}</dd>
            <dt>Guardians</dt><dd>{v.guardians.length ? v.guardians.map(short).join(', ') : 'None'}</dd>
            <dt>TapeSend</dt><dd>{[v.ownerInbox && 'owner', v.heirInbox && 'receiver'].filter(Boolean).join(' + ') || 'Latchkey’s public feed only'}</dd>
          </dl>
        </div>

        {isOwner && v.phase !== 'tripped' && <Fund v={v} busy={busy} run={run} />}
        {isOwner && v.phase !== 'tripped' && <Manage v={v} busy={busy} run={run} />}
        {isOwner && v.phase !== 'tripped' && <Share v={v} />}

        <History v={v} notices={notices} />

        {isFork && (
          <div class="dev stack noprint" style={{ '--gap': '8px' } as any}>
            <p class="meta">Fork-only rehearsal: move the local chain’s clock.</p>
            <div class="row wrap">
              <button class="btn small" onClick={async () => { await forkSkip(v.window + 1); refresh(); }}>Skip the window</button>
              <button class="btn small" onClick={async () => { await forkSkip(v.grace + 1); refresh(); }}>Skip the grace period</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function CheckIn({ v, busy, run }: { v: VaultView; busy: boolean; run: Run }) {
  return (
    <button class="btn primary block" disabled={busy} onClick={() => run('Check in', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'checkIn' }, on))}>
      {busy ? 'Working…' : v.phase === 'grace' ? 'I’m here: cancel the grace period' : 'Check in'}
    </button>
  );
}

function Fund({ v, busy, run }: { v: VaultView; busy: boolean; run: Run }) {
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
        {net.tokens.map((t) => <button class="chip" style={{ minHeight: '48px' }} aria-pressed={t.symbol === tok.symbol} onClick={() => setTok(t)}><b>{t.symbol}</b></button>)}
      </div>
      <input class={`input ${bad ? 'bad' : ''}`} inputMode="decimal" placeholder={`Amount in ${tok.symbol}`} value={amt} onInput={(e) => setAmt((e.target as HTMLInputElement).value)} />
      <button
        class="btn block" disabled={busy || bad || raw === 0n}
        onClick={() => run(`Deposit ${tok.symbol}`, (on) => (tok.address ? send({ address: tok.address, abi: erc20Abi, functionName: 'transfer', args: [v.address, raw] }, on) : sendValue(v.address, raw, on)))}
      >
        Deposit {amt || ''} {tok.symbol}
      </button>
    </div>
  );
}

function Manage({ v, busy, run }: { v: VaultView; busy: boolean; run: Run }) {
  const [open, setOpen] = useState<'' | 'heir' | 'times' | 'guardians' | 'inbox' | 'withdraw'>('');
  const [heir, setHeir] = useState('');
  const [heirInbox, setHeirInbox] = useState('');
  const [win, setWin] = useState(v.window);
  const [grace, setGrace] = useState(v.grace);
  const [g, setG] = useState<string[]>(v.seats.map((x) => (x === ZERO ? '' : x)));
  const [inbox, setInbox] = useState('');
  const [wTok, setWTok] = useState<Token>(net.tokens[0]);
  const [wAmt, setWAmt] = useState('');
  const [localErr, setLocalErr] = useState<string | null>(null);
  const bal = v.balances.find((b) => b.token.symbol === wTok.symbol)?.raw ?? 0n;
  let raw = 0n, bad = false;
  try { raw = wAmt.trim() ? parseUnits(wAmt.trim(), wTok.decimals) : 0n; } catch { bad = true; }
  const toggle = (k: typeof open) => { setOpen(open === k ? '' : k); setLocalErr(null); };
  const resolveOr = async (s: string) => {
    if (!s.trim()) return ZERO;
    const a = await resolveInbox(s);
    if (!a) throw new Error('That is not a TapeOut container or on-chain name.');
    return a;
  };
  const row = (k: typeof open, label: preact.ComponentChildren, action: string) => (
    <div class="spread"><span>{label}</span><button class="linkbtn" onClick={() => toggle(k)}>{action}</button></div>
  );

  return (
    <div class="card stack" style={{ '--gap': '12px' } as any}>
      <h3>Settings</h3>
      <p class="meta">Every change also counts as a check-in.</p>
      {localErr && <p class="err">{localErr}</p>}
      <ul class="list">
        <li>
          {row('heir', <>Receiver <span class="mono meta">{short(v.heir)}</span></>, 'Change')}
          {open === 'heir' && (
            <div class="stack" style={{ marginTop: '12px', '--gap': '10px' } as any}>
              <input class="input" placeholder="0x… new receiver" value={heir} onInput={(e) => setHeir((e.target as HTMLInputElement).value)} />
              <input class="input" placeholder="their TapeSend inbox, e.g. 15.2.272.tape (optional)" value={heirInbox} onInput={(e) => setHeirInbox((e.target as HTMLInputElement).value)} />
              <button class="btn small" disabled={busy || !isAddress(heir.trim())} onClick={async () => {
                try { const ib = await resolveOr(heirInbox); run('Change receiver', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'setHeir', args: [getAddress(heir.trim()), ib] }, on)); }
                catch (e) { setLocalErr((e as Error).message); }
              }}>Save receiver</button>
            </div>
          )}
        </li>
        <li>
          {row('times', <>Window and grace <span class="meta">{windowLabel(v.window)} · {windowLabel(v.grace)}</span></>, 'Change')}
          {open === 'times' && (
            <div class="stack" style={{ marginTop: '12px', '--gap': '10px' } as any}>
              <div class="chips">{WINDOWS.map((w) => <button class="chip" style={{ minHeight: '48px' }} aria-pressed={win === w.seconds} onClick={() => setWin(w.seconds)}><b>{w.label}</b></button>)}</div>
              <div class="chips">{GRACES.map((w) => <button class="chip" style={{ minHeight: '48px' }} aria-pressed={grace === w.seconds} onClick={() => setGrace(w.seconds)}><b>{w.label} grace</b></button>)}</div>
              <button class="btn small" disabled={busy || (win === v.window && grace === v.grace)} onClick={() => run('Change timing', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'setTimes', args: [BigInt(win), BigInt(grace)] }, on))}>Save timing</button>
            </div>
          )}
        </li>
        <li>
          {row('guardians', <>Guardians <span class="meta">{v.guardians.length || 'none'}</span></>, 'Change')}
          {open === 'guardians' && (
            <div class="stack" style={{ marginTop: '12px', '--gap': '10px' } as any}>
              {[0, 1, 2].map((i) => (
                <input class="input" placeholder={`Guardian ${i + 1}: 0x… (optional)`} value={g[i]} onInput={(e) => { const val = (e.target as HTMLInputElement).value; setG((prev) => prev.map((x, k) => (k === i ? val : x))); }} />
              ))}
              <button class="btn small" disabled={busy || g.some((x) => x.trim() && !isAddress(x.trim()))} onClick={() =>
                run('Change guardians', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'setGuardians', args: [g.map((x) => (x.trim() ? getAddress(x.trim()) : ZERO)) as [Address, Address, Address]] }, on))
              }>Save guardians</button>
            </div>
          )}
        </li>
        <li>
          {row('inbox', <>Your TapeSend inbox <span class="meta">{v.ownerInbox ? short(v.ownerInbox) : 'none'}</span></>, 'Change')}
          {open === 'inbox' && (
            <div class="stack" style={{ marginTop: '12px', '--gap': '10px' } as any}>
              <input class="input" placeholder="e.g. 15.2.272.tape, empty to remove" value={inbox} onInput={(e) => setInbox((e.target as HTMLInputElement).value)} />
              <button class="btn small" disabled={busy} onClick={async () => {
                try { const ib = await resolveOr(inbox); run('Change inbox', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'setOwnerInbox', args: [ib] }, on)); }
                catch (e) { setLocalErr((e as Error).message); }
              }}>Save inbox</button>
            </div>
          )}
        </li>
        <li>
          {row('withdraw', 'Take funds back', 'Withdraw')}
          {open === 'withdraw' && (
            <div class="stack" style={{ marginTop: '12px', '--gap': '10px' } as any}>
              <div class="chips">{net.tokens.map((t) => <button class="chip" style={{ minHeight: '48px' }} aria-pressed={t.symbol === wTok.symbol} onClick={() => setWTok(t)}><b>{t.symbol}</b></button>)}</div>
              <div class="row"><input class="input" inputMode="decimal" placeholder="Amount" value={wAmt} onInput={(e) => setWAmt((e.target as HTMLInputElement).value)} /><button class="btn small quiet" onClick={() => setWAmt(fmt(bal, wTok.decimals, wTok.decimals).replace(/,/g, ''))}>Max</button></div>
              <button class="btn small" disabled={busy || bad || raw === 0n || raw > bal} onClick={() => run('Withdraw', (on) => send({ address: v.address, abi: vaultAbi, functionName: 'withdraw', args: [wTok.address ?? ZERO, raw, account.value!] }, on))}>Withdraw to my wallet</button>
            </div>
          )}
        </li>
      </ul>
    </div>
  );
}

function ics(v: VaultView) {
  // Remind at half the window, repeating.
  const stamp = (t: number) => new Date(t * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const days = Math.max(1, Math.round((v.window * 0.5) / 86400));
  const link = location.href.split('?')[0];
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Latchkey//EN', 'BEGIN:VEVENT',
    `UID:${v.address}@latchkey`, `DTSTAMP:${stamp(Math.floor(Date.now() / 1000))}`,
    `DTSTART:${stamp(v.lastCheckIn + Math.floor(v.window * 0.5))}`, 'DURATION:PT15M', `RRULE:FREQ=DAILY;INTERVAL=${days}`,
    'SUMMARY:Latchkey: check in', `DESCRIPTION:Tap Check in so your latch stays open. ${link}`, `URL:${link}`,
    'BEGIN:VALARM', 'TRIGGER:-PT0M', 'ACTION:DISPLAY', 'DESCRIPTION:Latchkey check-in', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function Share({ v }: { v: VaultView }) {
  const link = location.href.split('?')[0];
  const onchain = dep ? `tape://${dep.tapeName}/#/v/${v.address}` : '';
  const a = useRef<HTMLAnchorElement>(null);
  return (
    <div class="card stack" style={{ '--gap': '14px' } as any}>
      <h3>Don’t forget, and don’t keep it secret</h3>
      <p class="muted">Put check-in reminders in your calendar, and give the receiver and your guardians this link. It only lets them watch until the latch trips.</p>
      {onchain && <p class="mono meta" style={{ overflowWrap: 'anywhere' }}>{onchain}</p>}
      <div class="row wrap">
        <a ref={a} class="btn small" download="latchkey-check-in.ics" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics(v))}`}>Add reminders to calendar</a>
        <Copy text={link} label="Copy vault link" />
        {onchain && <Copy text={onchain} label="Copy on-chain link" />}
        <button class="btn small quiet" onClick={() => print()}>Print a card</button>
      </div>
    </div>
  );
}

const PHASE = ['open', 'grace', '·', 'tripped'];
function describe(h: { stateBefore: number; stateAfter: number; inputs: number }) {
  const alive = (h.inputs >> 1) & 1;
  if (h.stateAfter & 2 && !(h.stateBefore & 2)) return 'Latch tripped';
  if (h.stateAfter & 1 && !(h.stateBefore & 1)) return 'Grace period started';
  if (alive && h.stateBefore & 1) return 'Check-in, grace period cancelled';
  if (alive) return 'Check-in';
  return 'Poke';
}

function History({ v, notices }: { v: VaultView; notices: Notice[] }) {
  if (!v.history.length && !notices.length) return null;
  return (
    <div class="card stack">
      <div class="spread"><h3>Every beat of the circuit</h3><a class="meta" href="#/proof">What is this?</a></div>
      <ul class="list">
        {v.history.slice(0, 12).map((h) => {
          const bits = ['expired', 'alive', 'graceOver'].filter((_, k) => (h.inputs >> k) & 1);
          const g = (h.inputs >> 3) & 7;
          return (
            <li class="spread">
              <div>
                <div>{describe(h)}</div>
                <div class="meta">{new Date(Number(h.time) * 1000).toLocaleString()} · block <span class="mono">{h.blockNumber.toString()}</span></div>
              </div>
              <span class="mono meta" style={{ textAlign: 'right' }} title="state → new state, with the input bits the vault gave the circuit">
                {PHASE[h.stateBefore]} → <b style={{ color: h.stateAfter & 2 ? '#e9b44c' : undefined }}>{PHASE[h.stateAfter]}</b>
                <br />{bits.join(' ') || 'no inputs'}{g ? ` · guardians ${g.toString(2).padStart(3, '0')}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {notices.length > 0 && (
        <>
          <h3 style={{ marginTop: '18px' }}>TapeSend notices</h3>
          <ul class="list">
            {notices.map((n) => (
              <li>
                <div class="spread"><b style={{ fontWeight: 500 }}>{n.subject || 'Message'}</b>{n.verified && <span class="tag">digest ok</span>}</div>
                <div class="meta">{new Date(n.time * 1000).toLocaleString()} · to {n.to.slice(-40) === (dep?.container ?? '').slice(2).toLowerCase() ? 'Latchkey’s public feed' : `inbox ${short('0x' + n.to.slice(-40))}`} · #{n.inboxIndex}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
