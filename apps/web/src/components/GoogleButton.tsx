import type { UserRecord } from '@travelclaw/shared';
import { useEffect, useId, useRef } from 'react';
import { api, ApiError } from '../api';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

/** Renders nothing when `clientId` is not set — the operator opts in, per desk. */
export function GoogleButton({
  clientId,
  onSignedIn,
  onError,
}: {
  clientId: string | null;
  onSignedIn: (user: UserRecord) => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const domId = useId();

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    async function handleCredential(response: GoogleCredentialResponse) {
      try {
        const user = await api<UserRecord>('/api/auth/google', {
          method: 'POST',
          body: JSON.stringify({ credential: response.credential }),
        });
        if (!cancelled) onSignedIn(user);
      } catch (err) {
        onError(err instanceof ApiError ? err.message : 'Google sign-in failed');
      }
    }

    function render() {
      if (cancelled || !window.google || !containerRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId!,
        callback: handleCredential,
      });
      containerRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        width: 280,
      });
    }

    if (window.google) {
      render();
      return () => {
        cancelled = true;
      };
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    const script = existing ?? document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.addEventListener('load', render);
    script.addEventListener('error', () => onError('Could not load Google sign-in'));
    if (!existing) document.head.appendChild(script);
    else render();

    return () => {
      cancelled = true;
      script.removeEventListener('load', render);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) return null;

  return <div id={domId} ref={containerRef} className="google-button" />;
}
