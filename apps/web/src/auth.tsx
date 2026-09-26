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
      // A signed-out visitor (401) is the normal case here, not an error to surface.
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let stop = false;
    Promise.all([
      api<AuthConfig>('/api/auth/config').catch(() => ({ googleClientId: null })),
      api<UserRecord>('/api/auth/me').catch(() => null),
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
      setUser(null);
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
