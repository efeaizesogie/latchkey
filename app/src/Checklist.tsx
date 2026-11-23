import type { Step, StepKey } from './lib/onboarding';

type Props = {
  steps: Step[];
  title?: string;
  /** what the button for the current step does */
  actions: Partial<Record<StepKey, { label: string; run: () => void }>>;
  compact?: boolean;
  /** show what every remaining step means (the guide), not only the current one */
  explainAll?: boolean;
  onDismiss?: () => void;
};

/** Scroll to an element on this page and briefly highlight it (used by checklist buttons). */
export function focusSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  el.classList.remove('spotlight');
  void el.offsetWidth;
  el.classList.add('spotlight');
}

export function Checklist({ steps, title = 'Getting started', actions, compact, explainAll, onDismiss }: Props) {
  const done = steps.filter((s) => s.done).length;
  const current = steps.find((s) => !s.done);
  if (!current) return null;
  return (
    <section class={`checklist ${compact ? 'checklist--compact' : ''}`} aria-label={title}>
      <div class="spread">
        <div>
          <h3>{title}</h3>
          <p class="meta">{done} of {steps.length} done · next: {current.title.toLowerCase()}</p>
        </div>
        {onDismiss && <button class="linkbtn" onClick={onDismiss}>Hide</button>}
      </div>
      <div class="checklist__bar" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ol class="checklist__steps">
        {steps.map((s, i) => {
          const isCurrent = s === current;
          const a = actions[s.key];
          return (
            <li class={`${s.done ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}>
              <span class="checklist__mark" aria-hidden="true">{s.done ? '✓' : i + 1}</span>
              <div class="checklist__body">
                <b>{s.title}{s.done && <span class="sr-only"> (done)</span>}</b>
                {!compact && (isCurrent || (explainAll && !s.done)) && <p class={isCurrent ? '' : 'later'}>{s.body}</p>}
                {isCurrent && a && <button class="btn small primary" onClick={a.run}>{a.label} <span aria-hidden="true">→</span></button>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
