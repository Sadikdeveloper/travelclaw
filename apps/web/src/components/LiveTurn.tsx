import type { TurnStepRecord } from '@travelclaw/shared';
import {
  Brain,
  Check,
  ChevronRight,
  CircleDashed,
  CloudSun,
  Coins,
  FileText,
  Globe,
  Hotel,
  Luggage,
  Map,
  MapPin,
  Plane,
  Sparkles,
  Stamp,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

export interface LiveTurnState {
  steps: TurnStepRecord[];
  /** Provider reasoning, plus brief action summaries when a retry is needed. */
  reasoning: string;
  /** The answer, as the model writes it. */
  reply: string;
  modelLabel: string;
  provider: string;
  startedAt: number;
}

const TOOL_ICON: Record<string, LucideIcon> = {
  'trip.outline': Map,
  'budget.estimate': Wallet,
  'packing.list': Luggage,
  'places.suggest': MapPin,
  'currency.convert': Coins,
  'weather.outlook': CloudSun,
  'visa.notes': Stamp,
  'memory.remember': Brain,
  'web.search': Globe,
  'web.fetch': FileText,
};

function iconFor(step: TurnStepRecord): LucideIcon {
  if (step.kind === 'desk') return step.name === 'stay' ? Hotel : Plane;
  if (step.kind === 'browser') return Globe;
  if (step.kind === 'tool') return TOOL_ICON[step.name ?? ''] ?? FileText;
  return Sparkles;
}

/**
 * The live process view: what the desk is doing, right now, in order — the
 * model's thinking, each tool it asked for with the arguments it sent, the
 * desks and browser steps as they move, and the answer being written. Everything
 * here is something the gateway actually reported; nothing is a placeholder that
 * pretends work is happening.
 */
export function LiveTurn({ state, onStop }: { state: LiveTurnState; onStop: () => void }) {
  const elapsed = useElapsed(state.startedAt);
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const writing = !state.reply;

  return (
    <section className="live-turn" aria-live="polite" aria-busy="true">
      <header className="live-head">
        <span className="live-pulse" aria-hidden="true" />
        <span className="live-title">{writing ? 'Working' : 'Writing the reply'}</span>
        <span className="live-model">{state.modelLabel}</span>
        <span className="live-clock">{formatSeconds(elapsed)}</span>
        <button className="btn-ghost live-stop" type="button" onClick={onStop}>
          Stop
        </button>
      </header>

      {state.reasoning ? (
        <div className="live-reasoning">
          <button
            type="button"
            className="reasoning-head"
            aria-expanded={reasoningOpen}
            onClick={() => setReasoningOpen((value) => !value)}
          >
            <Brain size={13} aria-hidden="true" />
            <span>Thinking</span>
            <ChevronRight
              size={13}
              className={reasoningOpen ? 'reasoning-chev open' : 'reasoning-chev'}
            />
          </button>
          {reasoningOpen ? <p className="reasoning-body">{state.reasoning}</p> : null}
        </div>
      ) : null}

      {state.steps.length ? (
        <ol className="live-steps">
          {state.steps.map((step) => (
            <Step key={step.id} step={step} />
          ))}
        </ol>
      ) : (
        <p className="live-quiet">Reading your message…</p>
      )}

      {state.reply ? (
        <article className="bubble live-reply">
          <p className="live-reply-text">{state.reply}</p>
          <span className="live-caret" aria-hidden="true" />
        </article>
      ) : null}
    </section>
  );
}

function Step({ step }: { step: TurnStepRecord }) {
  const Icon = iconFor(step);
  const [open, setOpen] = useState(false);
  const long = (step.detail?.length ?? 0) > 120;
  const showDetail = Boolean(step.detail) && (!long || open);
  return (
    <li className={`live-step ${step.state} ${step.kind}`}>
      <span className="step-state" aria-hidden="true">
        {step.state === 'running' ? (
          <CircleDashed size={13} className="spin" />
        ) : step.state === 'done' ? (
          <Check size={13} />
        ) : (
          <X size={13} />
        )}
      </span>
      <div className="live-step-body">
        <p className="live-step-line">
          <Icon size={13} aria-hidden="true" />
          <strong>{step.label}</strong>
          {step.source ? (
            <span className="source-chip">
              {step.source === 'model'
                ? 'the model asked for this'
                : 'the desk router chose this'}
            </span>
          ) : null}
          {long && step.detail ? (
            <button
              type="button"
              className="step-more"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? 'less' : 'more'}
            </button>
          ) : null}
        </p>
        {showDetail && step.detail ? (
          <p
            className={step.kind === 'tool' ? 'live-step-detail mono' : 'live-step-detail'}
          >
            {step.detail}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [startedAt]);
  return Math.max(0, now - startedAt);
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}
