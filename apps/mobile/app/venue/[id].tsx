import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { newIdempotencyKey } from "@venue/shared";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import { Button, Loading, Notice, styles } from "@/ui/primitives";
import { PlanOptions } from "@/venue-types/registry";

export default function VenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const venueId = String(id);
  const queryClient = useQueryClient();

  const [planId, setPlanId] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const venue = useQuery({ queryKey: ["venue", venueId], queryFn: () => api.venues.byId(venueId) });
  const plan = venue.data?.plans.find((p) => p.id === planId) ?? venue.data?.plans[0];

  const purchase = useMutation({
    mutationFn: () =>
      api.passes.purchase(
        {
          venueId,
          accessPlanId: plan!.id,
          requestedFor: new Date().toISOString(),
          options,
        },
        // Minted per attempt, so a double-tap cannot buy two passes.
        newIdempotencyKey(),
      ),
    onSuccess: (pass) => {
      void queryClient.invalidateQueries({ queryKey: ["balance"] });
      void queryClient.invalidateQueries({ queryKey: ["passes"] });
      router.replace(`/pass/${pass.id}`);
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "The pass could not be bought."),
  });

  if (venue.isPending) return <Loading />;
  if (!venue.data || !plan) {
    return (
      <View style={styles.screen}>
        <Notice tone="error">We could not find that place.</Notice>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View>
        <Text style={styles.subheading}>{venue.data.typeKey.toUpperCase()}</Text>
        <Text style={[styles.heading, { marginTop: 4 }]}>{venue.data.name}</Text>
        {venue.data.city && (
          <Text style={{ color: theme.inkSoft, marginTop: 2 }}>{venue.data.city}</Text>
        )}
      </View>

      {venue.data.plans.length > 1 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {venue.data.plans.map((option) => {
            const active = option.id === plan.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setPlanId(option.id)}
                style={{
                  borderWidth: 1,
                  borderColor: active ? theme.ink : theme.rule,
                  backgroundColor: active ? theme.ink : theme.card,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                <Text style={{ color: active ? theme.paper : theme.ink, fontSize: 13 }}>
                  {option.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.card}>
        <PlanOptions
          typeKey={venue.data.typeKey}
          plan={plan}
          value={options}
          onChange={setOptions}
        />
      </View>

      {error && <Notice tone="error">{error}</Notice>}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Text style={{ flex: 1, fontSize: 20, color: theme.ink, fontVariant: ["tabular-nums"] }}>
          {plan.cost} cr
        </Text>
        <View style={{ flex: 1 }}>
          <Button
            label={purchase.isPending ? "Buying…" : "Buy pass"}
            onPress={() => purchase.mutate()}
            disabled={purchase.isPending}
          />
        </View>
      </View>
    </ScrollView>
  );
}
