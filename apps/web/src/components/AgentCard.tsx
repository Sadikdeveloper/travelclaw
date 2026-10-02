import type { AgentTaskRecord, TaskDecision } from '@travelclaw/shared';
import { Check, Hotel, Plane, Undo2 } from 'lucide-react';

const label: Record<AgentTaskRecord['status'], string> = {
  working: 'Working',
  awaiting: 'Ready for you',
  accepted: 'Complete',
  rejected: 'Sent back',
};

/**
 * A desk this message woke, as it moves: working, then waiting on the traveler's
 * call. It sits under the process trail as the live half of the same story — the
 * trail says what happened, the card asks what happens next.
 */
export function AgentCard({
  task,
  busy,
  onDecide,
}: {
  task: AgentTaskRecord;
  busy: boolean;
  onDecide: (decision: TaskDecision) => void;
}) {
  const Icon = task.kind === 'flight' ? Plane : Hotel;
  return (
    <article className="agent-card" aria-live="polite">
      <header>
        <span className="agent-card-name">
          <span className="agent-card-icon" aria-hidden="true">
            <Icon size={14} />
          </span>
          {task.agentName}
        </span>
        <span className={task.status === 'working' ? 'status-chip working' : 'status-chip'}>
          {task.status === 'working' ? <span className="pulse" aria-hidden="true" /> : null}
          {label[task.status]}
        </span>
      </header>
      <p>
        {task.status === 'working' ? 'Working on it. Nothing is booked.' : task.summary}
      </p>
      {task.status === 'awaiting' ? (
        <div className="row agent-card-actions">
          <button
            className="btn copper"
            type="button"
            disabled={busy}
            onClick={() => onDecide('complete')}
          >
            <Check size={15} aria-hidden="true" />
            Yes, complete
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => onDecide('no')}
          >
            No
          </button>
          <button
            className="btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => onDecide('still_working')}
          >
            <Undo2 size={14} aria-hidden="true" />
            Still working
          </button>
        </div>
      ) : null}
    </article>
  );
}
