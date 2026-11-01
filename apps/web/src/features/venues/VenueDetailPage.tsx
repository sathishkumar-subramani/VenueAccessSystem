import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { newIdempotencyKey } from "@venue/shared";
import { api } from "@/lib/api";
import { Button, Credits, Notice, Spinner } from "@/ui/primitives";
import { planOptionsFor } from "@/venue-types/registry";

export function VenueDetailPage() {
  const { venueId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [planId, setPlanId] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const venue = useQuery({
    queryKey: ["venue", venueId],
    queryFn: () => api.venues.byId(venueId),
  });

  const plan = venue.data?.plans.find((p) => p.id === planId) ?? venue.data?.plans[0];
  const PlanOptions = planOptionsFor(venue.data?.typeKey ?? "");

  const purchase = useMutation({
    mutationFn: () =>
      api.passes.purchase(
        {
          venueId,
          accessPlanId: plan!.id,
          requestedFor: new Date().toISOString(),
          options,
        },
        // Minted once per attempt, so a double-tap cannot buy two passes.
        newIdempotencyKey(),
      ),
    onSuccess: (pass) => {
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
      void queryClient.invalidateQueries({ queryKey: ["passes"] });
      navigate(`/passes/${pass.id}`);
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "The pass could not be bought."),
  });

  if (venue.isPending) return <Spinner />;
  if (!venue.data || !plan) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-8">
        <Notice tone="error">We could not find that place.</Notice>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg space-y-6 px-5 py-8">
      <header>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft">
          {venue.data.typeKey}
        </p>
        <h1 className="font-display text-2xl font-bold">{venue.data.name}</h1>
        {venue.data.city && <p className="text-sm text-ink-soft">{venue.data.city}</p>}
      </header>

      {venue.data.plans.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {venue.data.plans.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPlanId(option.id)}
              aria-pressed={option.id === plan.id}
              className={`border px-3 py-1.5 text-sm ${
                option.id === plan.id ? "border-ink bg-ink text-paper" : "border-rule bg-card"
              }`}
            >
              {option.name}
            </button>
          ))}
        </div>
      )}

      <section className="space-y-4 border border-rule bg-card p-5">
        <PlanOptions plan={plan} value={options} onChange={setOptions} />
      </section>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex items-center justify-between gap-4">
        <p className="text-lg">
          <Credits value={plan.cost} />
        </p>
        <Button onClick={() => purchase.mutate()} disabled={purchase.isPending}>
          {purchase.isPending ? "Buying…" : "Buy pass"}
        </Button>
      </div>
    </main>
  );
}
