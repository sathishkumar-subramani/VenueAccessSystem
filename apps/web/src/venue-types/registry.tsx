import type { ComponentType } from "react";
import type { PlanDto } from "@venue/shared";

export interface PlanOptionsProps {
  plan: PlanDto;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

function readConfig(plan: PlanDto): Record<string, unknown> {
  return plan.config ?? {};
}

const num = (config: Record<string, unknown>, key: string, fallback: number): number =>
  typeof config[key] === "number" ? (config[key] as number) : fallback;

function GymPlanOptions({ plan }: PlanOptionsProps) {
  const config = readConfig(plan);

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
      <dt className="text-ink-soft">Valid for</dt>
      <dd className="font-mono">{num(config, "durationHours", 24)} hours</dd>
      <dt className="text-ink-soft">Entries</dt>
      <dd className="font-mono">{num(config, "maxEntries", 1)}</dd>
      <dt className="text-ink-soft">Re-entry</dt>
      <dd className="font-mono">{config.reEntry ? "Allowed" : "Single entry"}</dd>
    </dl>
  );
}

/** Coworking needs a quantity the gym has no concept of — and it changes the price. */
function CoworkingPlanOptions({ plan, value, onChange }: PlanOptionsProps) {
  const config = readConfig(plan);
  const blockHours = num(config, "blockMinutes", 240) / 60;
  const selected = Number(value.blocks ?? "1");

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">How long do you need the desk?</p>
      <div className="flex gap-2">
        {[1, 2, 3].map((blocks) => (
          <button
            key={blocks}
            type="button"
            onClick={() => onChange({ ...value, blocks: String(blocks) })}
            aria-pressed={selected === blocks}
            className={`flex-1 border px-3 py-2 font-mono text-sm transition-colors ${
              selected === blocks
                ? "border-stamp bg-stamp text-white"
                : "border-rule bg-card hover:border-ink-soft"
            }`}
          >
            {blocks * blockHours}h
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-soft">
        Open {num(config, "openHour", 9)}:00 to {num(config, "closeHour", 21)}:00. Step out and come
        back as often as you like.
      </p>
    </div>
  );
}

function ExpoPlanOptions({ plan }: PlanOptionsProps) {
  const config = readConfig(plan);
  const dates = Array.isArray(config.eventDates) ? (config.eventDates as string[]) : [];

  return (
    <div className="space-y-2 text-sm">
      {dates.length > 0 && (
        <p>
          <span className="text-ink-soft">Running on </span>
          <span className="font-mono">{dates.join(", ")}</span>
        </p>
      )}
      <p>
        <span className="text-ink-soft">Doors </span>
        <span className="font-mono">
          {num(config, "doorsOpenHour", 10)}:00 – {num(config, "doorsCloseHour", 18)}:00
        </span>
      </p>
      <p className="text-ink-soft">
        {num(config, "maxEntries", 3)} entries, so you can step out for lunch.
      </p>
    </div>
  );
}

const GenericPlanOptions = () => (
  <p className="text-sm text-ink-soft">This pass has no options to choose.</p>
);

/**
 * Mirrors PLUGINS_ENABLED on the server. An unknown key falls back to the plain
 * renderer rather than throwing — the backend is allowed to be ahead of a
 * client the user has not reloaded yet.
 */
const renderers: Record<string, ComponentType<PlanOptionsProps>> = {
  gym: GymPlanOptions,
  coworking: CoworkingPlanOptions,
  expo: ExpoPlanOptions,
};

export const planOptionsFor = (typeKey: string): ComponentType<PlanOptionsProps> =>
  renderers[typeKey.toLowerCase()] ?? GenericPlanOptions;
