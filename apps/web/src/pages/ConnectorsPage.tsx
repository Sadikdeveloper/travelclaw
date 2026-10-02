import type { ConnectorRecord } from '@travelclaw/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Banner, StatusTag } from '../components/Status';

export function ConnectorsPage() {
  const { user } = useAuth();
  const [connectors, setConnectors] = useState<ConnectorRecord[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stop = false;
    api<ConnectorRecord[]>('/api/connectors')
      .then((listed) => {
        if (!stop) setConnectors(listed);
      })
      .catch((err: unknown) => {
        if (!stop)
          setError(err instanceof ApiError ? err.message : 'Could not open connectors.');
      });
    return () => {
      stop = true;
    };
  }, []);

  function replaced(next: ConnectorRecord) {
    setConnectors((current) =>
      (current ?? []).map((entry) => (entry.name === next.name ? next : entry)),
    );
  }

  if (error && !connectors) return <Banner message={error} tone="bad" />;
  if (!connectors) return <p className="muted">Opening connectors…</p>;

  return (
    <section>
      <p className="kicker">Desk</p>
      <h1>Connectors</h1>
      <p className="lede">
        A connector is a key you provide — not a new tool, and nothing the model can change.
        Keys stay on the desk: each one is sent only to its own base URL, and never into a
        chat or a prompt.
      </p>
      {user?.isGuest ? (
        <Banner message="You are browsing as a guest. A key stored here lives on this guest session — sign in to keep it anywhere." />
      ) : null}
      {error ? <Banner message={error} tone="bad" /> : null}
      <div className="grid-2">
        {connectors.map((connector) => (
          <ConnectorCard
            key={connector.name}
            connector={connector}
            onSaved={replaced}
            onError={setError}
          />
        ))}
      </div>
    </section>
  );
}

function ConnectorCard({
  connector,
  onSaved,
  onError,
}: {
  connector: ConnectorRecord;
  onSaved: (next: ConnectorRecord) => void;
  onError: (message: string) => void;
}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearBase, setClearBase] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const stored = connector.source === 'account';

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    onError('');
    try {
      const body: { baseUrl?: string; apiKey?: string } = {};
      if (clearBase) body.baseUrl = '';
      else if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
      if (clearKey) body.apiKey = '';
      else if (apiKey.trim()) body.apiKey = apiKey.trim();
      const next = await api<ConnectorRecord>(`/api/connectors/${connector.name}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      onSaved(next);
      setBaseUrl('');
      setApiKey('');
      setClearBase(false);
      setClearKey(false);
      setNotice('Saved.');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save that connector.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setNotice('');
    onError('');
    try {
      const next = await api<ConnectorRecord>(`/api/connectors/${connector.name}`, {
        method: 'DELETE',
      });
      onSaved(next);
      setBaseUrl('');
      setApiKey('');
      setClearBase(false);
      setClearKey(false);
      setNotice('Removed.');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not remove that connector.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel">
      <div className="row">
        <h2 style={{ margin: 0 }}>{connector.label}</h2>
        <StatusTag status={connector.status} />
      </div>
      <p className="muted">{connector.detail}</p>
      <ul className="list">
        <li className="row">
          <span className="muted">Base URL</span>
          <span className="mono">{connector.baseUrl ?? 'desk default'}</span>
        </li>
        <li className="row">
          <span className="muted">Key</span>
          <span className="mono">
            {connector.keySuffix ? `…${connector.keySuffix}` : 'none stored'}
          </span>
        </li>
        {connector.source === 'environment' ? (
          <li className="muted">
            Set by the operator. Your own key would replace it for your chats.
          </li>
        ) : null}
        {connector.status === 'rejected' ? (
          <li>
            <Banner message="The provider refused this key. Check it and save again." />
          </li>
        ) : null}
      </ul>
      {notice ? <p className="muted">{notice}</p> : null}
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>Base URL</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder={connector.baseUrl ?? 'https://…'}
            value={baseUrl}
            disabled={clearBase}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label className="field">
          <span>API key</span>
          <input
            type="password"
            autoComplete="off"
            placeholder={
              stored && connector.keySuffix ? 'Leave blank to keep' : 'Paste a key'
            }
            value={apiKey}
            disabled={clearKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        {stored ? (
          <div className="row">
            {connector.baseUrl ? (
              <label className="row muted">
                <input
                  type="checkbox"
                  checked={clearBase}
                  onChange={(event) => setClearBase(event.target.checked)}
                />
                Clear base URL
              </label>
            ) : null}
            {connector.keySuffix ? (
              <label className="row muted">
                <input
                  type="checkbox"
                  checked={clearKey}
                  onChange={(event) => setClearKey(event.target.checked)}
                />
                Clear key
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="row">
          <button className="btn copper" type="submit" disabled={busy}>
            {busy ? 'Saving…' : stored ? 'Update' : 'Save'}
          </button>
          {stored ? (
            <button className="btn-ghost" type="button" disabled={busy} onClick={remove}>
              Remove
            </button>
          ) : null}
        </div>
      </form>
    </article>
  );
}
