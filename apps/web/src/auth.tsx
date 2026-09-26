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
import { api } from './api';

interface AuthContextValue {
  user: UserRecord | null;
  loading: boolean;
  googleClientId: string | null;
  setUser: (user: UserRecord | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api<UserRecord>('/api/auth/me');
      setUser(me);
    } catch {
      // A signed-out visitor is the normal case here, not an error to surface — fall
      // back to a guest so the desk stays usable without forcing a login.
      try {
        setUser(await api<UserRecord>('/api/auth/guest', { method: 'POST' }));
      } catch {
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    let stop = false;
    Promise.all([
      api<AuthConfig>('/api/auth/config').catch(() => ({ googleClientId: null })),
      // No account required to use the desk: a signed-out visitor is bootstrapped into
      // a guest session automatically. Signing in later folds that guest's chats in.
      api<UserRecord>('/api/auth/me').catch(() =>
        api<UserRecord>('/api/auth/guest', { method: 'POST' }).catch(() => null),
      ),
    ]).then(([config, me]) => {
      if (stop) return;
      setGoogleClientId(config.googleClientId);
      setUser(me);
      setLoading(false);
    });
    return () => {
      stop = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      // Land back on a guest instead of a dead end — signing out should not force a
      // real sign-in just to keep using the desk.
      try {
        setUser(await api<UserRecord>('/api/auth/guest', { method: 'POST' }));
      } catch {
        setUser(null);
      }
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, googleClientId, setUser, refresh, logout }),
    [user, loading, googleClientId, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth used outside AuthProvider');
  return ctx;
}
