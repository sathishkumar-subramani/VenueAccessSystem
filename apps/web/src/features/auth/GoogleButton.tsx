import { useEffect, useRef } from "react";
import { useAuth } from "./AuthContext";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

/**
 * Google Identity Services hands the browser an ID token. The browser is not
 * trusted with anything else: the server verifies the signature and the
 * audience before it will create or find an account.
 */
export function GoogleButton({ onError }: { onError: (message: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const { signInWithGoogle } = useAuth();

  useEffect(() => {
    if (!CLIENT_ID || !holder.current) return;

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;

    script.onload = () => {
      const target = holder.current;
      if (!target || !window.google) return;

      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: ({ credential }) => {
          signInWithGoogle(credential).catch((cause: unknown) => {
            onError(cause instanceof Error ? cause.message : "Google sign-in failed.");
          });
        },
      });

      window.google.accounts.id.renderButton(target, {
        theme: "outline",
        size: "large",
        width: 320,
        text: "continue_with",
      });
    };

    document.head.appendChild(script);
    return () => script.remove();
  }, [signInWithGoogle, onError]);

  if (!CLIENT_ID) {
    return <p className="text-xs text-ink-soft">Set VITE_GOOGLE_CLIENT_ID to enable Google sign-in.</p>;
  }

  return <div ref={holder} className="flex justify-center" />;
}
