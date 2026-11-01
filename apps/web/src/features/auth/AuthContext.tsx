import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UserDto } from "@venue/shared";
import { api, hasStoredSession, onSignedOut } from "@/lib/api";

interface AuthState {
  user: UserDto | null;
  ready: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [ready, setReady] = useState(false);

  // Restore the session on load, so a refresh does not look like a sign-out.
  useEffect(() => {
    if (!hasStoredSession()) {
      setReady(true);
      return;
    }

    api.auth
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => onSignedOut(() => setUser(null)), []);

  const refreshUser = useCallback(async () => {
    setUser(await api.auth.me());
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      signUp: async (email, password, displayName) => {
        setUser((await api.auth.signUp({ email, password, displayName })).user);
      },
      signIn: async (email, password) => {
        setUser((await api.auth.signIn({ email, password })).user);
      },
      signInWithGoogle: async (idToken) => {
        setUser((await api.auth.google(idToken)).user);
      },
      signOut: async () => {
        await api.auth.signOut();
        setUser(null);
      },
      refreshUser,
    }),
    [user, ready, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
