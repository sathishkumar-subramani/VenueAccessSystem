import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, Notice } from "@/ui/primitives";

/**
 * The real scanner lives in the mobile app, where the camera is. This exists so
 * a venue with a laptop at the desk can still admit people — paste or type the
 * code, same endpoint, same rules.
 */
export function ScannerPage() {
  const [token, setToken] = useState("");
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const redeem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;

    setBusy(true);
    try {
      const result = await api.operator.redeem(token.trim());
      setOutcome({ ok: true, message: result.message });
      setToken("");
    } catch (cause) {
      setOutcome({
        ok: false,
        message: cause instanceof Error ? cause.message : "This pass was not accepted.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-md space-y-4 px-5 py-8">
      <h1 className="font-display text-2xl font-bold">Check someone in</h1>

      <form className="space-y-3" onSubmit={redeem}>
        <Field
          label="Pass code"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Paste the scanned code"
          autoFocus
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Checking…" : "Check in"}
        </Button>
      </form>

      {outcome ? (
        <div
          role="status"
          className={`border-l-4 px-4 py-3 ${outcome.ok ? "border-valid" : "border-void"}`}
        >
          <p className="font-display text-lg font-bold">
            {outcome.ok ? "Let them in" : "Do not admit"}
          </p>
          <p className="text-sm text-ink-soft">{outcome.message}</p>
        </div>
      ) : (
        <Notice>
          Use the mobile app at the door for camera scanning. This page is for a desk setup.
        </Notice>
      )}
    </main>
  );
}
