import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Notice, Spinner } from "@/ui/primitives";

export function PassPage() {
  const { passId = "" } = useParams();

  const pass = useQuery({ queryKey: ["pass", passId], queryFn: () => api.passes.byId(passId) });
  const isActive = pass.data?.state === "active";

  /**
   * The token behind the QR lives about 30 seconds, so it is refetched while
   * this screen is open. A screenshot forwarded to a friend is worthless by the
   * time they reach the door.
   */
  const token = useQuery({
    queryKey: ["pass-token", passId],
    queryFn: () => api.passes.token(passId),
    enabled: isActive,
    refetchInterval: 25_000,
    refetchIntervalInBackground: false,
    gcTime: 0,
  });

  if (pass.isPending) return <Spinner label="Loading your pass" />;
  if (!pass.data) {
    return (
      <main className="mx-auto w-full max-w-sm px-5 py-8">
        <Notice tone="error">We could not find that pass.</Notice>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-sm px-5 py-8">
      <article className="ticket-edge border border-rule bg-card">
        <header className="border-b border-dashed border-rule px-6 py-5">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft">Admit one</p>
          <h1 className="mt-1 font-display text-xl font-bold">{pass.data.venueName}</h1>
        </header>

        <div className="flex flex-col items-center gap-4 px-6 py-8">
          {!isActive ? (
            <p className="font-mono text-sm uppercase tracking-wide text-void">{pass.data.state}</p>
          ) : token.data ? (
            <QRCodeSVG value={token.data.token} size={208} level="M" />
          ) : (
            <div className="size-52 animate-pulse bg-rule" aria-label="Loading code" />
          )}

          <p className="text-center text-xs text-ink-soft">
            {isActive
              ? "Show this at the door. The code refreshes on its own."
              : "This pass can no longer be scanned."}
          </p>
        </div>

        <footer className="grid grid-cols-2 gap-4 border-t border-dashed border-rule px-6 py-4 font-mono text-xs">
          <div>
            <p className="text-ink-soft">Entries left</p>
            <p className="text-base">{pass.data.entriesRemaining}</p>
          </div>
          <div>
            <p className="text-ink-soft">Valid until</p>
            <p className="text-base">
              {new Date(pass.data.validUntil).toLocaleString("en-IN", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        </footer>
      </article>
    </main>
  );
}
