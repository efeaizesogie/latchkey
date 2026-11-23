import { useEffect, useState } from 'preact/hooks';
import { isAddress, getAddress, parseEther, decodeEventLog, type Address, type Hash } from 'viem';
import { account, send, explain, same, short, type TxStage } from '../lib/chain';
import { net, dep, WINDOWS, GRACES, DEMO_WINDOW, DEMO_GRACE, isFork, isTestnet, hasHerald, ZERO } from '../lib/config';
import { factoryAbi } from '../lib/abi';
import { factoryInfo, fmt, windowLabel, resolveInbox } from '../lib/vault';
import { Err, TxNote } from '../ui';
import { go, picker } from '../app';

type Kind = 'backup' | 'heir';
const STEPS = 4;

/** An optional TapeSend inbox: a container address, or an on-chain name like 15.2.272.tape. */
function useInbox() {
  const [text, setText] = useState('');
  const [addr, setAddr] = useState<Address | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let live = true;
    setAddr(null);
    setBad(false);
    if (!text.trim()) return;
    resolveInbox(text).then((a) => { if (live) { setAddr(a); setBad(!a); } }).catch(() => live && setBad(true));
    return () => { live = false; };
  }, [text]);
  return { text, setText, addr, bad };
}

function InboxField({ label, hint, inbox }: { label: string; hint: string; inbox: ReturnType<typeof useInbox> }) {
  return (
    <label class="field">
      <span>{label}</span>
      <input class={`input ${inbox.bad ? 'bad' : ''}`} placeholder="e.g. 15.2.272.tape (optional)" spellcheck={false} value={inbox.text} onInput={(e) => inbox.setText((e.target as HTMLInputElement).value)} />
      <small class="meta" style={{ display: 'block', marginTop: '6px' }}>
        {inbox.bad ? 'Not a TapeOut container or on-chain name.' : inbox.addr ? <>Container <span class="mono">{short(inbox.addr)}</span></> : hint}
      </small>
    </label>
  );
}

export function Create() {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>('backup');
  const [to, setTo] = useState('');
  const [win, setWin] = useState(WINDOWS[1].seconds);
  const [grace, setGrace] = useState(GRACES[1].seconds);
  const [g, setG] = useState(['', '', '']);
  const [deposit, setDeposit] = useState('');
  const [fee, setFee] = useState<bigint | null>(null);
  const [stage, setStage] = useState<TxStage>('idle');
  const [hash, setHash] = useState<Hash>();
  const [err, setErr] = useState<string | null>(null);
  const heirInbox = useInbox();
  const ownerInbox = useInbox();
  const demo = isFork || isTestnet || new URLSearchParams(location.search).has('demo');
  const windows = demo ? [DEMO_WINDOW, ...WINDOWS] : WINDOWS;
  const graces = demo ? [DEMO_GRACE, ...GRACES] : GRACES;

  useEffect(() => { factoryInfo().then((f) => f && setFee(f.setupFee)).catch(() => {}); }, []);

  const addrOk = isAddress(to.trim());
  const selfAddr = addrOk && same(to.trim(), account.value);
  const gTrim = g.map((x) => x.trim());
  const gBad = gTrim.map((x, i) =>
    !!x && (!isAddress(x) || same(x, account.value) || same(x, to.trim()) || gTrim.slice(0, i).some((y) => same(y, x)))
  );
  const gCount = gTrim.filter((x, i) => x && !gBad[i]).length;
  let depositWei = 0n;
  let depositBad = false;
  try { depositWei = deposit.trim() ? parseEther(deposit.trim()) : 0n; } catch { depositBad = true; }
  const busy = stage === 'preparing' || stage === 'signing' || stage === 'pending';

  async function create() {
    setErr(null);
    if (!account.value) { picker.value = true; return; }
    if (!dep) { setErr('Latchkey is not deployed on this network yet.'); return; }
    try {
      const seats = gTrim.map((x, i) => (x && !gBad[i] ? getAddress(x) : ZERO)) as [Address, Address, Address];
      const rc = await send(
        {
          address: dep.factory,
          abi: factoryAbi,
          functionName: 'createVault',
          args: [getAddress(to.trim()), BigInt(win), BigInt(grace), seats, ownerInbox.addr ?? ZERO, heirInbox.addr ?? ZERO],
          value: (fee ?? 0n) + depositWei,
        },
        (s, h) => { setStage(s); if (h) setHash(h); }
      );
      for (const l of rc.logs) {
        try {
          const ev = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
          if (ev.eventName === 'VaultCreated') { go(`/v/${(ev.args as any).vault}?new=1`); return; }
        } catch {}
      }
      go('/mine');
    } catch (e) {
      setStage('idle');
      setErr(explain(e));
    }
  }

  const who = kind === 'backup' ? 'your backup wallet' : 'your heir';
  const label = (list: { label: string; seconds: number }[], s: number) => list.find((w) => w.seconds === s)?.label ?? windowLabel(s);
  const nav = (next?: () => void, disabled?: boolean) => (
    <div class="row">
      {step > 0 && <button class="btn" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>}
      {next && <button class="btn primary" disabled={disabled} onClick={next}>Continue</button>}
    </div>
  );

  return (
    <section class="shell section">
      <div class="narrow stack" style={{ '--gap': '24px' } as any}>
        <div class="steps" aria-hidden="true">{Array.from({ length: STEPS }, (_, i) => <i class={i <= step ? 'on' : ''} />)}</div>

        {step === 0 && (
          <div class="stack" style={{ '--gap': '20px' } as any}>
            <span class="meta">Step 1 of {STEPS}</span>
            <h2>Who should it open for?</h2>
            <div class="seg" role="group" aria-label="Receiver type">
              <button aria-pressed={kind === 'backup'} onClick={() => setKind('backup')}>My backup wallet</button>
              <button aria-pressed={kind === 'heir'} onClick={() => setKind('heir')}>Someone I trust</button>
            </div>
            <p class="muted">
              {kind === 'backup'
                ? 'A second wallet you keep somewhere else, like a hardware wallet or a seed phrase in a safe. If you lose this one, your funds find their way back to you.'
                : 'A spouse, a sibling, a child. They don’t need to do anything today. Send them the vault link later; it works without us.'}
            </p>
            <label class="field">
              <span>Address on X Layer</span>
              <input class={`input ${to && !addrOk ? 'bad' : ''}`} autoComplete="off" spellcheck={false} placeholder="0x…" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
            </label>
            {to && !addrOk && <p class="meta">That doesn’t look like an X Layer address (0x followed by 40 characters).</p>}
            {selfAddr && <p class="err">That’s the wallet you’re connected with. Pick a different one, or the vault can never open for anyone else.</p>}
            {hasHerald && <InboxField label="Their TapeSend inbox" hint="If they have a TapeOut container, the vault messages it over TapeSend the moment it opens." inbox={heirInbox} />}
            {nav(() => setStep(1), !addrOk || selfAddr || heirInbox.bad)}
          </div>
        )}

        {step === 1 && (
          <div class="stack" style={{ '--gap': '20px' } as any}>
            <span class="meta">Step 2 of {STEPS}</span>
            <h2>How long a silence means something is wrong?</h2>
            <div class="chips">
              {windows.map((w) => (
                <button class="chip" aria-pressed={win === w.seconds} onClick={() => setWin(w.seconds)}><b>{w.label}</b><small>{w.hint}</small></button>
              ))}
            </div>
            <h3>Then a grace period</h3>
            <p class="muted">When the silence runs out, anyone can start a grace period{hasHerald ? ', and you get a TapeSend message if you gave an inbox' : ''}. One check-in during it cancels everything.</p>
            <div class="chips">
              {graces.map((w) => (
                <button class="chip" aria-pressed={grace === w.seconds} onClick={() => setGrace(w.seconds)}><b>{w.label}</b><small>{w.hint}</small></button>
              ))}
            </div>
            {nav(() => setStep(2))}
          </div>
        )}

        {step === 2 && (
          <div class="stack" style={{ '--gap': '20px' } as any}>
            <span class="meta">Step 3 of {STEPS} · optional</span>
            <h2>Guardians</h2>
            <p class="muted">
              Up to three people you trust. During a grace period, two of them can confirm you are really gone, so {who} does not have to wait it out.
              They can never do anything while you are checking in, and they never touch the funds.
            </p>
            {[0, 1, 2].map((i) => (
              <label class="field">
                <span>Guardian {i + 1}</span>
                <input
                  class={`input ${gBad[i] ? 'bad' : ''}`} placeholder="0x… (optional)" spellcheck={false} value={g[i]}
                  onInput={(e) => { const val = (e.target as HTMLInputElement).value; setG((prev) => prev.map((x, k) => (k === i ? val : x))); }}
                />
              </label>
            ))}
            {gBad.some(Boolean) && <p class="meta">Each guardian must be a different address, and not you or the receiver.</p>}
            {gCount === 1 && <p class="note">With one guardian, the grace period always runs its full length: it takes two to end it early.</p>}
            {nav(() => setStep(3), gBad.some(Boolean))}
          </div>
        )}

        {step === 3 && (
          <div class="stack" style={{ '--gap': '20px' } as any}>
            <span class="meta">Step 4 of {STEPS}</span>
            <h2>Check it reads right.</h2>
            <div class="card">
              <p style={{ fontSize: '18px' }}>
                If I don’t check in for <b>{label(windows, win)}</b>, a grace period of <b>{label(graces, grace)}</b> starts. If I still don’t check in{gCount >= 2 ? ', or two of my guardians confirm' : ''}, the latch trips and <b class="mono">{short(to.trim())}</b> ({who}) can claim everything in this vault.
              </p>
            </div>
            {hasHerald && <InboxField label="Your own TapeSend inbox" hint="Get a TapeSend message when your grace period starts." inbox={ownerInbox} />}
            <label class="field">
              <span>Put some OKB in now (optional; you can add USDT next)</span>
              <input class={`input ${depositBad ? 'bad' : ''}`} inputMode="decimal" placeholder="0.0" value={deposit} onInput={(e) => setDeposit((e.target as HTMLInputElement).value)} />
            </label>
            <dl class="kv">
              <dt>Setup fee</dt><dd class="num">{fee === null ? '…' : `${fmt(fee, 18)} OKB`}</dd>
              <dt>Guardians</dt><dd>{gCount || 'None'}</dd>
              <dt>You keep</dt><dd>Full control while the latch is open</dd>
              <dt>Network</dt><dd>{net.name}</dd>
            </dl>
            <Err msg={err} />
            <TxNote stage={stage} hash={hash} what="Create vault" />
            <div class="row">
              <button class="btn" onClick={() => setStep(2)} disabled={busy}>Back</button>
              <button class="btn primary" onClick={create} disabled={depositBad || busy || ownerInbox.bad}>
                {!account.value ? 'Connect wallet' : busy ? 'Creating…' : 'Create vault'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
