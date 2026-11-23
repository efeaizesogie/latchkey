import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { net, isFork } from './lib/config';
import { account, wallets, walletsScanned, connect, disconnect, short, FORK_ACTORS, useForkActor, walletName, walletIcon, walletLinks, explain } from './lib/chain';

/** Open with picker.value = true from anywhere. */
export const picker = signal(false);

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}

function WalletGlyph({ icon, name }: { icon?: string; name: string }) {
  if (icon) return <img class="wallet-icon" src={icon} alt="" width={28} height={28} />;
  return <span class="wallet-icon wallet-icon--blank" aria-hidden="true">{name.slice(0, 1)}</span>;
}

export function ConnectModal() {
  const open = picker.value;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  const close = () => {
    picker.value = false;
    setErr(null);
    setBusy(null);
  };

  // focus in, Esc to close, Tab stays inside, page behind does not scroll, focus returns afterwards
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => (panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current?.querySelector<HTMLElement>('button'))?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>('button, a[href], input')].filter((x) => !x.hasAttribute('disabled'));
        if (!items.length) return;
        const [first, last] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const pick = async (w: (typeof wallets.value)[number]) => {
    setErr(null);
    setBusy(w.id);
    try {
      await connect(w);
      close();
    } catch (e) {
      setErr(explain(e));
      setBusy(null);
    }
  };

  const links = walletLinks();
  const found = wallets.value;
  const a = account.value;

  return (
    <div class="modal-backdrop" onClick={close}>
      <div ref={panel} class="modal" role="dialog" aria-modal="true" aria-labelledby="connect-title" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <h3 id="connect-title">{a ? 'Your wallet' : 'Connect a wallet'}</h3>
          <button class="icon-btn" onClick={close} aria-label="Close"><CloseIcon /></button>
        </div>

        {a ? (
          <div class="stack" style={{ '--gap': '14px' } as any}>
            <div class="wallet-row wallet-row--static">
              <WalletGlyph icon={walletIcon.value} name={walletName.value || 'Wallet'} />
              <span class="wallet-name">{walletName.value || 'Connected'}<small class="mono">{short(a)}</small></span>
              <span class="tag">connected</span>
            </div>
            <div class="row wrap">
              <a class="btn small" href="#/mine" onClick={close}>My vaults</a>
              <button class="btn small quiet" onClick={() => { disconnect(); close(); }}>Disconnect</button>
            </div>
          </div>
        ) : (
          <div class="stack" style={{ '--gap': '14px' } as any}>
            <p class="muted" style={{ fontSize: '15px' }}>
              Latchkey never sees your keys. Your wallet asks you to approve each step{net.key === 'xlayer' ? ', on X Layer' : ''}.
            </p>

            {found.length > 0 && (
              <ul class="wallet-list" aria-label="Wallets found in this browser">
                {found.map((w, i) => (
                  <li>
                    <button class="wallet-row" onClick={() => pick(w)} disabled={!!busy} data-autofocus={i === 0 ? '' : undefined} aria-busy={busy === w.id}>
                      <WalletGlyph icon={w.icon} name={w.name} />
                      <span class="wallet-name">{w.name}<small>{busy === w.id ? 'Check your wallet…' : 'Detected'}</small></span>
                      <span class="chev" aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {walletsScanned.value && found.length === 0 && !isFork && (
              <div class="stack" style={{ '--gap': '10px' } as any}>
                <p class="note">No wallet in this browser.{isPhone() ? ' Open Latchkey inside your wallet app instead:' : ' Install OKX Wallet or MetaMask, then reload. On a phone, open this page inside the wallet app.'}</p>
                {isPhone() && (
                  <ul class="wallet-list">
                    <li><a class="wallet-row" href={links.okx} data-autofocus=""><WalletGlyph name="OKX" /><span class="wallet-name">Open in OKX Wallet<small>Discover tab, X Layer built in</small></span><span class="chev" aria-hidden="true">›</span></a></li>
                    <li><a class="wallet-row" href={links.metamask}><WalletGlyph name="MetaMask" /><span class="wallet-name">Open in MetaMask<small>In-app browser</small></span><span class="chev" aria-hidden="true">›</span></a></li>
                  </ul>
                )}
              </div>
            )}
            {!walletsScanned.value && found.length === 0 && <p class="meta" aria-live="polite">Looking for wallets…</p>}

            {isFork && FORK_ACTORS.length > 0 && (
              <div class="stack" style={{ '--gap': '8px' } as any}>
                <p class="meta">Test people on the local fork (Hardhat’s public test keys, worthless):</p>
                <ul class="wallet-list">
                  {FORK_ACTORS.map((p, i) => (
                    <li>
                      <button class="wallet-row" onClick={() => { useForkActor(i); close(); }} data-autofocus={found.length === 0 && i === 0 ? '' : undefined}>
                        <WalletGlyph name={p.name} />
                        <span class="wallet-name">{p.name}<small class="mono">{short(p.account.address)}</small></span>
                        <span class="chev" aria-hidden="true">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {err && <p class="err" role="alert">{err}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
