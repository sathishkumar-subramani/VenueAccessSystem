import { useState } from "react";
import { Button, Field, Notice } from "@/ui/primitives";
import { useAuth } from "./AuthContext";
import { GoogleButton } from "./GoogleButton";

export function SignInPage() {
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (mode === "signup") await signUp(email, password, displayName);
      else await signIn(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-8 px-5 py-16">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft">Venue Access</p>
        <h1 className="mt-2 font-display text-3xl font-bold leading-tight">
          Load credits once.
          <br />
          Walk into anywhere.
        </h1>
      </header>

      <form className="space-y-4" onSubmit={submit}>
        {mode === "signup" && (
          <Field
            label="Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            required
          />
        )}

        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          hint={mode === "signup" ? "At least 8 characters." : undefined}
          required
        />

        {error && <Notice tone="error">{error}</Notice>}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
        </Button>
      </form>

      <div className="space-y-4">
        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ink-soft">
          <span className="h-px flex-1 bg-rule" />
          or
          <span className="h-px flex-1 bg-rule" />
        </div>

        <GoogleButton onError={setError} />

        <button
          type="button"
          className="w-full text-sm text-ink-soft underline underline-offset-4"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
          }}
        >
          {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </main>
  );
}
