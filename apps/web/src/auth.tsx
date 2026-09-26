import type { AuthConfig, UserRecord } from '@travelclaw/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError, setSessionRecovery } from './api';

/** Why the desk could not stand up a session. Shown as-is, with a retry — never a login wall. */
export interface AuthProblem {
  kind: 'rate_limited' | 'unreachable';
  message: string;
}

interface AuthContextValue {
  user: UserRecord | null;
  loading: boolean;
  problem: AuthProblem | null;
  googleClientId: string | null;
  setUser: (user: UserRecord | null) => void;
  /** Try the session again: resume it, else mint a guest. Used by the retry button. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Turns a failed bootstrap into something the UI can show a retry beside. */
function describeProblem(error: unknown): AuthProblem {
  if (error instanceof ApiError && error.code === 'rate_limited') {
    return { kind: 'rate_limited', message: error.message };
  }
  return {
    kind: 'unreachable',
    message:
      error instanceof ApiError
        ? error.message
        : 'The gateway did not answer. Check that it is running, then try again.',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<AuthProblem | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  /**
   * Resume the cookie's session, or start a guest one. No account required: a visitor
   * who never signed up gets a guest session, and a failure here is reported as what it
   * is (a rate limit, or a gateway that is not answering) so the UI can offer a retry
   * instead of sending them to a sign-in page they do not need.
   */
  const start = useCallback(async () => {
    try {
      setUser(await api<UserRecord>('/api/auth/me'));
      setProblem(null);
      return;
    } catch {
      // A signed-out visitor is the normal case here, not an error to surface.
    }
    try {
      setUser(await api<UserRecord>('/api/auth/guest', { method: 'POST' }));
      setProblem(null);
    } catch (error) {
      setUser(null);
      setProblem(describeProblem(error));
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await start();
    setLoading(false);
  }, [start]);

  /** Any caller that lands an account (sign-in, register, Google) also clears a failure. */
  const applyUser = useCallback((account: UserRecord | null) => {
    setUser(account);
    if (account) setProblem(null);
  }, []);

  useEffect(() => {
    let stop = false;
    api<AuthConfig>('/api/auth/config')
      .catch(() => ({ googleClientId: null }))
      .then((config) => {
        if (!stop) setGoogleClientId(config.googleClientId);
      });
    void start().finally(() => {
      if (!stop) setLoading(false);
    });
    return () => {
      stop = true;
    };
  }, [start]);

  // Kept current with the account: `api()` calls this when a cookie is rejected, and a
  // real account must never be silently downgraded to a guest to recover.
  useEffect(() => {
    setSessionRecovery(async () => {
      if (user && !user.isGuest) return false;
      try {
        setUser(await api<UserRecord>('/api/auth/guest', { method: 'POST' }));
        setProblem(null);
        return true;
      } catch (error) {
        // The old guest is spent. Drop it, so the UI shows the reason and a retry
        // instead of a chat page whose every request will fail.
        setUser(null);
        setProblem(describeProblem(error));
        return false;
      }
    });
    return () => setSessionRecovery(null);
  }, [user]);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      // Land back on a guest instead of a dead end — signing out should not force a
      // real sign-in just to keep using the desk.
      try {
        setUser(await api<UserRecord>('/api/auth/guest', { method: 'POST' }));
        setProblem(null);
      } catch (error) {
        setUser(null);
        setProblem(describeProblem(error));
      }
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, problem, googleClientId, setUser: applyUser, refresh, logout }),
    [user, loading, problem, googleClientId, applyUser, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
}
