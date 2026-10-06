import type { AgentTaskRecord, MessageRecord, ToolTrace } from '@travelclaw/shared';
import {
  Brain,
  ChevronDown,
  CloudSun,
  Coins,
  FileText,
  Globe,
  Hotel,
  Luggage,
  Map,
  MapPin,
  PenLine,
  Plane,
  Stamp,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatWhen } from '../format';

/**
 * The visible "how it decided" layer of a chat: every tool the desk ran (and who
 * asked for it — the model or the deterministic router), every desk it woke, and
 * which model wrote the final reply. It is a trail, not a log: plain words, in the
 * order they happened, collapsible once read.
 */

const TOOL_META: Record<string, { label: string; icon: LucideIcon }> = {
  'trip.outline': { label: 'Planned a day-by-day outline', icon: Map },
  'budget.estimate': { label: 'Estimated a budget', icon: Wallet },
  'packing.list': { label: 'Built a packing list', icon: Luggage },
  'places.suggest': { label: 'Suggested places', icon: MapPin },
  'currency.convert': { label: 'Converted a currency', icon: Coins },
  'weather.outlook': { label: 'Checked the weather', icon: CloudSun },
  'visa.notes': { label: 'Checked entry notes', icon: Stamp },
  'memory.remember': { label: 'Kept a note in memory', icon: Brain },
  'web.search': { label: 'Searched the web', icon: Globe },
  'web.fetch': { label: 'Read a page', icon: FileText },
};

const TASK_STATUS: Record<AgentTaskRecord['status'], string> = {
  working: 'searching now',
  awaiting: 'needs a detail from you',
  completed: 'finished with a real search result',
  accepted: 'you marked it complete',
  rejected: 'you sent it back',
};

const SOURCE_LABEL: Record<NonNullable<ToolTrace['source']>, string> = {
  model: 'the model asked for this',
  router: 'the desk router chose this',
};

interface Step {
  key: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  source?: ToolTrace['source'];
  ok?: boolean;
}

export function ProcessTrail({
  message,
  tasks,
  latest,
}: {
  message: MessageRecord;
  /** Desks this message woke — they are steps too, and they move as they finish. */
  tasks: AgentTaskRecord[];
  /** True only for the newest assistant message: its trail starts open. */
  latest?: boolean;
}) {
  // Only the newest trail opens itself; earlier ones collapse once something newer lands.
  const [open, setOpen] = useState(Boolean(latest));
  useEffect(() => {
    if (!latest) setOpen(false);
  }, [latest]);

  const steps: Step[] = [];
  for (const task of tasks) {
    steps.push({
      key: task.id,
      icon: task.kind === 'flight' ? Plane : Hotel,
      title: `Woke the ${task.agentName}`,
      detail: `It is on pass ${task.pass} — ${TASK_STATUS[task.status]}.`,
      ok: task.status !== 'rejected',
    });
  }
  for (const [index, tool] of message.tools.entries()) {
    const meta = TOOL_META[tool.name] ?? {
      label: tool.name,
      icon: FileText,
    };
    steps.push({
      key: `${message.id}-tool-${index}-${tool.name}`,
      icon: meta.icon,
      title: meta.label,
      detail: tool.summary,
      source: tool.source,
      ok: tool.ok,
    });
  }
  steps.push({
    key: `${message.id}-reply`,
    icon: PenLine,
    title: 'Wrote the reply',
    detail: `${modelLabel(message)} put the answer together, grounded on what ran above.`,
    ok: true,
  });

  const when = formatWhen(message.createdAt);

  if (!stepsHaveProcess(steps)) {
    // Nothing ran — the model answered from its own notes. Provenance, not a disclosure.
    return (
      <p className="trail-meta">
        <Workflow size={12} aria-hidden="true" />
        answered directly · {modelLabel(message)} · {when}
      </p>
    );
  }

  return (
    <div className="trail">
      <button
        type="button"
        className="trail-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="trail-title">
          <Workflow size={13} aria-hidden="true" />
          Agent process
        </span>
        <span className="trail-count">
          {steps.length} {steps.length === 1 ? 'step' : 'steps'}
        </span>
        <span className="trail-via">
          {modelLabel(message)} · {when}
        </span>
        <ChevronDown
          size={14}
          className={open ? 'trail-chev open' : 'trail-chev'}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <ol className="trail-steps">
          {steps.map((step) => {
            const Icon = step.icon;
            const failed = step.ok === false;
            return (
              <li key={step.key} className={failed ? 'trail-step failed' : 'trail-step'}>
                <span className="step-icon" aria-hidden="true">
                  <Icon size={13} />
                </span>
                <div className="step-body">
                  <p className="step-line">
                    <strong>{step.title}</strong>
                    {step.source ? (
                      <span className="source-chip">{SOURCE_LABEL[step.source]}</span>
                    ) : null}
                    {failed ? <span className="source-chip bad">did not run</span> : null}
                  </p>
                  {step.detail ? <p className="step-detail">{step.detail}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function stepsHaveProcess(steps: Step[]): boolean {
  // The closing "wrote the reply" step is always there; a real process has more.
  return steps.length > 1;
}

function modelLabel(message: MessageRecord): string {
  if (message.provider === 'desk') return 'the desk';
  return message.model || message.provider || 'the desk';
}
