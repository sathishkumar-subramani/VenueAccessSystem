import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Credits, Notice, Spinner } from "@/ui/primitives";

const PACKS = [100, 500, 1000];

export function WalletPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const balance = useQuery({ queryKey: ["balance"], queryFn: () => api.wallet.balance() });
  const ledger = useQuery({ queryKey: ["ledger"], queryFn: () => api.wallet.ledger() });

  const topUp = useMutation({
    mutationFn: (credits: number) => api.wallet.startTopUp(credits),
    onSuccess: () => {
      // Credits land when Razorpay's signed webhook reaches the server — not here.
      setMessage({
        tone: "info",
        text: "Payment started. Your balance updates as soon as the payment clears.",
      });
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: (cause: unknown) =>
      setMessage({
        tone: "error",
        text: cause instanceof Error ? cause.message : "The top-up could not be started.",
      }),
  });

  return (
    <main className="mx-auto w-full max-w-lg space-y-8 px-5 py-8">
      <section className="border border-rule bg-card p-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft">Balance</p>
        <p className="mt-1 font-display text-5xl font-bold">
          {balance.isPending ? "—" : <Credits value={balance.data?.credits ?? 0} />}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Add credits</h2>
        <div className="grid grid-cols-3 gap-2">
          {PACKS.map((pack) => (
            <Button
              key={pack}
              variant="quiet"
              onClick={() => topUp.mutate(pack)}
              disabled={topUp.isPending}
            >
              +{pack}
            </Button>
          ))}
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">Activity</h2>

        {ledger.isPending && <Spinner />}
        {ledger.data?.length === 0 && <Notice>Nothing yet. Add credits to buy your first pass.</Notice>}

        <ul className="divide-y divide-rule border-y border-rule">
          {ledger.data?.map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-4 py-3">
              <div>
                <p className="text-sm">{entry.reason}</p>
                <p className="font-mono text-xs text-ink-soft">
                  {new Date(entry.occurredAt).toLocaleString("en-IN")}
                </p>
              </div>
              <span
                className={`font-mono text-sm tabular-nums ${
                  entry.signed < 0 ? "text-ink" : "text-valid"
                }`}
              >
                {entry.signed > 0 ? "+" : ""}
                {entry.signed}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
