import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { UserDto } from "@venue/shared";
import { api, hasStoredSession, onSignedOut } from "./api";

interface AuthState {
  user: UserDto | null;
  ready: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // A phone session should survive the app being closed for a week.
      if (await hasStoredSession()) {
        try {
          const me = await api.auth.me();
          if (!cancelled) setUser(me);
        } catch {
          if (!cancelled) setUser(null);
        }
      }
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => onSignedOut(() => setUser(null)), []);

  const signOut = useCallback(async () => {
    await api.auth.signOut();
    setUser(null);
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
      signOut,
    }),
    [user, ready, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
