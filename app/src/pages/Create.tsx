import { useEffect, useState } from 'preact/hooks';
import { isAddress, getAddress, parseEther, decodeEventLog, type Hash } from 'viem';
import { account, send, explain, same, short, type TxStage } from '../lib/chain';
import { net, WINDOWS, DEMO_WINDOW, isFork } from '../lib/config';
import { factoryAbi } from '../lib/abi';
import { factoryInfo, fmt, windowLabel } from '../lib/vault';
import { Err, TxNote } from '../ui';
import { go, picker } from '../app';

type Kind = 'backup' | 'heir';

export function Create() {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>('backup');
  const [to, setTo] = useState('');
  const [win, setWin] = useState(WINDOWS[1].seconds);
  const [deposit, setDeposit] = useState('');
  const [fee, setFee] = useState<bigint | null>(null);
  const [stage, setStage] = useState<TxStage>('idle');
  const [hash, setHash] = useState<Hash>();
  const [err, setErr] = useState<string | null>(null);
  const demo = isFork || new URLSearchParams(location.search).has('demo');
  const windows = demo ? [DEMO_WINDOW, ...WINDOWS] : WINDOWS;

  useEffect(() => { factoryInfo().then((f) => f && setFee(f.setupFee)).catch(() => {}); }, []);

  const addrOk = isAddress(to.trim());
  const selfAddr = addrOk && same(to.trim(), account.value);
  let depositWei = 0n;
  let depositBad = false;
  try { depositWei = deposit.trim() ? parseEther(deposit.trim()) : 0n; } catch { depositBad = true; }

  async function create() {
    setErr(null);
    if (!account.value) { picker.value = true; return; }
    if (!net.factory) { setErr('Latchkey is not deployed on this network yet.'); return; }
    try {
      const rc = await send(
        { address: net.factory, abi: factoryAbi, functionName: 'createVault', args: [getAddress(to.trim()), BigInt(win)], value: (fee ?? 0n) + depositWei },
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
  return (
    <section class="shell section">
      <div class="narrow stack" style={{ '--gap': '24px' } as any}>
        <div class="steps" aria-hidden="true">{[0, 1, 2].map((i) => <i class={i <= step ? 'on' : ''} />)}</div>

        {step === 0 && (
          <div class="stack" style={{ '--gap': '20px' } as any}>
            <span class="meta">Step 1 of 3</span>
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
              <input
                class={`input ${to && !addrOk ? 'bad' : ''}`} inputMode="text" autoComplete="off" spellcheck={false}
                placeholder="0x…" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)}
              />
            </label>
            {to && !addrOk && <p class="meta">That doesn’t look like an X Layer address (0x followed by 40 characters).</p>}
            {selfAddr && <p class="err">That’s the wallet you’re connected with. Pick a different one, or the vault can never open for anyone else.</p>}
            <div class="row">
              <button class="btn primary" disabled={!addrOk || selfAddr} onClick={() => setStep(1)}>Continue</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div class="stack" style={{ '--gap': '20px' } as any}>
            <span class="meta">Step 2 of 3</span>
            <h2>How long a silence means something is wrong?</h2>
            <div class="chips">
              {windows.map((w) => (
                <button class="chip" aria-pressed={win === w.seconds} onClick={() => setWin(w.seconds)}>
                  <b>{w.label}</b><small>{w.hint}</small>
                </button>
              ))}
            </div>
            <p class="muted">Every check-in restarts the clock. When it runs out, anyone may trip the latch, and from then on only {who} can take the funds.</p>
            <div class="row">
              <button class="btn" onClick={() => setStep(0)}>Back</button>
              <button class="btn primary" onClick={() => setStep(2)}>Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div class="stack" style={{ '--gap': '20px' } as any}>
            <span class="meta">Step 3 of 3</span>
            <h2>Check it reads right.</h2>
            <div class="card">
              <p style={{ fontSize: '18px' }}>
                If I don’t check in for <b>{windows.find((w) => w.seconds === win)?.label ?? windowLabel(win)}</b>, anyone can trip the latch, and{' '}
                <b class="mono">{short(to.trim())}</b> ({who}) can claim everything in this vault.
              </p>
            </div>
            <label class="field">
              <span>Put some OKB in now (optional; you can add USDT next)</span>
              <input class={`input ${depositBad ? 'bad' : ''}`} inputMode="decimal" placeholder="0.0" value={deposit} onInput={(e) => setDeposit((e.target as HTMLInputElement).value)} />
            </label>
            <dl class="kv">
              <dt>Setup fee</dt><dd class="num">{fee === null ? '…' : `${fmt(fee, 18)} OKB`}</dd>
              <dt>You keep</dt><dd>Full control while the latch is open</dd>
              <dt>Network</dt><dd>{net.name}</dd>
            </dl>
            <Err msg={err} />
            <TxNote stage={stage} hash={hash} what="Create vault" />
            <div class="row">
              <button class="btn" onClick={() => setStep(1)} disabled={stage === 'preparing' || stage === 'signing' || stage === 'pending'}>Back</button>
              <button class="btn primary" onClick={create} disabled={depositBad || stage === 'preparing' || stage === 'signing' || stage === 'pending'}>
                {!account.value ? 'Connect wallet' : stage === 'idle' || stage === 'done' ? 'Create vault' : 'Creating…'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
