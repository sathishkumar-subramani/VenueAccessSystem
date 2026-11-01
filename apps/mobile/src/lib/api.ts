import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { createApiClient, type TokenStore } from "@venue/shared";

/**
 * EAS injects EXPO_PUBLIC_API_URL per build profile. The app.json value is the
 * fallback for a plain `expo start`.
 */
const baseUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "http://localhost:5080/api";

const ACCESS_KEY = "va_access";
const REFRESH_KEY = "va_refresh";

/**
 * SecureStore, not AsyncStorage: on Android this is the Keystore and on iOS the
 * Keychain. A phone-held refresh token lives for weeks, so it belongs there
 * rather than in plain app storage.
 */
const mobileTokenStore: TokenStore = {
  getAccessToken: () => SecureStore.getItemAsync(ACCESS_KEY),
  getRefreshToken: () => SecureStore.getItemAsync(REFRESH_KEY),
  save: async ({ accessToken, refreshToken }) => {
    await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
    await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
  },
  clear: async () => {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};

const signedOutListeners = new Set<() => void>();

export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

export const hasStoredSession = async (): Promise<boolean> =>
  (await SecureStore.getItemAsync(REFRESH_KEY)) !== null;

export const api = createApiClient({
  baseUrl,
  tokens: mobileTokenStore,
  onSignedOut: () => signedOutListeners.forEach((listener) => listener()),
});
