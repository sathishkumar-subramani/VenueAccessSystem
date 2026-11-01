import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Notice, Spinner } from "@/ui/primitives";

export function MyPassesPage() {
  const passes = useQuery({ queryKey: ["passes"], queryFn: () => api.passes.mine() });

  if (passes.isPending) return <Spinner label="Loading your passes" />;

  if (passes.data?.length === 0) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-8">
        <Notice>No passes yet. Pick a place and buy one — it shows up here straight away.</Notice>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg space-y-4 px-5 py-8">
      <h1 className="font-display text-2xl font-bold">Your passes</h1>

      <ul className="space-y-3">
        {passes.data?.map((pass) => (
          <li key={pass.id}>
            <Link
              to={`/passes/${pass.id}`}
              className="flex items-baseline justify-between gap-4 border border-rule bg-card p-4 hover:border-ink-soft"
            >
              <div>
                <p className="font-display font-bold">{pass.venueName}</p>
                <p className="font-mono text-xs text-ink-soft">
                  until {new Date(pass.validUntil).toLocaleString("en-IN")}
                </p>
              </div>
              <span
                className={`font-mono text-xs uppercase ${
                  pass.state === "active" ? "text-valid" : "text-ink-soft"
                }`}
              >
                {pass.state}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
