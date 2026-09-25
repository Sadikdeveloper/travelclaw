import type { AgentTaskRecord, TaskDecision } from '@travelclaw/shared';

const label: Record<AgentTaskRecord['status'], string> = {
  working: 'Working',
  awaiting: 'Ready for you',
  accepted: 'Complete',
  rejected: 'Sent back',
};

export function AgentCard({
  task,
  busy,
  onDecide,
}: {
  task: AgentTaskRecord;
  busy: boolean;
  onDecide: (decision: TaskDecision) => void;
}) {
  return (
    <article className="agent-card" aria-live="polite">
      <header>
        <strong>{task.agentName}</strong>
        <span className={task.status === 'working' ? 'status-chip working' : 'status-chip'}>
          {task.status === 'working' ? <span className="pulse" aria-hidden="true" /> : null}
          {label[task.status]}
        </span>
      </header>
      <p>
        {task.status === 'working' ? 'Working on it. Nothing is booked.' : task.summary}
      </p>
      {task.status === 'awaiting' ? (
        <div className="row">
          <button
            className="btn copper"
            type="button"
            disabled={busy}
            onClick={() => onDecide('complete')}
          >
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
            Still working
          </button>
        </div>
      ) : null}
    </article>
  );
}
