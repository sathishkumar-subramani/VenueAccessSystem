import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Credits, Notice, Spinner } from "@/ui/primitives";

export function VenuesPage() {
  const [type, setType] = useState("");

  // The filters come from the server, so they always match what is enabled.
  const types = useQuery({ queryKey: ["venue-types"], queryFn: () => api.venues.types() });

  const venues = useQuery({
    queryKey: ["venues", type],
    queryFn: () => api.venues.list(type ? { type } : {}),
  });

  return (
    <main className="mx-auto w-full max-w-lg space-y-6 px-5 py-8">
      <h1 className="font-display text-2xl font-bold">Where are you going?</h1>

      <div className="flex flex-wrap gap-2">
        <FilterChip label="Everything" active={type === ""} onClick={() => setType("")} />
        {types.data?.map((venueType) => (
          <FilterChip
            key={venueType.key}
            label={venueType.displayName}
            active={type === venueType.key}
            onClick={() => setType(venueType.key)}
          />
        ))}
      </div>

      {venues.isPending && <Spinner label="Finding places" />}
      {venues.data?.length === 0 && <Notice>No places here yet. Try another filter.</Notice>}

      <ul className="space-y-3">
        {venues.data?.map((venue) => (
          <li key={venue.id}>
            <Link
              to={`/venues/${venue.id}`}
              className="block border border-rule bg-card p-4 transition-colors hover:border-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stamp"
            >
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-display font-bold">{venue.name}</h2>
                <span className="font-mono text-xs uppercase tracking-wide text-ink-soft">
                  {venue.typeKey}
                </span>
              </div>
              {venue.city && <p className="text-sm text-ink-soft">{venue.city}</p>}
              {venue.plans.length > 0 && (
                <p className="mt-2 text-sm">
                  From <Credits value={Math.min(...venue.plans.map((plan) => plan.cost))} />
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`border px-3 py-1.5 text-sm transition-colors ${
        active ? "border-ink bg-ink text-paper" : "border-rule bg-card hover:border-ink-soft"
      }`}
    >
      {label}
    </button>
  );
}
