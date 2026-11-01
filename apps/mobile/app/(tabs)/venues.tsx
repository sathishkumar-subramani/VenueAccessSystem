import { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import { Loading, Notice, styles } from "@/ui/primitives";

export default function VenuesScreen() {
  const [type, setType] = useState("");

  const types = useQuery({ queryKey: ["venue-types"], queryFn: () => api.venues.types() });
  const venues = useQuery({
    queryKey: ["venues", type],
    queryFn: () => api.venues.list(type ? { type } : {}),
  });

  return (
    <View style={styles.screen}>
      {/* Driven by the server, so it always matches PLUGINS_ENABLED. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip label="Everything" active={type === ""} onPress={() => setType("")} />
          {types.data?.map((venueType) => (
            <Chip
              key={venueType.key}
              label={venueType.displayName}
              active={type === venueType.key}
              onPress={() => setType(venueType.key)}
            />
          ))}
        </View>
      </ScrollView>

      {venues.isPending ? (
        <Loading label="Finding places" />
      ) : venues.data?.length === 0 ? (
        <Notice>No places here yet. Try another filter.</Notice>
      ) : (
        <FlatList
          data={venues.data ?? []}
          keyExtractor={(venue) => venue.id}
          contentContainerStyle={{ gap: 12 }}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/venue/${item.id}`)}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <Text style={{ fontSize: 16, fontWeight: "700", color: theme.ink, flex: 1 }}>
                  {item.name}
                </Text>
                <Text style={{ fontSize: 11, color: theme.inkSoft, textTransform: "uppercase" }}>
                  {item.typeKey}
                </Text>
              </View>

              {item.city && (
                <Text style={{ color: theme.inkSoft, fontSize: 13, marginTop: 2 }}>{item.city}</Text>
              )}

              {item.plans.length > 0 && (
                <Text style={{ marginTop: 8, color: theme.ink, fontVariant: ["tabular-nums"] }}>
                  From {Math.min(...item.plans.map((plan) => plan.cost))} cr
                </Text>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: active ? theme.ink : theme.rule,
        backgroundColor: active ? theme.ink : theme.card,
        paddingHorizontal: 14,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: active ? theme.paper : theme.ink, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}
