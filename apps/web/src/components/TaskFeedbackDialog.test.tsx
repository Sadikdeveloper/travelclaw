import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentTaskRecord } from '@travelclaw/shared';
import { TaskFeedbackDialog } from './TaskFeedbackDialog';

const task: AgentTaskRecord = {
  id: 'task-1',
  sessionId: 'session-1',
  messageId: 'message-1',
  kind: 'flight',
  agentName: 'Flight desk',
  status: 'completed',
  summary: 'Found a provider offer.',
  pass: 1,
  offers: [],
  createdAt: '2026-10-05T12:00:00Z',
  updatedAt: '2026-10-05T12:01:00Z',
};

describe('task feedback dialog', () => {
  it('asks for feedback only as an explicit close-out, with all three choices', () => {
    const html = renderToStaticMarkup(
      <TaskFeedbackDialog
        task={task}
        busy={false}
        onDecision={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(html).toContain('Was this task successful?');
    expect(html).toContain('Flight desk finished its search');
    expect(html).toContain('Yes');
    expect(html).toContain('No');
    expect(html).toContain('Keep working');
    expect(html).toContain('Close task feedback');
  });
});
