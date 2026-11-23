import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import qrcode from 'qrcode-generator';
import type { Hash } from 'viem';
import { explorerTx } from './lib/config';
import { waiting, type TxStage } from './lib/chain';

export function Mark({ size = 22 }: { size?: number }) {
  // A key bow with one square bit: the latch.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="8" cy="12" r="5.25" stroke="currentColor" stroke-width="1.5" />
      <path d="M13.25 12H22" stroke="currentColor" stroke-width="1.5" />
      <rect x="17" y="12.75" width="3.5" height="3.5" fill="#e9b44c" />
    </svg>
  );
}

/** The latch bit. Rolls the digit when it changes. */
export function Bit({ on, big, label }: { on: boolean; big?: boolean; label?: string }) {
  const prev = useRef(on);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prev.current !== on) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 520);
      prev.current = on;
      return () => clearTimeout(t);
    }
  }, [on]);
  return (
    <div class={`bit ${on ? 'on' : ''} ${big ? 'big' : ''} ${flash ? 'flash' : ''}`} role="img" aria-label={label ?? (on ? 'Latch tripped: 1' : 'Latch open: 0')}>
      <span class="roll" key={on ? 1 : 0}>{on ? '1' : '0'}</span>
    </div>
  );
}

/** Thin countdown ring. `left` from 0 to 1. */
export function Ring({ left, children, warn }: { left: number; children: ComponentChildren; warn?: boolean }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, left));
  const low = warn || v < 0.1;
  return (
    <div class="ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} stroke="#2f2f3e" stroke-width="1.5" fill="none" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke-width="2" stroke-linecap="round"
          stroke={low ? '#e9b44c' : '#ececf2'}
          stroke-dasharray={`${c * v} ${c}`}
          style={{ transition: 'stroke-dasharray .6s ease' }}
        />
      </svg>
      <div class="center">{children}</div>
    </div>
  );
}

export function Qr({ text }: { text: string }) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const svg = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  return <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Copy({ text, label = 'Copy', onCopied }: { text: string; label?: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <button
      class="btn small quiet"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch {
          const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
        }
        setDone(true); setTimeout(() => setDone(false), 1400);
        onCopied?.();
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export function TxNote({ stage, hash, what }: { stage: TxStage; hash?: Hash; what: string }) {
  if (stage === 'idle') return null;
  const link = hash ? explorerTx(hash) : '';
  const text =
    stage === 'preparing' ? `${what}: checking it will succeed…` :
    stage === 'signing' ? `Confirm “${what}” in your wallet…` :
    stage === 'pending' ? `${what}: waiting for X Layer…` :
    stage === 'done' ? `${what}: done.` : '';
  if (!text) return null;
  return (
    <p class="meta" aria-live="polite">
      {text}{' '}
      {stage === 'signing' && waiting.value && <button class="linkbtn" onClick={() => waiting.value?.cancel()}>Cancel</button>}
      {hash && (link ? <a href={link} target="_blank" rel="noreferrer" class="mono">{hash.slice(0, 10)}…</a> : <span class="mono">{hash.slice(0, 10)}…</span>)}
    </p>
  );
}

export function Err({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p class="err" role="alert">{msg}</p>;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
