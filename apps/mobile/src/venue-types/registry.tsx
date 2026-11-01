import type { ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import type { PlanDto } from "@venue/shared";
import { theme } from "../lib/theme";

export interface PlanOptionsProps {
  plan: PlanDto;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

const num = (config: Record<string, unknown>, key: string, fallback: number): number =>
  typeof config[key] === "number" ? (config[key] as number) : fallback;

const Row = ({ label, value }: { label: string; value: string }) => (
  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
    <Text style={{ color: theme.inkSoft, fontSize: 14 }}>{label}</Text>
    <Text style={{ color: theme.ink, fontSize: 14, fontVariant: ["tabular-nums"] }}>{value}</Text>
  </View>
);

function GymOptions({ plan }: PlanOptionsProps) {
  const config = plan.config ?? {};
  return (
    <View>
      <Row label="Valid for" value={`${num(config, "durationHours", 24)} hours`} />
      <Row label="Entries" value={String(num(config, "maxEntries", 1))} />
      <Row label="Re-entry" value={config.reEntry ? "Allowed" : "Single entry"} />
    </View>
  );
}

/** Coworking needs a quantity the gym has no concept of — and it changes the price. */
function CoworkingOptions({ plan, value, onChange }: PlanOptionsProps) {
  const config = plan.config ?? {};
  const blockHours = num(config, "blockMinutes", 240) / 60;
  const selected = Number(value.blocks ?? "1");

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: theme.inkSoft, fontSize: 14 }}>How long do you need the desk?</Text>

      <View style={{ flexDirection: "row", gap: 8 }}>
        {[1, 2, 3].map((blocks) => {
          const active = selected === blocks;
          return (
            <Pressable
              key={blocks}
              onPress={() => onChange({ ...value, blocks: String(blocks) })}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: active ? theme.stamp : theme.rule,
                backgroundColor: active ? theme.stamp : theme.card,
              }}
            >
              <Text style={{ color: active ? "#fff" : theme.ink, fontVariant: ["tabular-nums"] }}>
                {blocks * blockHours}h
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={{ color: theme.inkSoft, fontSize: 12 }}>
        Open {num(config, "openHour", 9)}:00 to {num(config, "closeHour", 21)}:00. Step out and come
        back as often as you like.
      </Text>
    </View>
  );
}

function ExpoOptions({ plan }: PlanOptionsProps) {
  const config = plan.config ?? {};
  const dates = Array.isArray(config.eventDates) ? (config.eventDates as string[]) : [];

  return (
    <View>
      {dates.length > 0 && <Row label="Running on" value={dates.join(", ")} />}
      <Row
        label="Doors"
        value={`${num(config, "doorsOpenHour", 10)}:00 – ${num(config, "doorsCloseHour", 18)}:00`}
      />
      <Row label="Entries" value={`${num(config, "maxEntries", 3)} (re-entry allowed)`} />
    </View>
  );
}

const GenericOptions = () => (
  <Text style={{ color: theme.inkSoft, fontSize: 14 }}>This pass has no options to choose.</Text>
);

const renderers: Record<string, (props: PlanOptionsProps) => ReactElement> = {
  gym: GymOptions,
  coworking: CoworkingOptions,
  expo: ExpoOptions,
};

/**
 * Mirrors PLUGINS_ENABLED on the server. An unknown key falls back to the plain
 * renderer rather than crashing — a shipped app cannot be redeployed as quickly
 * as the API, so it must tolerate a venue type it has never heard of.
 */
export function PlanOptions({ typeKey, ...props }: PlanOptionsProps & { typeKey: string }) {
  const Renderer = renderers[typeKey.toLowerCase()] ?? GenericOptions;
  return <Renderer {...props} />;
}
