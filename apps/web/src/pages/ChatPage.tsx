import type { MessageRecord, SessionRecord } from '@travelclaw/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveRevision } from '../App';
import { api, ApiError } from '../api';
import { RichText } from '../components/RichText';
import { Banner } from '../components/Status';

const prompts = [
  'Outline 4 days in Kyoto from 2026-11-02, steady pace, food first',
  'What should I pack for Reykjavik for 4 days?',
  'Estimate a comfortable budget for 2 people in Lisbon for 5 days',
  '/remember I prefer trains to taxis',
];

export function ChatPage() {
  const { sessionId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const revision = useLiveRevision();
  const generation = useRef(0);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [draft, setDraft] = useState(params.get('draft') ?? '');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api<SessionRecord[]>('/api/sessions')
      .then(setSessions)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not load sessions'),
      );
  }, [revision]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    const seq = ++generation.current;
    api<{ messages: MessageRecord[] }>(`/api/sessions/${sessionId}`)
      .then((body) => {
        if (seq === generation.current) setMessages(body.messages);
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : 'Could not open that chat'),
      );
  }, [sessionId, revision]);

  async function openChat() {
    const session = await api<SessionRecord>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ channel: 'webchat' }),
    });
    navigate(`/chat/${session.id}`);
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
      const opened = await api<{ messages: MessageRecord[] }>(`/api/sessions/${id}`);
      if (seq === generation.current) setMessages(opened.messages);
      if (!sessionId) navigate(`/chat/${id}`);
      setSessions(await api<SessionRecord[]>('/api/sessions'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The turn failed');
      setDraft(content);
    } finally {
      setSending(false);
    }
  }

  const active = sessions.find((session) => session.id === sessionId);

  return (
    <div className="chat-layout">
      <aside className="session-col">
        <button className="btn" type="button" onClick={openChat}>
          New chat
        </button>
        <ul className="list" style={{ marginTop: 12 }}>
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                className={
                  session.id === sessionId ? 'session-link active' : 'session-link'
                }
                to={`/chat/${session.id}`}
              >
                {session.title}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <section className="thread">
        <header className="thread-head">
          <strong>{active?.title || 'New chat'}</strong>
          <div className="mono">{active?.key || 'webchat · a new peer when you send'}</div>
        </header>
        <div className="transcript" aria-live="polite">
          {error ? <Banner message={error} tone="bad" /> : null}
          {messages.length === 0 ? (
            <div className="empty">
              <p>Start with a city and two dates, or tell the desk what to remember.</p>
              <div className="chips">
                {prompts.map((prompt) => (
                  <button key={prompt} type="button" onClick={() => send(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message) => (
            <article
              key={message.id}
              className={message.role === 'user' ? 'bubble user' : 'bubble'}
            >
              {message.role === 'user' ? (
                message.content
              ) : (
                <RichText text={message.content} />
              )}
              {message.tools.length ? (
                <div className="meta">
                  {message.tools.map((tool) => (
                    <span key={tool.name} className={tool.ok ? 'pill' : 'pill bad'}>
                      {tool.name}
                    </span>
                  ))}
                </div>
              ) : null}
              {message.provider ? (
                <div className="mono">
                  {message.provider} · {message.model}
                </div>
              ) : null}
            </article>
          ))}
          {sending ? <p className="muted">Marlow is at the desk…</p> : null}
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
              placeholder="City, dates, or /remember …"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
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
