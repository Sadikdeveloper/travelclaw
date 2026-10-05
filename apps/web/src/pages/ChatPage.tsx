import type {
  AgentTaskRecord,
  ChatResponse,
  HoldAttempt,
  MessageAttachment,
  MessageRecord,
  SessionRecord,
  TaskDecision,
} from '@travelclaw/shared';
import { Hotel, Plane, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveRevision } from '../App';
import { api, ApiError } from '../api';
import { AgentCard } from '../components/AgentCard';
import { AttachmentChip } from '../components/AttachmentChip';
import { Composer } from '../components/Composer';
import { ProcessTrail } from '../components/ProcessTrail';
import { RichText } from '../components/RichText';
import { Banner } from '../components/Status';
import { TaskFeedbackDialog } from '../components/TaskFeedbackDialog';
import { useAuth } from '../auth';
import { mirrorGuestMessages } from '../guestChatCache';

const prompts: Array<{ text: string; icon: ComponentType<{ size?: number }> }> = [
  { text: 'Find a flight from Lagos to Lisbon on 2026-11-02', icon: Plane },
  { text: 'Book a hotel in Lisbon for 2 from 2026-11-02 to 2026-11-06', icon: Hotel },
  { text: 'Flight and a hotel in Kyoto from 2026-11-02 to 2026-11-06', icon: Sparkles },
];

export function ChatPage() {
  const { sessionId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const revision = useLiveRevision();
  const { user } = useAuth();
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  // A task can update through polling or the live socket. Track its last state so
  // feedback opens only when a search *changes* from working to completed, never
  // just because someone reopened an old chat.
  const taskStatuses = useRef(new Map<string, AgentTaskRecord['status']>());
  const feedbackHandled = useRef(new Set<string>());
  const feedbackQueue = useRef<AgentTaskRecord[]>([]);
  // Set immediately after this tab starts a desk. It covers an operator setting
  // TRAVELCLAW_TASK_DELAY=0, where the first task read may already be completed.
  const feedbackExpectedForSession = useRef<string | null>(null);
  const [title, setTitle] = useState('New chat');
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([]);
  const [draft, setDraft] = useState(params.get('draft') ?? '');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [holdingOfferId, setHoldingOfferId] = useState('');
  const [feedbackTask, setFeedbackTask] = useState<AgentTaskRecord | null>(null);
  const [givingFeedback, setGivingFeedback] = useState(false);
  const transcript = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // The hero landing view only applies to a brand-new, not-yet-opened chat — once a
  // specific chat id is in the URL, it always gets the normal thread, even mid-send.
  const isLanding = !sessionId;

  useEffect(() => {
    // A different chat should not inherit a completion prompt or status history
    // from the previous one. Preserve only the one freshly created desk response
    // that is navigating from /chat into its new session.
    const keepExpected = Boolean(
      sessionId && feedbackExpectedForSession.current === sessionId,
    );
    taskStatuses.current.clear();
    feedbackHandled.current.clear();
    feedbackQueue.current = [];
    if (!keepExpected) feedbackExpectedForSession.current = null;
    setFeedbackTask(null);
    setGivingFeedback(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setTasks([]);
      setTitle('New chat');
      return;
    }
    stickToBottom.current = true;
    if (user?.isGuest) {
      // Instant paint from this device's own cache while the network request is
      // still in flight — nothing else backs a guest's chat on first render.
      const cached = mirrorGuestMessages(user.id, sessionId);
      if (cached.length) setMessages(cached);
    }
    const seq = ++generation.current;
    loadChat(sessionId, seq).catch(() => setError('Could not open that chat'));
  }, [sessionId, revision, user]);

  const hasWorkingDesk = tasks.some((task) => task.status === 'working');
  useEffect(() => {
    if (!sessionId || !hasWorkingDesk) return;
    // Progress and Stop remain usable even if the live socket is unavailable.
    const timer = setInterval(() => {
      void loadChat(sessionId, ++generation.current).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [sessionId, hasWorkingDesk]);

  useEffect(() => {
    if (!sessionId) return;
    const firstReadOfOurNewDesk = feedbackExpectedForSession.current === sessionId;
    for (const task of tasks) {
      const previous = taskStatuses.current.get(task.id);
      taskStatuses.current.set(task.id, task.status);
      if (
        task.status === 'completed' &&
        (previous === 'working' || (firstReadOfOurNewDesk && previous === undefined)) &&
        !feedbackHandled.current.has(task.id)
      ) {
        feedbackHandled.current.add(task.id);
        feedbackQueue.current.push(task);
      }
    }
    // A regular first read records a working task. A zero-delay first read may
    // queue a completed one. Either way it has served its purpose now.
    if (firstReadOfOurNewDesk) feedbackExpectedForSession.current = null;
    if (!feedbackTask && feedbackQueue.current.length) {
      setFeedbackTask(feedbackQueue.current.shift() ?? null);
    }
  }, [sessionId, tasks, feedbackTask]);

  /** Fetch one chat's messages and desks, honoring the newest caller only. */
  async function loadChat(id: string, seq: number): Promise<MessageRecord[] | null> {
    const [opened, desks] = await Promise.all([
      api<{ session: SessionRecord; messages: MessageRecord[] }>(`/api/sessions/${id}`),
      api<AgentTaskRecord[]>(`/api/sessions/${id}/tasks`),
    ]);
    if (seq !== generation.current) return null;
    setTitle(opened.session.title);
    setMessages(opened.messages);
    setTasks(desks);
    if (user?.isGuest) mirrorGuestMessages(user.id, id, opened.messages);
    return opened.messages;
  }

  async function stopBrowser(taskId: string) {
    try {
      await api(`/api/tasks/${taskId}/browser/stop`, { method: 'POST' });
      if (sessionId) await loadChat(sessionId, ++generation.current);
    } catch {
      setError('Could not stop the browser search. Please retry.');
    }
  }

  function dismissFeedback() {
    if (givingFeedback) return;
    setFeedbackTask(null);
  }

  async function giveTaskFeedback(decision: TaskDecision) {
    const task = feedbackTask;
    if (!task || givingFeedback) return;
    setGivingFeedback(true);
    setError('');
    try {
      const next = await api<AgentTaskRecord>(`/api/tasks/${task.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setTasks((current) => current.map((item) => (item.id === next.id ? next : item)));
      setFeedbackTask(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that answer');
    } finally {
      setGivingFeedback(false);
    }
  }

  async function askProviderToHold(taskId: string, offerId: string) {
    setHoldingOfferId(offerId);
    setError('');
    try {
      const result = await api<HoldAttempt>(`/api/tasks/${taskId}/offers/${offerId}/hold`, {
        method: 'POST',
        body: JSON.stringify({ confirm: true }),
      });
      setTasks((current) =>
        current.map((task) => (task.id === result.task.id ? result.task : task)),
      );
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not ask the provider for a hold',
      );
    } finally {
      setHoldingOfferId('');
    }
  }

  function stop() {
    abort.current?.abort();
  }

  async function send(text: string, files: MessageAttachment[]) {
    const content = text.trim();
    if (sending || (!content && !files.length)) return;
    const controller = new AbortController();
    abort.current = controller;
    setSending(true);
    setError('');
    setDraft('');
    setAttachments([]);
    stickToBottom.current = true;
    let id = sessionId;
    try {
      if (!id) {
        const session = await api<SessionRecord>('/api/sessions', {
          method: 'POST',
          body: JSON.stringify({ channel: 'webchat' }),
          signal: controller.signal,
        });
        id = session.id;
      }
      const response = await api<ChatResponse>(`/api/sessions/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, attachments: files }),
        signal: controller.signal,
      });
      if (response.model === 'agents') feedbackExpectedForSession.current = id;
      await loadChat(id, ++generation.current);
      if (!sessionId) navigate(`/chat/${id}`);
    } catch (err) {
      if (isAbort(err)) {
        // Stopped, not failed: the desk may already hold the message (it is persisted
        // before the model runs), so reconcile with what it has. The socket refills
        // the reply if the turn lands after we stopped watching.
        let current: MessageRecord[] | null = null;
        if (id) {
          current = await loadChat(id, ++generation.current).catch(() => null);
          if (!sessionId) navigate(`/chat/${id}`);
        }
        const lastUser = [...(current ?? [])].reverse().find((m) => m.role === 'user');
        if (!lastUser || lastUser.content !== content) {
          // The message never reached the desk — hand it back to the composer.
          setDraft(content);
          setAttachments(files);
        }
      } else {
        setError(err instanceof ApiError ? err.message : 'The turn failed');
        setDraft(content);
        setAttachments(files);
      }
    } finally {
      abort.current = null;
      setSending(false);
    }
  }

  // Follow the trail down as it grows, unless the traveler scrolled up to read.
  useEffect(() => {
    const el = transcript.current;
    if (!el || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, tasks, sending]);

  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((message) => message.role === 'assistant')?.id,
    [messages],
  );

  const composer = (
    <Composer
      variant={isLanding ? 'hero' : 'thread'}
      draft={draft}
      onDraftChange={setDraft}
      attachments={attachments}
      onAttachmentsChange={setAttachments}
      sending={sending}
      onSend={(text, files) => void send(text, files)}
      onStop={stop}
    />
  );

  if (isLanding) {
    return (
      <div className="chat-layout chat-landing">
        <section className="hero">
          <div className="hero-inner">
            <img src="/mark.svg" alt="" className="hero-mark" />
            <span className="mode-chip mode-chip-hero">
              <Sparkles size={13} aria-hidden="true" />
              Agent mode
            </span>
            <h1>Your next trip, one message away.</h1>
            <p className="hero-sub">
              Ask for a flight, a hotel, or both. A desk spins up for each one — nothing
              books until you say so.
            </p>
            {error ? <Banner message={error} tone="bad" /> : null}
            {composer}
            <div className="hero-chips">
              {prompts.map(({ text, icon: Icon }) => (
                <button
                  key={text}
                  type="button"
                  disabled={sending}
                  onClick={() => void send(text, [])}
                >
                  <Icon size={14} />
                  {text}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="chat-layout">
      <section className="thread">
        <header className="thread-head">
          <strong>{title}</strong>
        </header>
        <div
          className="transcript"
          aria-live="polite"
          ref={transcript}
          onScroll={() => {
            const el = transcript.current;
            if (!el) return;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
          }}
        >
          {error ? <Banner message={error} tone="bad" /> : null}
          {messages.map((message) => {
            const messageTasks = tasks.filter((task) => task.messageId === message.id);
            return (
              <div key={message.id} className="turn">
                {message.role === 'user' ? (
                  <article className="bubble user">
                    {message.attachments.length ? (
                      <div className="bubble-files">
                        {message.attachments.map((attachment, index) => (
                          <AttachmentChip
                            key={`${message.id}-${index}`}
                            attachment={attachment}
                          />
                        ))}
                      </div>
                    ) : null}
                    {message.content ? message.content : null}
                  </article>
                ) : (
                  <>
                    <article className="bubble">
                      <RichText text={message.content} />
                    </article>
                    {message.role === 'assistant' ? (
                      <ProcessTrail
                        message={message}
                        tasks={messageTasks}
                        latest={message.id === lastAssistantId}
                      />
                    ) : null}
                  </>
                )}
                {messageTasks.map((task) => (
                  <AgentCard
                    onStopBrowser={() => void stopBrowser(task.id)}
                    key={task.id}
                    task={task}
                    holdingOfferId={holdingOfferId}
                    onHold={(offerId) => void askProviderToHold(task.id, offerId)}
                  />
                ))}
              </div>
            );
          })}
          {sending ? (
            <div className="working" aria-live="polite">
              <span className="working-spinner" aria-hidden="true" />
              <div className="working-copy">
                <strong>The desk is working</strong>
                <span className="working-steps" aria-hidden="true">
                  <span>reading your message</span>
                  <span>running its tools</span>
                  <span>writing the reply</span>
                </span>
              </div>
              <button className="btn-ghost working-stop" type="button" onClick={stop}>
                Stop
              </button>
            </div>
          ) : null}
        </div>
        {composer}
      </section>
      {feedbackTask ? (
        <TaskFeedbackDialog
          task={feedbackTask}
          busy={givingFeedback}
          onDismiss={dismissFeedback}
          onDecision={(decision) => void giveTaskFeedback(decision)}
        />
      ) : null}
    </div>
  );
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
