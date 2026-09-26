import type {
  AgentTaskRecord,
  MessageRecord,
  SessionRecord,
  TaskDecision,
} from '@travelclaw/shared';
import { Hotel, Plane, Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveRevision } from '../App';
import { api, ApiError } from '../api';
import { AgentCard } from '../components/AgentCard';
import { RichText } from '../components/RichText';
import { Banner } from '../components/Status';
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
  const [title, setTitle] = useState('New chat');
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [tasks, setTasks] = useState<AgentTaskRecord[]>([]);
  const [draft, setDraft] = useState(params.get('draft') ?? '');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [deciding, setDeciding] = useState('');

  // The hero landing view only applies to a brand-new, not-yet-opened chat — once a
  // specific chat id is in the URL, it always gets the normal thread, even mid-send.
  const isLanding = !sessionId;

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setTasks([]);
      setTitle('New chat');
      return;
    }
    if (user?.isGuest) {
      // Instant paint from this device's own cache while the network request is
      // still in flight — nothing else backs a guest's chat on first render.
      const cached = mirrorGuestMessages(user.id, sessionId);
      if (cached.length) setMessages(cached);
    }
    const seq = ++generation.current;
    Promise.all([
      api<{ session: SessionRecord; messages: MessageRecord[] }>(
        `/api/sessions/${sessionId}`,
      ),
      api<AgentTaskRecord[]>(`/api/sessions/${sessionId}/tasks`),
    ])
      .then(([opened, desks]) => {
        if (seq !== generation.current) return;
        setTitle(opened.session.title);
        setMessages(opened.messages);
        setTasks(desks);
        if (user?.isGuest) mirrorGuestMessages(user.id, sessionId, opened.messages);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not open that chat'),
      );
  }, [sessionId, revision, user]);

  async function decide(taskId: string, decision: TaskDecision) {
    setDeciding(taskId);
    setError('');
    try {
      const next = await api<AgentTaskRecord>(`/api/tasks/${taskId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setTasks((current) => current.map((task) => (task.id === next.id ? next : task)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that answer');
    } finally {
      setDeciding('');
    }
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setError('');
    setDraft('');
    try {
      let id = sessionId;
      if (!id) {
        const session = await api<SessionRecord>('/api/sessions', {
          method: 'POST',
          body: JSON.stringify({ channel: 'webchat' }),
        });
        id = session.id;
      }
      await api(`/api/sessions/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      const seq = ++generation.current;
      const [opened, desks] = await Promise.all([
        api<{ session: SessionRecord; messages: MessageRecord[] }>(`/api/sessions/${id}`),
        api<AgentTaskRecord[]>(`/api/sessions/${id}/tasks`),
      ]);
      if (seq === generation.current) {
        setTitle(opened.session.title);
        setMessages(opened.messages);
        setTasks(desks);
        if (user?.isGuest) mirrorGuestMessages(user.id, id, opened.messages);
      }
      if (!sessionId) navigate(`/chat/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The turn failed');
      setDraft(content);
    } finally {
      setSending(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  }

  if (isLanding) {
    return (
      <div className="chat-layout chat-landing">
        <section className="hero">
          <div className="hero-inner">
            <img src="/mark.svg" alt="" className="hero-mark" />
            <h1>Your next trip, one message away.</h1>
            <p className="hero-sub">
              Ask for a flight, a hotel, or both. A desk spins up for each one — nothing
              books until you say so.
            </p>
            {error ? <Banner message={error} tone="bad" /> : null}
            <form
              className="hero-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send(draft);
              }}
            >
              <label className="sr-only" htmlFor="hero-draft">
                Message
              </label>
              <textarea
                id="hero-draft"
                rows={1}
                value={draft}
                placeholder="A flight, a hotel, or both"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
              />
              <button
                className="hero-send"
                type="submit"
                disabled={sending || !draft.trim()}
                aria-label="Send"
              >
                <Send size={18} aria-hidden="true" />
              </button>
            </form>
            <div className="hero-chips">
              {prompts.map(({ text, icon: Icon }) => (
                <button
                  key={text}
                  type="button"
                  disabled={sending}
                  onClick={() => void send(text)}
                >
                  <Icon size={14} />
                  {text}
                </button>
              ))}
            </div>
            {sending ? <p className="muted hero-sending">Sending…</p> : null}
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
        <div className="transcript" aria-live="polite">
          {error ? <Banner message={error} tone="bad" /> : null}
          {messages.map((message) => (
            <div key={message.id} className="turn">
              <article className={message.role === 'user' ? 'bubble user' : 'bubble'}>
                {message.role === 'user' ? (
                  message.content
                ) : (
                  <RichText text={message.content} />
                )}
              </article>
              {tasks
                .filter((task) => task.messageId === message.id)
                .map((task) => (
                  <AgentCard
                    key={task.id}
                    task={task}
                    busy={deciding === task.id}
                    onDecide={(decision) => void decide(task.id, decision)}
                  />
                ))}
            </div>
          ))}
          {sending ? <p className="muted">Sending…</p> : null}
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <label className="field">
            <span className="sr-only">Message</span>
            <textarea
              value={draft}
              placeholder="A flight, a hotel, or both"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKeyDown}
            />
          </label>
          <div className="row">
            <button
              className="btn copper"
              type="submit"
              disabled={sending || !draft.trim()}
            >
              Send
            </button>
            <span className="muted">Enter sends. Shift+Enter starts a line.</span>
          </div>
        </form>
      </section>
    </div>
  );
}
