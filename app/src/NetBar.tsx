import { useEffect, useRef, useState } from 'preact/hooks';
import { parseAbi, type Hash } from 'viem';
import { NETS, net, isTestnet, switchNet, FAUCET_URL, type Net } from './lib/config';
import { account, send, explain, pub, type TxStage } from './lib/chain';
import { picker } from './Connect';

const faucetAbi = parseAbi(['function faucet()', 'error TooSoon(uint256 nextAt)', 'function balanceOf(address) view returns (uint256)']);

/** Header control: which network you are on, and a menu to switch. */
export function NetSwitch() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', off);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', off); };
  }, [open]);
  const options: { key: Net['key']; label: string; hint: string }[] = [
    { key: 'xlayer', label: 'X Layer', hint: NETS.xlayer.dep ? 'Mainnet · real funds' : 'Mainnet · launching soon' },
    { key: 'testnet', label: 'X Layer testnet', hint: NETS.testnet.dep ? 'Free test tokens' : 'Not deployed yet' },
    ...(NETS.fork.dep && (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? [{ key: 'fork' as const, label: 'Local fork', hint: 'Developer rehearsal' }] : []),
  ];
  const short = net.key === 'xlayer' ? 'X Layer' : net.key === 'testnet' ? 'Testnet' : 'fork';
  return (
    <div class="netswitch" ref={box}>
      <button class={`netpill ${isTestnet ? 'is-test' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Switch network">
        {short} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div class="netmenu" role="menu">
          {options.map((o) => {
            const ready = o.key === 'xlayer' ? true : !!NETS[o.key].dep;
            return (
              <button role="menuitemradio" aria-checked={net.key === o.key} disabled={!ready} onClick={() => (net.key === o.key ? setOpen(false) : switchNet(o.key))}>
                <span>{o.label}{net.key === o.key && <span class="tick-mark" aria-hidden="true"> ✓</span>}</span>
                <small>{o.hint}</small>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Thin bar under the header: testnet tools, or a pointer to testnet before the mainnet launch. */
export function NetBanner() {
  const [stage, setStage] = useState<TxStage>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  const token = NETS.testnet.dep?.token;
  const a = account.value;

  const refresh = () => {
    if (isTestnet && token && a) pub.readContract({ address: token, abi: faucetAbi, functionName: 'balanceOf', args: [a] }).then(setBal).catch(() => {});
  };
  useEffect(refresh, [a]);

  if (!isTestnet) {
    if (net.key === 'xlayer' && !NETS.xlayer.dep && NETS.testnet.dep)
      return (
        <div class="netbanner">
          <div class="shell netbanner__row">
            <span>Latchkey is live on <b>X Layer testnet</b> while mainnet launches. Try the whole journey for free.</span>
            <button class="btn small" onClick={() => switchNet('testnet')}>Try it on testnet</button>
          </div>
        </div>
      );
    return null;
  }

  const drip = async () => {
    setMsg(null);
    if (!a) { picker.value = true; return; }
    try {
      await send({ address: token!, abi: faucetAbi, functionName: 'faucet' }, (s: TxStage, _h?: Hash) => setStage(s));
      setMsg('1,000 tUSDT0 is in your wallet.');
      refresh();
    } catch (e) {
      const t = explain(e);
      setMsg(t);
    }
    setStage('idle');
  };
  const busy = stage === 'preparing' || stage === 'signing' || stage === 'pending';

  return (
    <div class="netbanner is-test" role="note">
      <div class="shell netbanner__row">
        <span><b>Testnet.</b> Test tokens have no value. The circuits run on Latchkey’s TAP-02 evaluator, since TapeOut is mainnet only.</span>
        <span class="row wrap" style={{ gap: '8px' }}>
          <a class="btn small quiet" href={FAUCET_URL} target="_blank" rel="noreferrer">Get test OKB ↗</a>
          <button class="btn small" onClick={drip} disabled={busy}>{busy ? 'Sending…' : a ? 'Get 1,000 tUSDT0' : 'Connect for test dollars'}</button>
        </span>
      </div>
      {(msg || (bal !== null && bal > 0n)) && (
        <div class="shell meta" style={{ paddingBottom: '8px' }} aria-live="polite">{msg ?? `You hold ${(Number(bal) / 1e6).toLocaleString('en-US')} tUSDT0.`}</div>
      )}
    </div>
  );
}
