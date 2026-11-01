import { createApiClient, type TokenStore } from "@venue/shared";

const ACCESS_KEY = "va.access";
const REFRESH_KEY = "va.refresh";

/**
 * localStorage, so a refresh does not sign the user out. It is readable by any
 * script on this origin, which is why access tokens are short-lived and refresh
 * tokens rotate on every use — a stolen one works at most once.
 */
const webTokenStore: TokenStore = {
  getAccessToken: () => localStorage.getItem(ACCESS_KEY),
  getRefreshToken: () => localStorage.getItem(REFRESH_KEY),
  save: ({ accessToken, refreshToken }) => {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const hasStoredSession = (): boolean => localStorage.getItem(REFRESH_KEY) !== null;

const signedOutListeners = new Set<() => void>();

export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? "/api",
  tokens: webTokenStore,
  onSignedOut: () => signedOutListeners.forEach((listener) => listener()),
});
