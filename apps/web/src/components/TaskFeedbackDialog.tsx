import type { AgentTaskRecord, TaskDecision } from '@travelclaw/shared';
import { CheckCircle2, CircleX, PencilLine, X } from 'lucide-react';
import { useEffect } from 'react';

/**
 * A short, explicit close-out for a search that really reached a terminal result.
 * It is intentionally not attached to a generic chat reply or an in-progress desk:
 * a traveler should never be asked to grade work that has not actually run.
 */
export function TaskFeedbackDialog({
  task,
  busy,
  onDecision,
  onDismiss,
}: {
  task: AgentTaskRecord;
  busy: boolean;
  onDecision: (decision: TaskDecision) => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onDismiss]);

  return (
    <div className="task-feedback-backdrop" role="presentation">
      <section
        className="task-feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-feedback-title"
        aria-describedby="task-feedback-detail"
      >
        <header className="task-feedback-head">
          <div>
            <h2 id="task-feedback-title">Was this task successful?</h2>
            <p id="task-feedback-detail">
              {task.agentName} finished its search. Nothing was purchased.
            </p>
          </div>
          <button
            type="button"
            className="task-feedback-close"
            aria-label="Close task feedback"
            title="Close"
            disabled={busy}
            onClick={onDismiss}
          >
            <span>Esc</span>
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <div className="task-feedback-options">
          <button type="button" disabled={busy} onClick={() => onDecision('complete')}>
            <CheckCircle2 size={22} aria-hidden="true" />
            <span>Yes</span>
          </button>
          <button type="button" disabled={busy} onClick={() => onDecision('no')}>
            <CircleX size={22} aria-hidden="true" />
            <span>No</span>
          </button>
          <button type="button" disabled={busy} onClick={() => onDecision('still_working')}>
            <PencilLine size={22} aria-hidden="true" />
            <span>Keep working</span>
          </button>
        </div>
      </section>
    </div>
  );
}
